'use strict';

/**
 * AI Blocks Mapper — converte resultados de tools em BLOCOS interativos
 * (generative UI) que o frontend renderiza como tabelas filtráveis, cards de
 * métrica, alertas, etc. (Fase 3).
 *
 * Contrato do bloco: { kind, ...dados }. O frontend (AiBlocks.jsx) mapeia `kind`
 * para um componente. Blocos são anexados à mensagem do assistant (JSONB) e
 * emitidos via evento SSE `block` durante o streaming.
 *
 * Best-effort: se um resultado não casar com nenhum mapeamento, retorna null e o
 * fluxo segue só com o texto do modelo.
 */

/** Mapeia o resultado de UMA tool para um bloco (ou null). */
function toolResultToBlock(name, result) {
  if (!result || typeof result !== 'object') return null;

  switch (name) {
    case 'list_services': {
      const rows = Array.isArray(result.services) ? result.services : [];
      if (!rows.length) return null;
      return {
        kind: 'table',
        table: 'services',
        title: `Serviços (${result.count ?? rows.length})`,
        columns: [
          { key: 'name', label: 'Nome' },
          { key: 'image', label: 'Imagem' },
          { key: 'status', label: 'Status', badge: true },
          { key: 'ports', label: 'Portas' },
          { key: 'group', label: 'Grupo' },
        ],
        rows: rows.map((s) => ({
          id: s.id,
          name: s.name,
          image: s.image,
          status: s.status,
          ports: Array.isArray(s.ports) ? s.ports.join(', ') : (s.ports || ''),
          group: s.group || '',
        })),
      };
    }

    case 'list_docker_containers': {
      const rows = Array.isArray(result.containers) ? result.containers : [];
      if (!rows.length) return null;
      return {
        kind: 'table',
        table: 'containers',
        title: `Containers (${result.count ?? rows.length})`,
        columns: [
          { key: 'name', label: 'Nome' },
          { key: 'image', label: 'Imagem' },
          { key: 'state', label: 'Estado', badge: true },
          { key: 'status', label: 'Status' },
          { key: 'ports', label: 'Portas' },
        ],
        rows: rows.map((c) => ({
          id: c.id,
          name: c.name,
          image: c.image,
          state: c.state,
          status: c.status,
          ports: Array.isArray(c.ports)
            ? c.ports.map((p) => (typeof p === 'string' ? p : `${p.PublicPort || ''}→${p.PrivatePort || ''}`)).join(', ')
            : (c.ports || ''),
        })),
      };
    }

    case 'list_databases': {
      const rows = Array.isArray(result.databases) ? result.databases : [];
      if (!rows.length) return null;
      return {
        kind: 'table',
        table: 'databases',
        title: `Bancos de dados (${result.count ?? rows.length})`,
        columns: [
          { key: 'name', label: 'Nome' },
          { key: 'type', label: 'Tipo', badge: true },
          { key: 'host', label: 'Host' },
          { key: 'port', label: 'Porta' },
          { key: 'database', label: 'Database' },
          { key: 'projects', label: 'Projetos' },
        ],
        rows: rows.map((r) => ({
          id: r.id, name: r.name, type: r.type, host: r.host, port: r.port,
          database: r.database, projects: Array.isArray(r.projects) ? r.projects.join(', ') : '',
        })),
      };
    }

    case 'list_sites': {
      const rows = Array.isArray(result.sites) ? result.sites : [];
      if (!rows.length) return null;
      return {
        kind: 'table',
        table: 'sites',
        title: `Sites (${result.count ?? rows.length})`,
        columns: [
          { key: 'name', label: 'Nome' },
          { key: 'domain', label: 'Domínio' },
          { key: 'status', label: 'Status', badge: true },
          { key: 'ssl', label: 'SSL', badge: true },
        ],
        rows: rows.map((s) => ({
          id: s.id, name: s.name, domain: s.domain, status: s.status,
          ssl: s.ssl ? 'sim' : 'não',
        })),
      };
    }

    case 'list_nginx': {
      const rows = Array.isArray(result.vhosts) ? result.vhosts : [];
      if (!rows.length) return null;
      return {
        kind: 'table',
        table: 'nginx',
        title: `Nginx vhosts (${result.count ?? rows.length})`,
        columns: [
          { key: 'name', label: 'Nome' },
          { key: 'domains', label: 'Domínios' },
          { key: 'enabled', label: 'Ativo', badge: true },
          { key: 'ssl', label: 'SSL', badge: true },
        ],
        rows: rows.map((v) => ({
          id: v.id, name: v.name,
          domains: Array.isArray(v.domains) ? v.domains.join(', ') : (v.domains || ''),
          enabled: v.enabled ? 'sim' : 'não',
          ssl: v.ssl ? 'sim' : 'não',
        })),
      };
    }

    case 'get_server_metrics': {
      const items = [];
      if (result.cpu != null) items.push({ label: 'CPU', value: `${Number(result.cpu).toFixed(0)}%`, percent: Number(result.cpu) });
      if (result.memory?.usedPercent != null) items.push({ label: 'Memória', value: `${Number(result.memory.usedPercent).toFixed(0)}%`, percent: Number(result.memory.usedPercent) });
      if (result.disk?.usedPercent != null) items.push({ label: 'Disco', value: `${Number(result.disk.usedPercent).toFixed(0)}%`, percent: Number(result.disk.usedPercent) });
      if (!items.length) return null;
      return { kind: 'metrics', title: 'Métricas do servidor', items };
    }

    case 'get_service_metrics': {
      const items = [];
      if (result.cpuPercent != null) items.push({ label: 'CPU', value: `${Number(result.cpuPercent).toFixed(0)}%`, percent: Number(result.cpuPercent) });
      if (result.memoryPercent != null) items.push({ label: 'RAM', value: `${Number(result.memoryPercent).toFixed(0)}%`, percent: Number(result.memoryPercent) });
      if (result.memoryUsage) items.push({ label: 'RAM usada', value: String(result.memoryUsage) });
      if (result.uptimeSeconds != null) items.push({ label: 'Uptime', value: `${Math.round(result.uptimeSeconds / 3600)}h` });
      if (result.restartCount != null) items.push({ label: 'Restarts', value: String(result.restartCount) });
      if (!items.length) return null;
      return { kind: 'metrics', title: `Métricas do serviço`, items };
    }

    default:
      return null;
  }
}

/** Bloco de erro para falha de tool. */
function errorBlock(name, message) {
  return { kind: 'error_alert', tool: name, message: String(message || 'erro desconhecido') };
}

module.exports = { toolResultToBlock, errorBlock };
