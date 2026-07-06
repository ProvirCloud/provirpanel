'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CICDManager = require('../services/CICDManager');
const DockerManager = require('../services/DockerManager');
const GitHubDeliveryManager = require('../services/GitHubDeliveryManager');

const router = express.Router();
const ciCdManager = new CICDManager();
const dockerManager = new DockerManager();
const githubDelivery = new GitHubDeliveryManager();

// Helper: ensure project code is indexed for AI operations (non-blocking)
const ensureProjectIndexed = (service) => {
  try {
    const { isIndexed, startBackgroundIndex } = require('../services/project-ai-chat');
    const deployments = Array.isArray(service.deployments) ? service.deployments : [];
    const active = deployments.find(d => d.status === 'active') || deployments.find(d => d.id === service.activeDeploymentId);
    const projectDir = active?.projectDir || (service.volumes || [])[0]?.hostPath || null;
    if (projectDir && fs.existsSync(projectDir) && !isIndexed(service.id, projectDir)) {
      startBackgroundIndex(service.id, projectDir);
    }
  } catch { /* non-critical */ }
};

let dockerBaseDir =
  process.env.DOCKER_PROJECTS_DIR ||
  process.env.DOCKER_BASE_DIR ||
  '/data/projects/docker';
try {
  fs.mkdirSync(dockerBaseDir, { recursive: true });
} catch (err) {
  dockerBaseDir = path.join(process.cwd(), 'backend/data/projects/docker');
  fs.mkdirSync(dockerBaseDir, { recursive: true });
}

const normalizeServiceName = (value, fallback = 'github-service') =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || fallback;

const getNextServiceSortOrder = () =>
  dockerManager.listServices().reduce((max, service, index) => {
    const value = Number.isFinite(Number(service.uiSortOrder)) ? Number(service.uiSortOrder) : index * 10;
    return Math.max(max, value);
  }, -10) + 10;

const getLocalIP = () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
};

const buildDefaultEnvVars = (blueprint = {}) => {
  const keys = Array.isArray(blueprint.envKeys) ? blueprint.envKeys : [];
  const envVars = [];
  if (keys.includes('NODE_ENV')) {
    envVars.push({ key: 'NODE_ENV', value: 'production', secret: false });
  }
  if (keys.includes('JAVA_OPTS')) {
    envVars.push({ key: 'JAVA_OPTS', value: '-Xmx512m -Djava.awt.headless=true', secret: false });
  }
  keys
    .filter((key) => key && !['NODE_ENV', 'JAVA_OPTS'].includes(key))
    .forEach((key) => envVars.push({ key, value: '', secret: /TOKEN|SECRET|PASSWORD|KEY/i.test(key) }));
  return envVars;
};

const buildDeliveryConfig = ({ connectionId, repository, branch, blueprint, deployMode = 'manual', workflowPath = null }) => ({
  provider: 'github',
  connectionId: connectionId || null,
  repository: repository || blueprint.repository || '',
  branch: branch || blueprint.branch || 'main',
  projectPath: blueprint.projectPath || '.',
  buildType: blueprint.buildType,
  deployMode,
  workflowPath: workflowPath || `.github/workflows/provirpanel-${normalizeServiceName(blueprint.serviceName)}.yml`,
  autoDeploy: deployMode !== 'manual',
  requireApproval: deployMode !== 'manual',
  blueprint,
  updatedAt: new Date().toISOString()
});

const createDraftServiceFromBlueprint = async ({
  connectionId,
  repository,
  branch,
  blueprint,
  serviceName,
  hostPort,
  networkName = 'provirpanel',
  bindLocalOnly = true,
  deployMode = 'manual'
}) => {
  if (!blueprint || typeof blueprint !== 'object') {
    const err = new Error('Blueprint inválido');
    err.status = 400;
    throw err;
  }
  const services = dockerManager.listServices();
  const name = normalizeServiceName(serviceName || blueprint.serviceName);
  if (!name || name.length < 2) {
    const err = new Error('Nome do serviço é obrigatório');
    err.status = 400;
    throw err;
  }
  if (services.some((service) => service.name === name)) {
    const err = new Error('Já existe um serviço com este nome');
    err.status = 409;
    throw err;
  }

  const containerPort = Number(blueprint.containerPort || blueprint.defaultPort || 3000);
  const resolvedPort = hostPort ? Number(hostPort) : await dockerManager.findAvailablePort(Number(blueprint.defaultPort || containerPort || 8000));
  if (!resolvedPort) {
    const err = new Error('Nenhuma porta disponível encontrada');
    err.status = 409;
    throw err;
  }

  const serviceId = crypto.randomUUID();
  const projectDir = path.join(dockerBaseDir, name);
  fs.mkdirSync(projectDir, { recursive: true });
  const containerPath =
    blueprint.buildType === 'java-jar'
      ? '/app'
      : blueprint.templateId === 'nginx-static'
        ? '/usr/share/nginx/html'
        : '/usr/src/app';
  const now = new Date().toISOString();
  const service = {
    id: serviceId,
    name,
    templateId: blueprint.templateId || 'node-app',
    image: blueprint.imageName || 'node:20',
    containerId: null,
    hostPort: resolvedPort,
    containerPort,
    volumes: [{ hostPath: projectDir, containerPath }],
    envVars: buildDefaultEnvVars(blueprint),
    command: null,
    networkName,
    bindLocalOnly,
    url: `http://localhost:${resolvedPort}`,
    serverIP: getLocalIP(),
    externalUrl: bindLocalOnly ? null : `http://${getLocalIP()}:${resolvedPort}`,
    healthcheck: blueprint.healthcheck || {
      enabled: true,
      target: '/health',
      intervalSeconds: 10,
      timeoutSeconds: 5,
      retries: 6,
      startPeriodSeconds: 5,
      containerEnabled: false
    },
    autoRollback: true,
    uiGroupId: null,
    uiSortOrder: getNextServiceSortOrder(),
    createdAt: now,
    updatedAt: now,
    hasProject: true,
    nodeServiceMode: blueprint.nodeServiceMode || 'service',
    nodeSiteConfig: blueprint.nodeSiteConfig || null,
    delivery: buildDeliveryConfig({ connectionId, repository, branch, blueprint, deployMode })
  };

  dockerManager.saveService(service);
  return service;
};

