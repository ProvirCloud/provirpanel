/**
 * Zeus Context Collector
 * Coleta dados em tempo real do painel para injetar como contexto no chat da IA
 */

const collectLocalContext = async (api, token, hostHeader) => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (hostHeader) headers['Host'] = hostHeader;
  const context = {};

  const safeFetch = async (url) => {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  };

  // Sites
  const sitesData = await safeFetch(`${api}/sites`);
  if (sitesData) {
    const sites = sitesData.sites || sitesData || [];
    context.sites = sites.map(s => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      status: s.status,
      behindProxy: s.behindProxy,
      ssl: s.ssl,
      containers: s.containers ? Object.keys(s.containers).length : 0
    }));
  }

  // Docker services
  const dockerData = await safeFetch(`${api}/docker/services`);
  if (dockerData) {
    const services = Array.isArray(dockerData) ? dockerData : (dockerData.services || []);
    const runningServices = services.filter(s => s.status === 'running' || s.runtimeState === 'running');

    context.services = await Promise.all(services.map(async s => {
      const base = {
        id: s.id,
        name: s.name,
        image: s.image,
        status: s.status,
        ports: s.ports,
        group: s.group
      };
      if (!s.id || !runningServices.find(r => r.id === s.id)) return base;
      const metricsData = await safeFetch(`${api}/docker/services/${s.id}/metrics`);
      const current = metricsData?.metrics?.current;
      if (!current) return base;
      return {
        ...base,
        metrics: {
          cpuPercent: current.cpuPercent,
          memoryUsage: current.memoryUsage,
          memoryLimit: current.memoryLimit,
          memoryPercent: current.memoryPercent,
          networkRxBytes: current.networkRxBytes,
          networkTxBytes: current.networkTxBytes,
          diskReadBytes: current.diskReadBytes,
          diskWriteBytes: current.diskWriteBytes,
          restartCount: current.restartCount,
          uptimeSeconds: current.uptimeSeconds
        }
      };
    }));

    // Collect changelogs for services with recent deploys
    for (const s of services.slice(0, 10)) {
      if (!s.id) continue;
      const clData = await safeFetch(`${api}/docker/services/${s.id}/changelog?limit=3`);
      if (clData?.changelog?.length) {
        if (!context.changelogs) context.changelogs = [];
        context.changelogs.push({ service: s.name, entries: clData.changelog });
      }
    }
  }

  // Metrics
  const metricsData = await safeFetch(`${api}/api/metrics`);
  if (metricsData) {
    context.metrics = {
      cpu: metricsData.cpu,
      memory: metricsData.memory,
      disk: metricsData.disk
    };
  }

  // Nginx servers
  const nginxData = await safeFetch(`${api}/nginx/servers`);
  if (nginxData) {
    const servers = Array.isArray(nginxData) ? nginxData : (nginxData.servers || []);
    context.nginx = servers.map(s => ({
      id: s.id,
      name: s.name,
      domains: s.domains || s.serverNames,
      enabled: s.enabled,
      ssl: s.ssl
    }));
  }

  return context;
};

