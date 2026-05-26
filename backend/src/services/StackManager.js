'use strict';

/**
 * StackManager — gerencia stacks de infraestrutura (grupos de serviços Docker).
 *
 * Uma Stack é equivalente a um ambiente de cliente: agrupa serviços Docker
 * com rede compartilhada, dependências declaradas e ciclo de vida unificado
 * (start/stop todos os serviços de uma vez).
 *
 * Estrutura de dados (stacks.json):
 * [
 *   {
 *     id: string (UUID),
 *     name: string,
 *     description: string,
 *     client: string,           // nome do cliente
 *     environment: string,      // production | staging | development | custom
 *     network: string,          // nome da rede Docker (auto-gerado)
 *     status: string,           // running | partial | stopped | draft
 *     blueprintId: string|null, // blueprint de origem (se criado de template)
 *     createdAt: ISO string,
 *     updatedAt: ISO string,
 *     services: [
 *       {
 *         id: string (UUID),
 *         name: string,
 *         role: string,         // entry-point | runtime | database | cache | queue | monitor | storage
 *         image: string,
 *         tag: string,
 *         ports: [{ host: number, container: number }],
 *         volumes: [{ host: string, container: string }],
 *         env: [{ key: string, value: string, secret: boolean }],
 *         command: string[],
 *         dependencies: string[],   // IDs de outros serviços nesta stack
 *         containerId: string|null, // ID do container Docker após deploy
 *         status: string,           // running | stopped | error | pending
 *         position: { x: number, y: number }, // posição no canvas
 *         createdAt: ISO string,
 *         updatedAt: ISO string
 *       }
 *     ]
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Docker = require('dockerode');

const STACKS_PATH = path.join(__dirname, '../../data/stacks.json');

// Garante que o diretório e arquivo existem
fs.mkdirSync(path.dirname(STACKS_PATH), { recursive: true });
if (!fs.existsSync(STACKS_PATH)) {
  fs.writeFileSync(STACKS_PATH, '[]');
}

const generateId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
};

const normalizeResources = (resources = {}) => {
  const cpuLimit = Number(resources.cpuLimit || 0);
  const memoryMb = Number(resources.memoryMb || 0);
  const cpuReserved = Number(resources.cpuReserved || 0);
  const memoryReservedMb = Number(resources.memoryReservedMb || 0);
  return {
    cpuLimit: Number.isFinite(cpuLimit) ? Math.max(0, cpuLimit) : 0,
    memoryMb: Number.isFinite(memoryMb) ? Math.max(0, memoryMb) : 0,
    cpuReserved: Number.isFinite(cpuReserved) ? Math.max(0, cpuReserved) : 0,
    memoryReservedMb: Number.isFinite(memoryReservedMb) ? Math.max(0, memoryReservedMb) : 0
  };
};

const normalizeScaling = (scaling = {}) => {
  const replicas = Number(scaling.replicas || 1);
  const maxReplicas = Number(scaling.maxReplicas || Math.max(1, replicas || 1));
  const mode = scaling.mode === 'stateful' ? 'stateful' : 'stateless';
  return {
    replicas: Number.isFinite(replicas) ? Math.max(1, Math.trunc(replicas)) : 1,
    maxReplicas: Number.isFinite(maxReplicas) ? Math.max(1, Math.trunc(maxReplicas)) : 1,
    mode
  };
};

/**
 * Ordena serviços por dependência (topological sort).
 * Garante que serviços dependentes são iniciados depois dos seus prerequisites.
 */
const topologicalSort = (services) => {
  const sorted = [];
  const visited = new Set();

  const visit = (svc) => {
    if (visited.has(svc.id)) return;
    visited.add(svc.id);
    for (const depId of (svc.dependencies || [])) {
      const dep = services.find((s) => s.id === depId);
      if (dep) visit(dep);
    }
    sorted.push(svc);
  };

  for (const svc of services) {
    visit(svc);
  }

  return sorted;
};

/**
 * Calcula posição automática no canvas com base no papel do serviço.
 * Layout por camadas: entry-point (topo) → runtime (meio) → dados (base)
 */
