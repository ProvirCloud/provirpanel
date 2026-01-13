'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const DockerManager = require('../services/DockerManager');
const pool = require('../config/database');

const router = express.Router();
const dockerManager = new DockerManager();
const serviceLogsPath = path.join(__dirname, '..', 'logs', 'service-updates.log');
const appLogsPath = path.join(__dirname, '..', 'logs', 'app.log');

// Função para ler logs do PM2
const getPM2Logs = () => {
  try {
    const logsDir = path.join(process.env.HOME || '/root', '.pm2/logs');
    const logFiles = fs.readdirSync(logsDir).filter(file => 
      file.includes('provirpanel-backend') && (file.includes('out') || file.includes('error'))
    );
    
    const logs = [];
    
    logFiles.forEach(file => {
      const filePath = path.join(logsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        if (line.trim()) {
          const isError = file.includes('error');
          logs.push({
            timestamp: new Date().toISOString(),
            level: isError ? 'error' : 'info',
            source: 'pm2',
            message: line.trim()
          });
        }
      });
    });
    
    return logs.slice(-100); // Últimas 100 linhas
  } catch (error) {
    return [{
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Não foi possível ler logs do PM2: ' + error.message
    }];
  }
};

const getServiceUpdateLogs = () => {
  try {
    if (!fs.existsSync(serviceLogsPath)) {
      return [{
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'service-update',
        message: 'Nenhuma atualizacao registrada ainda.'
      }];
    }
    const content = fs.readFileSync(serviceLogsPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());
    const logs = lines
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          if (!parsed || !parsed.timestamp || !parsed.message) {
            return null;
          }
          return {
            timestamp: parsed.timestamp,
            level: parsed.level || 'info',
            source: parsed.source || 'service-update',
            message: parsed.message
          };
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
    return logs.slice(-200);
  } catch (error) {
    return [{
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Nao foi possivel ler logs de atualizacao: ' + error.message
    }];
  }
};

const getAppLogs = () => {
  try {
    if (!fs.existsSync(appLogsPath)) {
      return [];
    }
    const content = fs.readFileSync(appLogsPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());
    const logs = lines
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          if (!parsed || !parsed.timestamp || !parsed.message) {
            return null;
          }
          return {
            timestamp: parsed.timestamp,
            level: parsed.level || 'info',
            source: parsed.source || 'backend',
            message: parsed.message
          };
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
    return logs.slice(-200);
  } catch (error) {
    return [{
      timestamp: new Date().toISOString(),
      level: 'warn',
      source: 'backend',
      message: 'Nao foi possivel ler logs da aplicacao: ' + error.message
    }];
  }
};

const getRuntimeLogs = () => ([
  {
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'nodejs',
    message: `Node.js ativo (pid ${process.pid}, uptime ${Math.round(process.uptime())}s)`
  }
]);

const readDockerContainerLogs = (containerId, timeoutMs = 2000) =>
  new Promise((resolve, reject) => {
    const container = dockerManager.docker.getContainer(containerId);
    let timeoutId = null;
    container.logs({ stdout: true, stderr: true, tail: 50 }, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      timeoutId = setTimeout(() => {
        try {
          stream.destroy();
        } catch {
          // ignore
        }
        resolve('');
      }, timeoutMs);
      let buffer = Buffer.alloc(0);
      stream.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
      });
      stream.on('end', () => {
        if (timeoutId) clearTimeout(timeoutId);
        try {
          const lines = [];
          let offset = 0;
          while (offset + 8 <= buffer.length) {
            const size = buffer.readUInt32BE(offset + 4);
            const start = offset + 8;
            const end = start + size;
            if (end > buffer.length) break;
            const payload = buffer.slice(start, end);
            lines.push(payload.toString('utf8'));
            offset = end;
          }
          if (!lines.length) {
            resolve(buffer.toString('utf8'));
            return;
          }
          resolve(lines.join(''));
        } catch (parseErr) {
          resolve(buffer.toString('utf8'));
        }
      });
      stream.on('error', (streamErr) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(streamErr);
      });
    });
  });

const withTimeout = (promise, timeoutMs, fallback) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
  ]);

const tailFileLines = (filePath, maxLines = 200) => {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim());
  return lines.slice(-maxLines);
};