const formatContextForPrompt = (context, panelName) => {
  const parts = [`## Dados em tempo real do painel "${panelName}":\n`];

  if (context.sites && context.sites.length) {
    parts.push(`### Sites WordPress (${context.sites.length}):`);
    context.sites.forEach(s => {
      parts.push(`- ${s.domain || s.name} | status: ${s.status || 'unknown'} | SSL: ${s.ssl ? 'sim' : 'não'} | proxy: ${s.behindProxy ? 'sim' : 'não'}`);
    });
    parts.push('');
  }

  if (context.services && context.services.length) {
    parts.push(`### Containers/Serviços Docker (${context.services.length}):`);
    context.services.forEach(s => {
      let line = `- ${s.name} | imagem: ${s.image || '?'} | status: ${s.status || '?'}`;
      if (s.metrics) {
        const m = s.metrics;
        const fmt = (bytes) => bytes == null ? '?' : bytes >= 1073741824 ? `${(bytes/1073741824).toFixed(1)}GB` : bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)}MB` : bytes >= 1024 ? `${(bytes/1024).toFixed(1)}KB` : `${bytes}B`;
        line += ` | CPU: ${m.cpuPercent ?? 0}%`;
        line += ` | RAM: ${fmt(m.memoryUsage)} (${m.memoryPercent ?? 0}%)`;
        if (m.networkRxBytes != null) line += ` | Rede in/out: ${fmt(m.networkRxBytes)}/${fmt(m.networkTxBytes)}`;
        if (m.diskReadBytes != null) line += ` | Disco r/w: ${fmt(m.diskReadBytes)}/${fmt(m.diskWriteBytes)}`;
        if (m.restartCount != null) line += ` | restarts: ${m.restartCount}`;
        if (m.uptimeSeconds != null) {
          const u = m.uptimeSeconds;
          const upStr = u >= 86400 ? `${Math.floor(u/86400)}d ${Math.floor((u%86400)/3600)}h` : u >= 3600 ? `${Math.floor(u/3600)}h ${Math.floor((u%3600)/60)}m` : `${Math.floor(u/60)}m`;
          line += ` | uptime: ${upStr}`;
        }
      }
      parts.push(line);
    });
    parts.push('');
  }

  if (context.metrics) {
    parts.push('### Métricas do servidor:');
    if (context.metrics.cpu) parts.push(`- CPU: ${context.metrics.cpu.usage || context.metrics.cpu}%`);
    if (context.metrics.memory) {
      const mem = context.metrics.memory;
      parts.push(`- RAM: ${mem.usedPercent || mem.used || '?'}% usado`);
    }
    if (context.metrics.disk) {
      const disk = context.metrics.disk;
      if (Array.isArray(disk) && disk[0]) parts.push(`- Disco: ${disk[0].usedPercent || disk[0].use || '?'}% usado`);
    }
    parts.push('');
  }

  if (context.nginx && context.nginx.length) {
    parts.push(`### Configurações Nginx (${context.nginx.length} virtual hosts):`);
    context.nginx.forEach(s => {
      const domains = Array.isArray(s.domains) ? s.domains.join(', ') : (s.domains || s.name || s.file);
      let line = `- **${domains}**`;
      if (s.file) line += ` (arquivo: ${s.file})`;
      line += ` | ativo: ${s.enabled !== false ? 'sim' : 'não'}`;
      if (s.ssl !== undefined) line += ` | SSL: ${s.ssl ? 'sim' : 'não'}`;
      if (s.proxyPass) line += ` | proxy_pass: ${s.proxyPass}`;
      if (s.listen) line += ` | listen: ${s.listen}`;
      parts.push(line);
    });
    parts.push('');
  }

  if (context.changelogs && context.changelogs.length) {
    parts.push('### Changelogs recentes dos serviços:');
    context.changelogs.forEach(cl => {
      parts.push(`\n**${cl.service}**:`);
      cl.entries.forEach(entry => {
        parts.push(`  Versão ${entry.version} (${entry.promotedAt ? new Date(entry.promotedAt).toLocaleDateString('pt-BR') : '?'}):`);
        (entry.commits || []).forEach(c => {
          parts.push(`    - ${c.message} (${c.author})`);
        });
      });
    });
    parts.push('');
  }

  if (context.disk) {
    parts.push('### Disco:');
    parts.push(`- Total: ${context.disk.total} | Usado: ${context.disk.used} (${context.disk.usedPercent}) | Livre: ${context.disk.available}`);
    parts.push('');
  }

  if (context.recentErrors && context.recentErrors.length) {
    parts.push('### Últimos erros do log nginx (NÃO são configurações, são apenas logs de erro recentes):');
    context.recentErrors.forEach(e => parts.push(`- ${e}`));
    parts.push('');
  }

  return parts.join('\n');
};

const collectPanelsContext = async () => {
  const GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://localhost:3002';
  const API_KEY = process.env.ZEUS_API_KEY || '';
  try {
    const res = await fetch(`${GATEWAY_URL}/api/panels?internal=1`, {
      headers: { 'x-api-key': API_KEY },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.panels || [];
  } catch { return []; }
};

const formatPanelsContext = (panels) => {
  if (!panels || !panels.length) return '';
  const parts = ['## Painéis conectados ao hub central:\n'];
  panels.forEach(p => {
    parts.push(`### ${p.name} (${p.url})`);
    parts.push(`- Status: ${p.status} | Sites: ${p.sitesCount} | Último sync: ${p.lastSyncAt || 'nunca'}`);
    if (p.description) parts.push(`- ${p.description}`);
  });
  return parts.join('\n');
};

module.exports = { collectLocalContext, formatContextForPrompt, collectPanelsContext, formatPanelsContext };