router.post('/connect', (req, res, next) => {
  try {
    const { provider, repoUrl, branch, destinationPath, buildScript, restart } = req.body || {};
    if (!repoUrl || !branch || !destinationPath) {
      return res.status(400).json({ message: 'repoUrl, branch and destinationPath are required' });
    }
    const config = {
      provider: provider || 'github',
      repoUrl,
      branch,
      destinationPath,
      buildScript,
      restart
    };
    ciCdManager.saveConfig(config);
    return res.json({ status: 'connected', config });
  } catch (err) {
    return next(err);
  }
});

router.get('/config', (req, res) => {
  res.json({ config: ciCdManager.loadConfig() });
});

router.get('/deploys', (req, res) => {
  res.json({ deploys: ciCdManager.listDeploys() });
});

router.get('/github/status', (req, res) => {
  res.json(githubDelivery.listConnections());
});

router.post('/github/connect', async (req, res, next) => {
  try {
    const connection = await githubDelivery.connectWithToken({
      token: req.body?.token,
      label: req.body?.label
    });
    res.json({ connection, ...githubDelivery.listConnections() });
  } catch (err) {
    next(err);
  }
});

router.delete('/github/connections/:connectionId', (req, res, next) => {
  try {
    res.json(githubDelivery.removeConnection(req.params.connectionId));
  } catch (err) {
    next(err);
  }
});

router.get('/github/repositories', async (req, res, next) => {
  try {
    const repositories = await githubDelivery.listRepositories(req.query?.connectionId);
    res.json({ repositories });
  } catch (err) {
    next(err);
  }
});

router.get('/github/repositories/:owner/:repo/branches', async (req, res, next) => {
  try {
    const branches = await githubDelivery.listBranches({
      connectionId: req.query?.connectionId,
      owner: req.params.owner,
      repo: req.params.repo
    });
    res.json({ branches });
  } catch (err) {
    next(err);
  }
});

router.post('/github/analyze', async (req, res, next) => {
  try {
    const analysis = await githubDelivery.analyzeRepository({
      connectionId: req.body?.connectionId,
      owner: req.body?.owner,
      repo: req.body?.repo,
      branch: req.body?.branch || 'main'
    });
    res.json({ analysis });
  } catch (err) {
    next(err);
  }
});

router.post('/github/services/from-blueprint', async (req, res, next) => {
  try {
    const service = await createDraftServiceFromBlueprint({
      connectionId: req.body?.connectionId,
      repository: req.body?.repository,
      branch: req.body?.branch,
      blueprint: req.body?.blueprint,
      serviceName: req.body?.serviceName,
      hostPort: req.body?.hostPort,
      networkName: req.body?.networkName,
      bindLocalOnly: req.body?.bindLocalOnly,
      deployMode: req.body?.deployMode
    });
    res.status(201).json({ service });
  } catch (err) {
    next(err);
  }
});

router.put('/github/services/:serviceId/delivery', (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    const service = services.find((entry) => entry.id === req.params.serviceId);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    const blueprint = req.body?.blueprint || service.delivery?.blueprint || {};
    const delivery = buildDeliveryConfig({
      connectionId: req.body?.connectionId,
      repository: req.body?.repository,
      branch: req.body?.branch,
      blueprint,
      deployMode: req.body?.deployMode,
      workflowPath: req.body?.workflowPath
    });
    const updatedService = dockerManager.saveService({
      ...service,
      delivery,
      healthcheck: req.body?.healthcheck || service.healthcheck,
      nodeServiceMode: blueprint.nodeServiceMode || service.nodeServiceMode,
      nodeSiteConfig: blueprint.nodeSiteConfig || service.nodeSiteConfig,
      updatedAt: new Date().toISOString()
    });
    res.json({ service: updatedService, delivery });
  } catch (err) {
    next(err);
  }
});