const getNginxLogs = () => {
  const logs = [];
  const accessLog = '/var/log/nginx/access.log';
  const errorLog = '/var/log/nginx/error.log';

  if (fs.existsSync(accessLog)) {
    tailFileLines(accessLog, 100).forEach((line) => {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'nginx:access',
        message: line
      });
    });
  }

  if (fs.existsSync(errorLog)) {
    tailFileLines(errorLog, 100).forEach((line) => {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: 'nginx:error',
        message: line
      });
    });
  }

  return logs;
};

const findLatestPostgresLog = () => {
  const candidates = [
    '/var/log/postgresql',
    '/var/lib/postgresql/data/log',
    '/var/lib/postgresql/data/pg_log'
  ];

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.includes('postgresql') && name.endsWith('.log'))
      .map((name) => ({
        name,
        path: path.join(dir, name),
        stat: fs.statSync(path.join(dir, name))
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (files.length) {
      return files[0].path;
    }
  }
  return null;
};

const getPostgresLogs = () => {
  const logPath = findLatestPostgresLog();
  if (!logPath) {
    return [];
  }
  return tailFileLines(logPath, 120).map((line) => ({
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'postgres',
    message: line
  }));
};

// Detecta o nivel do log baseado em palavras-chave
const detectLogLevel = (message) => {
  const msgLower = message.toLowerCase();
  if (msgLower.includes('error') || msgLower.includes('fatal') || msgLower.includes('exception') ||
      msgLower.includes('failed') || msgLower.includes('panic')) {
    return 'error';
  }
  if (msgLower.includes('warn') || msgLower.includes('warning') || msgLower.includes('deprecated')) {
    return 'warn';
  }
  if (msgLower.includes('debug') || msgLower.includes('trace')) {
    return 'debug';
  }
  return 'info';
};

// Extrai timestamp do log se disponível
const extractTimestamp = (line) => {
  // Tenta ISO format: 2025-01-13T12:34:56Z
  const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)/);
  if (isoMatch) {
    try {
      const date = new Date(isoMatch[1]);
      if (!isNaN(date.getTime())) {
        return { timestamp: date.toISOString(), cleanMessage: line.replace(isoMatch[0], '').trim() };
      }
    } catch (e) {}
  }

  // Fallback: usa timestamp atual
  return { timestamp: new Date().toISOString(), cleanMessage: line };
};

