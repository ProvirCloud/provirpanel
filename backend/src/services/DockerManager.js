'use strict';

const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const ProjectTemplateManager = require('./ProjectTemplateManager');

const ALLOWED_PULL_IMAGES = new Set([
  'postgres',
  'postgresql',
  'mysql',
  'mariadb',
  'wordpress',
  'redis',
  'nginx',
  'node',
  'dpage/pgadmin4',
  'n8nio/n8n',
  'mongo',
  'rabbitmq',
  'memcached',
  'eclipse-temurin',
  'openjdk',
  'amazoncorretto',
  'python',
  'ruby',
  'golang',
  'httpd',
  'traefik',
  'adminer',
  'phpmyadmin',
  'minio/minio',
  'grafana/grafana',
  'prom/prometheus',
  'elasticsearch',
  'kibana',
  'bitnami/wordpress',
  'bitnami/postgresql',
  'bitnami/mysql',
  'bitnami/redis',
  'bitnami/nginx',
  'bitnami/node',
  'bitnami/mongodb'
]);

const extractContainerHealthStatus = (container = {}) => {
  const explicitStatus = container.State?.Health?.Status || container.Health?.Status;
  if (explicitStatus) return explicitStatus;
  const statusText = String(container.Status || '').toLowerCase();
  if (statusText.includes('unhealthy')) return 'unhealthy';
  if (statusText.includes('healthy')) return 'healthy';
  if (statusText.includes('health: starting') || statusText.includes('(health: starting)')) {
    return 'starting';
  }
  return null;
};

