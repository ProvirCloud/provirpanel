'use strict';

/**
 * Rotas: /api/stacks
 *
 * Gerencia Stacks (ambientes de infraestrutura agrupados).
 *
 * GET    /api/stacks                          — listar stacks
 * POST   /api/stacks                          — criar stack
 * GET    /api/stacks/blueprints               — listar blueprints disponíveis
 * GET    /api/stacks/training/actions         — últimas ações (para AI)
 * GET    /api/stacks/training/summary         — sumário de ações (para AI)
 * GET    /api/stacks/:id                      — detalhe da stack
 * PUT    /api/stacks/:id                      — atualizar metadados
 * DELETE /api/stacks/:id                      — deletar stack
 * POST   /api/stacks/:id/clone                — clonar stack
 * POST   /api/stacks/:id/sync                 — sincronizar status com Docker
 * POST   /api/stacks/:id/start                — iniciar todos os serviços (SSE)
 * POST   /api/stacks/:id/stop                 — parar todos os serviços (SSE)
 * GET    /api/stacks/:id/compose              — exportar docker-compose.yml
 * GET    /api/stacks/:id/compose/env          — exportar .env de exemplo
 * GET    /api/stacks/:id/compose/validate     — validar antes de gerar
 * POST   /api/stacks/:id/services             — adicionar serviço
 * PUT    /api/stacks/:id/services/:svcId      — atualizar serviço
 * DELETE /api/stacks/:id/services/:svcId      — remover serviço
 * POST   /api/stacks/:id/services/:svcId/start    — iniciar serviço (SSE)
 * POST   /api/stacks/:id/services/:svcId/stop     — parar serviço
 * POST   /api/stacks/:id/services/:svcId/restart  — reiniciar serviço
 * POST   /api/stacks/:id/positions            — salvar posições do canvas
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const StackManager = require('../services/StackManager');
const ComposeGenerator = require('../services/ComposeGenerator');
const { logAction, getSummary, getRecentActions } = require('../middleware/infraLogger');

const stackManager = new StackManager();
const composeGenerator = new ComposeGenerator();
const ComposeParser = require('../services/ComposeParser');
const composeParser = new ComposeParser();
const NginxStackIntegration = require('../services/NginxStackIntegration');
const nginxIntegration = new NginxStackIntegration();

const BLUEPRINTS_PATH = path.join(__dirname, '../../data/blueprints.json');
const BLUEPRINTS_SEED_PATH = path.join(__dirname, '../data/blueprints-seed.json');

const readBlueprints = () => {
  try {
    if (!fs.existsSync(BLUEPRINTS_PATH)) {
      // Seed from bundled file if data dir is empty (fresh deploy)
      if (fs.existsSync(BLUEPRINTS_SEED_PATH)) {
        fs.mkdirSync(path.dirname(BLUEPRINTS_PATH), { recursive: true });
        fs.copyFileSync(BLUEPRINTS_SEED_PATH, BLUEPRINTS_PATH);
      } else {
        return [];
      }
    }
    return JSON.parse(fs.readFileSync(BLUEPRINTS_PATH, 'utf8'));
  } catch {
    return [];
  }
};

// Extrai username do JWT payload (injetado pelo middleware auth)
const getUser = (req) => req.user?.username || req.user?.sub || 'unknown';

// ─── Importação de Serviços Existentes (docker-services.json) ─────────────────

const DOCKER_SERVICES_PATHS = [
  path.join(__dirname, '../../data/docker-services.json'),
  path.join(process.cwd(), 'backend/data/docker-services.json'),
  path.join(process.cwd(), 'data/docker-services.json')
];

const readDockerServices = () => {
  for (const p of DOCKER_SERVICES_PATHS) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
    }
  }
  return [];
};

/**
 * Detecta o papel do serviço com base no templateId e imagem.
 * Segue as mesmas regras documentadas em INFRA-AI-TRAINING.md.
 */