router.get('/github/services/:serviceId/workflow/content', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find((entry) => entry.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });
    const delivery = service.delivery || {};
    if (!delivery.connectionId || !delivery.repository || !delivery.workflowPath) {
      return res.json({ content: null });
    }
    const [owner, repo] = delivery.repository.split('/');
    const connection = githubDelivery.getConnection(delivery.connectionId);
    try {
      const wfRes = await githubDelivery.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/contents/${delivery.workflowPath}?ref=${delivery.branch || 'main'}`);
      const content = wfRes.data?.content ? Buffer.from(wfRes.data.content, 'base64').toString('utf8') : null;
      res.json({ content, path: delivery.workflowPath });
    } catch (err) {
      if (err.status === 404) return res.json({ content: null });
      throw err;
    }
  } catch (err) { next(err); }
});

router.put('/github/services/:serviceId/workflow/content', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find((entry) => entry.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });
    const delivery = service.delivery || {};
    const content = req.body?.content;
    if (!content) return res.status(400).json({ message: 'content é obrigatório' });
    const repoFullName = String(req.body?.repository || delivery.repository || '');
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) return res.status(400).json({ message: 'Repositório inválido' });
    const workflowPath = delivery.workflowPath || `.github/workflows/provirpanel-${normalizeServiceName(service.name)}.yml`;
    const branch = req.body?.branch || delivery.branch || 'main';
    const savedWorkflow = await githubDelivery.saveWorkflow({
      connectionId: req.body?.connectionId || delivery.connectionId,
      owner, repo, branch, workflowPath, content,
      message: `Update ProvirPanel workflow for ${service.name}`
    });
    const updatedDelivery = { ...delivery, workflowPath, workflowUpdatedAt: new Date().toISOString(), workflowCommitSha: savedWorkflow.commitSha, workflowHtmlUrl: savedWorkflow.htmlUrl };
    dockerManager.saveService({ ...service, delivery: updatedDelivery, updatedAt: new Date().toISOString() });
    res.json({ savedWorkflow, delivery: updatedDelivery });
  } catch (err) { next(err); }
});

router.post('/github/services/:serviceId/workflow', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find((entry) => entry.id === req.params.serviceId);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    const delivery = req.body?.delivery || service.delivery || {};
    const blueprint = req.body?.blueprint || delivery.blueprint;
    if (!blueprint) {
      return res.status(400).json({ message: 'Blueprint não configurado no serviço' });
    }
    const workflowPath =
      req.body?.workflowPath ||
      delivery.workflowPath ||
      `.github/workflows/provirpanel-${normalizeServiceName(service.name)}.yml`;
    // Auto-detect project config from GitHub repo
    const repoFullName = String(req.body?.repository || delivery.repository || blueprint.repository || '');
    const [repoOwner, repoName] = repoFullName.split('/');
    const projectPath = blueprint.projectPath && blueprint.projectPath !== '.' ? blueprint.projectPath : '.';
    let detectedConfig = {};
    if (repoOwner && repoName && (req.body?.connectionId || delivery.connectionId)) {
      try {
        detectedConfig = await githubDelivery.detectProjectConfig({
          connectionId: req.body?.connectionId || delivery.connectionId,
          owner: repoOwner, repo: repoName,
          branch: req.body?.branch || delivery.branch || blueprint.branch || 'main',
          projectPath
        });
      } catch {}
    }

    // Merge: detectedConfig fills in what blueprint doesn't have explicitly
    const mergedBlueprint = { ...blueprint, branch: req.body?.branch || delivery.branch || blueprint.branch };
    for (const [k, v] of Object.entries(detectedConfig)) {
      if (!mergedBlueprint[k]) mergedBlueprint[k] = v;
    }

    const content = githubDelivery.generateWorkflow({
      serviceId: service.id,
      serviceName: service.name,
      blueprint: mergedBlueprint,
      provirPanelUrl: req.body?.provirPanelUrl,
      deployMode: req.body?.deployMode || delivery.deployMode || 'manual'
    });

    let savedWorkflow = null;
    if (req.body?.saveToGitHub) {
      const repoFullName = String(req.body?.repository || delivery.repository || blueprint.repository || '');
      const [owner, repo] = repoFullName.split('/');
      if (!owner || !repo) {
        return res.status(400).json({ message: 'Repositório inválido para salvar workflow' });
      }
      savedWorkflow = await githubDelivery.saveWorkflow({
        connectionId: req.body?.connectionId || delivery.connectionId,
        owner,
        repo,
        branch: req.body?.branch || delivery.branch || blueprint.branch || 'main',
        workflowPath,
        content,
        message: `Add ProvirPanel workflow for ${service.name}`
      });
    }

    const updatedDelivery = {
      ...delivery,
      workflowPath,
      workflowUpdatedAt: new Date().toISOString(),
      ...(savedWorkflow ? { workflowCommitSha: savedWorkflow.commitSha, workflowHtmlUrl: savedWorkflow.htmlUrl } : {})
    };
    dockerManager.saveService({ ...service, delivery: updatedDelivery, updatedAt: new Date().toISOString() });
    res.json({ workflow: { path: workflowPath, content }, savedWorkflow, delivery: updatedDelivery });
  } catch (err) {
    next(err);
  }
});

router.get('/github/services/:serviceId/workflow/run-status', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find((entry) => entry.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });
    const delivery = service.delivery || {};
    const repoFullName = String(delivery.repository || '');
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) return res.json({ run: null });
    const run = await githubDelivery.getLatestWorkflowRun({
      connectionId: delivery.connectionId,
      owner,
      repo,
      workflowPath: delivery.workflowPath,
      branch: delivery.branch || 'main'
    });
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

router.post('/github/services/:serviceId/workflow/dispatch', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find((entry) => entry.id === req.params.serviceId);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    const delivery = service.delivery || {};
    const repoFullName = String(req.body?.repository || delivery.repository || '');
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      return res.status(400).json({ message: 'Repositório inválido para executar workflow' });
    }
    const dispatch = await githubDelivery.dispatchWorkflow({
      connectionId: req.body?.connectionId || delivery.connectionId,
      owner,
      repo,
      workflowPath: req.body?.workflowPath || delivery.workflowPath,
      ref: req.body?.branch || delivery.branch || 'main',
      inputs: req.body?.inputs || {}
    });
    dockerManager.saveService({
      ...service,
      delivery: {
        ...delivery,
        lastWorkflowDispatchAt: dispatch.dispatchedAt,
        updatedAt: new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    });
    res.json({ dispatch });
  } catch (err) {
    next(err);
  }
});

router.post('/deploy', async (req, res, next) => {
  try {
    const entry = await ciCdManager.runDeploy(req.body || {});
    res.json({ deploy: entry });
  } catch (err) {
    next(err);
  }
});

router.post('/webhook', async (req, res, next) => {
  try {
    const entry = await ciCdManager.runDeploy(req.body || {});
    res.json({ status: 'ok', deploy: entry });
  } catch (err) {
    next(err);
  }
});

// AI-powered blueprint generation based on running Docker container
// ─── AI Infrastructure Routes ────────────────────────────────────────────────
const infraAi = require('../services/infra-ai');

router.post('/github/services/:serviceId/smart-blueprint', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    const service = services.find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const result = await infraAi.generateSmartBlueprint(service);
    if (!result || !result.blueprint) {
      return res.status(500).json({ message: 'AI não conseguiu gerar blueprint' });
    }

    const { blueprint: aiBp, serviceUpdates, explanation, warnings } = result;

    // Apply service updates (command, healthcheck, port) if AI detected mismatches
    let updatedService = { ...service };
    const appliedUpdates = [];
    if (serviceUpdates) {
      if (serviceUpdates.command && serviceUpdates.command !== service.command) {
        updatedService.command = serviceUpdates.command;
        appliedUpdates.push(`Comando: ${serviceUpdates.command}`);
      }
      if (serviceUpdates.containerPort && serviceUpdates.containerPort !== service.containerPort) {
        updatedService.containerPort = serviceUpdates.containerPort;
        appliedUpdates.push(`Porta: ${serviceUpdates.containerPort}`);
      }
      if (serviceUpdates.healthcheck) {
        updatedService.healthcheck = serviceUpdates.healthcheck;
        appliedUpdates.push('Healthcheck atualizado');
      }
    }

    // Merge blueprint
    const existing = service.delivery?.blueprint || {};
    const merged = {
      ...existing,
      buildType: aiBp.buildType || existing.buildType,
      installCommand: aiBp.installCommand || existing.installCommand,
      buildCommand: aiBp.needsBuildInCI ? (aiBp.buildCommand || existing.buildCommand) : '',
      startCommand: aiBp.startCommand || existing.startCommand,
      artifactPath: aiBp.artifactPath || existing.artifactPath || '.',
      containerPort: aiBp.containerPort || existing.containerPort,
      packageManager: aiBp.packageManager || existing.packageManager,
      nodeServiceMode: aiBp.nodeServiceMode || existing.nodeServiceMode,
      needsBuildInCI: aiBp.needsBuildInCI ?? false,
      healthcheck: aiBp.healthcheck || existing.healthcheck,
      aiGenerated: true,
      aiGeneratedAt: new Date().toISOString()
    };

    // Save
    const delivery = updatedService.delivery || {};
    const updatedDelivery = { ...delivery, blueprint: merged };
    updatedService = { ...updatedService, delivery: updatedDelivery, updatedAt: new Date().toISOString() };
    dockerManager.saveService(updatedService);

    // Auto-regenerate and save workflow to GitHub
    let savedWorkflow = null;
    let workflowError = null;
    const repoFullName = String(delivery.repository || '');
    const [owner, repo] = repoFullName.split('/');
    if (owner && repo && delivery.connectionId) {
      try {
        const workflowPath = delivery.workflowPath || `.github/workflows/provirpanel-${normalizeServiceName(service.name)}.yml`;
        const content = githubDelivery.generateWorkflow({
          serviceId: service.id,
          serviceName: service.name,
          blueprint: { ...merged, branch: delivery.branch || merged.branch || 'main' },
          deployMode: delivery.deployMode || 'push'
        });
        savedWorkflow = await githubDelivery.saveWorkflow({
          connectionId: delivery.connectionId,
          owner, repo,
          branch: delivery.branch || 'main',
          workflowPath, content,
          message: `Update workflow via Smart Blueprint for ${service.name}`
        });
        const finalDelivery = {
          ...updatedDelivery, workflowPath,
          workflowUpdatedAt: new Date().toISOString(),
          ...(savedWorkflow ? { workflowCommitSha: savedWorkflow.commitSha, workflowHtmlUrl: savedWorkflow.htmlUrl } : {})
        };
        dockerManager.saveService({ ...updatedService, delivery: finalDelivery });
      } catch (wfErr) { workflowError = wfErr.message; }
    }

    res.json({
      blueprint: merged,
      explanation,
      warnings: warnings || [],
      appliedUpdates,
      workflowSaved: !!savedWorkflow,
      workflowError
    });
  } catch (err) { next(err); }
});

router.post('/services/:serviceId/ai-validate', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    ensureProjectIndexed(service);
    const validation = await infraAi.validatePreDeploy(service);

    // Auto-apply fixes if requested
    let applied = [];
    let gitPushed = 0;
    if (req.body?.autoFix && validation.autoFixes?.length) {
      const result = await infraAi.applyAutoFixes(service, validation.autoFixes, dockerManager);
      applied = result.applied;

      // Push config fixes to GitHub if any
      const gitFixes = applied.filter(a => a.success && a.requiresGitPush);
      if (gitFixes.length && service.delivery?.provider === 'github') {
        try {
          const pushResult = await infraAi.pushConfigFixToGitHub(service, gitFixes);
          gitPushed = pushResult.pushed;
        } catch (e) { /* git push failed, fixes applied locally only */ }
      }

      // If fixes were applied successfully, mark as ready (the issues were resolved)
      const fixedTypes = applied.filter(a => a.success).map(a => a.type);
      if (fixedTypes.length && !validation.ready) {
        const remainingCritical = (validation.issues || []).filter(i =>
          i.severity === 'critical' && !fixedTypes.includes(i.fix?.type)
        );
        if (remainingCritical.length === 0) {
          validation.ready = true;
        }
      }
    }

    res.json({ validation, applied, gitPushed });
  } catch (err) { next(err); }
});

router.post('/services/:serviceId/ai-infra-analysis', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    ensureProjectIndexed(service);
    const analysis = await infraAi.analyzeInfrastructure(service);
    res.json({ analysis });
  } catch (err) { next(err); }
});

router.post('/services/:serviceId/ai-project-analysis', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    ensureProjectIndexed(service);
    const allServices = dockerManager.listServices();
    const analysis = await infraAi.analyzeProjectDependencies(service, allServices, req.body?.userInstruction);
    res.json({ analysis });
  } catch (err) { next(err); }
});

router.post('/services/:serviceId/ai-apply-fixes', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const fixes = req.body?.fixes;
    if (!fixes?.length) return res.status(400).json({ message: 'Nenhum fix fornecido' });

    const result = await infraAi.applyAutoFixes(service, fixes, dockerManager);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══ WORKFLOW FAILURE AUTO-FIX ═══

const resolveProvirPanelUrl = () => {
  if (process.env.PROVIRPANEL_PUBLIC_URL) return process.env.PROVIRPANEL_PUBLIC_URL;
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return `http://${iface.address}:${process.env.PORT || 3000}`;
      }
    }
  }
  return `http://localhost:${process.env.PORT || 3000}`;
};