const getDockerLogs = async () => {
  const logs = [];
  let services = [];
  let containers = [];
  try {
    services = dockerManager.listServices();
  } catch (err) {
    const hint = err.message && err.message.toLowerCase().includes('permission')
      ? 'Permissao negada no socket Docker. Verifique /var/run/docker.sock e grupo docker.'
      : null;
    return [{
      timestamp: new Date().toISOString(),
      level: 'error',
      source: 'docker:system',
      message: `Nao foi possivel listar servicos do Docker: ${err.message}${hint ? ` (${hint})` : ''}`,
      metadata: { error: err.message, hint }
    }];
  }

  try {
    containers = await withTimeout(dockerManager.listContainers(), 5000, null);
    if (!containers) {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'docker:system',
        message: 'Timeout ao listar containers do Docker (5s). Verifique a conexao com Docker daemon.',
        metadata: { timeout: true }
      });
      containers = [];
    } else if (!Array.isArray(containers)) {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: 'docker:system',
        message: 'Resposta invalida do Docker API ao listar containers.',
        metadata: { responseType: typeof containers }
      });
      containers = [];
    }
  } catch (err) {
    const hint = err.message && err.message.toLowerCase().includes('permission')
      ? 'Permissao negada no socket Docker. Verifique /var/run/docker.sock e grupo docker.'
      : null;
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'error',
      source: 'docker:system',
      message: `Nao foi possivel listar containers do Docker: ${err.message}${hint ? ` (${hint})` : ''}`,
      metadata: { error: err.message, hint }
    });
  }

  const containerNames = containers.map(c => c.Names?.[0]?.replace('/', '') || c.Id.slice(0, 12));
  logs.push({
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'docker:system',
    message: `Containers encontrados: ${containers.length} | Servicos registrados: ${services.length}`,
    metadata: {
      containersCount: containers.length,
      servicesCount: services.length,
      containerNames: containerNames.join(', ')
    }
  });

  if (!services.length && !containers.length) {
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'docker:system',
      message: 'Nenhum servico registrado ou container ativo para logs.'
    });
    return logs;
  }

  const containerMap = new Map();
  const containerInfo = new Map();

  // Primeiro, mapeia os containers ativos (prioridade)
  // Filtra apenas containers em estado 'running' para coletar logs
  const runningContainers = containers.filter(c => c.State === 'running');

  if (runningContainers.length < containers.length) {
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'docker:system',
      message: `${runningContainers.length} containers rodando de ${containers.length} total (ignorando containers parados para logs).`,
      metadata: { runningCount: runningContainers.length, totalCount: containers.length }
    });
  }

  runningContainers.forEach((container) => {
    const id = container.Id;
    const containerName = container.Names?.[0]?.replace('/', '') || id.slice(0, 12);

    // Tenta encontrar um serviço correspondente pelo containerId
    const matchingService = services.find(s => s.containerId === id);
    const displayName = matchingService ? matchingService.name : containerName;

    containerMap.set(id, displayName);
    containerInfo.set(id, {
      name: displayName,
      state: container.State,
      status: container.Status,
      image: container.Image,
      created: container.Created,
      serviceName: matchingService?.name
    });
  });

  // Avisa sobre serviços sem container ativo
  services.forEach((service) => {
    if (!service.containerId) {
      return;
    }
    // Se o serviço tem um containerId mas o container não está na lista de ativos
    if (!containerMap.has(service.containerId)) {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: `docker:${service.name}`,
        message: 'Servico registrado mas container nao encontrado (pode estar parado ou foi recriado).',
        metadata: {
          serviceName: service.name,
          registeredContainerId: service.containerId.slice(0, 12)
        }
      });
    }
  });

  for (const [containerId, name] of containerMap.entries()) {
    const info = containerInfo.get(containerId);
    try {
      const output = await withTimeout(readDockerContainerLogs(containerId, 3000), 2500, '');
      if (!output) {
        logs.push({
          timestamp: new Date().toISOString(),
          level: 'warn',
          source: `docker:${name}`,
          message: 'Timeout ao ler logs do container.',
          metadata: { containerId: containerId.slice(0, 12), timeout: true, ...info }
        });
        continue;
      }
      const lines = output.split('\n').filter((line) => line.trim());
      if (!lines.length) {
        logs.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          source: `docker:${name}`,
          message: 'Nenhum log recente do container.',
          metadata: { containerId: containerId.slice(0, 12), ...info }
        });
      } else {
        lines.slice(-100).forEach((line) => {
          const { timestamp, cleanMessage } = extractTimestamp(line);
          const detectedLevel = detectLogLevel(cleanMessage);
          logs.push({
            timestamp,
            level: detectedLevel,
            source: `docker:${name}`,
            message: cleanMessage,
            metadata: {
              containerId: containerId.slice(0, 12),
              containerState: info?.state,
              image: info?.image
            }
          });
        });
      }
    } catch (err) {
      const hint = err.message && err.message.toLowerCase().includes('permission')
        ? 'Permissao negada no socket Docker. Verifique /var/run/docker.sock e grupo docker.'
        : null;
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: `docker:${name}`,
        message: `Nao foi possivel ler logs do container ${containerId.slice(0, 12)}: ${err.message}${hint ? ` (${hint})` : ''}`,
        metadata: { containerId: containerId.slice(0, 12), error: err.message, hint, ...info }
      });
    }
  }

  return logs;
};

const getDockerLogsSafe = async () => {
  try {
    return await getDockerLogs();
  } catch (err) {
    return [{
      timestamp: new Date().toISOString(),
      level: 'warn',
      source: 'docker',
      message: `Falha ao coletar logs do Docker: ${err.message}`
    }];
  }
};

const DOCKER_LOGS_TTL_MS = 5000;
let dockerLogsCache = {
  logs: [],
  updatedAt: 0,
  inFlight: false
};

const refreshDockerLogsCache = async () => {
  if (dockerLogsCache.inFlight) return;
  dockerLogsCache.inFlight = true;
  try {
    const logs = await getDockerLogsSafe();
    dockerLogsCache = {
      logs,
      updatedAt: Date.now(),
      inFlight: false
    };
  } catch (err) {
    dockerLogsCache = {
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'docker',
        message: `Falha ao atualizar cache do Docker: ${err.message}`
      }],
      updatedAt: Date.now(),
      inFlight: false
    };
  }
};

