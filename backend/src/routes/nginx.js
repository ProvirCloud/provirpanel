'use strict';

const express = require('express');
const NginxManager = require('../services/NginxManager');

const router = express.Router();
const nginxManager = new NginxManager();

// Status do Nginx
router.get('/status', (req, res, next) => {
  try {
    const installed = nginxManager.isInstalled();
    const status = installed ? nginxManager.getStatus() : { running: false };
    res.json({ installed, ...status });
  } catch (err) {
    next(err);
  }
});

// Listar hosts
router.get('/hosts', (req, res, next) => {
  try {
    const hosts = nginxManager.listHosts();
    res.json({ hosts });
  } catch (err) {
    next(err);
  }
});

// Criar host
router.post('/hosts', (req, res, next) => {
  try {
    const result = nginxManager.createHost(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Habilitar host
router.post('/hosts/:filename/enable', (req, res, next) => {
  try {
    nginxManager.enableHost(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Desabilitar host
router.post('/hosts/:filename/disable', (req, res, next) => {
  try {
    nginxManager.disableHost(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Deletar host
router.delete('/hosts/:filename', (req, res, next) => {
  try {
    nginxManager.deleteHost(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Testar configuração
router.post('/test', (req, res, next) => {
  try {
    const result = nginxManager.testConfig();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Reload
router.post('/reload', (req, res, next) => {
  try {
    nginxManager.reload();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Restart
router.post('/restart', (req, res, next) => {
  try {
    nginxManager.restart();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Instalar SSL
router.post('/ssl/install', async (req, res, next) => {
  try {
    const { domain, email } = req.body;
    const result = await nginxManager.installSSL(domain, email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Listar certificados SSL
router.get('/ssl/certs', (req, res, next) => {
  try {
    const certs = nginxManager.listSSLCerts();
    res.json({ certs });
  } catch (err) {
    next(err);
  }
});

// Renovar SSL
router.post('/ssl/renew', (req, res, next) => {
  try {
    const result = nginxManager.renewSSL();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Configurar auto-renovação
router.post('/ssl/auto-renew', (req, res, next) => {
  try {
    const result = nginxManager.setupAutoRenew();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Estatísticas
router.get('/stats', (req, res, next) => {
  try {
    const stats = nginxManager.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Logs
router.get('/logs', (req, res, next) => {
  try {
    const { type = 'access', lines = 100 } = req.query;
    const logs = nginxManager.getLogs(type, parseInt(lines));
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