const guessRole = (svc) => {
  const id = (svc.templateId || '').toLowerCase();
  const img = (svc.image || '').toLowerCase();
  if (id.includes('nginx') || id.includes('traefik') || img.includes('nginx') || img.includes('traefik')) return 'entry-point';
  if (id.includes('postgres') || id.includes('mysql') || id.includes('mongo') || id.includes('mariadb') ||
      img.includes('postgres') || img.includes('mysql') || img.includes('mongo')) return 'database';
  if (id.includes('redis') || id.includes('memcache') || img.includes('redis') || img.includes('memcache')) return 'cache';
  if (id.includes('rabbit') || id.includes('kafka') || img.includes('rabbit') || img.includes('kafka')) return 'queue';
  if (id.includes('pgadmin') || id.includes('adminer') || id.includes('grafana') || id.includes('prometheus') ||
      img.includes('pgadmin') || img.includes('grafana') || img.includes('prometheus')) return 'monitor';
  if (id.includes('minio') || img.includes('minio')) return 'storage';
  return 'runtime'; // default
};

/**
 * Converte o formato antigo (docker-services.json) para o formato de Stack.
 */
const legacyToStackService = (svc) => ({
  id: svc.id,
  name: svc.name,
  role: guessRole(svc),
  image: (svc.image || '').split(':')[0],
  tag: (svc.image || '').includes(':') ? svc.image.split(':')[1] : 'latest',
  ports: svc.hostPort && svc.containerPort ? [{ host: svc.hostPort, container: svc.containerPort }] : [],
  volumes: (svc.volumes || []).map((v) => ({ host: v.hostPath || v.host || '', container: v.containerPath || v.container || '' })),
  env: (svc.env || []).map((e) => ({ key: e.key, value: e.value || '', secret: e.secret || false })),
  command: svc.command || [],
  dependencies: [],
  containerId: svc.containerId || null,
  status: svc.containerId ? 'running' : 'pending',
  position: { x: 0, y: 0 },
  createdAt: svc.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  _legacy: true // marcador de origem
});

/**
 * GET /api/stacks/unassigned-services
 * Lista serviços do DockerPanel que ainda não pertencem a nenhuma stack.
 * Usado pelo modal de importação.
 */
