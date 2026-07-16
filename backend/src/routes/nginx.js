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
    const filename = req.body.filename || req.params.filename;
    const skipValidation = req.body.skipValidation === true;
    const result = nginxManager.saveConfig(filename, req.body.content, { skipValidation });
    if (!skipValidation && result.valid === false) {
      return res.status(400).json({ error: result.error || 'Configuracao Nginx invalida (nginx -t falhou)', ...result });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Salvar configuração (POST alternativo - evita bloqueio de proxy)
router.post('/configs/save', (req, res, next) => {
  try {
    const { filename, content, skipValidation } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename obrigatorio' });
    const result = nginxManager.saveConfig(filename, content, { skipValidation: skipValidation === true });
    if (!skipValidation && result.valid === false) {
      return res.status(400).json({ error: result.error || 'Configuracao Nginx invalida (nginx -t falhou)', ...result });
    }
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

// Deletar (POST alternativo)
router.post('/configs/delete', (req, res, next) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename obrigatorio' });
    nginxManager.deleteConfig(filename);
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

// Toggle (POST alternativo sem filename na URL)
router.post('/configs/toggle', (req, res, next) => {
  try {
    const { filename, enabled } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename obrigatorio' });
    if (enabled) {
      nginxManager.enableConfig(filename);
    } else {
      nginxManager.disableConfig(filename);
    }
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
    const result = await nginxManager.getDockerContainers();
    res.json(result);
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

router.get('/ssl/status', (req, res, next) => {
  try {
    const status = nginxManager.getCertbotStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.post('/ssl/install-certbot', (req, res, next) => {
  try {
    const result = nginxManager.installCertbot();
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
    res.status(500).json({ success: false, error: err.message || 'Falha ao recarregar Nginx' });
  }
});

module.exports = router;