const autoPosition = (services) => {
  const roleOrder = ['entry-point', 'webapp', 'runtime', 'database', 'cache', 'queue', 'storage', 'monitor'];
  const CARD_W = 180;
  const CARD_H = 80;
  const GAP_X = 48;
  const GAP_Y = 100;
  const CANVAS_W = 860;
  const TOP_OFFSET = 60;

  // Agrupa por papel
  const groups = {};
  for (const svc of services) {
    const role = svc.role || 'runtime';
    if (!groups[role]) groups[role] = [];
    groups[role].push(svc);
  }

  const rows = roleOrder.filter((r) => groups[r]?.length > 0);

  const positioned = [];
  rows.forEach((role, rowIdx) => {
    const svcs = groups[role];
    const rowWidth = svcs.length * CARD_W + (svcs.length - 1) * GAP_X;
    const startX = Math.max(0, (CANVAS_W - rowWidth) / 2);
    const y = TOP_OFFSET + rowIdx * (CARD_H + GAP_Y);

    svcs.forEach((svc, colIdx) => {
      positioned.push({
        ...svc,
        position: { x: startX + colIdx * (CARD_W + GAP_X), y }
      });
    });
  });

  return positioned;
};

class StackManager {
  constructor() {
    this.docker = new Docker();
  }

  // ─── Persistência ──────────────────────────────────────────────────────────