router.get('/unassigned-services', (req, res) => {
  try {
    const legacy = readDockerServices();
    const stacks = stackManager.listStacks();

    // Coleta todos os IDs de serviços já em stacks
    const assignedIds = new Set(stacks.flatMap((s) => s.services.map((svc) => svc.id)));

    const unassigned = legacy
      .filter((svc) => !assignedIds.has(svc.id))
      .map((svc) => ({
        ...legacyToStackService(svc),
        _originalData: {
          templateId: svc.templateId,
          url: svc.url,
          externalUrl: svc.externalUrl,
          networkName: svc.networkName
        }
      }));

    res.json(unassigned);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stacks/:id/import-services
 * Importa serviços selecionados do DockerPanel para uma stack.
 * Body: { serviceIds: string[] }
 */
router.post('/:id/import-services', (req, res) => {
  try {
    const { serviceIds = [] } = req.body;
    if (!serviceIds.length) return res.status(400).json({ error: 'Nenhum serviço selecionado' });

    const legacy = readDockerServices();
    const stack = stackManager.getStack(req.params.id);
    const imported = [];

    for (const svcId of serviceIds) {
      const legacySvc = legacy.find((s) => s.id === svcId);
      if (!legacySvc) continue;

      const converted = legacyToStackService(legacySvc);
      const added = stackManager.addService(req.params.id, converted);
      imported.push(added);
    }

    logAction('service.import', {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client,
      input: { serviceIds, count: imported.length },
      output: { importedNames: imported.map((s) => s.name) }
    });

    const updatedStack = stackManager.getStack(req.params.id);
    res.json({ imported, stack: updatedStack });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Blueprints ────────────────────────────────────────────────────────────────

router.get('/blueprints', (req, res) => {
  res.json(readBlueprints());
});

// ─── Import Docker Compose ─────────────────────────────────────────────────────

router.post("/import-compose/preview", (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "content is required" });
    const parsed = composeParser.parse(content, {});
    res.json({ services: parsed.services, network: parsed.network || null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/import-compose", (req, res) => {
  try {
    const { content, name, client, environment, buildContextPath } = req.body;
    if (!content) {
      return res.status(400).json({ error: "content (docker-compose.yml) is required" });
    }
    const parsed = composeParser.parse(content, { name, client, environment });

    // Se informado, sobrescreve o context de todos os serviços com build:
    if (buildContextPath) {
      for (const svc of parsed.services) {
        if (svc.build) {
          svc.build.context = buildContextPath;
        }
      }
    }

    const stack = stackManager.createStack(parsed);

    logAction("stack.create", {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client,
      input: { source: "docker-compose-import", serviceCount: stack.services.length },
      output: { stackId: stack.id, network: stack.network }
    });

    res.status(201).json(stack);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ─── Training Data (AI) ────────────────────────────────────────────────────────

router.get('/training/summary', (req, res) => {
  res.json(getSummary());
});

router.get('/training/actions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  res.json(getRecentActions(limit));
});

// ─── CRUD de Stacks ────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const stacks = stackManager.listStacks();
    res.json(stacks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, description, client, environment, blueprintId, services } = req.body;

    // Se vier de um blueprint, carrega os serviços dele
    let initialServices = services || [];
    if (blueprintId && !services?.length) {
      const blueprints = readBlueprints();
      const blueprint = blueprints.find((b) => b.id === blueprintId);
      if (blueprint) {
        initialServices = blueprint.services || [];
      }
    }

    const stack = stackManager.createStack({
      name, description, client, environment, blueprintId, services: initialServices
    });

    logAction('stack.create', {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client,
      input: { name, description, client, environment, blueprintId, serviceCount: initialServices.length },
      output: { stackId: stack.id, network: stack.network }
    });

    res.status(201).json(stack);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    res.json(stack);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const stack = stackManager.updateStack(req.params.id, req.body);

    logAction('stack.update', {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client,
      input: req.body
    });

    res.json(stack);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    await stackManager.deleteStackFull(req.params.id);

    logAction('stack.delete', {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Clone de Stack ────────────────────────────────────────────────────────────

router.post('/:id/clone', (req, res) => {
  try {
    const { name, environment, client } = req.body;
    const source = stackManager.getStack(req.params.id);
    const clone = stackManager.cloneStack(req.params.id, { name, environment, client });

    logAction('stack.clone', {
      user: getUser(req),
      stackId: clone.id,
      stackName: clone.name,
      stackEnvironment: clone.environment,
      client: clone.client,
      input: { sourceStackId: source.id, sourceStackName: source.name, name, environment },
      output: { cloneId: clone.id }
    });

    res.status(201).json(clone);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Sincronização de Status ──────────────────────────────────────────────────


router.get("/:id/validate", (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const result = stackManager.validateStack(stack);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    const stack = await stackManager.syncStackStatus(req.params.id);
    res.json(stack);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start / Stop Stack (Server-Sent Events para progresso) ───────────────────

router.all('/:id/start', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (msg) => res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);

  const start = Date.now();
  let success = true;

  try {
    const stack = stackManager.getStack(req.params.id);

    logAction('stack.start', {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client,
      input: { serviceCount: stack.services.length }
    });

    const results = await stackManager.startStack(req.params.id, send);

    const failed = results.filter((r) => r.status === 'error');
    if (failed.length) success = false;


    // Auto-configure Nginx if services have access settings
    if (success) {
      try {
        const freshStack = stackManager.getStack(req.params.id);
        const nginxResult = nginxIntegration.applyForStack(freshStack);
        if (nginxResult.applied) {
          send(`🌐 Nginx configurado automaticamente (${nginxResult.results?.length || 0} rota(s))`);
        }
      } catch (nginxErr) {
        send(`⚠️  Nginx: ${nginxErr.message}`);
      }
    }

    send(`✅ Concluído — ${results.length - failed.length}/${results.length} serviços iniciados`);
    res.write(`data: ${JSON.stringify({ done: true, results })}\n\n`);
  } catch (err) {
    success = false;
    send(`❌ Erro: ${err.message}`);
    res.write(`data: ${JSON.stringify({ done: true, error: err.message })}\n\n`);
  }

  res.end();
});

router.all('/:id/stop', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (msg) => res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);

  try {
    const stack = stackManager.getStack(req.params.id);

    logAction('stack.stop', {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client
    });

    const results = await stackManager.stopStack(req.params.id, send);
    send('✅ Stack parada com sucesso');
    res.write(`data: ${JSON.stringify({ done: true, results })}\n\n`);
  } catch (err) {
    send(`❌ Erro: ${err.message}`);
    res.write(`data: ${JSON.stringify({ done: true, error: err.message })}\n\n`);
  }

  res.end();
});

// ─── Compose Export ────────────────────────────────────────────────────────────

router.get('/:id/compose/validate', (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const result = composeGenerator.validate(stack);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/:id/compose', (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const yaml = composeGenerator.generate(stack);

    logAction('compose.export', {
      user: getUser(req),
      stackId: stack.id,
      stackName: stack.name,
      stackEnvironment: stack.environment,
      client: stack.client,
      output: { format: 'docker-compose.yml' }
    });

    const download = req.query.download === 'true';
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="docker-compose-${stack.name.replace(/\s+/g, '-')}.yml"`);
      res.setHeader('Content-Type', 'application/x-yaml');
    } else {
      res.setHeader('Content-Type', 'text/plain');
    }
    res.send(yaml);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/:id/compose/env', (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const envFile = composeGenerator.generateEnvFile(stack);

    const download = req.query.download === 'true';
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename=".env.${stack.environment}"`);
    }
    res.setHeader('Content-Type', 'text/plain');
    res.send(envFile);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── Serviços da Stack ─────────────────────────────────────────────────────────

router.post('/:id/services', (req, res) => {
  try {
    const svc = stackManager.addService(req.params.id, req.body);

    logAction('service.add', {
      user: getUser(req),
      stackId: req.params.id,
      serviceId: svc.id,
      serviceName: svc.name,
      serviceRole: svc.role,
      input: { image: svc.image, tag: svc.tag, role: svc.role, ports: svc.ports, env: svc.env }
    });

    res.status(201).json(svc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/services/:svcId', (req, res) => {
  try {
    const svc = stackManager.updateService(req.params.id, req.params.svcId, req.body);

    logAction('service.update', {
      user: getUser(req),
      stackId: req.params.id,
      serviceId: svc.id,
      serviceName: svc.name,
      serviceRole: svc.role,
      input: req.body
    });

    res.json(svc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/services/:svcId', (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const svc = stack.services.find((s) => s.id === req.params.svcId);
    stackManager.removeService(req.params.id, req.params.svcId);

    logAction('service.remove', {
      user: getUser(req),
      stackId: req.params.id,
      serviceId: req.params.svcId,
      serviceName: svc?.name,
      serviceRole: svc?.role
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Start / Stop / Restart de Serviço Individual (SSE) ───────────────────────

router.all('/:id/services/:svcId/start', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (msg) => res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);

  try {
    const stack = stackManager.getStack(req.params.id);
    const svc = stack.services.find((s) => s.id === req.params.svcId);

    logAction('service.start', {
      user: getUser(req),
      stackId: req.params.id,
      stackName: stack.name,
      serviceId: req.params.svcId,
      serviceName: svc?.name,
      serviceRole: svc?.role
    });

    const containerId = await stackManager.startService(req.params.id, req.params.svcId, send);
    res.write(`data: ${JSON.stringify({ done: true, containerId })}\n\n`);
  } catch (err) {
    send(`❌ Erro: ${err.message}`);
    res.write(`data: ${JSON.stringify({ done: true, error: err.message })}\n\n`);
  }

  res.end();
});

router.post('/:id/services/:svcId/stop', async (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const svc = stack.services.find((s) => s.id === req.params.svcId);

    logAction('service.stop', {
      user: getUser(req),
      stackId: req.params.id,
      stackName: stack.name,
      serviceId: req.params.svcId,
      serviceName: svc?.name
    });

    await stackManager.stopService(req.params.id, req.params.svcId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/services/:svcId/restart', async (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const svc = stack.services.find((s) => s.id === req.params.svcId);

    logAction('service.restart', {
      user: getUser(req),
      stackId: req.params.id,
      stackName: stack.name,
      serviceId: req.params.svcId,
      serviceName: svc?.name
    });

    await stackManager.restartService(req.params.id, req.params.svcId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Logs de serviço da stack ─────────────────────────────────────────────────

router.get("/:id/services/:svcId/logs", async (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const svc = stack.services.find((s) => s.id === req.params.svcId);
    if (!svc) return res.status(404).json({ error: "Servico nao encontrado" });

    const containerId = svc.containerId || (svc.containerIds && svc.containerIds[0]);
    if (!containerId) return res.json({ logs: "Container nao iniciado" });

    const Docker = require("dockerode");
    const docker = new Docker();
    const container = docker.getContainer(containerId);
    const logData = await container.logs({ stdout: true, stderr: true, tail: 200, timestamps: true });

    let text = "";
    if (Buffer.isBuffer(logData)) {
      let offset = 0;
      while (offset + 8 <= logData.length) {
        const size = logData.readUInt32BE(offset + 4);
        const start = offset + 8;
        const end = start + size;
        if (end > logData.length) break;
        text += logData.slice(start, end).toString("utf8");
        offset = end;
      }
      if (!text) text = logData.toString("utf8");
    } else {
      text = String(logData || "");
    }

    res.json({ logs: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ─── Upload de arquivos para serviço (chunked) ───────────────────────────────

const multer = require("multer");
const os = require("os");
const crypto = require("crypto");
const stackUpload = multer({ dest: os.tmpdir() });

const STACK_CHUNK_ROOT = path.join(os.tmpdir(), 'provirpanel-stack-uploads');
fs.mkdirSync(STACK_CHUNK_ROOT, { recursive: true });

const sanitizeStackUploadId = (id) => {
  const v = String(id || '');
  if (!/^[a-f0-9-]{36}$/i.test(v)) throw new Error('uploadId inválido');
  return v;
};

const stackChunkDir = (uploadId) => path.join(STACK_CHUNK_ROOT, sanitizeStackUploadId(uploadId));

const writeStackChunkMeta = (uploadId, meta) => {
  const dir = stackChunkDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
};

const readStackChunkMeta = (uploadId) => {
  const dir = stackChunkDir(uploadId);
  const p = path.join(dir, 'meta.json');
  if (!fs.existsSync(p)) throw new Error('Upload não encontrado');
  return { dir, meta: JSON.parse(fs.readFileSync(p, 'utf8')) };
};

const assembleStackChunks = (uploadId) => {
  const { dir, meta } = readStackChunkMeta(uploadId);
  const out = path.join(dir, meta.filename);
  fs.writeFileSync(out, '');
  for (let i = 0; i < meta.totalChunks; i++) {
    const chunk = path.join(dir, `chunk-${i}`);
    if (!fs.existsSync(chunk)) throw new Error(`Chunk ${i + 1}/${meta.totalChunks} não recebido`);
    fs.appendFileSync(out, fs.readFileSync(chunk));
  }
  return { archivePath: out, filename: meta.filename };
};

const cleanStackChunks = (uploadId) => {
  try { fs.rmSync(stackChunkDir(uploadId), { recursive: true, force: true }); } catch { /* ignore */ }
};

const extractAndSaveUpload = async (archivePath, originalName, stackId, svcId) => {
  const stack = stackManager.getStack(stackId);
  const svc = stack.services.find((s) => s.id === svcId);
  if (!svc) throw new Error('Serviço não encontrado');

  const dockerBaseDir = process.env.DOCKER_VOLUME_BASE ||
    path.join(process.cwd(), 'backend/data/projects/docker');
  const containerName = `provir-${stackId.slice(0, 8)}-${svc.name}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
  const serviceDir = path.join(dockerBaseDir, containerName);
  fs.mkdirSync(serviceDir, { recursive: true });

  const volume = (svc.volumes || [])[0];
  let targetDir = serviceDir;
  if (volume?.host) {
    if (volume.host.startsWith('/')) targetDir = volume.host;
    else if (volume.host.startsWith('./') || volume.host.startsWith('../'))
      targetDir = path.join(serviceDir, volume.host.replace(/^\.\/?/, ''));
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const lower = originalName.toLowerCase();
  const { execSync } = require('child_process');
  if (lower.endsWith('.zip')) execSync(`unzip -o "${archivePath}" -d "${targetDir}"`, { stdio: 'pipe' });
  else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: 'pipe' });
  else if (lower.endsWith('.tar')) execSync(`tar -xf "${archivePath}" -C "${targetDir}"`, { stdio: 'pipe' });
  else fs.copyFileSync(archivePath, path.join(targetDir, originalName));

  // Flatten single root dir
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== '__MACOSX');
  const files = entries.filter((e) => e.isFile() && e.name !== '.DS_Store');
  if (dirs.length === 1 && files.length === 0) {
    const rootDir = path.join(targetDir, dirs[0].name);
    for (const entry of fs.readdirSync(rootDir))
      fs.renameSync(path.join(rootDir, entry), path.join(targetDir, entry));
    fs.rmdirSync(rootDir);
  }

  // Update volume in stacks.json
  const stacks = stackManager.readStacks();
  const si = stacks.findIndex((s) => s.id === stackId);
  if (si >= 0) {
    const vi = stacks[si].services.findIndex((s) => s.id === svcId);
    if (vi >= 0) {
      if (!stacks[si].services[vi].volumes?.length)
        stacks[si].services[vi].volumes = [{ host: targetDir, container: '/app' }];
      else
        stacks[si].services[vi].volumes[0].host = targetDir;
      stackManager.writeStacks(stacks);
    }
  }

  return { targetDir, file: originalName };
};

// Upload direto (arquivo único, sem chunks — mantido para compatibilidade)
router.post('/:id/services/:svcId/upload', stackUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });
    const result = await extractAndSaveUpload(
      req.file.path, req.file.originalname || 'archive',
      req.params.id, req.params.svcId
    );
    fs.unlink(req.file.path, () => {});
    res.json({ success: true, ...result });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// Chunked upload — init
router.post('/:id/services/:svcId/upload/init', (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const svc = stack.services.find((s) => s.id === req.params.svcId);
    if (!svc) return res.status(404).json({ error: 'Serviço não encontrado' });

    const totalChunks = Number(req.body?.totalChunks || 0);
    if (!Number.isInteger(totalChunks) || totalChunks < 1)
      return res.status(400).json({ error: 'totalChunks inválido' });

    const uploadId = crypto.randomUUID();
    const filename = String(req.body?.filename || 'archive.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
    writeStackChunkMeta(uploadId, {
      stackId: req.params.id,
      svcId: req.params.svcId,
      filename,
      size: Number(req.body?.size || 0),
      totalChunks,
    });
    res.json({ uploadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chunked upload — chunk
router.post('/:id/services/:svcId/upload/chunk', stackUpload.single('chunk'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chunk obrigatório' });
    const { dir, meta } = readStackChunkMeta(req.body?.uploadId);
    if (meta.stackId !== req.params.id || meta.svcId !== req.params.svcId)
      return res.status(400).json({ error: 'Upload inválido para este serviço' });
    const idx = Number(req.body?.chunkIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= meta.totalChunks)
      return res.status(400).json({ error: 'chunkIndex inválido' });
    fs.renameSync(req.file.path, path.join(dir, `chunk-${idx}`));
    res.json({ ok: true, chunkIndex: idx });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// Chunked upload — complete
router.post('/:id/services/:svcId/upload/complete', async (req, res) => {
  const uploadId = req.body?.uploadId;
  try {
    const { meta } = readStackChunkMeta(uploadId);
    if (meta.stackId !== req.params.id || meta.svcId !== req.params.svcId)
      return res.status(400).json({ error: 'Upload inválido para este serviço' });
    const { archivePath, filename } = assembleStackChunks(uploadId);
    const result = await extractAndSaveUpload(archivePath, filename, req.params.id, req.params.svcId);
    cleanStackChunks(uploadId);
    res.json({ success: true, ...result });
  } catch (err) {
    if (uploadId) cleanStackChunks(uploadId);
    res.status(500).json({ error: err.message });
  }
});

// ─── Build de serviço a partir de upload de código-fonte ────────────────────────
// POST /:id/services/:svcId/build  — upload do zip + docker build (SSE)
// POST /:id/services/:svcId/build/init
// POST /:id/services/:svcId/build/chunk
// POST /:id/services/:svcId/build/complete

const STACK_BUILD_ROOT = path.join(os.tmpdir(), 'provirpanel-stack-builds');
fs.mkdirSync(STACK_BUILD_ROOT, { recursive: true });

const stackBuildChunkDir = (uploadId) => path.join(STACK_BUILD_ROOT, sanitizeStackUploadId(uploadId));

const writeStackBuildMeta = (uploadId, meta) => {
  const dir = stackBuildChunkDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
};

const readStackBuildMeta = (uploadId) => {
  const dir = stackBuildChunkDir(uploadId);
  const p = path.join(dir, 'meta.json');
  if (!fs.existsSync(p)) throw new Error('Upload não encontrado');
  return { dir, meta: JSON.parse(fs.readFileSync(p, 'utf8')) };
};

const assembleStackBuildChunks = (uploadId) => {
  const { dir, meta } = readStackBuildMeta(uploadId);
  const out = path.join(dir, meta.filename);
  fs.writeFileSync(out, '');
  for (let i = 0; i < meta.totalChunks; i++) {
    const chunk = path.join(dir, `chunk-${i}`);
    if (!fs.existsSync(chunk)) throw new Error(`Chunk ${i + 1}/${meta.totalChunks} não recebido`);
    fs.appendFileSync(out, fs.readFileSync(chunk));
  }
  return { archivePath: out, filename: meta.filename, meta };
};

const cleanStackBuildChunks = (uploadId) => {
  try { fs.rmSync(stackBuildChunkDir(uploadId), { recursive: true, force: true }); } catch { /* ignore */ }
};

const runBuildFromArchive = async (archivePath, filename, stackId, svcId, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (msg) => res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);

  try {
    const stack = stackManager.getStack(stackId);
    const svc = stack.services.find((s) => s.id === svcId);
    if (!svc) throw new Error('Serviço não encontrado');
    if (!svc.build) throw new Error('Serviço não tem configuração de build');

    // Extrai o zip em diretório permanente do serviço
    const buildDir = path.join(STACK_BUILD_ROOT, `${stackId.slice(0, 8)}-${svcId.slice(0, 8)}`);
    fs.mkdirSync(buildDir, { recursive: true });

    send(`📦 Extraindo ${filename}...`);
    const lower = filename.toLowerCase();
    const { execSync } = require('child_process');
    if (lower.endsWith('.zip')) execSync(`unzip -o "${archivePath}" -d "${buildDir}"`, { stdio: 'pipe' });
    else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) execSync(`tar -xzf "${archivePath}" -C "${buildDir}"`, { stdio: 'pipe' });
    else if (lower.endsWith('.tar')) execSync(`tar -xf "${archivePath}" -C "${buildDir}"`, { stdio: 'pipe' });
    else throw new Error('Formato não suportado. Use .zip, .tar ou .tar.gz');

    // Flatten single root dir
    const entries = fs.readdirSync(buildDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && e.name !== '__MACOSX');
    const files = entries.filter(e => e.isFile() && e.name !== '.DS_Store');
    if (dirs.length === 1 && files.length === 0) {
      const rootDir = path.join(buildDir, dirs[0].name);
      for (const entry of fs.readdirSync(rootDir))
        fs.renameSync(path.join(rootDir, entry), path.join(buildDir, entry));
      fs.rmdirSync(rootDir);
    }

    // Atualiza o context do serviço no stacks.json
    const stacks = stackManager.readStacks();
    const si = stacks.findIndex(s => s.id === stackId);
    const vi = si >= 0 ? stacks[si].services.findIndex(s => s.id === svcId) : -1;
    if (si >= 0 && vi >= 0) {
      stacks[si].services[vi].build.context = buildDir;
      stackManager.writeStacks(stacks);
    }

    // Builda a imagem
    const imageFull = `${svc.image}:${svc.tag || 'latest'}`;
    const dockerfile = svc.build.dockerfile || 'Dockerfile';
    const buildArgs = svc.build.args || {};
    send(`🔨 Buildando ${imageFull}...`);

    const DockerManager = require('../services/DockerManager');
    const dm = new DockerManager();
    await dm.buildImage(imageFull, buildDir, send, { dockerfileName: dockerfile, buildArgs });

    send(`✅ Build concluído! Imagem ${imageFull} pronta.`);
    res.write(`data: ${JSON.stringify({ done: true, imageFull })}\n\n`);
  } catch (err) {
    send(`❌ Erro: ${err.message}`);
    res.write(`data: ${JSON.stringify({ done: true, error: err.message })}\n\n`);
  } finally {
    try { fs.unlinkSync(archivePath); } catch { /* ignore */ }
    res.end();
  }
};

// Build direto (arquivo único)
router.post('/:id/services/:svcId/build', stackUpload.single('archive'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });
  await runBuildFromArchive(req.file.path, req.file.originalname || 'archive.zip', req.params.id, req.params.svcId, res);
});

// Build chunked — init
router.post('/:id/services/:svcId/build/init', (req, res) => {
  try {
    const stack = stackManager.getStack(req.params.id);
    const svc = stack.services.find(s => s.id === req.params.svcId);
    if (!svc) return res.status(404).json({ error: 'Serviço não encontrado' });
    const totalChunks = Number(req.body?.totalChunks || 0);
    if (!Number.isInteger(totalChunks) || totalChunks < 1)
      return res.status(400).json({ error: 'totalChunks inválido' });
    const uploadId = crypto.randomUUID();
    const filename = String(req.body?.filename || 'archive.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
    writeStackBuildMeta(uploadId, { stackId: req.params.id, svcId: req.params.svcId, filename, size: Number(req.body?.size || 0), totalChunks });
    res.json({ uploadId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Build chunked — chunk
router.post('/:id/services/:svcId/build/chunk', stackUpload.single('chunk'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chunk obrigatório' });
    const { dir, meta } = readStackBuildMeta(req.body?.uploadId);
    if (meta.stackId !== req.params.id || meta.svcId !== req.params.svcId)
      return res.status(400).json({ error: 'Upload inválido' });
    const idx = Number(req.body?.chunkIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= meta.totalChunks)
      return res.status(400).json({ error: 'chunkIndex inválido' });
    fs.renameSync(req.file.path, path.join(dir, `chunk-${idx}`));
    res.json({ ok: true, chunkIndex: idx });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// Build chunked — complete (SSE)
router.post('/:id/services/:svcId/build/complete', async (req, res) => {
  const uploadId = req.body?.uploadId;
  try {
    const { archivePath, filename, meta } = assembleStackBuildChunks(uploadId);
    if (meta.stackId !== req.params.id || meta.svcId !== req.params.svcId)
      return res.status(400).json({ error: 'Upload inválido' });
    cleanStackBuildChunks(uploadId);
    await runBuildFromArchive(archivePath, filename, req.params.id, req.params.svcId, res);
  } catch (err) {
    if (uploadId) cleanStackBuildChunks(uploadId);
    res.status(500).json({ error: err.message });
  }
});────────────

router.post('/:id/positions', (req, res) => {
  try {
    stackManager.saveServicePositions(req.params.id, req.body.positions || []);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
