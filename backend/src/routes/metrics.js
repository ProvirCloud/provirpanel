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
            message: line.trim()
          });
        }
      });
    });
    
    return logs.slice(-100);
  } catch (error) {
    return [{
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Não foi possível ler logs do PM2: ' + error.message
    }];
  }
};

// Função para verificar saúde dos serviços
const checkHealth = async () => {
  const services = {};
  
  try {
    await pool.query('SELECT 1');
    services.database = { status: 'healthy', message: 'PostgreSQL conectado' };
  } catch (error) {
    services.database = { status: 'error', message: 'Erro na conexão: ' + error.message };
  }
  
  try {
    execSync('docker info', { stdio: 'ignore' });
    services.docker = { status: 'healthy', message: 'Docker funcionando' };
  } catch (error) {
    services.docker = { status: 'error', message: 'Docker não disponível' };
  }
  
  try {
    execSync('nginx -t', { stdio: 'ignore' });
    services.nginx = { status: 'healthy', message: 'Nginx configurado corretamente' };
  } catch (error) {
    services.nginx = { status: 'warning', message: 'Problema na configuração do Nginx' };
  }
  
  return { services };
};

router.get('/logs', async (req, res, next) => {
  try {
    const logs = getPM2Logs();
    res.json({ logs });
  } catch (error) {
    next(error);
  }
});

router.get('/health', async (req, res, next) => {
  try {
    const health = await checkHealth();
    res.json(health);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
