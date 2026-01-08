'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const DockerManager = require('../services/DockerManager');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');

const router = express.Router();
const dockerManager = new DockerManager();
const jwtSecret = process.env.JWT_SECRET || 'change-me';
let dockerBaseDir =
  process.env.DOCKER_VOLUME_BASE ||
  (process.env.CLOUDPAINEL_PROJECTS_DIR
    ? `${process.env.CLOUDPAINEL_PROJECTS_DIR}/docker`
    : path.join(process.cwd(), 'backend/data/projects/docker'));
try {
  fs.mkdirSync(dockerBaseDir, { recursive: true });
} catch (err) {
  // Fallback to local path if target base dir is not available.
  dockerBaseDir = path.join(process.cwd(), 'backend/data/projects/docker');
  fs.mkdirSync(dockerBaseDir, { recursive: true });
}
let progressNamespace = null;
const portCheckHost = '0.0.0.0';

// Função para obter IP local
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
};

const isPortFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    const timeout = setTimeout(() => {
      server.close();
      resolve(false);
    }, 1000);
    
    server.once('error', (err) => {
      clearTimeout(timeout);
      resolve(false);
    });
    
    server.once('listening', () => {
      clearTimeout(timeout);
      server.close(() => resolve(true));
    });
    
    server.listen(port, '127.0.0.1');
  });

const findAvailablePort = async (startPort, usedPorts) => {
  let port = Number(startPort);
  while (port < 65535) {
    const dockerFree = !usedPorts.includes(port);
    const systemFree = await isPortFree(port);
    if (dockerFree && systemFree) {
      return port;
    }
    port += 1;
  }
  return null;
};

router.get('/containers', async (req, res, next) => {
  try {
    const containers = await dockerManager.listContainers();
    res.json({ containers });
  } catch (err) {
    next(err);
  }
});

// Templates for wizard
router.get('/templates', (req, res) => {
  res.json({ templates: SERVICE_TEMPLATES, baseDir: dockerBaseDir });
});

// List saved services (containers + metadata)
router.get('/services', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    res.json({ services });
  } catch (err) {
    next(err);
  }
});

router.get('/images', async (req, res, next) => {
  try {
    const images = await dockerManager.listImages();
    res.json({ images });
  } catch (err) {
    next(err);
  }
});

router.get('/presets', (req, res) => {
  const presets = [
    {
      id: 'postgres',
      name: 'PostgreSQL',
      image: 'postgres',
      tag: '16',
      ports: [{ container: 5432, host: 5432 }],
      volumes: [{ host: `${dockerBaseDir}/postgres`, container: '/var/lib/postgresql/data' }],
      env: [{ key: 'POSTGRES_PASSWORD', value: 'postgres' }, { key: 'POSTGRES_DB', value: 'app' }]
    },
    {
      id: 'mysql',
      name: 'MySQL',
      image: 'mysql',
      tag: '8',
      ports: [{ container: 3306, host: 3306 }],
      volumes: [{ host: `${dockerBaseDir}/mysql`, container: '/var/lib/mysql' }],
      env: [{ key: 'MYSQL_ROOT_PASSWORD', value: 'root' }, { key: 'MYSQL_DATABASE', value: 'app' }]
    },
    {
      id: 'redis',
      name: 'Redis',
      image: 'redis',
      tag: '7',
      ports: [{ container: 6379, host: 6379 }],
      volumes: [{ host: `${dockerBaseDir}/redis`, container: '/data' }],
      env: []
    },
    {
      id: 'nginx',
      name: 'Nginx',
      image: 'nginx',
      tag: 'latest',
      ports: [{ container: 80, host: 8080 }],
      volumes: [{ host: `${dockerBaseDir}/nginx`, container: '/usr/share/nginx/html' }],
      env: []
    },
    {
      id: 'node',
      name: 'Node.js',
      image: 'node',
      tag: '20',
      ports: [{ container: 3000, host: 3000 }],
      volumes: [{ host: `${dockerBaseDir}/node`, container: '/app' }],
      env: [{ key: 'NODE_ENV', value: 'production' }]
    }
  ];
  res.json({ presets, baseDir: dockerBaseDir });
});

