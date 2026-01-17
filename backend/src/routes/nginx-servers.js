'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const NginxServerManager = require('../services/NginxServerManager');

const router = express.Router();
const nginxManager = new NginxServerManager();
const upload = multer({ dest: path.join(os.tmpdir(), 'nginx-ssl') });

const getSslStorageDir = () => process.env.NGINX_SSL_STORAGE || '/etc/nginx/ssl';
const sanitizeName = (value) => value.replace(/[^a-zA-Z0-9.-]/g, '_');
const buildSslPaths = (domain) => {
  const safe = sanitizeName(domain || 'default');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const dir = getSslStorageDir();
  return {
    dir,
    certPath: path.join(dir, `${safe}-${stamp}.crt`),
    keyPath: path.join(dir, `${safe}-${stamp}.key`)
  };
};

const ensureStorageDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

// ==================== SERVER CRUD ====================

// List all servers
router.get('/servers', async (req, res, next) => {
  try {
    const servers = await nginxManager.getAllServers();
    res.json({ servers });
  } catch (err) {
    next(err);
  }
});

// Get server by ID
router.get('/servers/:id', async (req, res, next) => {
  try {
    const server = await nginxManager.getServerById(parseInt(req.params.id, 10));
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
  } catch (err) {
    next(err);
  }
});

// Create new server
router.post('/servers', async (req, res, next) => {
  try {
    const server = await nginxManager.createServer(req.body);
    res.status(201).json(server);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Domain already exists' });
    }
    next(err);
  }
});

// Update server
router.put('/servers/:id', async (req, res, next) => {
  try {
    const server = await nginxManager.updateServer(parseInt(req.params.id, 10), req.body);
    res.json(server);
  } catch (err) {
    next(err);
  }
});

