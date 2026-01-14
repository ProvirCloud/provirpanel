'use strict';

const express = require('express');
const NginxManager = require('../services/NginxManager');

const router = express.Router();
const nginxManager = new NginxManager();

// Status
router.get('/status', (req, res, next) => {
  try {
    const status = nginxManager.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// Listar todas as configurações
router.get('/configs', (req, res, next) => {
  try {
    const configs = nginxManager.listAllConfigs();
    res.json({ configs });
  } catch (err) {
    next(err);
  }
});

// Salvar configuração editada
router.put('/configs/:filename', (req, res, next) => {
  try {
    const result = nginxManager.saveConfig(req.params.filename, req.body.content);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Criar nova configuração
router.post('/configs', (req, res, next) => {
  try {
    const result = nginxManager.createConfig(req.body.filename, req.body.content);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Deletar
router.delete('/configs/:filename', (req, res, next) => {
  try {
    nginxManager.deleteConfig(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Enable/Disable
router.post('/configs/:filename/enable', (req, res, next) => {
  try {
    nginxManager.enableConfig(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/configs/:filename/disable', (req, res, next) => {
  try {
    nginxManager.disableConfig(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Templates
router.get('/templates', (req, res, next) => {
  try {
    const templates = nginxManager.getTemplates();
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

// Containers Docker
router.get('/docker-containers', async (req, res, next) => {
  try {
    const containers = await nginxManager.getDockerContainers();
    res.json({ containers });
  } catch (err) {
    next(err);
  }
});

// SSL
router.post('/ssl/install', (req, res, next) => {
  try {
    const { domain, email } = req.body;
    const result = nginxManager.installSSL(domain, email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/ssl/certs', (req, res, next) => {
  try {
    const certs = nginxManager.listCerts();
    res.json({ certs });
  } catch (err) {
    next(err);
  }
});

// Test & Reload
router.post('/test', (req, res, next) => {
  try {
    const result = nginxManager.testConfig();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/reload', (req, res, next) => {
  try {
    nginxManager.reload();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
