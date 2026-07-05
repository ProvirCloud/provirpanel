'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const authRoutes = require('./routes/auth');
const metricsRoutes = require('./routes/metrics');
const terminalRoutes = require('./routes/terminal');
const dockerRoutes = require('./routes/docker');
const storageRoutes = require('./routes/storage');
const cicdRoutes = require('./routes/ci-cd');
const domainsRoutes = require('./routes/domains');
const logsRoutes = require('./routes/logs');
const emailRoutes = require('./routes/email');
const nginxRoutes = require('./routes/nginx');
const nginxServersRoutes = require('./routes/nginx-servers');
const gatewayRoutes = require('./routes/gateway');
const securityAuditRoutes = require('./routes/security-audit');
const publicStorageRoutes = require('./routes/public-storage');
const stacksRoutes = require('./routes/stacks');
const sitesRoutes = require('./routes/sites');
const zeusRoutes = require('./routes/zeus');
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const MetricsCollector = require('./services/MetricsCollector');
const DockerManager = require('./services/DockerManager');
const NginxLogWatcher = require('./services/NginxLogWatcher');
const pool = require('./config/database');
const { runMigrations } = require('./config/migrate');

const app = express();
app.set('trust proxy', 1);
const appLogsPath = path.join(__dirname, 'logs', 'app.log');
fs.mkdirSync(path.dirname(appLogsPath), { recursive: true });
const appendNodeLog = (message) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'nodejs',
    message
  };
  fs.appendFile(appLogsPath, `${JSON.stringify(entry)}\n`, () => {});
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", 'https:', 'data:'],
      imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https:'],
      connectSrc: ["'self'", 'https:', 'wss:'],
      mediaSrc: ["'self'", 'https:', 'data:', 'blob:'],
      frameSrc: ["'self'", 'https:', 'blob:'],
      frameAncestors: ["'self'"]
    }
  }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
}));
app.use(express.json({ limit: '800mb' }));

app.use('/public/storage', publicStorageRoutes);
app.use('/api/public/storage', publicStorageRoutes);
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/metrics', authMiddleware, metricsRoutes);
app.use('/api', authMiddleware, logsRoutes);
app.use('/', authMiddleware, logsRoutes);
app.use('/terminal', authMiddleware, terminalRoutes.router);
app.use('/api/terminal', authMiddleware, terminalRoutes.router);
app.use('/docker', authMiddleware, dockerRoutes.router);
app.use('/api/docker', authMiddleware, dockerRoutes.router);
app.use('/storage', authMiddleware, storageRoutes);
app.use('/api/storage', authMiddleware, storageRoutes);
app.use('/ci-cd', authMiddleware, cicdRoutes);
app.use('/api/ci-cd', authMiddleware, cicdRoutes);
app.use('/domains', authMiddleware, domainsRoutes);
app.use('/api/domains', authMiddleware, domainsRoutes);
app.use('/email', authMiddleware, emailRoutes);
app.use('/api/email', authMiddleware, emailRoutes);
app.use('/gateway', authMiddleware, gatewayRoutes);
app.use('/api/gateway', authMiddleware, gatewayRoutes);
app.use('/security', authMiddleware, securityAuditRoutes);
app.use('/api/security', authMiddleware, securityAuditRoutes);
app.use('/stacks', authMiddleware, stacksRoutes);
app.use('/api/stacks', authMiddleware, stacksRoutes);
app.use('/sites', authMiddleware, sitesRoutes);
app.use('/api/sites', authMiddleware, sitesRoutes);
app.use('/zeus', authMiddleware, zeusRoutes);
app.use('/api/zeus', authMiddleware, zeusRoutes);
app.use('/nginx', authMiddleware, nginxServersRoutes);
app.use('/nginx', authMiddleware, nginxRoutes);
app.use('/api/nginx', authMiddleware, nginxServersRoutes);
app.use('/api/nginx', authMiddleware, nginxRoutes);

app.use(errorHandler);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
  }
});

io.on('connection', (socket) => {
  socket.emit('connected', { message: 'Socket connected' });

  socket.on('disconnect', () => {
    // Intentionally left blank for now.
  });
});

terminalRoutes.initTerminalSocket(io);
dockerRoutes.initDockerSocket(io);
if (cicdRoutes.initAiChatSocket) cicdRoutes.initAiChatSocket(io);

// Initialize Nginx Log Watcher for real-time logs
const nginxLogWatcher = new NginxLogWatcher(io);
nginxLogWatcher.init().catch(err => {
  console.warn('[NginxLogWatcher] Failed to initialize:', err.message);
});

const metricsCollector = new MetricsCollector();
const dockerManager = new DockerManager();
setInterval(async () => {
  try {
    const metrics = await metricsCollector.collect();
    let containersRunning = null;
    try {
      const containers = await dockerManager.listContainers();
      containersRunning = containers.filter((container) => container.State === 'running').length;
    } catch (err) {
      containersRunning = null;
    }
    io.emit('metrics', { ...metrics, containersRunning });
  } catch (err) {
    // Intentionally ignore metrics errors for now.
  }
}, 5000);

const port = process.env.PORT || 3000;

const generateUuid = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const ensureDefaultAdmin = async () => {
  const username = process.env.DEFAULT_ADMIN_USER || 'admin';
  const password = process.env.DEFAULT_ADMIN_PASS || 'admin123';
  try {
    const existing = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    if (existing.rows[0].count > 0) {
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4)',
      [generateUuid(), username, passwordHash, 'admin']
    );
    // eslint-disable-next-line no-console
    console.log('Default admin user created');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to ensure default admin user', err.message);
  }
};

// Run migrations and start server
runMigrations()
  .then(() => ensureDefaultAdmin())
  .finally(() => {
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`CloudPainel listening on port ${port}`);
    const entry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'backend',
      message: 'Backend iniciado'
    };
    fs.appendFile(appLogsPath, `${JSON.stringify(entry)}\n`, () => {});
    appendNodeLog(`Node.js iniciado (pid ${process.pid})`);

    // Start Zeus Heartbeat (child panels push context to hub)
    try {
      const zeusHeartbeat = require('./services/zeus-heartbeat');
      zeusHeartbeat.start();
    } catch (err) {
      console.warn('[Zeus Heartbeat] Failed to start:', err.message);
    }
  });
});

setInterval(() => {
  appendNodeLog(`Node.js ativo (pid ${process.pid})`);
}, 60000);