const getDockerLogsCached = async () => {
  const now = Date.now();
  const stale = now - dockerLogsCache.updatedAt > DOCKER_LOGS_TTL_MS;

  if (stale && !dockerLogsCache.inFlight) {
    refreshDockerLogsCache();
  }

  if (dockerLogsCache.logs.length) {
    return dockerLogsCache.logs;
  }

  return [{
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'docker',
    message: 'Coletando logs do Docker...'
  }];
};

const safeLogs = (source, fn) => {
  try {
    return fn();
  } catch (err) {
    return [{
      timestamp: new Date().toISOString(),
      level: 'warn',
      source,
      message: `Falha ao coletar logs (${source}): ${err.message}`
    }];
  }
};

// Função para verificar saúde dos serviços
const checkHealth = async () => {
  const services = {};
  
  // Verificar banco de dados
  try {
    await pool.query('SELECT 1');
    services.database = {
      status: 'healthy',
      message: 'PostgreSQL conectado'
    };
  } catch (error) {
    services.database = {
      status: 'error',
      message: 'Erro na conexão: ' + error.message
    };
  }
  
  // Verificar Docker
  try {
    execSync('docker info', { stdio: 'ignore' });
    services.docker = {
      status: 'healthy',
      message: 'Docker funcionando'
    };
  } catch (error) {
    services.docker = {
      status: 'error',
      message: 'Docker não disponível'
    };
  }
  
  // Verificar Nginx
  try {
    execSync('nginx -t', { stdio: 'ignore' });
    services.nginx = {
      status: 'healthy',
      message: 'Nginx configurado corretamente'
    };
  } catch (error) {
    services.nginx = {
      status: 'warning',
      message: 'Problema na configuração do Nginx'
    };
  }
  
  // Verificar PM2
  try {
    const pm2Status = execSync('pm2 jlist', { encoding: 'utf8' });
    const processes = JSON.parse(pm2Status);
    const provirProcess = processes.find(p => p.name === 'provirpanel-backend');
    
    if (provirProcess && provirProcess.pm2_env.status === 'online') {
      services.pm2 = {
        status: 'healthy',
        message: 'Processo online'
      };
    } else {
      services.pm2 = {
        status: 'warning',
        message: 'Processo não encontrado ou offline'
      };
    }
  } catch (error) {
    services.pm2 = {
      status: 'error',
      message: 'PM2 não disponível'
    };
  }
  
  // Verificar espaço em disco
  try {
    const df = execSync('df -h /', { encoding: 'utf8' });
    const lines = df.split('\n');
    const diskInfo = lines[1].split(/\s+/);
    const usage = parseInt(diskInfo[4]);
    
    if (usage > 90) {
      services.disk = {
        status: 'error',
        message: `Disco ${usage}% cheio`
      };
    } else if (usage > 80) {
      services.disk = {
        status: 'warning',
        message: `Disco ${usage}% usado`
      };
    } else {
      services.disk = {
        status: 'healthy',
        message: `Disco ${usage}% usado`
      };
    }
  } catch (error) {
    services.disk = {
      status: 'warning',
      message: 'Não foi possível verificar disco'
    };
  }
  
  return { services };
};

// Rota para logs
router.get('/logs', async (req, res, next) => {
  try {
    const dockerLogs = await getDockerLogsCached();

    const dockerEntries = Array.isArray(dockerLogs) ? dockerLogs : [];
    const hasDockerSource = dockerEntries.some((log) =>
      (log.source || '').startsWith('docker')
    );
    if (!hasDockerSource) {
      dockerEntries.push({
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'docker',
        message: 'Logs do Docker indisponiveis ou vazios no momento.'
      });
    }

    const logs = [
      ...safeLogs('pm2', getPM2Logs),
      ...safeLogs('backend', getAppLogs),
      ...safeLogs('service-update', getServiceUpdateLogs),
      ...dockerEntries,
      ...safeLogs('nginx', getNginxLogs),
      ...safeLogs('postgres', getPostgresLogs),
      ...getRuntimeLogs()
    ]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-200);
    res.json({ logs });
  } catch (error) {
    res.json({
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'error',
        source: 'logs',
        message: `Falha geral ao coletar logs: ${error.message}`
      }]
    });
  }
});