class DockerManager {
  constructor(options = {}) {
    this.docker = options.docker || new Docker();
    this.registryPath =
      options.registryPath ||
      process.env.DOCKER_SERVICES_REGISTRY ||
      path.join(__dirname, '../../data/docker-services.json');
    this.registryFallbackPaths = [
      path.join(process.cwd(), 'backend/data/docker-services.json'),
      path.join(process.cwd(), 'data/docker-services.json'),
      path.join(__dirname, '../../../data/docker-services.json')
    ].filter((candidate, index, list) => candidate !== this.registryPath && list.indexOf(candidate) === index);
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

  async ensureNetwork(name) {
    if (!name) return null;
    const networks = await this.docker.listNetworks();
    const existing = networks.find((net) => net.Name === name);
    if (existing) {
      return existing;
    }
    return this.docker.createNetwork({ Name: name, Driver: 'bridge' });
  }

  async pullImage(imageName, onProgress, options = {}) {
    const normalized = (imageName || '').trim();
    const baseName = normalized.split(':')[0];
    if (!options.allowAny && !ALLOWED_PULL_IMAGES.has(baseName)) {
      // Allow any image from Docker Hub (contains /) or official images
      const isDockerHub = baseName.includes('/') || baseName.match(/^[a-z][a-z0-9-]+$/);
      if (!isDockerHub) {
        throw new Error('Image not allowed');
      }
    }

    return new Promise((resolve, reject) => {
      const layerStates = {};
      const importantStatuses = new Set(['Pulling fs layer', 'Downloading', 'Verifying Checksum', 'Download complete', 'Extracting', 'Pull complete']);
      let lastSummaryTime = 0;
      
      const pullOptions = options.authconfig ? { authconfig: options.authconfig } : undefined;
      this.docker.pull(normalized, pullOptions, (err, stream) => {
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
  readRegistryFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return [];
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  readRegistry() {
    const primary = this.readRegistryFile(this.registryPath);
    if (primary.length) {
      return primary;
    }

    for (const fallbackPath of this.registryFallbackPaths) {
      const fallback = this.readRegistryFile(fallbackPath);
      if (fallback.length) {
        return fallback;
      }
    }

    return primary;
  }

  writeRegistry(services) {
    fs.writeFileSync(this.registryPath, JSON.stringify(services, null, 2));
  }

  listServices() {
    return this.readRegistry();
  }

  isManagedContainer(containerInfo = {}) {
    const labels = containerInfo.Config?.Labels || containerInfo.Labels || {};
    if (labels['provirpanel.managed'] === 'true') {
      return true;
    }

    const networkNames = [
      ...Object.keys(containerInfo.NetworkSettings?.Networks || {}),
      ...(Array.isArray(containerInfo.NetworkSettings?.Networks)
        ? containerInfo.NetworkSettings.Networks.map((network) => network?.NetworkID || network?.Name).filter(Boolean)
        : [])
    ].map((value) => String(value || '').toLowerCase());

    if (networkNames.some((name) => name === 'provirpanel' || name.includes('provirpanel'))) {
      return true;
    }

    const mounts = containerInfo.Mounts || [];
    return mounts.some((mount) => {
      const source = String(mount.Source || mount.hostPath || '');
      return source.includes('/projects/docker/') || source.includes('/data/projects/docker/');
    });
  }

  inferServiceFromContainer(containerInfo = {}) {
    if (!containerInfo || !this.isManagedContainer(containerInfo)) {
      return null;
    }

    const labels = containerInfo.Config?.Labels || {};
    const ports = containerInfo.NetworkSettings?.Ports || {};
    const firstPortEntry = Object.entries(ports).find(([, bindings]) => Array.isArray(bindings) && bindings.length > 0);
    const [containerPortKey, bindings] = firstPortEntry || [];
    const firstBinding = bindings?.[0] || null;
    const containerPort = containerPortKey ? Number(String(containerPortKey).split('/')[0]) : null;
    const hostPort = firstBinding?.HostPort ? Number(firstBinding.HostPort) : null;
    const bindLocalOnly = firstBinding?.HostIp === '127.0.0.1';
    const networkName =
      Object.keys(containerInfo.NetworkSettings?.Networks || {})[0] ||
      containerInfo.HostConfig?.NetworkMode ||
      'bridge';
    const name = labels['provirpanel.service.name'] || String(containerInfo.Name || '').replace(/^\//, '');
    const image = containerInfo.Config?.Image || '';

    return {
      id: labels['provirpanel.service.id'] || containerInfo.Id,
      name,
      templateId: labels['provirpanel.template.id'] || null,
      image,
      containerId: containerInfo.Id,
      hostPort,
      containerPort,
      volumes: (containerInfo.Mounts || []).map((mount) => ({
        hostPath: mount.Source || '',
        containerPath: mount.Destination || ''
      })),
      networkName,
      bindLocalOnly,
      url: hostPort ? `http://localhost:${hostPort}` : null,
      externalUrl: hostPort && !bindLocalOnly ? `http://localhost:${hostPort}` : null,
      createdAt: containerInfo.Created || new Date().toISOString(),
      containerStatus: containerInfo.State?.Status || null,
      healthStatus: extractContainerHealthStatus(containerInfo),
      hasProject: Boolean(labels['provirpanel.has_project'] === 'true'),
      parentService: labels['provirpanel.parent.id'] || null,
      envVars: []
    };
  }

  async listManagedServices() {
    const registryServices = this.readRegistry();
    let containers = [];

    try {
      containers = await this.listContainers();
    } catch (err) {
      return registryServices;
    }

    const byContainerId = new Map(containers.map((container) => [container.Id, container]));
    const byName = new Map(
      containers.flatMap((container) =>
        (container.Names || []).map((name) => [String(name).replace(/^\//, ''), container])
      )
    );

    // Filter out services whose container no longer exists (auto-cleanup)
    const aliveServices = [];
    const deadIds = [];

    for (const service of registryServices) {
      const matchedContainer = byContainerId.get(service.containerId) || byName.get(service.name);
      if (matchedContainer) {
        const publishedPort = (matchedContainer.Ports || []).find((port) => port.PublicPort);
        const hostPort = publishedPort?.PublicPort ?? service.hostPort ?? null;
        const containerPort = publishedPort?.PrivatePort ?? service.containerPort ?? null;
        const bindLocalOnly = publishedPort?.IP === '127.0.0.1' || service.bindLocalOnly || false;
        const networkName =
          Object.keys(matchedContainer.NetworkSettings?.Networks || {})[0] ||
          matchedContainer.HostConfig?.NetworkMode ||
          service.networkName ||
          'bridge';

        aliveServices.push({
          ...service,
          containerId: matchedContainer.Id,
          hostPort,
          containerPort,
          networkName,
          bindLocalOnly,
          url: hostPort ? `http://localhost:${hostPort}` : service.url,
          externalUrl: hostPort && !bindLocalOnly ? `http://localhost:${hostPort}` : service.externalUrl,
          containerStatus: matchedContainer.Status || matchedContainer.State || null,
          healthStatus: extractContainerHealthStatus(matchedContainer)
        });
      } else if (service.containerId) {
        // Container gone — mark for removal from registry
        deadIds.push(service.id);
      } else {
        // No containerId yet (never started) — keep it
        aliveServices.push(service);
      }
    }

    // Auto-cleanup dead services from registry
    if (deadIds.length > 0) {
      const cleaned = registryServices.filter((s) => !deadIds.includes(s.id));
      this.writeRegistry(cleaned);
    }

    const knownContainerIds = new Set(aliveServices.map((service) => service.containerId).filter(Boolean));

    for (const container of containers) {
      if (knownContainerIds.has(container.Id)) continue;

      try {
        const details = await this.docker.getContainer(container.Id).inspect();
        const inferred = this.inferServiceFromContainer(details);
        if (inferred) {
          aliveServices.push(inferred);
        }
      } catch (err) {
        // Ignore containers that disappear during listing.
      }
    }

    return aliveServices;
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

  async getContainerLogs(containerId, options = {}) {
    const container = this.docker.getContainer(containerId);
    const info = await container.inspect();
    const isTty = !!info?.Config?.Tty;

    const data = await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: options.tail || 100
    });

    // dockerode may return a Buffer, a Stream, or a string depending on version
    const { PassThrough } = require('stream');

    // If it's already a readable stream with .on
    if (data && typeof data.on === 'function' && typeof data.pipe === 'function') {
      if (isTty) {
        return data;
      }
      const output = new PassThrough();
      this.docker.modem.demuxStream(data, output, output);
      data.on('end', () => output.end());
      data.on('error', (err) => output.emit('error', err));
      return output;
    }

    // If it's a Buffer or string, wrap in a stream that emits once then stays open for follow
    const output = new PassThrough();
    if (Buffer.isBuffer(data)) {
      if (isTty) {
        output.write(data);
      } else {
        // Parse multiplexed docker log format
        let offset = 0;
        while (offset + 8 <= data.length) {
          const size = data.readUInt32BE(offset + 4);
          const start = offset + 8;
          const end = start + size;
          if (end > data.length) break;
          output.write(data.slice(start, end));
          offset = end;
        }
        if (offset === 0) output.write(data);
      }
    } else if (data) {
      output.write(String(data));
    }
    // Don't end the stream — keep it open for follow mode
    // The socket handler will destroy it on disconnect
    return output;
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

  async buildImage(imageName, contextPath, onProgress, options = {}) {
    try {
      if (onProgress) {
        onProgress(`🔨 Construindo imagem ${imageName} a partir de ${contextPath}...`);
      }

      const { execFile } = require('child_process');
      return new Promise((resolve, reject) => {
        const args = ['build', '-t', imageName];
        if (options.dockerfileName) {
          args.push('-f', options.dockerfileName);
        }
        if (options.buildArgs && typeof options.buildArgs === 'object') {
          Object.entries(options.buildArgs).forEach(([key, value]) => {
            args.push('--build-arg', `${key}=${value}`);
          });
        }
        args.push('.');

        const child = execFile('docker', args, {
          cwd: contextPath,
          env: { ...process.env, DOCKER_BUILDKIT: '1' },
          maxBuffer: 50 * 1024 * 1024,
          timeout: 600000
        }, (err, stdout, stderr) => {
          if (err) {
            const errorOutput = stderr || stdout || err.message;
            if (onProgress) {
              onProgress(`❌ Build falhou: ${errorOutput.trim().split('\n').pop()}`);
            }
            return reject(new Error(errorOutput.trim().split('\n').pop() || err.message));
          }
          if (onProgress) {
            onProgress(`✅ Imagem ${imageName} construída com sucesso`);
          }
          return resolve(stdout);
        });

        if (child.stdout && onProgress) {
          child.stdout.on('data', (data) => {
            String(data).split('\n').forEach((line) => {
              const trimmed = line.trim();
              if (trimmed) onProgress(trimmed);
            });
          });
        }
        if (child.stderr && onProgress) {
          child.stderr.on('data', (data) => {
            String(data).split('\n').forEach((line) => {
              const trimmed = line.trim();
              if (trimmed) onProgress(trimmed);
            });
          });
        }
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
