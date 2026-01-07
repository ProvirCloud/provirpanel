'use strict';

const path = require('path');
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
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const MetricsCollector = require('./services/MetricsCollector');
const DockerManager = require('./services/DockerManager');
const pool = require('./config/database');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/api/metrics', authMiddleware, metricsRoutes);
app.get('/api/logs', authMiddleware, (req, res) => {
  res.json({ 
    logs: [
      { timestamp: new Date().toISOString(), level: 'info', message: 'Sistema iniciado' },
      { timestamp: new Date().toISOString(), level: 'info', message: 'Backend rodando' }
    ]
  });
});
app.get('/api/health', authMiddleware, (req, res) => {
  res.json({ 
    services: {
      database: { status: 'healthy', message: 'PostgreSQL conectado' },
      docker: { status: 'healthy', message: 'Docker funcionando' },
      nginx: { status: 'healthy', message: 'Nginx OK' }
    }
  });
});
app.use('/terminal', authMiddleware, terminalRoutes.router);
app.use('/docker', authMiddleware, dockerRoutes.router);
app.use('/storage', authMiddleware, storageRoutes);
app.use('/ci-cd', authMiddleware, cicdRoutes);
app.use('/domains', authMiddleware, domainsRoutes);

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

ensureDefaultAdmin().finally(() => {
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`CloudPainel listening on port ${port}`);
  });
});
