'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const DockerManager = require('../services/DockerManager');
const pool = require('../config/database');

const router = express.Router();
const dockerManager = new DockerManager();
const serviceLogsPath = path.join(process.cwd(), 'backend/logs/service-updates.log');

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
      return [];
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

const getDockerLogs = () => {
  const logs = [];
  let services = [];
  try {
    services = dockerManager.listServices();
  } catch (err) {
    return logs;
  }

  services.forEach((service) => {
    if (!service.containerId) return;
    try {
      const output = execFileSync('docker', ['logs', '--tail', '50', service.containerId], {
        encoding: 'utf8'
      });
      output
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line) => {
          logs.push({
            timestamp: new Date().toISOString(),
            level: 'info',
            source: `docker:${service.name}`,
            message: line
          });
        });
    } catch (err) {
      logs.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: `docker:${service.name}`,
        message: `Nao foi possivel ler logs do container ${service.containerId}: ${err.message}`
      });
    }
  });

  return logs;
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
    const logs = [
      ...getPM2Logs(),
      ...getServiceUpdateLogs(),
      ...getDockerLogs(),
      ...getNginxLogs(),
      ...getPostgresLogs()
    ]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-200);
    res.json({ logs });
  } catch (error) {
    next(error);
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