const generateDeployToken = () => {
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'change-me';
  return jwt.sign({ userId: 'github-deploy', role: 'admin' }, secret, { expiresIn: '365d' });
};

router.get('/deploy-token', (req, res) => {
  res.json({ token: generateDeployToken() });
});

router.post('/services/:serviceId/workflow-failed', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    ensureProjectIndexed(service);
    const delivery = service.delivery || {};
    if (!delivery.connectionId || !delivery.repository) {
      return res.status(400).json({ message: 'Serviço sem delivery configurado' });
    }
    const [owner, repo] = delivery.repository.split('/');
    const runId = req.body?.runId;
    if (!runId) return res.status(400).json({ message: 'runId obrigatório' });

    // 1. Fetch failure logs from GitHub
    const failureLogs = await githubDelivery.getWorkflowRunFailureLogs({
      connectionId: delivery.connectionId, owner, repo, runId
    });

    // 1b. Fetch current workflow content
    let currentWorkflow = '';
    try {
      const conn = githubDelivery.getConnection(delivery.connectionId);
      const wfRes = await githubDelivery.githubRequest(conn, 'GET', `/repos/${owner}/${repo}/contents/${delivery.workflowPath}?ref=${delivery.branch || 'main'}`);
      if (wfRes.data?.content) currentWorkflow = Buffer.from(wfRes.data.content, 'base64').toString('utf8');
    } catch { /* workflow file not accessible */ }

    // 2. Get project context
    const ctx = infraAi.collectFullContext(service);

    // 3. Ask AI to diagnose and fix
    const { zeusChat } = require('../services/deploy-ai');
    const provirPanelUrl = resolveProvirPanelUrl();
    const prompt = `Você é a Zeus AI. O workflow do GitHub Actions FALHOU para o serviço "${service.name}".

Você DEVE resolver o problema. Não dê dicas. Retorne AÇÕES.

## Logs do Workflow Falho:
${failureLogs.slice(0, 8000)}

## Workflow YAML Atual:
${currentWorkflow.slice(0, 4000)}

## Configuração do Serviço:
- Imagem: ${service.image}
- Comando: ${service.command || 'nenhum'}
- Repo: ${delivery.repository}
- Branch: ${delivery.branch}
- Workflow: ${delivery.workflowPath}
- Blueprint buildType: ${delivery.blueprint?.buildType || '?'}
- Blueprint needsBuildInCI: ${delivery.blueprint?.needsBuildInCI ?? '?'}
- ProvirPanel URL: ${provirPanelUrl}

## Arquivos do Projeto:
${JSON.stringify(ctx.projectFiles || {}, null, 2).slice(0, 4000)}

## Responda APENAS com JSON válido (sem markdown, sem comentários):
{
  "diagnosis": "o que causou a falha (1 frase)",
  "fixes": [
    {
      "type": "workflow|command|env|config_file|secret",
      "description": "o que vai ser corrigido",
      "file": "caminho do arquivo (se aplicável)",
      "content": "conteúdo COMPLETO do arquivo corrigido (se type=workflow, o YAML inteiro)",
      "key": "nome da env/secret (se aplicável)",
      "value": "valor (se aplicável)"
    }
  ],
  "redispatch": true
}

REGRAS CRÍTICAS:
- Se o workflow usa secrets.PROVIRPANEL_URL ou secrets.PROVIRPANEL_TOKEN e eles não existem: type="secret", key="PROVIRPANEL_URL" value="${provirPanelUrl}" e key="PROVIRPANEL_TOKEN" value="auto".
- Se o workflow falhou por erro no script (curl, tar, etc): type="workflow", retorne o YAML COMPLETO corrigido no campo "content".
- Se falhou por erro de build/código: type="config_file", corrija o arquivo.
- "redispatch": true SEMPRE que você aplicar um fix que resolve o problema.
- Se type="workflow", o campo "content" DEVE ser o YAML completo do workflow (não apenas um trecho).
- NUNCA diga "verifique" ou "certifique-se". Você RESOLVE.`;

    const answer = await zeusChat(prompt);
    let result = { diagnosis: 'AI não respondeu', fixes: [], redispatch: false };
    try {
      const match = answer.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch {
      // If AI returned text but not valid JSON, extract what we can
      if (answer && answer.length > 10) {
        result.diagnosis = answer.slice(0, 200);
      }
    }

    // Auto-detect missing secrets: if workflow uses secrets.PROVIRPANEL_* and URL has no host
    const needsSecrets = (currentWorkflow || '').includes('secrets.PROVIRPANEL') || (delivery.workflowPath || '').includes('provirpanel');
    const logsShowMissingUrl = failureLogs.includes('No host part') || failureLogs.includes('URL rejected') || failureLogs.includes('curl: (3)') || (failureLogs.includes('/api/docker/services/') && failureLogs.includes('FAILED'));
    if (needsSecrets && logsShowMissingUrl) {
      const hasUrlFix = result.fixes.some(f => f.key === 'PROVIRPANEL_URL');
      const hasTokenFix = result.fixes.some(f => f.key === 'PROVIRPANEL_TOKEN');
      if (!hasUrlFix) {
        result.fixes.push({ type: 'secret', key: 'PROVIRPANEL_URL', value: resolveProvirPanelUrl(), description: 'Criar secret PROVIRPANEL_URL no repositório' });
      }
      if (!hasTokenFix) {
        result.fixes.push({ type: 'secret', key: 'PROVIRPANEL_TOKEN', value: 'auto', description: 'Criar secret PROVIRPANEL_TOKEN no repositório' });
      }
      if (!result.diagnosis || result.diagnosis === 'AI não respondeu') {
        result.diagnosis = 'Secrets PROVIRPANEL_URL e PROVIRPANEL_TOKEN não configurados no repositório GitHub.';
      }
      // Always redispatch when secrets are being created
      result.redispatch = true;
    }

    // Also fix the workflow if it has https:// prefix before $PROVIRPANEL_URL
    if (currentWorkflow && currentWorkflow.includes("https://$PROVIRPANEL_URL")) {
      const fixedWorkflow = currentWorkflow.replace(/https:\/\/\$PROVIRPANEL_URL/g, '$PROVIRPANEL_URL').replace(/https:\/\/\${{\s*secrets\.PROVIRPANEL_URL\s*}}/g, '${{ secrets.PROVIRPANEL_URL }}');
      if (fixedWorkflow !== currentWorkflow) {
        result.fixes.push({
          type: 'workflow',
          description: 'Remover https:// duplicado (URL do secret j\u00e1 inclui protocolo)',
          file: delivery.workflowPath,
          content: fixedWorkflow
        });
      }
    }

    // 4. Apply fixes
    const applied = [];
    for (const fix of (result.fixes || [])) {
      try {
        if (fix.type === 'workflow' && fix.content) {
          const wfPath = fix.file || delivery.workflowPath;
          await githubDelivery.saveWorkflow({
            connectionId: delivery.connectionId, owner, repo,
            branch: delivery.branch || 'main',
            workflowPath: wfPath, content: fix.content,
            message: `fix(ai): ${fix.description || 'workflow fix'} [Zeus AI]`
          });
          applied.push({ ...fix, success: true });
        } else if (fix.type === 'config_file' && fix.file && fix.content) {
          // SAFETY: Never let AI overwrite package.json or lock files
          const dangerousFiles = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
          if (dangerousFiles.some(f => fix.file.endsWith(f))) {
            applied.push({ ...fix, success: false, reason: 'Prote\u00e7\u00e3o: AI n\u00e3o pode sobrescrever ' + fix.file });
            continue;
          }
          const conn = githubDelivery.getConnection(delivery.connectionId);
          const filePath = delivery.projectPath && delivery.projectPath !== '.' ? `${delivery.projectPath}/${fix.file}` : fix.file;
          let sha = null;
          try {
            const existing = await githubDelivery.githubRequest(conn, 'GET', `/repos/${owner}/${repo}/contents/${filePath}?ref=${delivery.branch || 'main'}`);
            sha = existing.data?.sha;
          } catch { /* file may not exist */ }
          await githubDelivery.githubRequest(conn, 'PUT', `/repos/${owner}/${repo}/contents/${filePath}`, {
            data: { message: `fix(ai): ${fix.description || fix.file} [Zeus AI]`, content: Buffer.from(fix.content).toString('base64'), branch: delivery.branch || 'main', ...(sha ? { sha } : {}) }
          });
          applied.push({ ...fix, success: true });
        } else if (fix.type === 'secret' && fix.key) {
          // AUTO-CREATE GitHub Actions secrets
          let secretValue = fix.value || '';
          // Resolve known secrets automatically
          if (fix.key === 'PROVIRPANEL_URL' && (!secretValue || secretValue.includes('<'))) {
            secretValue = resolveProvirPanelUrl();
          }
          if (fix.key === 'PROVIRPANEL_TOKEN' && (!secretValue || secretValue.includes('<'))) {
            secretValue = generateDeployToken();
          }
          await githubDelivery.setRepositorySecret({
            connectionId: delivery.connectionId, owner, repo,
            secretName: fix.key, secretValue
          });
          applied.push({ ...fix, value: '***', success: true });
        } else if (fix.type === 'command' && fix.value) {
          dockerManager.saveService({ ...service, command: fix.value, updatedAt: new Date().toISOString() });
          applied.push({ ...fix, success: true });
        } else if (fix.type === 'env' && fix.key) {
          const envVars = [...(service.envVars || [])];
          const idx = envVars.findIndex(e => e.key === fix.key);
          if (idx >= 0) envVars[idx] = { ...envVars[idx], value: fix.value };
          else envVars.push({ key: fix.key, value: fix.value || '', secret: false });
          dockerManager.saveService({ ...service, envVars, updatedAt: new Date().toISOString() });
          applied.push({ ...fix, success: true });
        } else {
          applied.push({ ...fix, success: false, reason: 'Tipo não suportado para auto-apply' });
        }
      } catch (e) {
        applied.push({ ...fix, success: false, reason: e.message });
      }
    }

    // 5. Re-dispatch workflow if fixes were applied
    let redispatched = false;
    const shouldRedispatch = result.redispatch || applied.some(a => a.success && a.type === 'secret');
    if (shouldRedispatch && applied.some(a => a.success)) {
      try {
        await githubDelivery.dispatchWorkflow({
          connectionId: delivery.connectionId, owner, repo,
          workflowPath: delivery.workflowPath,
          ref: delivery.branch || 'main', inputs: {}
        });
        redispatched = true;
      } catch { /* dispatch failed */ }
    }

    res.json({ diagnosis: result.diagnosis, applied, redispatched });
  } catch (err) { next(err); }
});

