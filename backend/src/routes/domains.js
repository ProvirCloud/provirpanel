'use strict';

const express = require('express');
const ProxyManager = require('../services/CloudflareManager');
const DockerManager = require('../services/DockerManager');

const router = express.Router();
const proxyManager = new ProxyManager();
const dockerManager = new DockerManager();

// Listar rotas configuradas
router.get('/', async (req, res, next) => {
  try {
    const routes = proxyManager.listRoutes();
    res.json({ routes, baseUrl: proxyManager.baseUrl });
  } catch (err) {
    next(err);
  }
});

// Criar rota para serviço
router.post('/', async (req, res, next) => {
  try {
    const { serviceId, pathPrefix } = req.body;
    
    if (!serviceId || !pathPrefix) {
      return res.status(400).json({ message: 'serviceId e pathPrefix são obrigatórios' });
    }
    
    // Buscar serviço
    const services = dockerManager.listServices();
    const service = services.find(s => s.id === serviceId);
    
    if (!service) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    // Validar pathPrefix
    if (!/^\/[a-z0-9-]+$/.test(pathPrefix)) {
      return res.status(400).json({ message: 'Path deve começar com / e conter apenas letras, números e hífens' });
    }
    
    // Verificar se path já existe
    const existingRoutes = proxyManager.listRoutes();
    if (existingRoutes.some(r => r.pathPrefix === pathPrefix)) {
      return res.status(409).json({ message: 'Path já está sendo usado' });
    }
    
    const targetIP = 'localhost';
    const route = proxyManager.createServiceRoute(
      serviceId,
      service.name,
      pathPrefix,
      targetIP,
      service.hostPort
    );
    
    res.json({ route });
  } catch (err) {
    next(err);
  }
});

// Remover rota
router.delete('/:id', async (req, res, next) => {
  try {
    proxyManager.removeRoute(req.params.id);
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

// Configurações
router.get('/config', (req, res) => {
  res.json({
    baseUrl: proxyManager.baseUrl,
    configured: true
  });
});

router.post('/config', (req, res) => {
  const { baseUrl } = req.body;
  
  if (!baseUrl) {
    return res.status(400).json({ message: 'Base URL é obrigatória' });
  }
  
  process.env.PROXY_BASE_URL = baseUrl;
  proxyManager.baseUrl = baseUrl;
  
  res.json({ message: 'Configuração salva com sucesso' });
});

module.exports = router;