router.get('/ports', async (req, res, next) => {
  try {
    const ports = (req.query.ports || '')
      .split(',')
      .map((p) => Number(p.trim()))
      .filter(Boolean);
    const used = await dockerManager.getUsedPorts();
    const availability = {};
    for (const port of ports) {
      const dockerFree = !used.includes(port);
      const systemFree = await isPortFree(port);
      availability[port] = dockerFree && systemFree;
    }
    res.json({ availability, used });
  } catch (err) {
    next(err);
  }
});

router.get('/available-port', async (req, res, next) => {
  try {
    const start = Number(req.query.start || 1024);
    const used = await dockerManager.getUsedPorts();
    const available = await findAvailablePort(start, used);
    res.json({ available });
  } catch (err) {
    next(err);
  }
});

router.get('/postgres-databases', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    const postgresDbs = services.filter(s => s.templateId === 'postgres-db');
    res.json({ databases: postgresDbs });
  } catch (err) {
    next(err);
  }
});

router.get('/networks', async (req, res, next) => {
  try {
    const networks = await dockerManager.listNetworks();
    res.json({ networks });
  } catch (err) {
    next(err);
  }
});

router.post('/images/pull', async (req, res, next) => {
  try {
    const { imageName } = req.body || {};
    const result = await dockerManager.pullImage(imageName);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

router.get('/services', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    // Add network fallback for older services
    const servicesWithNetwork = services.map(service => ({
      ...service,
      networkName: service.networkName || 'bridge'
    }));
    res.json({ services: servicesWithNetwork });
  } catch (err) {
    next(err);
  }
});

router.post('/containers/run', async (req, res, next) => {
  try {
    const { imageName, config } = req.body || {};
    const progress = [];
    const container = await dockerManager.runContainer(imageName, config, (msg) => progress.push(msg));
    res.json({ container, progress });
  } catch (err) {
    next(err);
  }
});

// Validate service name
const validateServiceName = (name, existingServices = []) => {
  if (!name || typeof name !== 'string') {
    return 'Nome do serviço é obrigatório';
  }
  if (name.length < 2 || name.length > 50) {
    return 'Nome deve ter entre 2 e 50 caracteres';
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return 'Nome pode conter apenas letras, números, _ e -';
  }
  if (existingServices.some(s => s.name === name)) {
    return 'Já existe um serviço com este nome';
  }
  return null;
};

// Create a service from template
router.post('/services', async (req, res, next) => {
  const progress = [];
  const sessionId = crypto.randomUUID();
  
  try {
    const { templateId, name, hostPort, volumeMappings = [], envVars = [], createProject = false, createManager = false, configureDb = null, networkName = 'bridge' } = req.body || {};
    
    progress.push(`🔍 Validando configuração do serviço ${name}...`);
    
    // Validate service name only once at the beginning
    const existingServices = dockerManager.listServices();
    const nameError = validateServiceName(name, existingServices);
    if (nameError) {
      progress.push(`❌ Validação falhou: ${nameError}`);
      return res.status(400).json({ message: nameError, progress });
    }
    
    progress.push(`✅ Nome do serviço validado com sucesso`);
    
    const template = SERVICE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      progress.push(`❌ Template ${templateId} não encontrado`);
      return res.status(400).json({ message: 'Template not found', progress });
    }

    progress.push(`📦 Preparando container ${template.image}:${template.tag}...`);
    
    const serviceId = crypto.randomUUID();
    const imageName = `${template.image}:${template.tag}`;
    const usedPorts = await dockerManager.getUsedPorts();
    const desiredPort = hostPort ? Number(hostPort) : null;
    
    let resolvedPort;
    if (desiredPort) {
      // Verificar se a porta desejada está disponível
      progress.push(`🔍 Verificando disponibilidade da porta ${desiredPort}...`);
      const usedPorts = await dockerManager.getUsedPorts();
      
      if (usedPorts.includes(desiredPort)) {
        progress.push(`❌ Porta ${desiredPort} já está sendo usada`);
        return res.status(409).json({
          message: `Porta ${desiredPort} já está sendo usada`,
          progress
        });
      }
      
      resolvedPort = desiredPort;
      progress.push(`✅ Porta ${desiredPort} disponível`);
    } else {
      // Buscar porta automática baseada na porta padrão do template
      const startPort = template.defaultPort || 8000;
      progress.push(`🔍 Buscando porta disponível a partir de ${startPort}...`);
      
      resolvedPort = await dockerManager.findAvailablePort(startPort);
      
      if (!resolvedPort) {
        return res.status(409).json({
          message: 'Nenhuma porta disponível encontrada.',
          progress
        });
      }
      progress.push(`✅ Porta ${resolvedPort} selecionada automaticamente`);
    }

    const hostConfig = {
      PortBindings: {
        [`${template.containerPort}/tcp`]: [{ HostPort: String(resolvedPort) }]
      },
      Binds: volumeMappings
        .filter((m) => m.hostPath && m.containerPath)
        .map((m) => `${m.hostPath}:${m.containerPath}`)
    };

    progress.push(`📁 Criando volumes e diretórios...`);
    
    const finalizedVolumes = volumeMappings.map((m) => {
      const hostPath =
        m.hostPath && m.hostPath.trim().length > 0
          ? m.hostPath
          : path.join(dockerBaseDir, name);
      return { ...m, hostPath };
    });
    
    try {
      finalizedVolumes
        .filter((m) => m.hostPath)
        .forEach((m) => {
          progress.push(`📂 Criando diretório: ${m.hostPath}`);
          fs.mkdirSync(path.resolve(m.hostPath), { recursive: true });
          
          // Fix PostgreSQL permissions
          if (templateId === 'postgres-db') {
            try {
              const { execSync } = require('child_process');
              execSync(`chown -R 999:999 "${m.hostPath}"`, { stdio: 'ignore' });
              execSync(`chmod -R 700 "${m.hostPath}"`, { stdio: 'ignore' });
              progress.push(`✅ Permissões PostgreSQL ajustadas`);
            } catch (err) {
              progress.push(`⚠️ Aviso: ${err.message}`);
            }
          }
        });
    } catch (err) {
      progress.push(`❌ Erro ao criar diretórios: ${err.message}`);
      throw err;
    }

    const env = [
      ...template.env.map((e) => `${e.key}=${e.value}`),
      ...envVars.filter((e) => e.key).map((e) => `${e.key}=${e.value}`)
    ];

    let finalImageName = imageName;
    let containerCmd = template.command;
    let containerUser = undefined;

    // Para projetos exemplo, criar arquivos no volume (exceto PostgreSQL)
    if (createProject && finalizedVolumes.length > 0 && templateId !== 'postgres-db') {
      const projectPath = finalizedVolumes[0].hostPath;
      
      try {
        await dockerManager.createProjectTemplate(templateId, projectPath, (msg) => {
          if (msg) {
            progress.push(msg);
            if (progressNamespace) {
              progressNamespace.emit('progress', { sessionId, message: msg });
            }
          }
        });
        
        // Para Node.js, usar imagem base e instalar dependências
        if (templateId === 'node-app') {
          containerCmd = ['sh', '-c', 'npm install && npm start'];
        }
      } catch (err) {
        progress.push(`⚠️ Erro ao criar projeto exemplo: ${err.message}`);
      }
    } else if (!createProject && templateId === 'node-app') {
      containerCmd = ['npm', 'start'];
    }

    const containerConfig = {
      name,
      HostConfig: {
        ...hostConfig,
        NetworkMode: networkName,
        Binds: finalizedVolumes
          .filter((m) => m.hostPath && m.containerPath)
          .map((m) => `${m.hostPath}:${m.containerPath}`)
      },
      Env: env,
      ExposedPorts: {
        [`${template.containerPort}/tcp`]: {}
      }
    };

    if (containerCmd) {
      containerConfig.Cmd = containerCmd;
    }
    if (template.workdir) {
      containerConfig.WorkingDir = template.workdir;
    }
    if (containerUser) {
      containerConfig.User = containerUser;
    }

    progress.push(`🚀 Iniciando container...`);
    
    try {
      const container = await dockerManager.runContainer(imageName, containerConfig, (msg) => {
        if (msg) {
          progress.push(msg);
          if (progressNamespace) {
            progressNamespace.emit('progress', { sessionId, message: msg });
          }
        }
      });
      
      progress.push(`✅ Container criado com ID: ${container.Id}`);
      
      const service = {
        id: serviceId,
        name,
        templateId,
        image: imageName,
        containerId: container.Id,
        hostPort: resolvedPort,
        containerPort: template.containerPort,
        volumes: finalizedVolumes,
        networkName,
        url: `http://localhost:${resolvedPort}`,
        serverIP: getLocalIP(),
        externalUrl: `http://${getLocalIP()}:${resolvedPort}`,
        createdAt: new Date().toISOString(),
        hasProject: createProject && finalizedVolumes.length > 0 && templateId !== 'postgres-db'
      };

      progress.push(`💾 Salvando serviço no registro...`);
      dockerManager.saveService(service);
      progress.push(`✅ Serviço salvo com sucesso`);

      let managerService = null;
      
      // Criar pgAdmin se solicitado para PostgreSQL
      if (createManager && templateId === 'postgres-db') {
        progress.push(`🔧 Criando pgAdmin...`);
        
        const pgAdminPort = await dockerManager.findAvailablePort(8081);
        if (!pgAdminPort) {
          throw new Error('Nenhuma porta disponível para pgAdmin');
        }
        progress.push(`✅ Usando porta ${pgAdminPort} para pgAdmin`);
        
        const pgAdminConfig = {
          name: `${name}-pgadmin`,
          User: 'root',
          HostConfig: {
            NetworkMode: networkName,
            PortBindings: {
              '80/tcp': [{ HostPort: String(pgAdminPort) }]
            }
          },
          Env: [
            'PGADMIN_DEFAULT_EMAIL=admin@admin.com',
            'PGADMIN_DEFAULT_PASSWORD=admin',
            'PGADMIN_CONFIG_SERVER_MODE=False',
            'PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED=False'
          ],
          ExposedPorts: { '80/tcp': {} }
        };
        
        const pgAdminContainer = await dockerManager.runContainer('dpage/pgadmin4:latest', pgAdminConfig);
        
        managerService = {
          id: crypto.randomUUID(),
          name: `${name}-pgadmin`,
          templateId: 'pgadmin',
          image: 'dpage/pgadmin4:latest',
          containerId: pgAdminContainer.Id,
          hostPort: pgAdminPort,
          containerPort: 80,
          volumes: [],
          networkName,
          url: `http://localhost:${pgAdminPort}`,
          serverIP: getLocalIP(),
          externalUrl: `http://${getLocalIP()}:${pgAdminPort}`,
          createdAt: new Date().toISOString(),
          parentService: serviceId,
          credentials: {
            email: 'admin@admin.com',
            password: 'admin'
          },
          dbConnection: {
            host: networkName === 'bridge' ? 'host.docker.internal' : name,
            port: resolvedPort,
            database: env.find(e => e.startsWith('POSTGRES_DB='))?.split('=')[1] || 'appdb',
            username: env.find(e => e.startsWith('POSTGRES_USER='))?.split('=')[1] || 'app',
            password: env.find(e => e.startsWith('POSTGRES_PASSWORD='))?.split('=')[1] || 'change-me'
          }
        };
        
        dockerManager.saveService(managerService);
        progress.push(`✅ pgAdmin criado na porta ${pgAdminPort}`);
      }
      
      // Configurar pgAdmin para banco existente
      if (templateId === 'pgadmin' && configureDb) {
        const targetDb = dockerManager.listServices().find(s => s.id === configureDb);
        if (targetDb && targetDb.templateId === 'postgres-db') {
          progress.push(`🔗 Configurando conexão com ${targetDb.name}...`);
          
          // Obter variáveis de ambiente do serviço PostgreSQL
          const template = SERVICE_TEMPLATES.find(t => t.id === 'postgres-db');
          const defaultEnv = template ? template.env : [];
          
          service.dbConnection = {
            host: targetDb.networkName === service.networkName ? targetDb.name : 'host.docker.internal',
            port: targetDb.hostPort,
            database: defaultEnv.find(e => e.key === 'POSTGRES_DB')?.value || 'appdb',
            username: defaultEnv.find(e => e.key === 'POSTGRES_USER')?.value || 'app',
            password: defaultEnv.find(e => e.key === 'POSTGRES_PASSWORD')?.value || 'change-me'
          };
          
          service.configuredFor = targetDb.id;
          dockerManager.saveService(service);
          progress.push(`✅ pgAdmin configurado para ${targetDb.name}`);
        }
      }

      if (progressNamespace) {
        progressNamespace.emit('progress', { sessionId, message: '✅ Serviço criado com sucesso!' });
      }

      res.json({ service, managerService, container, progress, sessionId });
    } catch (containerErr) {
      progress.push(`❌ Erro ao criar container: ${containerErr.message}`);
      throw containerErr;
    }
  } catch (err) {
    console.error('Service creation error:', err);
    progress.push(`❌ Erro: ${err.message}`);
    
    // Add more specific error information
    if (err.code) {
      progress.push(`Código do erro: ${err.code}`);
    }
    if (err.statusCode) {
      progress.push(`Status HTTP: ${err.statusCode}`);
    }
    
    const extra = err.progress || progress;
    res.status(500).json({ 
      message: err.message || 'Erro ao criar serviço', 
      code: err.code,
      progress: extra 
    });
  }
});

