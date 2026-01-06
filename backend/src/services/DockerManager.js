'use strict';

const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const ProjectTemplateManager = require('./ProjectTemplateManager');

const ALLOWED_PULL_IMAGES = new Set([
  'postgres',
  'postgresql',
  'mysql',
  'redis',
  'nginx',
  'node',
  'dpage/pgadmin4'
]);

class DockerManager {
  constructor(options = {}) {
    this.docker = options.docker || new Docker();
    this.registryPath =
      options.registryPath || path.join(__dirname, '../../data/docker-services.json');
    this.templateManager = new ProjectTemplateManager();
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    if (!fs.existsSync(this.registryPath)) {
      fs.writeFileSync(this.registryPath, '[]');
    }
  }

  listContainers() {
    return this.docker.listContainers({ all: true });
  }

  listImages() {
    return this.docker.listImages({ all: true });
  }

  async pullImage(imageName, onProgress) {
    const normalized = (imageName || '').trim();
    const baseName = normalized.split(':')[0];
    if (!ALLOWED_PULL_IMAGES.has(baseName)) {
      throw new Error('Image not allowed');
    }

    return new Promise((resolve, reject) => {
      const layerStates = {};
      const importantStatuses = new Set(['Pulling fs layer', 'Downloading', 'Verifying Checksum', 'Download complete', 'Extracting', 'Pull complete']);
      let lastSummaryTime = 0;
      
      this.docker.pull(normalized, (err, stream) => {
        if (err) {
          return reject(err);
        }
        this.docker.modem.followProgress(stream, (progressErr, output) => {
          if (progressErr) {
            return reject(progressErr);
          }
          if (onProgress) {
            onProgress(`✅ Download da imagem ${normalized} concluído`);
          }
          return resolve(output);
        }, (event) => {
          if (!onProgress) return;
          
          const id = event.id || '';
          const status = event.status || '';
          const progressDetail = event.progressDetail || {};
          
          // Emit non-layer messages immediately
          if (!id) {
            onProgress(status);
            return;
          }
          
          // Track layer state changes
          const lastStatus = layerStates[id];
          const isImportant = importantStatuses.has(status);
          
          if (status !== lastStatus && isImportant) {
            layerStates[id] = status;
            const progress = event.progress || '';
            onProgress(`${id}: ${status} ${progress}`.trim());
          }
          
          // Periodic summary every 3 seconds
          const now = Date.now();
          if (now - lastSummaryTime > 3000) {
            lastSummaryTime = now;
            const summary = Object.entries(layerStates).reduce((acc, [layerId, layerStatus]) => {
              acc[layerStatus] = (acc[layerStatus] || 0) + 1;
              return acc;
            }, {});
            const summaryText = Object.entries(summary).map(([s, count]) => `${count} ${s}`).join(', ');
            if (summaryText) {
              onProgress(`📊 Resumo: ${summaryText}`);
            }
          }
        });
      });
    });
  }

  async ensureImageExists(imageName, onProgress) {
    try {
      await this.docker.getImage(imageName).inspect();
      if (onProgress) {
        onProgress(`ℹ️  Imagem ${imageName} já existe localmente`);
      }
      return false; // already present
    } catch (err) {
      if (onProgress) {
        onProgress(`⬇️  Baixando imagem ${imageName}...`);
      }
      await this.pullImage(imageName, onProgress);
      if (onProgress) {
        onProgress(`✅ Imagem ${imageName} baixada com sucesso`);
      }
      return true; // pulled
    }
  }

  async runContainer(imageName, config = {}, onProgress) {
    try {
      await this.ensureImageExists(imageName, onProgress);
      
      if (onProgress) {
        onProgress(`🔨 Criando container...`);
      }
      
      let container;
      try {
        container = await this.docker.createContainer({
          Image: imageName,
          ...config
        });
        if (onProgress) {
          onProgress(`✅ Container ${container.id.slice(0, 12)} criado`);
        }
      } catch (createErr) {
        if (onProgress) {
          onProgress(`❌ Erro ao criar container: ${createErr.message}`);
        }
        throw createErr;
      }
      
      if (onProgress) {
        onProgress(`▶️  Iniciando container ${container.id.slice(0, 12)}...`);
      }
      
      try {
        await container.start();
        if (onProgress) {
          onProgress(`✅ Container ${container.id.slice(0, 12)} iniciado com sucesso`);
        }
      } catch (startErr) {
        if (onProgress) {
          onProgress(`❌ Erro ao iniciar container: ${startErr.message}`);
        }
        throw startErr;
      }
      
      return container.inspect();
    } catch (err) {
      if (onProgress) {
        onProgress(`❌ Erro geral: ${err.message}`);
      }
      throw err;
    }
  }

