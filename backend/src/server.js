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

const authRoutes = require('./routes/auth');
const metricsRoutes = require('./routes/metrics');
const terminalRoutes = require('./routes/terminal');
const dockerRoutes = require('./routes/docker');
const storageRoutes = require('./routes/storage');
const cicdRoutes = require('./routes/ci-cd');
const domainsRoutes = require('./routes/domains');
const logsRoutes = require('./routes/logs');
const nginxRoutes = require('./routes/nginx');
const nginxServersRoutes = require('./routes/nginx-servers');
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const MetricsCollector = require('./services/MetricsCollector');
const DockerManager = require('./services/DockerManager');
const NginxLogWatcher = require('./services/NginxLogWatcher');
const pool = require('./config/database');
const { runMigrations } = require('./config/migrate');

const app = express();
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

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api/metrics', authMiddleware, metricsRoutes);
app.use('/api', authMiddleware, logsRoutes);
app.use('/', authMiddleware, logsRoutes);
app.use('/terminal', authMiddleware, terminalRoutes.router);
app.use('/docker', authMiddleware, dockerRoutes.router);
app.use('/storage', authMiddleware, storageRoutes);
app.use('/ci-cd', authMiddleware, cicdRoutes);
app.use('/domains', authMiddleware, domainsRoutes);
app.use('/nginx', authMiddleware, nginxRoutes);
app.use('/api/nginx', authMiddleware, nginxServersRoutes);

app.use(errorHandler);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
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
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [username, passwordHash, 'admin']
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
  });
});

setInterval(() => {
  appendNodeLog(`Node.js ativo (pid ${process.pid})`);
}, 60000);