  readStacks() {
    try {
      const raw = fs.readFileSync(STACKS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  writeStacks(stacks) {
    fs.writeFileSync(STACKS_PATH, JSON.stringify(stacks, null, 2));
  }

  // ─── CRUD de Stacks ────────────────────────────────────────────────────────

  listStacks() {
    return this.readStacks();
  }

  getStack(id) {
    const stacks = this.readStacks();
    const stack = stacks.find((s) => s.id === id);
    if (!stack) throw new Error(`Stack ${id} não encontrada`);
    return stack;
  }

  createStack({ name, description = '', client = '', environment = 'production', blueprintId = null, services = [] }) {
    if (!name) throw new Error('Nome da stack é obrigatório');

    const id = generateId();
    const network = `provir-${id.slice(0, 8)}`;
    const now = new Date().toISOString();

    // Posiciona serviços iniciais automaticamente (se vier de blueprint)
    const positionedServices = services.map((svc) => ({
      id: svc.id || generateId(),
      name: svc.name,
      role: svc.role || 'runtime',
      image: svc.image,
      tag: svc.tag || 'latest',
      ports: svc.ports || [],
      volumes: svc.volumes || [],
      env: svc.env || [],
      command: svc.command || [],
      dependencies: svc.dependencies || [],
      containerId: null,
      containerIds: [],
      status: 'pending',
      resources: normalizeResources(svc.resources),
      scaling: normalizeScaling(svc.scaling),
      position: svc.position || { x: 0, y: 0 },
      createdAt: now,
      updatedAt: now
    }));

    const stack = {
      id,
      name,
      description,
      client,
      environment,
      network,
      status: 'draft',
      blueprintId,
      createdAt: now,
      updatedAt: now,
      services: autoPosition(positionedServices)
    };

    const stacks = this.readStacks();
    stacks.push(stack);
    this.writeStacks(stacks);
    return stack;
  }

  updateStack(id, updates) {
    const stacks = this.readStacks();
    const idx = stacks.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Stack ${id} não encontrada`);

    // Campos que não podem ser atualizados via update genérico
    const { id: _id, createdAt: _ca, services: _svcs, status: _st, ...allowed } = updates;

    stacks[idx] = {
      ...stacks[idx],
      ...allowed,
      updatedAt: new Date().toISOString()
    };

    this.writeStacks(stacks);
    return stacks[idx];
  }

  deleteStack(id) {
    const stacks = this.readStacks();
    const idx = stacks.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Stack ${id} não encontrada`);
    stacks.splice(idx, 1);
    this.writeStacks(stacks);
    return true;
  }

  async deleteStackFull(id) {
    const stack = this.getStack(id);

    // Stop and remove all containers
    for (const svc of stack.services) {
      const ids = Array.isArray(svc.containerIds) && svc.containerIds.length
        ? svc.containerIds
        : (svc.containerId ? [svc.containerId] : []);
      for (const containerId of ids) {
        try {
          const container = this.docker.getContainer(containerId);
          await container.stop().catch(() => {});
          await container.remove({ force: true });
        } catch { /* container may not exist */ }
      }
      // Also find by name pattern if no IDs
      if (!ids.length) {
        try {
          const containers = await this.docker.listContainers({ all: true });
          const namePattern = `provir-${id.slice(0, 8)}-${svc.name}`;
          const matches = containers.filter((c) => (c.Names || []).some((n) => n.includes(namePattern)));
          for (const m of matches) {
            try {
              const c = this.docker.getContainer(m.Id);
              await c.stop().catch(() => {});
              await c.remove({ force: true });
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }

    // Remove from stacks.json
    const stacks = this.readStacks();
    const idx = stacks.findIndex((s) => s.id === id);
    if (idx >= 0) {
      stacks.splice(idx, 1);
      this.writeStacks(stacks);
    }

    // Try to remove the network
    try {
      const network = this.docker.getNetwork(stack.network);
      await network.remove();
    } catch { /* network may not exist or be in use */ }

    return true;
  }


  // ─── CRUD de Serviços ──────────────────────────────────────────────────────

  addService(stackId, serviceData) {
    const stacks = this.readStacks();
    const idx = stacks.findIndex((s) => s.id === stackId);
    if (idx < 0) throw new Error(`Stack ${stackId} não encontrada`);

    const now = new Date().toISOString();
    const svc = {
      id: generateId(),
      name: serviceData.name,
      role: serviceData.role || 'runtime',
      image: serviceData.image,
      tag: serviceData.tag || 'latest',
      ports: serviceData.ports || [],
      volumes: serviceData.volumes || [],
      env: serviceData.env || [],
      command: serviceData.command || [],
      dependencies: serviceData.dependencies || [],
      containerId: null,
      containerIds: [],
      status: 'pending',
      resources: normalizeResources(serviceData.resources),
      scaling: normalizeScaling(serviceData.scaling),
      position: serviceData.position || { x: 0, y: 0 },
      createdAt: now,
      updatedAt: now
    };

    stacks[idx].services.push(svc);
    // Re-calcular posições automáticas
    stacks[idx].services = autoPosition(stacks[idx].services);
    stacks[idx].updatedAt = now;
    this.writeStacks(stacks);

    return stacks[idx].services.find((s) => s.id === svc.id);
  }

  updateService(stackId, serviceId, updates) {
    const stacks = this.readStacks();
    const stackIdx = stacks.findIndex((s) => s.id === stackId);
    if (stackIdx < 0) throw new Error(`Stack ${stackId} não encontrada`);

    const svcIdx = stacks[stackIdx].services.findIndex((s) => s.id === serviceId);
    if (svcIdx < 0) throw new Error(`Serviço ${serviceId} não encontrado`);

    const { id: _id, containerId: _cid, status: _st, createdAt: _ca, ...allowed } = updates;

    const nextResources = normalizeResources(updates.resources ?? stacks[stackIdx].services[svcIdx].resources);
    const nextScaling = normalizeScaling(updates.scaling ?? stacks[stackIdx].services[svcIdx].scaling);

    stacks[stackIdx].services[svcIdx] = {
      ...stacks[stackIdx].services[svcIdx],
      ...allowed,
      resources: nextResources,
      scaling: nextScaling,
      updatedAt: new Date().toISOString()
    };

    // Re-calcular posições se o papel mudou
    if (updates.role) {
      stacks[stackIdx].services = autoPosition(stacks[stackIdx].services);
    }

    stacks[stackIdx].updatedAt = new Date().toISOString();
    this.writeStacks(stacks);
    return stacks[stackIdx].services[svcIdx];
  }

  removeService(stackId, serviceId) {
    const stacks = this.readStacks();
    const stackIdx = stacks.findIndex((s) => s.id === stackId);
    if (stackIdx < 0) throw new Error(`Stack ${stackId} não encontrada`);

    stacks[stackIdx].services = stacks[stackIdx].services.filter((s) => s.id !== serviceId);
    // Remove referências de dependência
    for (const svc of stacks[stackIdx].services) {
      svc.dependencies = (svc.dependencies || []).filter((d) => d !== serviceId);
    }
    stacks[stackIdx].updatedAt = new Date().toISOString();
    this.writeStacks(stacks);
    return true;
  }

  saveServicePositions(stackId, positions) {
    // positions: [{ id, x, y }]
    const stacks = this.readStacks();
    const stackIdx = stacks.findIndex((s) => s.id === stackId);
    if (stackIdx < 0) throw new Error(`Stack ${stackId} não encontrada`);

    for (const pos of positions) {
      const svcIdx = stacks[stackIdx].services.findIndex((s) => s.id === pos.id);
      if (svcIdx >= 0) {
        stacks[stackIdx].services[svcIdx].position = { x: pos.x, y: pos.y };
      }
    }
    stacks[stackIdx].updatedAt = new Date().toISOString();
    this.writeStacks(stacks);
    return true;
  }

  // ─── Docker: Ciclo de Vida ─────────────────────────────────────────────────

  async _ensureNetwork(networkName) {
    const networks = await this.docker.listNetworks();
    const existing = networks.find((n) => n.Name === networkName);
    if (existing) return existing;
    return this.docker.createNetwork({ Name: networkName, Driver: 'bridge' });
  }

  async _imageExists(imageFull) {
    try {
      await this.docker.getImage(imageFull).inspect();
      return true;
    } catch {
      return false;
    }
  }

  async _pullImage(imageFull, onProgress) {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageFull, (err, stream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (fErr, output) => {
          if (fErr) return reject(fErr);
          if (onProgress) onProgress(`✅ Imagem ${imageFull} pronta`);
          resolve(output);
        }, (event) => {
          if (onProgress && event.status) {
            onProgress(`${event.id ? event.id + ': ' : ''}${event.status} ${event.progress || ''}`.trim());
          }
        });
      });
    });
  }

  async startService(stackId, serviceId, onProgress) {
    const stack = this.getStack(stackId);
    const svc = stack.services.find((s) => s.id === serviceId);
    if (!svc) throw new Error(`Serviço ${serviceId} não encontrado`);

    const containerName = `provir-${stackId.slice(0, 8)}-${svc.name}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
    if (onProgress) onProgress(`🔧 Iniciando ${svc.name}...`);

    await this._ensureNetwork(stack.network);

    // ── Reuse existing container if possible ─────────────────────────────────
    const savedId = svc.containerId || (svc.containerIds && svc.containerIds[0]);
    for (const cid of [containerName, savedId].filter(Boolean)) {
      try {
        const existing = this.docker.getContainer(cid);
        const info = await existing.inspect();
        if (info.State.Running) {
          if (onProgress) onProgress(`✅ ${svc.name} já está rodando`);
          this._updateServiceStatus(stackId, serviceId, [info.Id], 'running');
          return info.Id;
        }
        if (onProgress) onProgress(`▶️  Iniciando container existente ${svc.name}...`);
        await existing.start();
        if (onProgress) onProgress(`✅ ${svc.name} iniciado`);
        this._updateServiceStatus(stackId, serviceId, [info.Id], 'running');
        return info.Id;
      } catch { /* not found */ }
    }

    // ── Create new container (same logic as DockerPanel) ─────────────────────
    const imageFull = `${svc.image}:${svc.tag || 'latest'}`;
    if (onProgress) onProgress(`📦 Verificando imagem ${imageFull}...`);

    // Resolve volume paths — create real directories like DockerPanel does
    const dockerBaseDir = process.env.DOCKER_VOLUME_BASE ||
      path.join(process.cwd(), 'backend/data/projects/docker');
    const serviceDir = path.join(dockerBaseDir, containerName);
    fs.mkdirSync(serviceDir, { recursive: true });

    const binds = (svc.volumes || []).map((v) => {
      let hostPath = v.host || '';
      // Named volume (no slash) — Docker manages it
      if (hostPath && !hostPath.includes('/') && !hostPath.startsWith('.')) {
        return `${hostPath}:${v.container}`;
      }
      // Relative path — resolve to service directory
      if (!hostPath || hostPath.startsWith('./') || hostPath.startsWith('../')) {
        hostPath = path.join(serviceDir, (hostPath || '').replace(/^\.\/?/, '') || 'data');
      }
      fs.mkdirSync(hostPath, { recursive: true });
      return `${hostPath}:${v.container}`;
    });

    // Port bindings
    const bindHost = svc.bindLocalOnly !== false ? '127.0.0.1' : '0.0.0.0';
    const portBindings = {};
    const exposedPorts = {};
    for (const p of (svc.ports || [])) {
      const key = `${p.container}/tcp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostIp: bindHost, HostPort: String(p.host) }];
    }