// --- AI Chat about project code ---
function buildServiceContext(service) {
  const parts = [`Serviço: ${service.name}`, `Template: ${service.templateId || 'custom'}`];
  if (service.nodeServiceMode === 'sites') parts.push('Modo: Node Sites (hospeda build estático de qualquer framework frontend — Vue, React, Angular — de forma monolítica via Express. O deploy envia o dist/build para uma pasta e o Node serve como static files com fallback SPA.)');
  if (service.delivery?.repository) parts.push(`Repositório Git: ${service.delivery.repository} (branch: ${service.delivery.branch || 'main'})`);
  if (service.containerPort) parts.push(`Porta: ${service.containerPort}`);
  if (service.command) parts.push(`Comando: ${Array.isArray(service.command) ? service.command.join(' ') : service.command}`);
  return parts.join('\n');
}

router.post('/services/:serviceId/ai-chat', async (req, res, next) => {
  try {
    const { message, history, stream } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const service = dockerManager.listServices().find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const { chatAboutProject, chatAboutProjectStream } = require('../services/project-ai-chat');

    const deployments = Array.isArray(service.deployments) ? service.deployments : [];
    const active = deployments.find(d => d.status === 'active') || deployments.find(d => d.id === service.activeDeploymentId);
    const projectDir = active?.projectDir || (service.volumes || [])[0]?.hostPath || null;

    if (stream) {
      // SSE streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      // Flush padding to force Cloudflare to start streaming immediately
      res.write(`: ${' '.repeat(2048)}\n\n`);

      // Resolve Git-indexed collection if service has delivery repo
      const gitCollection = service.delivery?.repository
        ? `project_${service.delivery.repository.split('/').pop().replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
        : null;

      await chatAboutProjectStream(service.id, message, history || [], projectDir, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }, { gitCollection, serviceContext: buildServiceContext(service) });
      res.end();
    } else {
      const gitCollection = service.delivery?.repository
        ? `project_${service.delivery.repository.split('/').pop().replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
        : null;
      const result = await chatAboutProject(service.id, message, history || [], projectDir, { gitCollection, serviceContext: buildServiceContext(service) });
      res.json({
        answer: result.answer,
        sources: result.sources,
        model: result.model,
        indexed: result.indexed,
        indexing: result.indexing || false
      });
    }
  } catch (err) {
    if (!res.headersSent) return next(err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// POST /services/:serviceId/ai-chat/reindex — force re-index project code
router.post('/services/:serviceId/ai-chat/reindex', async (req, res, next) => {
  try {
    const service = dockerManager.listServices().find(s => s.id === req.params.serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const { indexProjectCode, invalidateIndex } = require('../services/project-ai-chat');

    const deployments = Array.isArray(service.deployments) ? service.deployments : [];
    const active = deployments.find(d => d.status === 'active') || deployments.find(d => d.id === service.activeDeploymentId);
    const projectDir = active?.projectDir || (service.volumes || [])[0]?.hostPath || null;

    if (!projectDir || !fs.existsSync(projectDir)) {
      return res.status(400).json({ error: 'Projeto não encontrado no servidor' });
    }

    invalidateIndex(service.id);
    const result = await indexProjectCode(service.id, projectDir);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

const initAiChatSocket = (io) => {
  const jwt = require('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET || 'change-me';

  const ns = io.of('/api/ai-chat');
  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token ||
      (socket.handshake.headers?.authorization?.startsWith('Bearer ') ? socket.handshake.headers.authorization.slice(7) : null);
    if (!token) return next(new Error('Unauthorized'));
    try {
      jwt.verify(token, jwtSecret);
      next();
    } catch { next(new Error('Unauthorized')); }
  });

  ns.on('connection', (socket) => {
    socket.on('chat', async ({ serviceId, message, history }) => {
      try {
        const service = dockerManager.listServices().find(s => s.id === serviceId);
        if (!service) return socket.emit('error', { error: 'Service not found' });

        const { chatAboutProjectStream } = require('../services/project-ai-chat');
        const deployments = Array.isArray(service.deployments) ? service.deployments : [];
        const active = deployments.find(d => d.status === 'active') || deployments.find(d => d.id === service.activeDeploymentId);
        const projectDir = active?.projectDir || (service.volumes || [])[0]?.hostPath || null;

        const tick = () => new Promise(resolve => setImmediate(resolve));
        await chatAboutProjectStream(service.id, message, history || [], projectDir, async (event) => {
          socket.emit('chat:event', event);
          if (event.type === 'token') await tick();
        });
        socket.emit('chat:event', { type: 'end' });
      } catch (err) {
        socket.emit('chat:event', { type: 'error', error: err.message });
      }
    });
  });
};

module.exports = router;
module.exports.initAiChatSocket = initAiChatSocket;