// Delete server
router.delete('/servers/:id', async (req, res, next) => {
  try {
    await nginxManager.deleteServer(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ==================== CONFIG GENERATION ====================

// Generate config preview (without saving)
router.post('/servers/:id/generate-preview', async (req, res, next) => {
  try {
    const config = await nginxManager.generatePreview(parseInt(req.params.id, 10));
    res.json({ config });
  } catch (err) {
    next(err);
  }
});

// Generate config preview from payload (without saving)
router.post('/preview-config', async (req, res, next) => {
  try {
    const config = nginxManager.generatePreviewFromPayload(req.body || {});
    res.json({ config });
  } catch (err) {
    next(err);
  }
});

// Parse config content into fields
router.post('/parse-config', async (req, res, next) => {
  try {
    const { content, filename } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    const parsed = nginxManager.parseNginxConfigContent(content, filename || 'manual.conf', null);
    res.json({ parsed });
  } catch (err) {
    next(err);
  }
});

// Apply config (generate, validate, enable, reload)
router.post('/servers/:id/apply-config', async (req, res, next) => {
  try {
    const result = await nginxManager.applyConfig(parseInt(req.params.id, 10));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get current config from file
router.get('/servers/:id/current-config', async (req, res, next) => {
  try {
    const result = await nginxManager.getCurrentConfig(parseInt(req.params.id, 10));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ==================== LOGS & METRICS ====================

// Get logs for a server
router.get('/servers/:id/logs', async (req, res, next) => {
  try {
    const { limit, offset, status, ip, path, startDate, endDate } = req.query;
    const logs = await nginxManager.getLogs(parseInt(req.params.id, 10), {
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0,
      status: status ? parseInt(status, 10) : undefined,
      ip,
      path,
      startDate,
      endDate
    });
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

// Get all logs (no server filter)
router.get('/logs', async (req, res, next) => {
  try {
    const { limit, offset, status, ip, path, startDate, endDate } = req.query;
    const logs = await nginxManager.getLogs(null, {
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0,
      status: status ? parseInt(status, 10) : undefined,
      ip,
      path,
      startDate,
      endDate
    });
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

// Get metrics for a server
router.get('/servers/:id/metrics', async (req, res, next) => {
  try {
    const { period } = req.query;
    const metrics = await nginxManager.getMetrics(parseInt(req.params.id, 10), period || '24h');
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

// Get global metrics
router.get('/metrics', async (req, res, next) => {
  try {
    const { period } = req.query;
    const metrics = await nginxManager.getMetrics(null, period || '24h');
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

// ==================== SSL CERTIFICATES ====================

// Get all certificates
router.get('/certs', async (req, res, next) => {
  try {
    const certs = await nginxManager.getAllCerts();
    res.json({ certs });
  } catch (err) {
    next(err);
  }
});

// Get certificates for a server
router.get('/servers/:id/certs', async (req, res, next) => {
  try {
    const certs = await nginxManager.getCertsByServer(parseInt(req.params.id, 10));
    res.json({ certs });
  } catch (err) {
    next(err);
  }
});

// Sync certificate from file
router.post('/servers/:id/certs/sync', async (req, res, next) => {
  try {
    const { domain, certPath, keyPath } = req.body;
    const result = await nginxManager.syncCertFromFile(
      parseInt(req.params.id, 10),
      domain,
      certPath,
      keyPath
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Upload SSL certificate/key files
router.post('/ssl/upload', upload.fields([{ name: 'certFile' }, { name: 'keyFile' }]), (req, res, next) => {
  try {
    const { domain } = req.body || {};
    if (!domain) {
      return res.status(400).json({ error: 'domain is required' });
    }
    const certFile = req.files?.certFile?.[0];
    const keyFile = req.files?.keyFile?.[0];
    if (!certFile || !keyFile) {
      return res.status(400).json({ error: 'certFile and keyFile are required' });
    }
    const { dir, certPath, keyPath } = buildSslPaths(domain);
    ensureStorageDir(dir);
    fs.renameSync(certFile.path, certPath);
    fs.renameSync(keyFile.path, keyPath);
    fs.chmodSync(certPath, 0o600);
    fs.chmodSync(keyPath, 0o600);
    res.json({ cert_path: certPath, key_path: keyPath });
  } catch (err) {
    next(err);
  }
});

// Store SSL certificate/key content
router.post('/ssl/store', (req, res, next) => {
  try {
    const { domain, certPem, keyPem } = req.body || {};
    if (!domain) {
      return res.status(400).json({ error: 'domain is required' });
    }
    if (!certPem || !keyPem) {
      return res.status(400).json({ error: 'certPem and keyPem are required' });
    }
    const { dir, certPath, keyPath } = buildSslPaths(domain);
    ensureStorageDir(dir);
    fs.writeFileSync(certPath, certPem, { mode: 0o600 });
    fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
    res.json({ cert_path: certPath, key_path: keyPath });
  } catch (err) {
    next(err);
  }
});

// Renew certificate
router.post('/certs/:id/renew', async (req, res, next) => {
  try {
    const result = await nginxManager.renewCert(parseInt(req.params.id, 10));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Toggle auto-renew
router.patch('/certs/:id/auto-renew', async (req, res, next) => {
  try {
    const { autoRenew } = req.body;
    const result = await nginxManager.toggleAutoRenew(parseInt(req.params.id, 10), autoRenew);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ==================== NGINX CONTROL ====================

// Get Nginx status
router.get('/status', (req, res, next) => {
  try {
    const status = nginxManager.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// Test configuration
router.post('/test', (req, res, next) => {
  try {
    const result = nginxManager.testConfig();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Reload Nginx
router.post('/reload', (req, res, next) => {
  try {
    const result = nginxManager.reload();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Restart Nginx
router.post('/restart', (req, res, next) => {
  try {
    const result = nginxManager.restart();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Health check
router.get('/health', async (req, res, next) => {
  try {
    const health = await nginxManager.healthCheck();
    const allOk = Object.values(health).every(c => c.ok);
    res.status(allOk ? 200 : 503).json(health);
  } catch (err) {
    next(err);
  }
});

// ==================== IMPORT EXISTING CONFIGS ====================

router.post('/import-configs', async (req, res, next) => {
  try {
    const result = await nginxManager.importAllConfigs();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
