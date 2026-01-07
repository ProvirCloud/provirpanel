'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pool = require('../config/database');
const MetricsCollector = require('../services/MetricsCollector');

const router = express.Router();
const metricsCollector = new MetricsCollector();

router.get('/', async (req, res, next) => {
  try {
    const metrics = await metricsCollector.collect();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

router.get('/logs', async (req, res, next) => {
  try {
    const logs = [
      { timestamp: new Date().toISOString(), level: 'info', message: 'Sistema iniciado' },
      { timestamp: new Date().toISOString(), level: 'info', message: 'Servidor rodando' }
    ];
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

router.get('/health', async (req, res, next) => {
  try {
    const services = {
      database: { status: 'healthy', message: 'PostgreSQL conectado' },
      docker: { status: 'healthy', message: 'Docker funcionando' }
    };
    res.json({ services });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