   // ---- Service registry helpers --------------------------------------------------
  readRegistry() {
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  writeRegistry(services) {
    fs.writeFileSync(this.registryPath, JSON.stringify(services, null, 2));
  }

  listServices() {
    return this.readRegistry();
  }

  saveService(service) {
    const services = this.readRegistry();
    const idx = services.findIndex((s) => s.id === service.id);
    if (idx >= 0) {
      services[idx] = service;
    } else {
      services.push(service);
    }
    this.writeRegistry(services);
    return service;
  }

  stopContainer(containerId) {
    return this.docker.getContainer(containerId).stop();
  }

  restartContainer(containerId) {
    return this.docker.getContainer(containerId).restart();
  }

  removeContainer(containerId) {
    return this.docker.getContainer(containerId).remove({ force: true });
  }

  getContainerLogs(containerId, options = {}) {
    return this.docker.getContainer(containerId).logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: options.tail || 100
    });
  }

  async getContainerStats(containerId) {
    const stats = await this.docker.getContainer(containerId).stats({ stream: false });

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
      stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage -
      stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

    const memoryUsage = stats.memory_stats.usage || 0;
    const memoryLimit = stats.memory_stats.limit || 0;

    return {
      cpuPercent: Number(cpuPercent.toFixed(2)),
      memoryUsage,
      memoryLimit
    };
  }

  async getUsedPorts() {
    const used = new Set();
    
    // Portas dos containers Docker ativos
    try {
      const containers = await this.docker.listContainers({ all: false });
      containers.forEach((container) => {
        (container.Ports || []).forEach((port) => {
          if (port.PublicPort) {
            used.add(port.PublicPort);
          }
        });
      });
    } catch (err) {
      console.error('Erro ao listar containers:', err);
    }
    
    // Verificar portas do sistema usando lsof
    try {
      const { execSync } = require('child_process');
      const output = execSync('lsof -i -P -n | grep LISTEN', { encoding: 'utf8' });
      const lines = output.split('\n');
      lines.forEach(line => {
        const match = line.match(/:([0-9]+)\s+\(LISTEN\)/);
        if (match) {
          used.add(parseInt(match[1]));
        }
      });
    } catch (err) {
      // Fallback para portas conhecidas se lsof falhar
      const systemPorts = [22, 25, 53, 80, 110, 143, 443, 993, 995, 3000, 3001, 5432, 3306, 6379, 8080];
      systemPorts.forEach(port => used.add(port));
    }
    
    return Array.from(used);
  }

  async listNetworks() {
    const networks = await this.docker.listNetworks();
    return networks.map(network => ({
      id: network.Id,
      name: network.Name,
      driver: network.Driver,
      scope: network.Scope,
      created: network.Created
    }));
  }

  async buildImage(imageName, contextPath, onProgress) {
    try {
      if (onProgress) {
        onProgress(`🔨 Construindo imagem ${imageName} a partir de ${contextPath}...`);
      }
      
      const tarfs = require('tar-fs');
      const tarStream = tarfs.pack(contextPath);
      
      return new Promise((resolve, reject) => {
        this.docker.buildImage(tarStream, { t: imageName }, (err, stream) => {
          if (err) {
            return reject(err);
          }
          
          this.docker.modem.followProgress(stream, (progressErr, output) => {
            if (progressErr) {
              return reject(progressErr);
            }
            if (onProgress) {
              onProgress(`✅ Imagem ${imageName} construída com sucesso`);
            }
            return resolve(output);
          }, (event) => {
            if (onProgress && event.stream) {
              const message = event.stream.trim();
              if (message) {
                onProgress(message);
              }
            }
          });
        });
      });
    } catch (err) {
      if (onProgress) {
        onProgress(`❌ Erro ao construir imagem: ${err.message}`);
      }
      throw err;
    }
  }

  async createProjectTemplate(templateId, projectPath, onProgress) {
    if (!this.templateManager.hasTemplate(templateId)) {
      if (onProgress) {
        onProgress(`⚠️  Template ${templateId} não disponível para projeto exemplo`);
      }
      return null;
    }

    try {
      if (onProgress) {
        onProgress(`📁 Criando projeto exemplo...`);
      }
      
      const createdFiles = await this.templateManager.createProjectFiles(templateId, projectPath);
      
      if (onProgress) {
        onProgress(`✅ Projeto exemplo criado com ${createdFiles.length} arquivos`);
        onProgress(`📝 Arquivos: ${createdFiles.join(', ')}`);
      }
      
      return createdFiles;
    } catch (err) {
      if (onProgress) {
        onProgress(`❌ Erro ao criar projeto exemplo: ${err.message}`);
      }
      throw err;
    }
  }

  removeService(serviceId) {
    const services = this.readRegistry();
    const updated = services.filter((s) => s.id !== serviceId);
    this.writeRegistry(updated);
    return true;
  }

  async findAvailablePort(startPort = 8000) {
    const usedPorts = await this.getUsedPorts();
    let port = startPort;
    while (port < 65535) {
      if (!usedPorts.includes(port)) {
        // Verificação adicional com tentativa de bind
        const net = require('net');
        const available = await new Promise((resolve) => {
          const server = net.createServer();
          server.once('error', () => resolve(false));
          server.once('listening', () => {
            server.close(() => resolve(true));
          });
          server.listen(port, '127.0.0.1');
        });
        
        if (available) {
          return port;
        }
      }
      port++;
    }
    return null;
  }

  getAvailableTemplates() {
    return this.templateManager.getAvailableTemplates();
  }
}

module.exports = DockerManager;
