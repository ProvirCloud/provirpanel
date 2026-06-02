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
    const content = githubDelivery.generateWorkflow({
      serviceId: service.id,
      serviceName: service.name,
      blueprint: {
        ...blueprint,
        branch: req.body?.branch || delivery.branch || blueprint.branch
      },
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

module.exports = router;