    // Env vars
    const env = (svc.env || []).map((e) => `${e.key}=${e.value}`);

    // Container config — identical structure to DockerPanel
    const containerConfig = {
      name: containerName,
      Image: imageFull,
      Cmd: svc.command?.length ? svc.command : undefined,
      Env: env,
      ExposedPorts: exposedPorts,
      Labels: {
        'provirpanel.managed': 'true',
        'provirpanel.stack.id': stackId,
        'provirpanel.stack.name': stack.name,
        'provirpanel.service.id': serviceId,
        'provirpanel.service.name': svc.name,
        'provirpanel.service.role': svc.role || 'runtime'
      },
      HostConfig: {
        PortBindings: portBindings,
        Binds: binds,
        NetworkMode: stack.network,
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 }
      }
    };

    // Use DockerManager.runContainer — same as DockerPanel
    const DockerManager = require('./DockerManager');
    const dockerManager = new DockerManager();
    const container = await dockerManager.runContainer(imageFull, containerConfig, onProgress);

    const containerId = container.Id || container.id;
    if (onProgress) onProgress(`✅ ${svc.name} rodando (${containerId.slice(0, 12)})`);
    this._updateServiceStatus(stackId, serviceId, [containerId], 'running');
    return containerId;
  }

  async stopService(stackId, serviceId, onProgress) {
    const stack = this.getStack(stackId);
    const svc = stack.services.find((s) => s.id === serviceId);
    if (!svc) throw new Error(`Serviço ${serviceId} não encontrado`);

    const ids = Array.isArray(svc.containerIds) && svc.containerIds.length
      ? svc.containerIds
      : (svc.containerId ? [svc.containerId] : []);

    for (const id of ids) {
      try {
        if (onProgress) onProgress(`⏹  Parando ${svc.name}...`);
        await this.docker.getContainer(id).stop();
      } catch (err) {
        if (!err.message?.includes('not running') && !err.message?.includes('No such container')) {
          throw err;
        }
      }
    }
    if (ids.length && onProgress) onProgress(`✅ ${svc.name} parado`);

    this._updateServiceStatus(stackId, serviceId, ids, 'stopped');
    return true;
  }

  async restartService(stackId, serviceId, onProgress) {
    const stack = this.getStack(stackId);
    const svc = stack.services.find((s) => s.id === serviceId);
    const ids = Array.isArray(svc?.containerIds) && svc.containerIds.length
      ? svc.containerIds
      : (svc?.containerId ? [svc.containerId] : []);
    if (!svc || !ids.length) throw new Error(`Serviço ${serviceId} não tem container associado`);

    if (onProgress) onProgress(`🔄 Reiniciando ${svc.name}...`);
    for (const id of ids) {
      await this.docker.getContainer(id).restart();
    }
    if (onProgress) onProgress(`✅ ${svc.name} reiniciado`);
    this._updateServiceStatus(stackId, serviceId, ids, 'running');
    return true;
  }

  async startStack(stackId, onProgress) {
    const stack = this.getStack(stackId);
    const ordered = topologicalSort(stack.services);

    // ── Validação pré-deploy ──────────────────────────────────────────────────
    if (onProgress) onProgress('🔍 Validando configuração da stack...');
    const validation = this.validateStack(stack);
    if (validation.errors.length > 0) {
      for (const err of validation.errors) {
        if (onProgress) onProgress(`❌ ${err}`);
      }
      throw new Error(`Validação falhou: ${validation.errors[0]}`);
    }
    if (validation.warnings.length > 0) {
      for (const warn of validation.warnings) {
        if (onProgress) onProgress(`⚠️  ${warn}`);
      }
    }

    if (onProgress) onProgress(`🚀 Iniciando stack "${stack.name}" (${ordered.length} serviços)...`);

    // ── Deploy com rollback ───────────────────────────────────────────────────
    const results = [];
    const startedIds = []; // track successfully started services for rollback

    for (const svc of ordered) {
      try {
        const containerId = await this.startService(stackId, svc.id, onProgress);
        results.push({ serviceId: svc.id, name: svc.name, status: 'running', containerId });
        startedIds.push(svc.id);
      } catch (err) {
        if (onProgress) onProgress(`❌ Falha ao iniciar ${svc.name}: ${err.message}`);
        results.push({ serviceId: svc.id, name: svc.name, status: 'error', error: err.message });

        // ── Rollback: parar todos que já subiram ──────────────────────────────
        if (startedIds.length > 0) {
          if (onProgress) onProgress(`🔄 Rollback: parando ${startedIds.length} serviço(s) já iniciado(s)...`);
          for (const startedSvcId of startedIds.reverse()) {
            try {
              await this.stopService(stackId, startedSvcId);
              const startedSvc = stack.services.find((s) => s.id === startedSvcId);
              if (onProgress) onProgress(`⏹  ${startedSvc?.name || startedSvcId} parado (rollback)`);
            } catch (rollbackErr) {
              if (onProgress) onProgress(`⚠️  Falha no rollback de ${startedSvcId}: ${rollbackErr.message}`);
            }
          }
        }
        break; // stop deploying remaining services
      }
    }

    this._updateStackStatus(stackId);
    return results;
  }

  async stopStack(stackId, onProgress) {
    const stack = this.getStack(stackId);
    // Para na ordem inversa
    const ordered = topologicalSort(stack.services).reverse();

    if (onProgress) onProgress(`⏹  Parando stack "${stack.name}"...`);

    const results = [];
    for (const svc of ordered) {
      try {
        await this.stopService(stackId, svc.id, onProgress);
        results.push({ serviceId: svc.id, name: svc.name, status: 'stopped' });
      } catch (err) {
        if (onProgress) onProgress(`⚠️  Falha ao parar ${svc.name}: ${err.message}`);
        results.push({ serviceId: svc.id, name: svc.name, status: 'error', error: err.message });
      }
    }

    this._updateStackStatus(stackId);
    return results;
  }

  // ─── Clone de Ambiente ─────────────────────────────────────────────────────

  cloneStack(sourceId, { name, environment, client }) {
    const source = this.getStack(sourceId);
    const now = new Date().toISOString();

    const newId = generateId();
    const services = source.services.map((svc) => ({
      ...svc,
      id: generateId(),
      containerId: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }));

    // Re-mapear dependências para novos IDs
    const idMap = {};
    source.services.forEach((svc, idx) => {
      idMap[svc.id] = services[idx].id;
    });
    for (const svc of services) {
      svc.dependencies = (svc.dependencies || []).map((d) => idMap[d] || d);
    }

    const clone = {
      id: newId,
      name: name || `${source.name} (clone)`,
      description: source.description,
      client: client || source.client,
      environment: environment || 'staging',
      network: `provir-${newId.slice(0, 8)}`,
      status: 'draft',
      blueprintId: source.blueprintId,
      createdAt: now,
      updatedAt: now,
      services
    };

    const stacks = this.readStacks();
    stacks.push(clone);
    this.writeStacks(stacks);
    return clone;
  }

  // ─── Sincronização de Status com Docker ───────────────────────────────────

  async syncStackStatus(stackId) {
    const stack = this.getStack(stackId);
    const stacks = this.readStacks();
    const stackIdx = stacks.findIndex((s) => s.id === stackId);

    for (let i = 0; i < stacks[stackIdx].services.length; i++) {
      const svc = stacks[stackIdx].services[i];
      const ids = Array.isArray(svc.containerIds) && svc.containerIds.length
        ? svc.containerIds
        : (svc.containerId ? [svc.containerId] : []);
      if (!ids.length) continue;

      let runningCount = 0;
      const aliveIds = [];
      for (const id of ids) {
        try {
          const info = await this.docker.getContainer(id).inspect();
          aliveIds.push(id);
          if (info.State.Running) {
            runningCount += 1;
          } else {
            // Container stopped — record why
            stacks[stackIdx].services[i].lastExitCode = info.State.ExitCode;
            stacks[stackIdx].services[i].lastError = info.State.Error || null;
          }
          stacks[stackIdx].services[i].restartCount = info.RestartCount || 0;
          stacks[stackIdx].services[i].health = info.State.Health?.Status || null;
        } catch {
          // container removed externally
        }
      }


      stacks[stackIdx].services[i].containerIds = aliveIds;
      stacks[stackIdx].services[i].containerId = aliveIds[0] || null;
      stacks[stackIdx].services[i].status = runningCount > 0 ? "running" : "stopped";
    }
    // Atualiza status geral da stack
    const statuses = stacks[stackIdx].services.map((s) => s.status);
    if (statuses.every((s) => s === 'running')) stacks[stackIdx].status = 'running';
    else if (statuses.every((s) => s === 'stopped' || s === 'pending')) stacks[stackIdx].status = 'stopped';
    else stacks[stackIdx].status = 'partial';

    stacks[stackIdx].updatedAt = new Date().toISOString();
    this.writeStacks(stacks);
    return stacks[stackIdx];
  }


  // ─── Validação pré-deploy ─────────────────────────────────────────────────

  validateStack(stack) {
    const errors = [];
    const warnings = [];

    if (!stack.services || !stack.services.length) {
      errors.push("Stack não tem serviços configurados");
      return { errors, warnings };
    }

    const usedNames = new Set();
    const usedPorts = new Set();

    for (const svc of stack.services) {
      if (!svc.name) {
        errors.push(`Serviço sem nome (id: ${svc.id})`);
      } else if (usedNames.has(svc.name)) {
        errors.push(`Nome duplicado: "${svc.name}"`);
      } else {
        usedNames.add(svc.name);
      }

      if (!svc.image) {
        errors.push(`Serviço "${svc.name || svc.id}" sem imagem Docker definida`);
      }

      for (const p of (svc.ports || [])) {
        if (p.host) {
          if (usedPorts.has(Number(p.host))) {
            errors.push(`Porta ${p.host} usada por múltiplos serviços (conflito em "${svc.name}")`);
          }
          usedPorts.add(Number(p.host));
        }
      }

      if (svc.role === "database" && !(svc.volumes && svc.volumes.length)) {
        warnings.push(`Banco "${svc.name}" sem volume — dados serão perdidos ao reiniciar`);
      }
      if (svc.role === "entry-point" && !(svc.ports && svc.ports.length)) {
        warnings.push(`Entry-point "${svc.name}" sem portas expostas`);
      }

      for (const depId of (svc.dependencies || [])) {
        if (!stack.services.some((s) => s.id === depId)) {
          warnings.push(`Serviço "${svc.name}" depende de "${depId}" que não existe na stack`);
        }
      }
    }

    return { errors, warnings };
  }

  // ─── Helpers Internos ──────────────────────────────────────────────────────

  _updateServiceStatus(stackId, serviceId, containerIds, status) {
    const stacks = this.readStacks();
    const stackIdx = stacks.findIndex((s) => s.id === stackId);
    if (stackIdx < 0) return;

    const svcIdx = stacks[stackIdx].services.findIndex((s) => s.id === serviceId);
    if (svcIdx < 0) return;

    const normalizedIds = Array.isArray(containerIds)
      ? containerIds.filter(Boolean)
      : (containerIds ? [containerIds] : []);
    stacks[stackIdx].services[svcIdx].containerIds = normalizedIds;
    stacks[stackIdx].services[svcIdx].containerId = normalizedIds[0] || null;
    stacks[stackIdx].services[svcIdx].status = status;
    stacks[stackIdx].services[svcIdx].updatedAt = new Date().toISOString();

    this._updateStackStatus(stackId, stacks);
    this.writeStacks(stacks);
  }

  _updateStackStatus(stackId, stacks = null) {
    const data = stacks || this.readStacks();
    const idx = data.findIndex((s) => s.id === stackId);
    if (idx < 0) return;

    const statuses = data[idx].services.map((s) => s.status);
    if (!statuses.length) {
      data[idx].status = 'draft';
    } else if (statuses.every((s) => s === 'running')) {
      data[idx].status = 'running';
    } else if (statuses.every((s) => s === 'stopped' || s === 'pending')) {
      data[idx].status = 'stopped';
    } else {
      data[idx].status = 'partial';
    }
    data[idx].updatedAt = new Date().toISOString();

    if (!stacks) this.writeStacks(data);
  }
}

module.exports = StackManager;