router.post('/containers/:id/stop', async (req, res, next) => {
  try {
    await dockerManager.stopContainer(req.params.id);
    res.json({ status: 'stopped' });
  } catch (err) {
    next(err);
  }
});

router.post('/containers/:id/restart', async (req, res, next) => {
  try {
    await dockerManager.restartContainer(req.params.id);
    res.json({ status: 'restarted' });
  } catch (err) {
    next(err);
  }
});

router.delete('/images/:id', async (req, res, next) => {
  try {
    await dockerManager.docker.getImage(req.params.id).remove({ force: true });
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/images/:id/pull', async (req, res, next) => {
  try {
    const image = dockerManager.docker.getImage(req.params.id);
    const info = await image.inspect();
    const tag = info.RepoTags && info.RepoTags[0] ? info.RepoTags[0] : req.params.id;
    await dockerManager.pullImage(tag);
    res.json({ status: 'pulled' });
  } catch (err) {
    next(err);
  }
});

router.delete('/containers/:id', async (req, res, next) => {
  try {
    await dockerManager.removeContainer(req.params.id);
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

// Update service
router.put('/services/:id', async (req, res, next) => {
  try {
    const { hostPort, envVars = [], networkName } = req.body || {};
    const services = dockerManager.listServices();
    const service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Verificar se a nova porta está disponível (se foi alterada)
    const newPort = Number(hostPort);
    if (newPort && newPort !== service.hostPort) {
      const usedPorts = await dockerManager.getUsedPorts();
      if (usedPorts.includes(newPort)) {
        return res.status(409).json({ 
          message: `Porta ${newPort} já está sendo usada` 
        });
      }
    }

    // Stop current container
    if (service.containerId) {
      try {
        await dockerManager.stopContainer(service.containerId);
        await dockerManager.removeContainer(service.containerId);
      } catch (err) {
        // Container might already be stopped/removed
      }
    }

    // Create new container with updated config
    const template = SERVICE_TEMPLATES.find((t) => t.id === service.templateId);
    const resolvedPort = newPort || service.hostPort;
    
    const env = [
      ...template.env.map((e) => `${e.key}=${e.value}`),
      ...envVars.filter((e) => e.key).map((e) => `${e.key}=${e.value}`)
    ];

    const containerConfig = {
      name: service.name,
      HostConfig: {
        NetworkMode: networkName || service.networkName || 'bridge',
        PortBindings: {
          [`${service.containerPort}/tcp`]: [{ HostPort: String(resolvedPort) }]
        },
        Binds: service.volumes
          .filter((m) => m.hostPath && m.containerPath)
          .map((m) => `${m.hostPath}:${m.containerPath}`)
      },
      Env: env,
      ExposedPorts: {
        [`${service.containerPort}/tcp`]: {}
      }
    };

    if (template.command) {
      containerConfig.Cmd = template.command;
    }
    if (template.workdir) {
      containerConfig.WorkingDir = template.workdir;
    }

    // For Node.js with project, use npm install and start
    if (service.hasProject && service.templateId === 'node-app') {
      containerConfig.Cmd = ['sh', '-c', 'npm install && npm start'];
    }

    const container = await dockerManager.runContainer(service.image, containerConfig);
    
    // Update service
    const updatedService = {
      ...service,
      containerId: container.Id,
      hostPort: resolvedPort,
      networkName: networkName || service.networkName,
      url: `http://localhost:${resolvedPort}`,
      serverIP: getLocalIP(),
      externalUrl: `http://${getLocalIP()}:${resolvedPort}`,
      updatedAt: new Date().toISOString()
    };

    dockerManager.saveService(updatedService);
    res.json({ service: updatedService });
  } catch (err) {
    next(err);
  }
});

// Remove service
router.delete('/services/:id', async (req, res, next) => {
  try {
    const { removeFolder = false } = req.body || {};
    const services = dockerManager.listServices();
    const service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    
    // Remove container if exists
    if (service.containerId) {
      try {
        await dockerManager.removeContainer(service.containerId);
      } catch (err) {
        // Container might already be removed
      }
    }
    
    // Remove folder if requested
    if (removeFolder && service.volumes && service.volumes.length > 0) {
      const fs = require('fs');
      for (const volume of service.volumes) {
        if (volume.hostPath && fs.existsSync(volume.hostPath)) {
          try {
            fs.rmSync(volume.hostPath, { recursive: true, force: true });
          } catch (err) {
            console.error('Error removing folder:', err);
          }
        }
      }
    }
    
    // Remove from registry
    dockerManager.removeService(req.params.id);
    
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

router.get('/containers/:id/stats', async (req, res, next) => {
  try {
    const stats = await dockerManager.getContainerStats(req.params.id);
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

const extractToken = (handshake) => {
  if (handshake.auth && handshake.auth.token) {
    return handshake.auth.token;
  }
  if (handshake.query && handshake.query.token) {
    return handshake.query.token;
  }
  const authHeader = handshake.headers && handshake.headers.authorization;
  if (authHeader) {
    const [scheme, token] = authHeader.split(' ');
    if (scheme === 'Bearer') {
      return token;
    }
  }
  return null;
};

// Preset templates to drive the wizard
const SERVICE_TEMPLATES = [
  {
    id: 'nginx-static',
    label: 'Nginx (static site)',
    image: 'nginx',
    tag: 'latest',
    defaultPort: 8080,
    containerPort: 80,
    volumes: [
      { hostPath: '', containerPath: '/usr/share/nginx/html' }
    ],
    env: [],
    description: 'Serve arquivos estáticos rapidamente'
  },
  {
    id: 'node-app',
    label: 'Node.js (app)',
    image: 'node',
    tag: '20',
    defaultPort: 8000,
    containerPort: 3000,
    volumes: [
      { hostPath: '', containerPath: '/usr/src/app' }
    ],
    env: [{ key: 'NODE_ENV', value: 'production' }],
    command: ['npm', 'start'],
    workdir: '/usr/src/app',
    description: 'Aplicação Node com npm start'
  },
  {
    id: 'postgres-db',
    label: 'PostgreSQL',
    image: 'postgres',
    tag: '16',
    defaultPort: 5433,
    containerPort: 5432,
    volumes: [
      { hostPath: '', containerPath: '/var/lib/postgresql/data' }
    ],
    env: [
      { key: 'POSTGRES_USER', value: 'app' },
      { key: 'POSTGRES_PASSWORD', value: 'change-me' },
      { key: 'POSTGRES_DB', value: 'appdb' }
    ],
    description: 'Banco PostgreSQL pronto para uso',
    hasProjectOption: false,
    hasManagerOption: true,
    managerLabel: 'Instalar pgAdmin (gerenciador web)'
  },
  {
    id: 'pgadmin',
    label: 'pgAdmin',
    image: 'dpage/pgadmin4',
    tag: 'latest',
    defaultPort: 8081,
    containerPort: 80,
    volumes: [
      { hostPath: '', containerPath: '/var/lib/pgadmin' }
    ],
    env: [
      { key: 'PGADMIN_DEFAULT_EMAIL', value: 'admin@admin.com' },
      { key: 'PGADMIN_DEFAULT_PASSWORD', value: 'admin' }
    ],
    description: 'Interface web para gerenciar PostgreSQL',
    isManager: true,
    hasProjectOption: false,
    hasDbConfigOption: true,
    dbConfigLabel: 'Configurar para banco PostgreSQL existente'
  },
  {
    id: 'mysql-db',
    label: 'MySQL',
    image: 'mysql',
    tag: '8',
    defaultPort: 3307,
    containerPort: 3306,
    volumes: [
      { hostPath: '', containerPath: '/var/lib/mysql' }
    ],
    env: [
      { key: 'MYSQL_ROOT_PASSWORD', value: 'root' },
      { key: 'MYSQL_DATABASE', value: 'app' }
    ],
    description: 'Banco MySQL pronto para uso'
  },
  {
    id: 'redis-cache',
    label: 'Redis',
    image: 'redis',
    tag: '7',
    defaultPort: 6380,
    containerPort: 6379,
    volumes: [
      { hostPath: '', containerPath: '/data' }
    ],
    env: [],
    description: 'Cache Redis pronto para uso'
  }
];

const initDockerSocket = (io) => {
  // Progress namespace for pull/build events
  progressNamespace = io.of('/api/docker/progress');
  progressNamespace.use((socket, next) => {
    const token = extractToken(socket.handshake);
    if (!token) {
      return next(new Error('Unauthorized'));
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      socket.user = {
        id: payload.sub,
        role: payload.role,
        username: payload.username
      };
      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  progressNamespace.on('connection', (socket) => {
    // Just listen, server will broadcast progress events
  });

  // Logs namespace
  const namespace = io.of('/api/docker/logs');

  namespace.use((socket, next) => {
    const token = extractToken(socket.handshake);
    if (!token) {
      return next(new Error('Unauthorized'));
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      socket.user = {
        id: payload.sub,
        role: payload.role,
        username: payload.username
      };
      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  namespace.on('connection', (socket) => {
    let currentStream = null;

    socket.on('subscribe', async (payload = {}) => {
      const { containerId, tail } = payload;
      if (!containerId) {
        socket.emit('error', { message: 'containerId is required' });
        return;
      }

      if (currentStream) {
        currentStream.destroy();
        currentStream = null;
      }

      try {
        currentStream = await dockerManager.getContainerLogs(containerId, { tail });
        currentStream.on('data', (chunk) => {
          socket.emit('log', { data: chunk.toString() });
        });
        currentStream.on('end', () => {
          socket.emit('end', { message: 'Log stream ended' });
        });
      } catch (err) {
        socket.emit('error', { message: err.message || 'Failed to stream logs' });
      }
    });

    socket.on('disconnect', () => {
      if (currentStream) {
        currentStream.destroy();
      }
    });
  });
};

module.exports = {
  router,
  initDockerSocket
};
