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

const getDockerLogs = async () => {
  const logs = [];
  let services = [];
  let containers = [];
  try {
    services = dockerManager.listServices();
  } catch (err) {
    return [{
      timestamp: new Date().toISOString(),
      level: 'warn',
      source: 'docker',
      message: `Nao foi possivel listar servicos do Docker: ${err.message}`
    }];
  }

  try {
    containers = await dockerManager.listContainers();
  } catch (err) {
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'warn',
      source: 'docker',
      message: `Nao foi possivel listar containers do Docker: ${err.message}`
    });
  }

  logs.push({
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'docker',
    message: `Containers ativos: ${containers.length} | Servicos registrados: ${services.length}`
  });

  if (!services.length && !containers.length) {
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'docker',
      message: 'Nenhum servico registrado ou container ativo para logs.'
    });
    return logs;
  }

  const containerMap = new Map();
  services.forEach((service) => {
    if (!service.containerId) {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: `docker:${service.name}`,
        message: 'Servico sem containerId registrado.'
      });
      return;
    }
    containerMap.set(service.containerId, service.name);
  });
  containers.forEach((container) => {
    if (!containerMap.has(container.Id)) {
      const name = container.Names?.[0]?.replace('/', '') || container.Id.slice(0, 12);
      containerMap.set(container.Id, name);
    }
  });

  for (const [containerId, name] of containerMap.entries()) {
    try {
      const output = await readDockerContainerLogs(containerId);
      const lines = output.split('\n').filter((line) => line.trim());
      if (!lines.length) {
        logs.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          source: `docker:${name}`,
          message: 'Nenhum log recente do container.'
        });
      } else {
        lines.forEach((line) => {
          logs.push({
            timestamp: new Date().toISOString(),
            level: 'info',
            source: `docker:${name}`,
            message: line
          });
        });
      }
    } catch (err) {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: `docker:${name}`,
        message: `Nao foi possivel ler logs do container ${containerId}: ${err.message}`
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
    const dockerLogs = await Promise.race([
      getDockerLogsSafe(),
      new Promise((resolve) => setTimeout(() => resolve([{
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'docker',
        message: 'Timeout ao coletar logs do Docker.'
      }]), 3000))
    ]);

    const logs = [
      ...safeLogs('pm2', getPM2Logs),
      ...safeLogs('backend', getAppLogs),
      ...safeLogs('service-update', getServiceUpdateLogs),
      ...dockerLogs,
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

// Rota para health check
router.get('/health', async (req, res, next) => {
  try {
    const health = await checkHealth();
    res.json(health);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