router.get('/logs/health', async (req, res, next) => {
  try {
    const logs = [
      ...getRuntimeLogs(),
      ...safeLogs('backend', getAppLogs),
      ...safeLogs('service-update', getServiceUpdateLogs)
    ]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-200);
    res.json({ logs });
  } catch (error) {
    res.json({
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'error',
        source: 'logs',
        message: `Falha ao coletar logs de health: ${error.message}`
      }]
    });
  }
});

// Rota para health check
router.get('/health', async (req, res, next) => {
  try {
    const health = await checkHealth();
    res.json(health);
  } catch (error) {
    next(error);
  }
});

// Rota para estatísticas de logs
router.get('/logs/stats', async (req, res, next) => {
  try {
    const dockerLogs = await getDockerLogsCached();
    const allLogs = [
      ...safeLogs('pm2', getPM2Logs),
      ...safeLogs('backend', getAppLogs),
      ...safeLogs('service-update', getServiceUpdateLogs),
      ...(Array.isArray(dockerLogs) ? dockerLogs : []),
      ...safeLogs('nginx', getNginxLogs),
      ...safeLogs('postgres', getPostgresLogs),
      ...getRuntimeLogs()
    ];

    const stats = {
      total: allLogs.length,
      byLevel: {},
      bySource: {},
      errorRate: 0,
      warnRate: 0,
      recentErrors: [],
      timeline: {}
    };

    allLogs.forEach(log => {
      // Contar por nível
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;

      // Contar por fonte
      const source = log.source || 'unknown';
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;

      // Timeline por hora
      const hour = new Date(log.timestamp).toISOString().slice(0, 13);
      if (!stats.timeline[hour]) {
        stats.timeline[hour] = { total: 0, error: 0, warn: 0, info: 0 };
      }
      stats.timeline[hour].total++;
      stats.timeline[hour][log.level] = (stats.timeline[hour][log.level] || 0) + 1;

      // Coletar erros recentes
      if (log.level === 'error' && stats.recentErrors.length < 10) {
        stats.recentErrors.push({
          timestamp: log.timestamp,
          source: log.source,
          message: log.message.slice(0, 150)
        });
      }
    });

    stats.errorRate = stats.total > 0 ? ((stats.byLevel['error'] || 0) / stats.total * 100).toFixed(2) : 0;
    stats.warnRate = stats.total > 0 ? ((stats.byLevel['warn'] || 0) / stats.total * 100).toFixed(2) : 0;

    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

// Rota para exportar logs
router.get('/logs/export', async (req, res, next) => {
  try {
    const format = req.query.format || 'json'; // json, csv, txt
    const dockerLogs = await getDockerLogsCached();
    const logs = [
      ...safeLogs('pm2', getPM2Logs),
      ...safeLogs('backend', getAppLogs),
      ...safeLogs('service-update', getServiceUpdateLogs),
      ...(Array.isArray(dockerLogs) ? dockerLogs : []),
      ...safeLogs('nginx', getNginxLogs),
      ...safeLogs('postgres', getPostgresLogs),
      ...getRuntimeLogs()
    ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="logs-${Date.now()}.json"`);
      res.json({ logs, exportedAt: new Date().toISOString(), total: logs.length });
    } else if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="logs-${Date.now()}.csv"`);
      let csv = 'Timestamp,Level,Source,Message\n';
      logs.forEach(log => {
        const message = (log.message || '').replace(/"/g, '""').replace(/\n/g, ' ');
        csv += `"${log.timestamp}","${log.level}","${log.source || ''}","${message}"\n`;
      });
      res.send(csv);
    } else if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="logs-${Date.now()}.txt"`);
      let txt = `=== LOGS EXPORT ===\nExported at: ${new Date().toISOString()}\nTotal logs: ${logs.length}\n\n`;
      logs.forEach(log => {
        txt += `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source || 'unknown'}] ${log.message}\n`;
      });
      res.send(txt);
    } else {
      res.status(400).json({ error: 'Invalid format. Use json, csv, or txt' });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
