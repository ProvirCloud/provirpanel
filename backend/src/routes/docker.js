'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const DockerManager = require('../services/DockerManager');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile, execSync } = require('child_process');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');
const tarfs = require('tar-fs');
const multer = require('multer');

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });
const dockerManager = new DockerManager();
const serviceLogsPath = path.join(__dirname, '..', 'logs', 'service-updates.log');
fs.mkdirSync(path.dirname(serviceLogsPath), { recursive: true });
const chunkUploadRoot = path.join(os.tmpdir(), 'provirpanel-chunk-uploads');
fs.mkdirSync(chunkUploadRoot, { recursive: true });
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cookieName = process.env.AUTH_COOKIE_NAME || 'provirpanel_token';
const CONTAINER_VOLUME_PERMISSIONS = {
  'postgres-db': {
    uid: 999,
    gid: 999,
    mode: '700',
    label: 'PostgreSQL'
  },
  pgadmin: {
    uid: 5050,
    gid: 5050,
    mode: '777',
    label: 'pgAdmin'
  }
};

const applyContainerVolumePermissions = (templateId, hostPath, progress) => {
  const permission = CONTAINER_VOLUME_PERMISSIONS[templateId];
  if (!permission || !hostPath) return;

  execSync(`chown -R ${permission.uid}:${permission.gid} "${hostPath}"`, { stdio: 'ignore' });
  execSync(`chmod -R ${permission.mode} "${hostPath}"`, { stdio: 'ignore' });
  if (progress) {
    progress.push(`✅ Permissões ${permission.label} ajustadas`);
  }
};

const createHttpError = (message, status = 500) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const sanitizeUploadId = (uploadId) => {
  const value = String(uploadId || '');
  if (!/^[a-f0-9-]{36}$/i.test(value)) {
    throw createHttpError('Upload inválido', 400);
  }
  return value;
};

const safeUploadFilename = (filename, fallback = 'archive.zip') => {
  const base = path.basename(String(filename || fallback)).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || fallback;
};

const getChunkUploadDir = (uploadId) =>
  path.join(chunkUploadRoot, sanitizeUploadId(uploadId));

const writeChunkMetadata = (uploadId, metadata) => {
  const uploadDir = getChunkUploadDir(uploadId);
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  return uploadDir;
};

const readChunkMetadata = (uploadId) => {
  const uploadDir = getChunkUploadDir(uploadId);
  const metadataPath = path.join(uploadDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw createHttpError('Upload não encontrado', 404);
  }
  return {
    uploadDir,
    metadata: JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  };
};

const cleanupChunkUpload = (uploadId) => {
  try {
    fs.rmSync(getChunkUploadDir(uploadId), { recursive: true, force: true });
  } catch (err) {
    // ignore cleanup errors
  }
};

const persistChunkFile = (uploadId, chunkIndex, file) => {
  if (!file?.path) {
    throw createHttpError('Chunk obrigatório', 400);
  }
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0) {
    throw createHttpError('Índice de chunk inválido', 400);
  }
  const { uploadDir, metadata } = readChunkMetadata(uploadId);
  if (index >= Number(metadata.totalChunks)) {
    throw createHttpError('Índice de chunk fora do limite', 400);
  }
  const targetPath = path.join(uploadDir, `chunk-${index}`);
  fs.renameSync(file.path, targetPath);
  return metadata;
};

const assembleChunkUpload = (uploadId) => {
  const { uploadDir, metadata } = readChunkMetadata(uploadId);
  const totalChunks = Number(metadata.totalChunks);
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    throw createHttpError('Total de chunks inválido', 400);
  }

  const archivePath = path.join(uploadDir, safeUploadFilename(metadata.filename));
  fs.writeFileSync(archivePath, '');
  for (let index = 0; index < totalChunks; index += 1) {
    const chunkPath = path.join(uploadDir, `chunk-${index}`);
    if (!fs.existsSync(chunkPath)) {
      throw createHttpError(`Chunk ${index + 1}/${totalChunks} não recebido`, 400);
    }
    fs.appendFileSync(archivePath, fs.readFileSync(chunkPath));
  }

  const expectedSize = Number(metadata.size || 0);
  if (expectedSize > 0 && fs.statSync(archivePath).size !== expectedSize) {
    throw createHttpError('Arquivo remontado com tamanho inválido', 400);
  }

  return {
    archivePath,
    filename: metadata.filename
  };
};

const ensureChunkUploadReady = (uploadId) => {
  const { uploadDir, metadata } = readChunkMetadata(uploadId);
  const totalChunks = Number(metadata.totalChunks);
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    throw createHttpError('Total de chunks inválido', 400);
  }

  let receivedSize = 0;
  for (let index = 0; index < totalChunks; index += 1) {
    const chunkPath = path.join(uploadDir, `chunk-${index}`);
    if (!fs.existsSync(chunkPath)) {
      throw createHttpError(`Chunk ${index + 1}/${totalChunks} não recebido`, 400);
    }
    receivedSize += fs.statSync(chunkPath).size;
  }

  const expectedSize = Number(metadata.size || 0);
  if (expectedSize > 0 && receivedSize !== expectedSize) {
    throw createHttpError('Arquivo recebido com tamanho inválido', 400);
  }

  return metadata;
};

const pushBuildProgress = (progress, sessionId, message, phase = 'build') => {
  if (!message) return;
  progress.push(message);
  if (progressNamespace && sessionId) {
    progressNamespace.emit('progress', {
      type: 'image-build',
      sessionId,
      phase,
      message
    });
  }
};

const PROJECT_DEPLOY_PHASE_PROGRESS = {
  upload: 18,
  process: 24,
  prepare: 34,
  extract: 46,
  candidate: 58,
  compile: 68,
  healthcheck: 80,
  cleanup: 86,
  promote: 92,
  rollback: 95,
  done: 100,
  error: 0
};

const pushDeploymentProgress = (progress, sessionId, message, phase = 'process', extra = {}) => {
  if (!message) return;
  if (Array.isArray(progress)) {
    progress.push(message);
  }
  const progressPercent = Object.prototype.hasOwnProperty.call(extra, 'progressPercent')
    ? extra.progressPercent
    : PROJECT_DEPLOY_PHASE_PROGRESS[phase] ?? 50;
  if (progressNamespace && sessionId) {
    progressNamespace.emit('progress', {
      type: 'project-deploy',
      sessionId,
      phase,
      message,
      progressPercent,
      ts: Date.now(),
      ...extra
    });
  }
};

const sendProgressError = (res, err, progress = []) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: err.message || 'Erro ao processar operação',
    progress
  });
};

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
const deploymentVersionLimit = Math.max(
  2,
  Number(process.env.DOCKER_DEPLOYMENT_VERSION_LIMIT || 10)
);
let progressNamespace = null;
const portCheckHost = '0.0.0.0';
const registriesPath = path.join(__dirname, '..', 'data', 'docker-registries.json');
fs.mkdirSync(path.dirname(registriesPath), { recursive: true });
if (!fs.existsSync(registriesPath)) {
  fs.writeFileSync(registriesPath, '[]');
}

const readRegistries = () => {
  try {
    return JSON.parse(fs.readFileSync(registriesPath, 'utf8'));
  } catch (err) {
    return [];
  }
};

const writeRegistries = (registries) => {
  fs.writeFileSync(registriesPath, JSON.stringify(registries, null, 2));
};

const normalizeRegistryHost = (value) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('://')) {
      const parsed = new URL(trimmed);
      return parsed.host;
    }
  } catch (err) {
    // ignore
  }
  return trimmed.split('/')[0];
};

const sanitizeRegistry = (registry) => ({
  id: registry.id,
  name: registry.name,
  serverAddress: registry.serverAddress,
  username: registry.username || '',
  hasPassword: Boolean(registry.password),
  certPath: registry.certPath || null
});

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

const persistRegistryCert = (host, certPem) => {
  if (!host || !certPem) return null;
  const certDir = path.join('/etc/docker/certs.d', host);
  fs.mkdirSync(certDir, { recursive: true });
  const certPath = path.join(certDir, 'ca.crt');
  fs.writeFileSync(certPath, certPem, 'utf8');
  return certPath;
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

const SECRET_MASK = '******';

const maskEnvVars = (envVars = []) =>
  envVars.map((env) => ({
    ...env,
    value: env.secret ? SECRET_MASK : env.value
  }));

const sanitizeDeploymentForClient = (deployment = {}) => ({
  ...deployment,
  envVars: maskEnvVars(deployment.envVars || [])
});

const sanitizePendingConfigForClient = (pendingConfig = null) => {
  if (!pendingConfig) return null;
  return {
    ...pendingConfig,
    envVars: maskEnvVars(pendingConfig.envVars || [])
  };
};

const normalizeEnvVars = (envVars = []) =>
  envVars
    .filter((env) => env && env.key)
    .map((env) => ({
      key: env.key,
      value: env.value ?? '',
      secret: !!env.secret
    }));

const mergeEnvVars = (incoming = [], existing = []) => {
  const existingByKey = new Map(
    existing.filter((env) => env && env.key).map((env) => [env.key, env])
  );

  return normalizeEnvVars(incoming).map((env) => {
    const previous = existingByKey.get(env.key);
    if (
      env.secret &&
      previous?.secret &&
      (env.value === SECRET_MASK || env.value === '')
    ) {
      return { ...env, value: previous.value };
    }
    return env;
  });
};

const parseEnvVarsPayload = (value) => {
  if (value === undefined || value === null) return null;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value || '[]');
    } catch (err) {
      throw createHttpError('envVars inválido', 400);
    }
  }
  if (!Array.isArray(parsed)) {
    throw createHttpError('envVars inválido', 400);
  }
  return parsed;
};

const parseJsonObjectPayload = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      throw createHttpError(`${label} inválido`, 400);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createHttpError(`${label} inválido`, 400);
  }
  return parsed;
};

const parseBooleanOption = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'sim', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'nao', 'não', 'off'].includes(text)) return false;
  return fallback;
};

const clampNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
};

const normalizeHealthcheckConfig = (incoming = null, existing = {}) => {
  const source = incoming === null || incoming === undefined ? existing || {} : incoming || {};
  const target = String(source.target || source.url || source.path || '').trim();
  return {
    enabled: parseBooleanOption(source.enabled, false),
    target: target || '/',
    intervalSeconds: clampNumber(source.intervalSeconds, 10, 1, 3600),
    timeoutSeconds: clampNumber(source.timeoutSeconds, 5, 1, 300),
    retries: clampNumber(source.retries, 6, 1, 120),
    startPeriodSeconds: clampNumber(source.startPeriodSeconds, 5, 0, 3600),
    containerEnabled: parseBooleanOption(source.containerEnabled, false)
  };
};

const parseHealthcheckPayload = (value) => {
  const parsed = parseJsonObjectPayload(value, 'healthcheck');
  return parsed ? normalizeHealthcheckConfig(parsed) : null;
};

const VERSION_CHANGE_TYPE_LABELS = {
  fix: 'Correção',
  content: 'Conteúdo',
  feature: 'Funcionalidade',
  security: 'Segurança',
  maintenance: 'Manutenção',
  other: 'Outro'
};

const normalizeVersionChangeType = (value) => {
  const type = String(value || 'fix').trim().toLowerCase();
  const aliases = {
    bugfix: 'fix',
    correcao: 'fix',
    correção: 'fix',
    conteudo: 'content',
    conteúdo: 'content',
    funcionalidade: 'feature',
    seguranca: 'security',
    segurança: 'security',
    manutencao: 'maintenance',
    manutenção: 'maintenance'
  };
  const normalized = aliases[type] || type;
  return VERSION_CHANGE_TYPE_LABELS[normalized] ? normalized : 'fix';
};

const normalizeVersionText = (value, maxLength = 40) =>
  String(value || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/[^\w.+-]/g, '-')
    .slice(0, maxLength);

const parseVersionMetadataPayload = (value) => {
  const parsed = parseJsonObjectPayload(value, 'versionMetadata');
  if (!parsed) return null;
  return {
    mode: parsed.mode === 'manual' ? 'manual' : 'auto',
    appVersion: normalizeVersionText(parsed.appVersion || parsed.version || ''),
    buildNumber: normalizeVersionText(parsed.buildNumber || parsed.build || '', 30),
    changeType: normalizeVersionChangeType(parsed.changeType || parsed.type)
  };
};

const getDeploymentAppVersion = (deployment = {}) =>
  normalizeVersionText(
    deployment.appVersion ||
      deployment.version ||
      deployment.versionMetadata?.appVersion ||
      ''
  );

const getDeploymentBuildNumber = (deployment = {}) => {
  const value =
    deployment.buildNumber ||
    deployment.build ||
    deployment.versionMetadata?.buildNumber ||
    '';
  const parsed = Number(String(value).replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getLatestDeploymentWithVersion = (deployments = []) =>
  [...(Array.isArray(deployments) ? deployments : [])]
    .filter((deployment) => deployment?.id)
    .sort((a, b) =>
      String(b.promotedAt || b.createdAt || '').localeCompare(String(a.promotedAt || a.createdAt || ''))
    )
    .find((deployment) => getDeploymentAppVersion(deployment) || getDeploymentBuildNumber(deployment));

const incrementAppVersion = (currentVersion, changeType) => {
  const clean = normalizeVersionText(currentVersion);
  const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return '1.0.0';
  const major = Number(match[1] || 1);
  const minor = Number(match[2] || 0);
  const patch = Number(match[3] || 0);
  if (changeType === 'feature') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
};

const buildDeploymentVersionMetadata = (incoming = null, deployments = []) => {
  const source = incoming && typeof incoming === 'object' ? incoming : {};
  const mode = source.mode === 'manual' ? 'manual' : 'auto';
  const changeType = normalizeVersionChangeType(source.changeType || source.type);
  const latestWithVersion = getLatestDeploymentWithVersion(deployments);
  const highestBuild = (Array.isArray(deployments) ? deployments : []).reduce(
    (max, deployment) => Math.max(max, getDeploymentBuildNumber(deployment)),
    0
  );
  const requestedVersion = normalizeVersionText(source.appVersion || source.version || '');
  const requestedBuild = normalizeVersionText(source.buildNumber || source.build || '', 30);
  const appVersion =
    mode === 'manual' && requestedVersion
      ? requestedVersion
      : incrementAppVersion(getDeploymentAppVersion(latestWithVersion), changeType);
  const buildNumber =
    mode === 'manual' && requestedBuild
      ? requestedBuild
      : String(highestBuild + 1);
  const changeTypeLabel = VERSION_CHANGE_TYPE_LABELS[changeType] || VERSION_CHANGE_TYPE_LABELS.fix;
  const label = `v${appVersion} build ${buildNumber} - ${changeTypeLabel}`;

  return {
    mode,
    appVersion,
    buildNumber,
    changeType,
    changeTypeLabel,
    label,
    generated: mode !== 'manual' || !requestedVersion || !requestedBuild
  };
};

const ENV_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

const parseEnvEntries = (content = '') =>
  String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const normalizedLine = line.startsWith('export ') ? line.slice(7).trim() : line;
      const idx = normalizedLine.indexOf('=');
      if (idx <= 0) return null;
      const key = normalizedLine.slice(0, idx).trim();
      let value = normalizedLine.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return key ? { key, value, secret: false } : null;
    })
    .filter(Boolean);

const readProjectEnvVars = (projectPath) => {
  if (!projectPath?.hostPath) return [];
  const filePath = path.join(projectPath.hostPath, '.env');
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseEnvEntries(content);
  } catch (err) {
    return [];
  }
};

const mergeEnvEntries = (...groups) => {
  const map = new Map();
  groups
    .flat()
    .forEach((entry) => {
      if (!entry || !entry.key) return;
      map.set(entry.key, {
        key: entry.key,
        value: entry.value ?? '',
        secret: !!entry.secret
      });
    });
  return Array.from(map.values());
};

const resolveEnvValue = (key, rawValue, lookup = {}) => {
  const text = String(rawValue ?? '');
  return text.replace(ENV_REFERENCE_PATTERN, (token, bracketed, simple) => {
    const refKey = bracketed || simple;
    if (Object.prototype.hasOwnProperty.call(lookup, refKey)) {
      return lookup[refKey];
    }
    return token;
  });
};

const buildContainerEnv = ({ explicitEnvVars = [] }) => {
  const merged = mergeEnvEntries(explicitEnvVars);
  const rawLookup = Object.fromEntries(
    merged.map((entry) => [entry.key, String(entry.value ?? '')])
  );
  return merged.map((entry) => `${entry.key}=${resolveEnvValue(entry.key, entry.value, rawLookup)}`);
};

const ensureExplicitContainerEnv = (env = [], envVars = []) => {
  const normalized = normalizeEnvVars(envVars);
  const rawLookup = Object.fromEntries(
    normalized.map((entry) => [entry.key, String(entry.value ?? '')])
  );
  return normalized.reduce(
    (entries, entry) =>
      upsertEnvValue(entries, entry.key, resolveEnvValue(entry.key, entry.value, rawLookup)),
    env
  );
};

const buildServiceLabels = ({
  serviceId,
  name,
  templateId,
  parentService = null,
  hasProject = false
}) => ({
  'provirpanel.managed': 'true',
  'provirpanel.service.id': String(serviceId || ''),
  'provirpanel.service.name': String(name || ''),
  'provirpanel.template.id': String(templateId || ''),
  'provirpanel.has_project': hasProject ? 'true' : 'false',
  ...(parentService ? { 'provirpanel.parent.id': String(parentService) } : {})
});

const sanitizeServiceForClient = (service) => ({
  ...service,
  networkName: service.networkName || 'bridge',
  envVars: maskEnvVars(service.envVars || []),
  pendingConfig: sanitizePendingConfigForClient(service.pendingConfig),
  deployments: (service.deployments || []).map(sanitizeDeploymentForClient)
});

const projectDeployJobs = new Map();

const sanitizeProjectDeployJob = (job = {}) => ({
  id: job.id,
  serviceId: job.serviceId,
  status: job.status,
  phase: job.phase || 'process',
  progressPercent: job.progressPercent ?? PROJECT_DEPLOY_PHASE_PROGRESS[job.phase] ?? 50,
  message: job.message || '',
  error: job.error || null,
  progress: Array.isArray(job.progress) ? job.progress : [],
  progressSessionId: job.progressSessionId || '',
  service: job.service ? sanitizeServiceForClient(job.service) : null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt || null,
  startedAt: job.startedAt || null,
  finishedAt: job.finishedAt || null
});

const sendServicesResponse = async (res, next) => {
  try {
    const services = await dockerManager.listManagedServices();
    res.json({ services: services.map(sanitizeServiceForClient) });
  } catch (err) {
    next(err);
  }
};

const resolveProjectPathFromVolume = (volumes = []) => {
  const volume = volumes.find((m) => m.hostPath && m.containerPath);
  if (!volume) return null;

  const root = volume.hostPath;
  const hasNextProject = (dir) => {
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) return false;
    const appDir = path.join(dir, 'app');
    const pagesDir = path.join(dir, 'pages');
    const nextConfig = path.join(dir, 'next.config.js');
    return fs.existsSync(appDir) || fs.existsSync(pagesDir) || fs.existsSync(nextConfig);
  };

  const resolveContainerPath = (hostDir) => {
    const relative = path.relative(root, hostDir).split(path.sep).join('/');
    return relative ? path.posix.join(volume.containerPath, relative) : volume.containerPath;
  };

  const searchDepth = (dir, depth) => {
    if (hasNextProject(dir)) {
      return {
        hostPath: dir,
        containerPath: resolveContainerPath(dir)
      };
    }
    if (depth <= 0) return null;
    let entries = [];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (err) {
      return null;
    }
    for (const entry of entries) {
      const found = searchDepth(path.join(dir, entry), depth - 1);
      if (found) return found;
    }
    return null;
  };

  const found = searchDepth(root, 2);
  if (found) return found;

  return null;
};

const resolvePackageProjectPathFromVolume = (volumes = []) => {
  const volume = volumes.find((m) => m.hostPath && m.containerPath);
  if (!volume) return null;

  const root = volume.hostPath;
  const resolveContainerPath = (hostDir) => {
    const relative = path.relative(root, hostDir).split(path.sep).join('/');
    return relative ? path.posix.join(volume.containerPath, relative) : volume.containerPath;
  };

  const hasPackageJson = (dir) => fs.existsSync(path.join(dir, 'package.json'));
  if (hasPackageJson(root)) {
    return {
      hostPath: root,
      containerPath: volume.containerPath
    };
  }

  const searchDepth = (dir, depth) => {
    if (depth <= 0) return null;
    let entries = [];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !['node_modules', '.git', 'dist', 'build'].includes(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch (err) {
      return null;
    }

    for (const entry of entries) {
      const candidate = path.join(dir, entry);
      if (hasPackageJson(candidate)) {
        return {
          hostPath: candidate,
          containerPath: resolveContainerPath(candidate)
        };
      }
    }
    for (const entry of entries) {
      const found = searchDepth(path.join(dir, entry), depth - 1);
      if (found) return found;
    }
    return null;
  };

  return searchDepth(root, 3);
};

const buildNodeCommandFromPackage = (project) => {
  if (!project?.hostPath) return null;
  const packagePath = path.join(project.hostPath, 'package.json');
  if (!fs.existsSync(packagePath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const scripts = pkg && typeof pkg === 'object' ? pkg.scripts || {} : {};
    const deps = {
      ...((pkg && typeof pkg === 'object' ? pkg.dependencies || {} : {}) || {}),
      ...((pkg && typeof pkg === 'object' ? pkg.devDependencies || {} : {}) || {})
    };
    const hasBuild = typeof scripts.build === 'string' && scripts.build.trim();
    const hasStart = typeof scripts.start === 'string' && scripts.start.trim();
    const hasDev = typeof scripts.dev === 'string' && scripts.dev.trim();
    const hasNext = Boolean(deps.next);
    const install = 'npm install';

    if (hasBuild && hasStart) {
      return ['sh', '-c', `${install} && npm run build && npm run start`];
    }
    if (hasNext && hasStart) {
      return ['sh', '-c', `${install} && npm run start`];
    }
    if (hasStart) {
      return ['sh', '-c', `${install} && npm run start`];
    }
    if (hasBuild && pkg.main) {
      return ['sh', '-c', `${install} && npm run build && node ${shellQuote(pkg.main)}`];
    }
    if (hasBuild) {
      return ['sh', '-c', `${install} && npm run build && npm start`];
    }
    if (hasDev) {
      return ['sh', '-c', `${install} && npm run dev`];
    }
    if (pkg.main) {
      return ['sh', '-c', `${install} && node ${shellQuote(pkg.main)}`];
    }
  } catch (err) {
    return null;
  }

  return ['sh', '-c', 'npm install && npm start'];
};

const resolveNodeCommand = (volumes = []) => {
  return buildNodeCommandFromPackage(resolvePackageProjectPathFromVolume(volumes));
};

const JAVA_IMAGE_KEYWORDS = [
  'java',
  'openjdk',
  'temurin',
  'corretto',
  'amazoncorretto',
  'adoptopenjdk',
  'liberica',
  'ibm-semeru',
  'sapmachine',
  'spring',
  'maven',
  'gradle'
];

const isJavaRuntimeService = (service = {}) => {
  const descriptor = [
    service.templateId,
    service.image,
    service.name
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return JAVA_IMAGE_KEYWORDS.some((keyword) => descriptor.includes(keyword));
};

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const upsertEnvValue = (env = [], key, value) => {
  const prefix = `${key}=`;
  return [
    ...env.filter((entry) => !String(entry || '').startsWith(prefix)),
    `${key}=${value ?? ''}`
  ];
};

const PROJECT_ENTRYPOINT_FILES = [
  'entrypoint.sh',
  'docker-entrypoint.sh',
  'start.sh',
  'run.sh',
  'startup.sh'
];

const scoreProjectEntrypointCandidate = (candidate) => {
  const basename = candidate.basename.toLowerCase();
  let score = 0;

  if (basename === 'entrypoint.sh') score += 100;
  if (basename === 'docker-entrypoint.sh') score += 95;
  if (basename === 'start.sh') score += 85;
  if (basename === 'run.sh') score += 80;
  if (basename === 'startup.sh') score += 75;
  score -= candidate.depth * 10;

  return score;
};

const resolveProjectEntrypointLaunch = (volumes = []) => {
  const project = resolvePrimaryVolumeProjectPath(volumes);
  if (!project?.hostPath || !project?.containerPath || !fs.existsSync(project.hostPath)) {
    return null;
  }

  const candidates = [];
  const maxDepth = 2;

  const visit = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      return;
    }

    entries.forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= maxDepth || entry.name === '.git' || entry.name === 'node_modules') return;
        visit(fullPath, depth + 1);
        return;
      }
      if (!entry.isFile()) return;
      const lowerName = entry.name.toLowerCase();
      if (!PROJECT_ENTRYPOINT_FILES.includes(lowerName)) return;

      const relative = path.relative(project.hostPath, fullPath).split(path.sep).join('/');
      candidates.push({
        hostPath: fullPath,
        relative,
        basename: entry.name,
        depth: relative.split('/').length - 1
      });
    });
  };

  visit(project.hostPath, 0);
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const scoreDiff = scoreProjectEntrypointCandidate(b) - scoreProjectEntrypointCandidate(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.relative.localeCompare(b.relative);
  });

  const selected = candidates[0];
  const containerScriptPath = path.posix.join(project.containerPath, selected.relative);
  const commandText = [
    `chmod +x ${shellQuote(containerScriptPath)} 2>/dev/null || true`,
    `if command -v bash >/dev/null 2>&1; then exec bash ${shellQuote(containerScriptPath)}; else exec sh ${shellQuote(containerScriptPath)}; fi`
  ].join(' && ');

  return {
    type: 'project-entrypoint',
    command: ['sh', '-c', commandText],
    commandText,
    hostPath: selected.hostPath,
    containerPath: containerScriptPath
  };
};

const scoreJavaJarCandidate = (candidate) => {
  const relative = candidate.relative.toLowerCase();
  const basename = candidate.basename.toLowerCase();
  let score = 0;

  if (!relative.includes('/')) score += 25;
  if (relative.startsWith('target/')) score += 50;
  if (relative.startsWith('build/libs/')) score += 50;
  if (relative.includes('/target/')) score += 35;
  if (relative.includes('/build/libs/')) score += 35;
  if (candidate.size >= 1024 * 1024) score += 20;
  if (candidate.size >= 10 * 1024 * 1024) score += 10;
  if (basename.endsWith('-plain.jar')) score -= 80;
  if (basename.startsWith('original-')) score -= 60;
  score -= candidate.depth * 5;

  return score;
};

const resolveJavaJarLaunch = (volumes = []) => {
  const project = resolvePrimaryVolumeProjectPath(volumes);
  if (!project?.hostPath || !project?.containerPath || !fs.existsSync(project.hostPath)) {
    return null;
  }

  const ignoredDirs = new Set([
    '.git',
    '.gradle',
    '.m2',
    'node_modules',
    '.next',
    'coverage'
  ]);
  const ignoredJarPattern = /(?:^|[-_.])(sources|javadoc|tests|test)\.jar$/i;
  const candidates = [];
  const maxDepth = 6;

  const visit = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      return;
    }

    entries.forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= maxDepth || ignoredDirs.has(entry.name)) return;
        visit(fullPath, depth + 1);
        return;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) return;
      if (ignoredJarPattern.test(entry.name)) return;

      let stat = null;
      try {
        stat = fs.statSync(fullPath);
      } catch (err) {
        return;
      }

      const relative = path.relative(project.hostPath, fullPath).split(path.sep).join('/');
      candidates.push({
        hostPath: fullPath,
        relative,
        basename: entry.name,
        depth: relative.split('/').length - 1,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    });
  };

  visit(project.hostPath, 0);
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const scoreDiff = scoreJavaJarCandidate(b) - scoreJavaJarCandidate(a);
    if (scoreDiff !== 0) return scoreDiff;
    const mtimeDiff = b.mtimeMs - a.mtimeMs;
    if (mtimeDiff !== 0) return mtimeDiff;
    return a.relative.localeCompare(b.relative);
  });

  const selected = candidates[0];
  const containerJarPath = path.posix.join(project.containerPath, selected.relative);
  const commandText = `java \${JAVA_OPTS:-} -jar ${shellQuote(containerJarPath)}`;

  return {
    type: 'java-jar',
    command: ['sh', '-c', commandText],
    commandText,
    hostPath: selected.hostPath,
    containerJarPath,
    containerPath: containerJarPath
  };
};

const resolveProjectAutoLaunch = ({
  service,
  isNodeService = false,
  isNginxStaticService = false,
  isNodeSitesMode = false
}) => {
  if (!service || isNodeService || isNginxStaticService || isNodeSitesMode) {
    return null;
  }
  return resolveProjectEntrypointLaunch(service.volumes) || resolveJavaJarLaunch(service.volumes);
};

const applyProjectRuntimeEnv = (env = [], projectPath, launch = null) => {
  let nextEnv = env;
  if (projectPath?.containerPath) {
    nextEnv = upsertEnvValue(nextEnv, 'APP_DIR', projectPath.containerPath);
    nextEnv = upsertEnvValue(nextEnv, 'APP_HOME', projectPath.containerPath);
    nextEnv = upsertEnvValue(nextEnv, 'PROJECT_DIR', projectPath.containerPath);
  }
  if (launch?.type === 'java-jar' && launch.containerJarPath) {
    nextEnv = upsertEnvValue(nextEnv, 'APP_JAR', launch.containerJarPath);
  }
  if (launch?.type === 'project-entrypoint' && launch.containerPath) {
    nextEnv = upsertEnvValue(nextEnv, 'APP_ENTRYPOINT', launch.containerPath);
  }
  return nextEnv;
};

const runCommand = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout, stderr) => {
      if (err) {
        err.message = `${err.message}${stderr ? `: ${stderr}` : ''}`;
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });

const ensureExtractor = async (command, hint) => {
  try {
    await runCommand('which', [command]);
  } catch (err) {
    throw new Error(`${command} não encontrado. Instale ${hint || command} para extrair arquivos.`);
  }
};

const cleanDirectory = (targetDir) => {
  if (!targetDir || !fs.existsSync(targetDir)) return;
  const entries = fs.readdirSync(targetDir);
  entries.forEach((entry) => {
    fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true });
  });
};

const flattenSingleRootDir = (targetDir, maxPasses = 5) => {
  try {
    let pass = 0;
    while (pass < maxPasses) {
      pass += 1;
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const ignoredNames = new Set(['__MACOSX']);
      const visibleEntries = entries.filter((entry) => {
        if (ignoredNames.has(entry.name)) return false;
        if (entry.isFile() && entry.name === '.DS_Store') return false;
        return true;
      });
      const dirs = visibleEntries.filter((e) => e.isDirectory());
      const files = visibleEntries.filter((e) => e.isFile());
      if (files.length > 0 || dirs.length !== 1) {
        break;
      }
      const rootDir = path.join(targetDir, dirs[0].name);
      const nestedEntries = fs.readdirSync(rootDir);
      nestedEntries.forEach((entry) => {
        fs.renameSync(path.join(rootDir, entry), path.join(targetDir, entry));
      });
      fs.rmdirSync(rootDir);
    }
  } catch (err) {
    // ignore flatten errors
  }
};

const findIndexDir = (rootDir, maxDepth = 4, entryFile = 'index.html') => {
  const walk = (dir, depth) => {
    if (fs.existsSync(path.join(dir, entryFile))) return dir;
    if (depth <= 0) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '__MACOSX' || entry.name === 'node_modules') continue;
      const found = walk(path.join(dir, entry.name), depth - 1);
      if (found) return found;
    }
    return null;
  };
  return walk(rootDir, maxDepth);
};

const normalizeStaticSiteRoot = (projectDir, entryFile = 'index.html') => {
  if (fs.existsSync(path.join(projectDir, entryFile))) {
    return true;
  }

  const indexDir = findIndexDir(projectDir, 5, entryFile);
  if (!indexDir) return false;
  if (path.resolve(indexDir) === path.resolve(projectDir)) return true;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provir-static-'));
  fs.readdirSync(indexDir).forEach((entry) => {
    fs.renameSync(path.join(indexDir, entry), path.join(tempDir, entry));
  });
  cleanDirectory(projectDir);
  fs.readdirSync(tempDir).forEach((entry) => {
    fs.renameSync(path.join(tempDir, entry), path.join(projectDir, entry));
  });
  fs.rmdirSync(tempDir);
  return fs.existsSync(path.join(projectDir, entryFile));
};

const extractArchiveTo = async (archivePath, targetDir, archiveName) => {
  const lower = (archiveName || archivePath).toLowerCase();
  if (lower.endsWith('.jar')) {
    fs.copyFileSync(archivePath, path.join(targetDir, safeUploadFilename(archiveName, 'app.jar')));
    return;
  }
  if (lower.endsWith('.zip')) {
    await ensureExtractor('unzip', 'unzip');
    await runCommand('unzip', ['-o', archivePath, '-d', targetDir]);
    flattenSingleRootDir(targetDir);
    return;
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await ensureExtractor('tar', 'tar');
    await runCommand('tar', ['-xzf', archivePath, '-C', targetDir]);
    flattenSingleRootDir(targetDir);
    return;
  }
  if (lower.endsWith('.tar')) {
    await ensureExtractor('tar', 'tar');
    await runCommand('tar', ['-xf', archivePath, '-C', targetDir]);
    flattenSingleRootDir(targetDir);
    return;
  }
  throw new Error('Formato de arquivo não suportado. Use .jar, .zip, .tar, .tar.gz ou .tgz.');
};

const removeContainerByName = async (name) => {
  if (!name) return;
  try {
    const containers = await dockerManager.docker.listContainers({ all: true });
    const match = containers.find((container) =>
      (container.Names || []).includes(`/${name}`)
    );
    if (match) {
      await dockerManager.docker.getContainer(match.Id).remove({ force: true });
    }
  } catch (err) {
    // ignore
  }
};

const runContainerWithRetry = async (image, config, name) => {
  try {
    return await dockerManager.runContainer(image, config);
  } catch (err) {
    const message = err && err.message ? err.message : '';
    if (message.includes('already in use') || message.includes('Conflict')) {
      await removeContainerByName(name);
      return await dockerManager.runContainer(image, config);
    }
    throw err;
  }
};

const writeEnvFile = (projectPath, envVars = [], templateEnv = []) => {
  if (!projectPath?.hostPath) return;
  fs.mkdirSync(projectPath.hostPath, { recursive: true });
  const merged = mergeEnvEntries(envVars);
  const content = merged.length
    ? merged.map((entry) => `${entry.key}=${entry.value ?? ''}`).join('\n') + '\n'
    : '';
  fs.writeFileSync(path.join(projectPath.hostPath, '.env'), content, 'utf8');
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildHealthcheckTargetUrl = (healthcheck, hostPort) => {
  const target = String(healthcheck?.target || '/').trim() || '/';
  if (/^https?:\/\//i.test(target)) {
    return target
      .replace(/\{host\}/g, '127.0.0.1')
      .replace(/\{port\}/g, String(hostPort));
  }
  const pathTarget = target.startsWith('/') ? target : `/${target}`;
  return `http://127.0.0.1:${hostPort}${pathTarget}`;
};

const requestHealthcheckUrl = (targetUrl, timeoutSeconds) =>
  new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(new Error(`URL de healthcheck invalida: ${targetUrl}`));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: Math.max(1, Number(timeoutSeconds || 5)) * 1000,
        headers: {
          'User-Agent': 'ProvirPanel-Healthcheck'
        }
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          const status = Number(res.statusCode || 0);
          if (status >= 200 && status < 400) {
            resolve({ statusCode: status });
            return;
          }
          reject(new Error(`HTTP ${status}`));
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`timeout apos ${timeoutSeconds}s`));
    });
    req.on('error', reject);
    req.end();
  });

const waitForServiceHealth = async ({
  serviceName,
  healthcheck,
  hostPort,
  onProgress = null,
  onAttemptFailure = null
}) => {
  const config = normalizeHealthcheckConfig(healthcheck);
  if (!config.enabled) {
    if (onProgress) onProgress(`Healthcheck desativado para ${serviceName}.`);
    return { skipped: true };
  }

  const targetUrl = buildHealthcheckTargetUrl(config, hostPort);
  if (config.startPeriodSeconds > 0) {
    appendServiceLog(
      'info',
      `Aguardando ${config.startPeriodSeconds}s antes do healthcheck de ${serviceName}`
    );
    if (onProgress) {
      onProgress(`Aguardando ${config.startPeriodSeconds}s antes do healthcheck de ${serviceName}...`);
    }
    await delay(config.startPeriodSeconds * 1000);
  }

  let lastError = null;
  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    try {
      if (onProgress) {
        onProgress(`Healthcheck ${serviceName} tentativa ${attempt}/${config.retries}: ${targetUrl}`);
      }
      appendServiceLog(
        'info',
        `Healthcheck ${serviceName} tentativa ${attempt}/${config.retries}: ${targetUrl}`
      );
      const result = await requestHealthcheckUrl(targetUrl, config.timeoutSeconds);
      appendServiceLog(
        'info',
        `Healthcheck ${serviceName} OK com status ${result.statusCode}`
      );
      if (onProgress) {
        onProgress(`Healthcheck ${serviceName} OK com status ${result.statusCode}.`);
      }
      return { ok: true, targetUrl, statusCode: result.statusCode };
    } catch (err) {
      lastError = err;
      appendServiceLog(
        'warn',
        `Healthcheck ${serviceName} falhou na tentativa ${attempt}/${config.retries}: ${err.message}`
      );
      if (onProgress) {
        onProgress(`Healthcheck ${serviceName} falhou na tentativa ${attempt}/${config.retries}: ${err.message}`);
      }
      if (onAttemptFailure) {
        await onAttemptFailure(err, attempt, config.retries);
      }
      if (attempt < config.retries) {
        await delay(config.intervalSeconds * 1000);
      }
    }
  }

  throw createHttpError(
    `Healthcheck falhou para ${serviceName}: ${lastError?.message || 'sem resposta'}`,
    502
  );
};

const stripAnsiSequences = (value) =>
  String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

const decodeDockerLogData = (logData) => {
  if (!logData) return '';
  if (!Buffer.isBuffer(logData)) return stripAnsiSequences(String(logData));

  let text = '';
  let offset = 0;
  while (offset + 8 <= logData.length) {
    const size = logData.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (!size || end > logData.length) break;
    text += logData.slice(start, end).toString('utf8');
    offset = end;
  }
  return stripAnsiSequences(text || logData.toString('utf8'));
};

const readContainerLogLines = async (containerId, tail = 40) => {
  if (!containerId) return [];
  try {
    const container = dockerManager.docker.getContainer(containerId);
    const logData = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: false
    });
    return decodeDockerLogData(logData)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    appendServiceLog('warn', `Nao foi possivel ler logs do container ${containerId}: ${err.message}`);
    return [];
  }
};

const createDeploymentLogEmitter = ({ containerId, pushProgress, phase = 'compile', label = 'container' }) => {
  const emitted = new Set();
  return async () => {
    const lines = await readContainerLogLines(containerId, 60);
    const fresh = lines.filter((line) => {
      if (emitted.has(line)) return false;
      emitted.add(line);
      return true;
    });
    fresh.slice(-6).forEach((line) => {
      pushProgress(`${label}: ${line}`, phase);
    });
  };
};

const buildDockerHealthcheckConfig = (healthcheck, containerPort) => {
  const config = normalizeHealthcheckConfig(healthcheck);
  if (!config.enabled || !config.containerEnabled) return null;

  const target = String(config.target || '/').trim() || '/';
  const containerUrl = /^https?:\/\//i.test(target)
    ? target.replace(/\{host\}/g, '127.0.0.1').replace(/\{port\}/g, String(containerPort))
    : `http://127.0.0.1:${containerPort}${target.startsWith('/') ? target : `/${target}`}`;
  const command = `curl -fsS ${shellQuote(containerUrl)} >/dev/null || wget -qO- ${shellQuote(containerUrl)} >/dev/null || exit 1`;

  return {
    Test: ['CMD-SHELL', command],
    Interval: config.intervalSeconds * 1000 * 1000 * 1000,
    Timeout: config.timeoutSeconds * 1000 * 1000 * 1000,
    Retries: config.retries,
    StartPeriod: config.startPeriodSeconds * 1000 * 1000 * 1000
  };
};

const DEFAULT_NODE_SITE_MODE = 'service';
const DEFAULT_NODE_SITE_TYPE = 'common';
const DEFAULT_NODE_SITE_FOLDER = 'www';
const DEFAULT_NODE_FALLBACK_FILE = 'index.html';
const NODE_SITE_FOLDERS = new Set(['www', 'publish']);
const NODE_SITE_TYPES = new Set(['common', 'spa']);

const resolvePrimaryVolumeProjectPath = (volumes = []) => {
  const volume = volumes.find((entry) => entry?.hostPath && entry?.containerPath);
  if (!volume) return null;
  return {
    hostPath: volume.hostPath,
    containerPath: volume.containerPath
  };
};

const normalizeNodeSiteMode = (value) => (value === 'sites' ? 'sites' : DEFAULT_NODE_SITE_MODE);
const normalizeNodeSiteType = (value) => (NODE_SITE_TYPES.has(value) ? value : DEFAULT_NODE_SITE_TYPE);
const normalizeNodeSiteFolder = (value) => (NODE_SITE_FOLDERS.has(value) ? value : DEFAULT_NODE_SITE_FOLDER);

const normalizeFallbackFile = (value) => {
  const raw = String(value || DEFAULT_NODE_FALLBACK_FILE).trim().replace(/\\/g, '/');
  const normalized = path.posix.normalize(`/${raw}`).slice(1);
  if (!normalized || normalized.startsWith('..')) {
    return DEFAULT_NODE_FALLBACK_FILE;
  }
  return normalized;
};

const resolveNodeServiceConfig = (payload = {}, existingService = {}) => {
  const existingConfig = existingService.nodeSiteConfig || {};
  const incomingConfig = payload.nodeSiteConfig || {};
  const nodeServiceMode = normalizeNodeSiteMode(
    payload.nodeServiceMode ?? existingService.nodeServiceMode
  );

  return {
    nodeServiceMode,
    nodeSiteConfig: {
      siteType: normalizeNodeSiteType(incomingConfig.siteType ?? existingConfig.siteType),
      siteFolder: normalizeNodeSiteFolder(incomingConfig.siteFolder ?? existingConfig.siteFolder),
      fallbackFile: normalizeFallbackFile(
        incomingConfig.fallbackFile ?? existingConfig.fallbackFile
      )
    }
  };
};

const getNodeServiceProjectPath = (volumes = [], nodeServiceMode = DEFAULT_NODE_SITE_MODE) => {
  if (nodeServiceMode === 'sites') {
    return resolvePrimaryVolumeProjectPath(volumes);
  }
  return resolvePackageProjectPathFromVolume(volumes) || resolvePrimaryVolumeProjectPath(volumes);
};

const getEnvProjectPath = (volumes = [], projectPath = null) =>
  projectPath?.hostPath ? projectPath : resolvePrimaryVolumeProjectPath(volumes);

const getNodeSiteContentDir = (projectPath, nodeSiteConfig = {}) => {
  if (!projectPath?.hostPath) return null;
  return path.join(
    projectPath.hostPath,
    normalizeNodeSiteFolder(nodeSiteConfig.siteFolder)
  );
};

const buildNodeSitePackageJson = (serviceName) =>
  JSON.stringify(
    {
      name: `${String(serviceName || 'node-site')
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')}-site`,
      private: true,
      version: '1.0.0',
      scripts: {
        start: 'node server.js'
      },
      dependencies: {
        express: '^4.19.2'
      }
    },
    null,
    2
  ) + '\n';

const buildNodeSiteServerSource = (nodeSiteConfig = {}) => {
  const siteFolder = normalizeNodeSiteFolder(nodeSiteConfig.siteFolder);
  const siteType = normalizeNodeSiteType(nodeSiteConfig.siteType);
  const fallbackFile = normalizeFallbackFile(nodeSiteConfig.fallbackFile);

  return `'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || process.env.APP_PORT || 3000);
const siteDir = path.resolve(__dirname, ${JSON.stringify(siteFolder)});
const siteType = ${JSON.stringify(siteType)};
const fallbackFile = ${JSON.stringify(fallbackFile)};

const normalizePrefix = (value) => {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  const prefixed = raw.startsWith('/') ? raw : '/' + raw;
  return prefixed.replace(/\\/+$/, '');
};

const stripForwardedPrefix = (urlPath, prefix) => {
  if (!prefix) return urlPath;
  if (urlPath === prefix) return '/';
  if (urlPath.startsWith(prefix + '/')) {
    return urlPath.slice(prefix.length) || '/';
  }
  return urlPath;
};

const hasFileExtension = (requestPath) => {
  const base = path.posix.basename(String(requestPath || ''));
  return base.includes('.');
};

const sendSiteFile = (relativePath, res, next, notFoundStatus = 404) => {
  const targetPath = path.resolve(siteDir, relativePath);
  if (targetPath !== siteDir && !targetPath.startsWith(siteDir + path.sep)) {
    return res.status(400).send('Caminho inválido');
  }
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    if (typeof next === 'function') {
      return next();
    }
    return res.status(notFoundStatus).send('Arquivo não encontrado');
  }
  return res.sendFile(targetPath);
};

app.use((req, _res, next) => {
  console.log('[site]', req.method, req.url);
  next();
});

app.use((req, _res, next) => {
  const forwardedPrefix = normalizePrefix(req.headers['x-forwarded-prefix'] || process.env.SITE_BASE_PATH || '');
  if (forwardedPrefix) {
    req.url = stripForwardedPrefix(req.url, forwardedPrefix);
  }
  next();
});

app.use(express.static(siteDir, { index: false, fallthrough: true }));

app.get('/', (req, res, next) => sendSiteFile(fallbackFile, res, next));

if (siteType === 'spa') {
  app.get('*', (req, res, next) => {
    const requested = req.path.replace(/^\\/+/, '');
    if (requested && hasFileExtension(requested)) {
      return res.status(404).send('Arquivo não encontrado');
    }
    return sendSiteFile(fallbackFile, res, next, 404);
  });
} else {
  app.get('*', (req, res, next) => {
    const requested = req.path.replace(/^\\/+/, '');
    if (!requested) {
      return sendSiteFile(fallbackFile, res, next);
    }
    return sendSiteFile(requested, res, next);
  });

  app.use((_req, res) => {
    res.status(404).send('Arquivo não encontrado');
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log('Node site serving', siteDir, 'on port', port);
});
`;
};

const ensureNodeSiteScaffold = (projectPath, serviceName, nodeSiteConfig = {}, previousConfig = null) => {
  if (!projectPath?.hostPath) return;

  fs.mkdirSync(projectPath.hostPath, { recursive: true });

  const normalizedConfig = {
    siteType: normalizeNodeSiteType(nodeSiteConfig.siteType),
    siteFolder: normalizeNodeSiteFolder(nodeSiteConfig.siteFolder),
    fallbackFile: normalizeFallbackFile(nodeSiteConfig.fallbackFile)
  };

  const siteDir = getNodeSiteContentDir(projectPath, normalizedConfig);
  fs.mkdirSync(siteDir, { recursive: true });

  const previousFolder = previousConfig?.siteFolder
    ? normalizeNodeSiteFolder(previousConfig.siteFolder)
    : null;
  if (previousFolder && previousFolder !== normalizedConfig.siteFolder) {
    const previousDir = path.join(projectPath.hostPath, previousFolder);
    if (fs.existsSync(previousDir) && fs.statSync(previousDir).isDirectory()) {
      const targetEntries = fs.readdirSync(siteDir);
      if (!targetEntries.length) {
        fs.readdirSync(previousDir).forEach((entry) => {
          fs.renameSync(path.join(previousDir, entry), path.join(siteDir, entry));
        });
      }
    }
  }

  fs.writeFileSync(
    path.join(projectPath.hostPath, 'package.json'),
    buildNodeSitePackageJson(serviceName),
    'utf8'
  );
  fs.writeFileSync(
    path.join(projectPath.hostPath, 'server.js'),
    buildNodeSiteServerSource(normalizedConfig),
    'utf8'
  );

  const readmePath = path.join(projectPath.hostPath, 'README-provir-sites.txt');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      [
        'Servico Node.js configurado para servir site estatico.',
        `Pasta do site: ${normalizedConfig.siteFolder}`,
        `Tipo do site: ${normalizedConfig.siteType === 'spa' ? 'Angular/React/Vue (fallback SPA)' : 'Site comum'}`,
        `Arquivo padrao/fallback: ${normalizedConfig.fallbackFile}`,
        '',
        'Envie os arquivos do site para a pasta acima pelo painel.'
      ].join('\n'),
      'utf8'
    );
  }
};

const checkProjectFiles = (projectPath, files = []) => {
  if (!projectPath?.hostPath) return [];
  return files.filter((file) => !fs.existsSync(path.join(projectPath.hostPath, file)));
};

const findPathCaseInsensitive = (rootDir, relativePath) => {
  const parts = relativePath.split('/').filter(Boolean);
  let current = rootDir;
  const resolvedParts = [];
  for (const part of parts) {
    let entries = [];
    try {
      entries = fs.readdirSync(current);
    } catch (err) {
      return null;
    }
    const match = entries.find((entry) => entry.toLowerCase() === part.toLowerCase());
    if (!match) {
      return null;
    }
    resolvedParts.push(match);
    current = path.join(current, match);
  }
  return resolvedParts.join('/');
};

const appendServiceLog = (level, message) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  fs.appendFile(serviceLogsPath, `${JSON.stringify(entry)}\n`, () => {});
};

const normalizeCommand = (commandInput) => {
  if (!commandInput) return null;
  if (Array.isArray(commandInput)) {
    return commandInput.filter(Boolean);
  }
  if (typeof commandInput === 'string') {
    const trimmed = commandInput.trim();
    if (!trimmed) return null;
    return ['sh', '-c', trimmed];
  }
  return null;
};

const stringifyCommand = (command) => {
  if (!command) return '';
  return Array.isArray(command) ? command.join(' ') : String(command);
};

const isAutoProjectLaunchCommand = (command) => {
  const value = stringifyCommand(command);
  return (
    /\bjava\b[\s\S]*\s-jar\s+/.test(value) ||
    PROJECT_ENTRYPOINT_FILES.some((filename) => value.includes(filename))
  );
};

const normalizeCommandText = (command) =>
  stringifyCommand(command)
    .replace(/^sh\s+-c\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

const isAutoNodeLifecycleCommand = (command) => {
  let value = normalizeCommandText(command);
  if (!value) return false;
  value = value.replace(/^cd\s+[^&]+&&\s*/, '').trim();
  value = value.replace(/^NPM_CONFIG_PRODUCTION=false\s+/, '').trim();
  value = value.replace(/^NEXT_STATIC_PAGE_GENERATION_TIMEOUT=\d+\s+/, '').trim();
  value = value.replace(/--include=dev/g, '').replace(/\s+/g, ' ').trim();

  if (['npm start', 'npm run start', 'npm install && npm start', 'npm install && npm run start'].includes(value)) {
    return true;
  }
  if (/^npm (install|ci)\s*&&\s*npm run build\s*&&\s*npm (run )?start$/.test(value)) {
    return true;
  }
  if (/^npm (install|ci)\s*&&\s*npm run build\s*&&\s*next start\b/.test(value)) {
    return true;
  }
  if (/^npm (install|ci)\s*&&\s*npm run dev$/.test(value)) {
    return true;
  }
  if (/^npm (install|ci)\s*&&\s*node\s+/.test(value)) {
    return true;
  }
  return false;
};

const resolvePersistedProjectCommand = (service = {}, isNodeService = false) => {
  if (!service.command) return null;
  if (isAutoProjectLaunchCommand(service.command)) return null;
  if (isNodeService && isAutoNodeLifecycleCommand(service.command)) return null;
  return service.command;
};

const stripNextStartFlags = (command) => {
  if (!command) return command;
  const normalize = (value) =>
    value.replace(/\bnext start\b\s+-H\s+0\.0\.0\.0\s+-p\s+3000\b/g, 'next start');

  if (Array.isArray(command)) {
    if (command[0] === 'sh' && command[1] === '-c') {
      const cmd = command.slice(2).join(' ');
      const updated = normalize(cmd);
      if (updated === cmd) return command;
      return ['sh', '-c', updated];
    }
    const cmd = command.join(' ');
    const updated = normalize(cmd);
    if (updated === cmd) return command;
    return ['sh', '-c', updated];
  }
  if (typeof command === 'string') {
    return normalize(command);
  }
  return command;
};

const addNpmIncludeDev = (cmd) => {
  let updated = cmd;
  if (!updated.includes('--include=dev')) {
    updated = updated.replace(/\bnpm\s+ci\b/g, 'npm ci --include=dev');
    updated = updated.replace(/\bnpm\s+install\b/g, 'npm install --include=dev');
  }
  if (updated.includes('--omit=dev')) {
    updated = updated.replace(/--omit=dev/g, '--include=dev');
  }
  return updated;
};

const ensureNextBuildTimeout = (command, timeoutSeconds = 180) => {
  if (!command) return command;
  const prefix = `NEXT_STATIC_PAGE_GENERATION_TIMEOUT=${timeoutSeconds}`;
  const needsPrefix = (value) => {
    const hasNextBuild = value.includes('next build') || value.includes('npm run build');
    return hasNextBuild && !value.includes(prefix);
  };
  const wrapWithPrefix = (value) => (needsPrefix(value) ? `${prefix} ${value}` : value);

  if (Array.isArray(command)) {
    if (command[0] === 'sh' && command[1] === '-c') {
      const cmd = command.slice(2).join(' ');
      const updated = wrapWithPrefix(cmd);
      if (updated === cmd) return command;
      return ['sh', '-c', updated];
    }
    const cmd = command.join(' ');
    const updated = wrapWithPrefix(cmd);
    if (updated === cmd) return command;
    return ['sh', '-c', updated];
  }
  if (typeof command === 'string') {
    return wrapWithPrefix(command);
  }
  return command;
};

const ensureNextBuildEnv = (env = [], command, timeoutSeconds = 180) => {
  if (!command) return env;
  const cmd = stringifyCommand(command);
  if (!cmd.includes('next build') && !cmd.includes('npm run build')) {
    return env;
  }
  const key = 'NEXT_STATIC_PAGE_GENERATION_TIMEOUT';
  const hasKey = env.some((entry) => entry.startsWith(`${key}=`));
  if (hasKey) return env;
  return [...env, `${key}=${timeoutSeconds}`];
};

const ensureCommandWorkdir = (command, workdir) => {
  if (!command || !workdir) return command;
  if (Array.isArray(command)) {
    if (command[0] === 'sh' && command[1] === '-c') {
      const existing = command.slice(2).join(' ');
      const prefix = `cd ${workdir} && `;
      if (existing.startsWith(prefix)) {
        return command;
      }
      return ['sh', '-c', `${prefix}${existing}`];
    }
    const existing = command.join(' ');
    const prefix = `cd ${workdir} && `;
    if (existing.startsWith(prefix)) {
      return ['sh', '-c', existing];
    }
    return ['sh', '-c', `${prefix}${existing}`];
  }
  if (typeof command === 'string') {
    const prefix = `cd ${workdir} && `;
    if (command.startsWith(prefix)) {
      return command;
    }
    return `${prefix}${command}`;
  }
  return command;
};

const ensureNpmDevDependencies = (command) => {
  if (!command) return command;
  const prefix = 'NPM_CONFIG_PRODUCTION=false';
  const needsPrefix = (value) => {
    const hasInstall = value.includes('npm install') || value.includes('npm ci');
    const hasBuild = value.includes('npm run build') || value.includes('next build');
    return hasInstall && hasBuild && !value.includes(prefix);
  };
  if (Array.isArray(command)) {
    if (command[0] === 'sh' && command[1] === '-c') {
      const cmd = command.slice(2).join(' ');
      const updatedCmd = addNpmIncludeDev(cmd);
      if (!needsPrefix(cmd) && updatedCmd === cmd) return command;
      const finalCmd = needsPrefix(cmd) ? `${prefix} ${updatedCmd}` : updatedCmd;
      return ['sh', '-c', finalCmd];
    }
    const cmd = command.join(' ');
    const updatedCmd = addNpmIncludeDev(cmd);
    if (!needsPrefix(cmd) && updatedCmd === cmd) return command;
    const finalCmd = needsPrefix(cmd) ? `${prefix} ${updatedCmd}` : updatedCmd;
    return ['sh', '-c', finalCmd];
  }
  if (typeof command === 'string') {
    const updatedCmd = addNpmIncludeDev(command);
    if (!needsPrefix(command) && updatedCmd === command) return command;
    return needsPrefix(command) ? `${prefix} ${updatedCmd}` : updatedCmd;
  }
  return command;
};

// List saved services (containers + metadata)
router.get('/services', async (req, res, next) => {
  await sendServicesResponse(res, next);
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

router.post('/networks/ensure', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ message: 'Nome da rede obrigatorio' });
    }
    const network = await dockerManager.ensureNetwork(name);
    res.json({ network });
  } catch (err) {
    next(err);
  }
});

router.get('/registries', (req, res) => {
  const registries = readRegistries().map(sanitizeRegistry);
  res.json({ registries });
});

router.post('/registries', (req, res, next) => {
  try {
    const { name, serverAddress, username, password, certPem } = req.body || {};
    if (!name || !serverAddress) {
      return res.status(400).json({ message: 'Nome e endereco do repositorio sao obrigatorios' });
    }
    const registries = readRegistries();
    const id = crypto.randomUUID();
    const host = normalizeRegistryHost(serverAddress);
    const certPath = certPem ? persistRegistryCert(host, certPem) : null;
    const registry = {
      id,
      name,
      serverAddress: host,
      username: username || '',
      password: password || '',
      certPath
    };
    registries.push(registry);
    writeRegistries(registries);
    res.json({ registry: sanitizeRegistry(registry) });
  } catch (err) {
    next(err);
  }
});

router.put('/registries/:id', (req, res, next) => {
  try {
    const { name, serverAddress, username, password, certPem } = req.body || {};
    const registries = readRegistries();
    const idx = registries.findIndex((reg) => reg.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ message: 'Repositorio nao encontrado' });
    }
    const current = registries[idx];
    const host = serverAddress ? normalizeRegistryHost(serverAddress) : current.serverAddress;
    let certPath = current.certPath || null;
    if (certPem) {
      certPath = persistRegistryCert(host, certPem);
    }
    const updated = {
      ...current,
      name: name || current.name,
      serverAddress: host,
      username: username ?? current.username,
      password: password ?? current.password,
      certPath
    };
    registries[idx] = updated;
    writeRegistries(registries);
    res.json({ registry: sanitizeRegistry(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/registries/:id', (req, res, next) => {
  try {
    const registries = readRegistries();
    const nextRegistries = registries.filter((reg) => reg.id !== req.params.id);
    writeRegistries(nextRegistries);
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/images/pull', async (req, res, next) => {
  try {
    const { imageName, registryId, allowAny } = req.body || {};
    let authconfig = null;
    if (registryId) {
      const registries = readRegistries();
      const registry = registries.find((reg) => reg.id === registryId);
      if (!registry) {
        return res.status(404).json({ message: 'Repositorio nao encontrado' });
      }
      if (registry.username || registry.password) {
        authconfig = {
          username: registry.username || '',
          password: registry.password || '',
          serveraddress: registry.serverAddress
        };
      }
    }
    const result = await dockerManager.pullImage(imageName, null, {
      allowAny: Boolean(allowAny || registryId),
      authconfig
    });
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

const isSafeRelativePath = (value) => {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) return false;
  if (normalized.startsWith('/') || normalized.includes('..')) return false;
  return true;
};

const buildImageFromPayload = async (body = {}, file = null, progress = []) => {
  let tempDir = null;
  try {
    const imageName = String(body?.imageName || '').trim();
    const dockerfileContent = String(body?.dockerfileContent || '').trim();
    const dockerfilePathInput = String(body?.dockerfilePath || '').trim();
    const buildArgsRaw = String(body?.buildArgs || '').trim();
    const buildSessionId = String(body?.buildSessionId || '').trim();
    const replaceImageId = String(body?.replaceImageId || '').trim();

    if (!imageName) {
      throw createHttpError('imageName is required', 400);
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provir-build-'));
    pushBuildProgress(progress, buildSessionId, `📁 Contexto temporario criado: ${tempDir}`, 'prepare');

    if (file?.path) {
      pushBuildProgress(progress, buildSessionId, `📦 Extraindo arquivo ${file.originalname}...`, 'extract');
      await extractArchiveTo(file.path, tempDir, file.originalname);
    }

    let dockerfileName = 'Dockerfile';
    if (dockerfileContent) {
      if (dockerfilePathInput && !isSafeRelativePath(dockerfilePathInput)) {
        throw createHttpError('dockerfilePath inválido', 400);
      }
      dockerfileName = dockerfilePathInput || 'Dockerfile';
      const dockerfileFullPath = path.join(tempDir, dockerfileName);
      fs.mkdirSync(path.dirname(dockerfileFullPath), { recursive: true });
      fs.writeFileSync(dockerfileFullPath, dockerfileContent, 'utf8');
      pushBuildProgress(progress, buildSessionId, `📝 Dockerfile salvo em ${dockerfileName}`, 'prepare');
    } else if (dockerfilePathInput) {
      if (!isSafeRelativePath(dockerfilePathInput)) {
        throw createHttpError('dockerfilePath inválido', 400);
      }
      const dockerfileFullPath = path.join(tempDir, dockerfilePathInput);
      if (!fs.existsSync(dockerfileFullPath)) {
        throw createHttpError(`Dockerfile não encontrado no contexto: ${dockerfilePathInput}`, 400);
      }
      dockerfileName = dockerfilePathInput;
      pushBuildProgress(progress, buildSessionId, `📄 Usando Dockerfile existente: ${dockerfileName}`, 'prepare');
    } else {
      const defaultDockerfile = path.join(tempDir, 'Dockerfile');
      if (!fs.existsSync(defaultDockerfile)) {
        throw createHttpError('Envie dockerfileContent ou um contexto com arquivo Dockerfile', 400);
      }
      pushBuildProgress(progress, buildSessionId, '📄 Usando Dockerfile padrão do contexto', 'prepare');
    }

    let buildArgs = undefined;
    if (buildArgsRaw) {
      try {
        const parsed = JSON.parse(buildArgsRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          buildArgs = parsed;
        }
      } catch (err) {
        throw createHttpError('buildArgs deve ser um JSON válido', 400);
      }
    }

    pushBuildProgress(progress, buildSessionId, `🔨 Iniciando build da imagem ${imageName}...`, 'build');
    await dockerManager.buildImage(
      imageName,
      tempDir,
      (msg) => {
        pushBuildProgress(progress, buildSessionId, msg, 'build');
      },
      { dockerfileName, buildArgs }
    );
    if (replaceImageId) {
      try {
        const builtImage = await dockerManager.docker.getImage(imageName).inspect();
        if (builtImage?.Id && builtImage.Id !== replaceImageId) {
          await dockerManager.docker.getImage(replaceImageId).remove({ force: false });
          pushBuildProgress(progress, buildSessionId, `🧹 Imagem anterior removida: ${replaceImageId.slice(7, 19)}`, 'cleanup');
        }
      } catch (err) {
        pushBuildProgress(
          progress,
          buildSessionId,
          `⚠️ Imagem anterior mantida: ${err.message}`,
          'cleanup'
        );
      }
    }
    pushBuildProgress(progress, buildSessionId, `✅ Build finalizado: ${imageName}`, 'done');

    return { status: 'built', imageName, progress };
  } finally {
    if (file?.path) {
      fs.unlink(file.path, () => {});
    }
    if (tempDir) {
      fs.rm(tempDir, { recursive: true, force: true }, () => {});
    }
  }
};

router.post('/images/build', upload.single('contextArchive'), async (req, res, next) => {
  const progress = [];
  try {
    const result = await buildImageFromPayload(req.body, req.file, progress);
    return res.json(result);
  } catch (err) {
    progress.push(`❌ Falha no build: ${err.message}`);
    return res.status(err.status || 500).json({ message: err.message || 'Build failed', progress });
  }
});

router.post('/images/build/init', (req, res, next) => {
  try {
    const uploadId = crypto.randomUUID();
    const totalChunks = Number(req.body?.totalChunks || 0);
    if (!Number.isInteger(totalChunks) || totalChunks < 1) {
      return res.status(400).json({ message: 'totalChunks inválido' });
    }

    writeChunkMetadata(uploadId, {
      type: 'image-build',
      filename: safeUploadFilename(req.body?.filename, 'context.zip'),
      size: Number(req.body?.size || 0),
      totalChunks,
      imageName: String(req.body?.imageName || '').trim(),
      dockerfileContent: String(req.body?.dockerfileContent || ''),
      dockerfilePath: String(req.body?.dockerfilePath || ''),
      buildArgs: String(req.body?.buildArgs || ''),
      buildSessionId: String(req.body?.buildSessionId || ''),
      replaceImageId: String(req.body?.replaceImageId || ''),
      createdAt: new Date().toISOString()
    });

    res.json({ uploadId });
  } catch (err) {
    next(err);
  }
});

router.post('/images/build/chunk', upload.single('chunk'), (req, res, next) => {
  try {
    const metadata = persistChunkFile(req.body?.uploadId, req.body?.chunkIndex, req.file);
    if (metadata.type !== 'image-build') {
      return res.status(400).json({ message: 'Upload inválido para build de imagem' });
    }
    res.json({ ok: true, chunkIndex: Number(req.body?.chunkIndex) });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

router.post('/images/build/complete', async (req, res, next) => {
  const progress = [];
  const uploadId = req.body?.uploadId;
  try {
    const { metadata } = readChunkMetadata(uploadId);
    if (metadata.type !== 'image-build') {
      return res.status(400).json({ message: 'Upload inválido para build de imagem' });
    }
    const { archivePath, filename } = assembleChunkUpload(uploadId);
    const result = await buildImageFromPayload(
      {
        imageName: metadata.imageName,
        dockerfileContent: metadata.dockerfileContent,
        dockerfilePath: metadata.dockerfilePath,
        buildArgs: metadata.buildArgs,
        buildSessionId: metadata.buildSessionId,
        replaceImageId: metadata.replaceImageId
      },
      { path: archivePath, originalname: filename },
      progress
    );
    cleanupChunkUpload(uploadId);
    return res.json(result);
  } catch (err) {
    progress.push(`❌ Falha no build: ${err.message}`);
    if (uploadId) cleanupChunkUpload(uploadId);
    return res.status(err.status || 500).json({ message: err.message || 'Build failed', progress });
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
    const {
      templateId,
      name,
      hostPort,
      volumeMappings = [],
      envVars = [],
      createProject = false,
      createManager = false,
      configureDb = null,
      networkName = 'provirpanel',
      command,
      bindLocalOnly = true,
      healthcheck: requestedHealthcheck,
      autoRollback: requestedAutoRollback,
      nodeServiceMode: requestedNodeServiceMode,
      nodeSiteConfig: requestedNodeSiteConfig
    } = req.body || {};
    
    progress.push(`🔍 Validando configuração do serviço ${name}...`);
    
    // Validate service name only once at the beginning
    const existingServices = dockerManager.listServices();
    const nameError = validateServiceName(name, existingServices);
    if (nameError) {
      progress.push(`❌ Validação falhou: ${nameError}`);
      return res.status(400).json({ message: nameError, progress });
    }
    
    progress.push(`✅ Nome do serviço validado com sucesso`);
    
    let template = SERVICE_TEMPLATES.find((t) => t.id === templateId);
    const isCustomImage = templateId === 'custom-image';
    const customImageName = String(req.body?.imageName || '').trim();
    const customContainerPort = Number(req.body?.containerPort || 0);

    if (isCustomImage) {
      if (!customImageName) {
        progress.push('❌ imageName é obrigatório para template custom-image');
        return res.status(400).json({ message: 'imageName is required', progress });
      }
      template = {
        id: 'custom-image',
        label: 'Imagem customizada',
        image: customImageName,
        tag: '',
        defaultPort: customContainerPort > 0 ? customContainerPort : 8080,
        containerPort: customContainerPort > 0 ? customContainerPort : 8080,
        volumes: [],
        env: [],
        description: 'Container baseado em imagem customizada',
        hasProjectOption: false,
        hasManagerOption: false
      };
    }

    if (!template) {
      progress.push(`❌ Template ${templateId} não encontrado`);
      return res.status(400).json({ message: 'Template not found', progress });
    }

    const imageName = isCustomImage
      ? customImageName
      : `${template.image}:${template.tag}`;
    progress.push(`📦 Preparando container ${imageName}...`);
    
    const serviceId = crypto.randomUUID();
    const { nodeServiceMode, nodeSiteConfig } = resolveNodeServiceConfig(
      {
        nodeServiceMode: requestedNodeServiceMode,
        nodeSiteConfig: requestedNodeSiteConfig
      },
      {}
    );
    const resolvedHealthcheck = normalizeHealthcheckConfig(requestedHealthcheck || {});
    const resolvedAutoRollback = parseBooleanOption(requestedAutoRollback, true);
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

    const portBinding = bindLocalOnly
      ? { HostPort: String(resolvedPort), HostIp: '127.0.0.1' }
      : { HostPort: String(resolvedPort) };
    if (!['bridge', 'host', 'none'].includes(networkName)) {
      await dockerManager.ensureNetwork(networkName);
    }

    const hostConfig = {
      PortBindings: {
        [`${template.containerPort}/tcp`]: [portBinding]
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
          
          if (CONTAINER_VOLUME_PERMISSIONS[templateId]) {
            try {
              applyContainerVolumePermissions(templateId, m.hostPath, progress);
            } catch (err) {
              progress.push(`⚠️ Aviso: ${err.message}`);
            }
          }
        });
    } catch (err) {
      progress.push(`❌ Erro ao criar diretórios: ${err.message}`);
      throw err;
    }

    const normalizedEnvVars = normalizeEnvVars(envVars);
    const isNodeSitesMode = templateId === 'node-app' && nodeServiceMode === 'sites';

    if (isNodeSitesMode) {
      const projectRoot = resolvePrimaryVolumeProjectPath(finalizedVolumes);
      if (projectRoot?.hostPath) {
        ensureNodeSiteScaffold(projectRoot, name, nodeSiteConfig);
        progress.push(
          `🌐 Estrutura de site preparada em ${path.join(projectRoot.hostPath, nodeSiteConfig.siteFolder)}`
        );
      } else {
        progress.push('⚠️ Nao foi possivel preparar a estrutura base do site');
      }
    }

    const projectPath = getNodeServiceProjectPath(finalizedVolumes, nodeServiceMode);
    const envProjectPath = getEnvProjectPath(finalizedVolumes, projectPath);
    if (envProjectPath?.hostPath) {
      writeEnvFile(envProjectPath, normalizedEnvVars, template.env);
      progress.push(`📝 .env gerado em ${envProjectPath.hostPath}`);
    } else {
      progress.push('⚠️ Nao foi possivel resolver o diretorio do projeto para gerar .env');
    }
    let env = buildContainerEnv({
      templateEnv: template.env,
      explicitEnvVars: normalizedEnvVars,
      projectPath: envProjectPath
    });
    env = ensureExplicitContainerEnv(env, normalizedEnvVars);

    let finalImageName = imageName;
    const normalizedCommand = isNodeSitesMode ? null : normalizeCommand(command);
    const hasUserCommand = isNodeSitesMode ? false : !!normalizedCommand;
    let containerCmd = normalizedCommand || template.command;
    let containerUser = undefined;

    // Para projetos exemplo, criar arquivos no volume (exceto PostgreSQL)
    if (createProject && finalizedVolumes.length > 0 && templateId !== 'postgres-db' && !isNodeSitesMode) {
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
        if (templateId === 'node-app' && !normalizedCommand) {
          containerCmd = resolveNodeCommand(finalizedVolumes) || ['sh', '-c', 'npm install && npm start'];
        }
      } catch (err) {
        progress.push(`⚠️ Erro ao criar projeto exemplo: ${err.message}`);
      }
    } else if (isNodeSitesMode) {
      containerCmd = ['sh', '-c', 'npm install && npm start'];
    } else if (!createProject && templateId === 'node-app' && !normalizedCommand) {
      containerCmd = resolveNodeCommand(finalizedVolumes) || ['npm', 'start'];
    }
    if (!hasUserCommand) {
      containerCmd = stripNextStartFlags(containerCmd);
      containerCmd = ensureCommandWorkdir(containerCmd, projectPath?.containerPath || template.workdir);
      const createCmdBefore = stringifyCommand(containerCmd);
      containerCmd = ensureNpmDevDependencies(containerCmd);
      const createAfterDev = stringifyCommand(containerCmd);
      containerCmd = ensureNextBuildTimeout(containerCmd);
      const createCmdAfter = stringifyCommand(containerCmd);
      if (createAfterDev !== createCmdBefore) {
        progress.push('ℹ️ Forcando instalacao de dependencias de desenvolvimento para build');
      }
      if (createCmdAfter !== createAfterDev) {
        progress.push('ℹ️ Ajustando timeout do Next.js para build');
      }
      const envBefore = env;
      env = ensureNextBuildEnv(env, containerCmd);
      if (env !== envBefore) {
        progress.push('ℹ️ Variavel de ambiente de timeout do Next.js adicionada');
      }
    }

    const containerConfig = {
      name,
      Labels: buildServiceLabels({
        serviceId,
        name,
        templateId,
        hasProject:
          isNodeSitesMode ||
          (createProject && finalizedVolumes.length > 0 && templateId !== 'postgres-db')
      }),
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

    const dockerHealthcheck = buildDockerHealthcheckConfig(resolvedHealthcheck, template.containerPort);
    if (dockerHealthcheck) {
      containerConfig.Healthcheck = dockerHealthcheck;
    }

      if (containerCmd) {
        containerConfig.Cmd = containerCmd;
      }
    if (projectPath?.containerPath || template.workdir) {
      containerConfig.WorkingDir = projectPath?.containerPath || template.workdir;
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
      try {
        await waitForServiceHealth({
          serviceName: name,
          healthcheck: resolvedHealthcheck,
          hostPort: resolvedPort
        });
      } catch (err) {
        await stopAndRemoveContainer(container.Id, name);
        throw err;
      }
      
      const service = {
        id: serviceId,
        name,
        templateId,
        image: imageName,
        containerId: container.Id,
        hostPort: resolvedPort,
        containerPort: template.containerPort,
        volumes: finalizedVolumes,
        envVars: normalizedEnvVars,
        command: isNodeSitesMode ? null : containerCmd || null,
        networkName,
        bindLocalOnly,
        url: `http://localhost:${resolvedPort}`,
        serverIP: getLocalIP(),
        externalUrl: bindLocalOnly ? null : `http://${getLocalIP()}:${resolvedPort}`,
        healthcheck: resolvedHealthcheck,
        autoRollback: resolvedAutoRollback,
        createdAt: new Date().toISOString(),
        hasProject:
          isNodeSitesMode ||
          (createProject && finalizedVolumes.length > 0 && templateId !== 'postgres-db'),
        nodeServiceMode,
        nodeSiteConfig
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
        
        const pgAdminVolumePath = path.join(dockerBaseDir, `${name}-pgadmin`);
        fs.mkdirSync(pgAdminVolumePath, { recursive: true });
        try {
          applyContainerVolumePermissions('pgadmin', pgAdminVolumePath, progress);
        } catch (err) {
          progress.push(`⚠️ Aviso ao ajustar volume do pgAdmin: ${err.message}`);
        }

        const pgAdminPortBinding = bindLocalOnly
          ? { HostPort: String(pgAdminPort), HostIp: '127.0.0.1' }
          : { HostPort: String(pgAdminPort) };
        const pgAdminConfig = {
          name: `${name}-pgadmin`,
          Labels: buildServiceLabels({
            serviceId: crypto.randomUUID(),
            name: `${name}-pgadmin`,
            templateId: 'pgadmin',
            parentService: serviceId
          }),
          HostConfig: {
            NetworkMode: networkName,
            PortBindings: {
              '80/tcp': [pgAdminPortBinding]
            },
            Binds: [`${pgAdminVolumePath}:/var/lib/pgadmin`]
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
          volumes: [
            {
              hostPath: pgAdminVolumePath,
              containerPath: '/var/lib/pgadmin'
            }
          ],
          networkName,
          bindLocalOnly,
          url: `http://localhost:${pgAdminPort}`,
          serverIP: getLocalIP(),
          externalUrl: bindLocalOnly ? null : `http://${getLocalIP()}:${pgAdminPort}`,
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

      res.json({ service: sanitizeServiceForClient(service), managerService, container, progress, sessionId });
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



router.get("/containers/:id/logs", async (req, res, next) => {
  try {
    const tail = parseInt(req.query.tail) || 200;
    const container = dockerManager.docker.getContainer(req.params.id);
    const logData = await container.logs({ stdout: true, stderr: true, tail, timestamps: true });
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

router.post("/containers/:id/start", async (req, res, next) => {
  try {
    const container = dockerManager.docker.getContainer(req.params.id);
    await container.start();
    res.json({ status: "started" });
  } catch (err) {
    if (err.statusCode === 304) {
      return res.json({ status: "already running" });
    }
    next(err);
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
    const requestBody = req.body || {};
    const services = dockerManager.listServices();
    let service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    const applyConfig = parseBooleanOption(requestBody.apply, true);
    const configKeys = [
      'hostPort',
      'envVars',
      'networkName',
      'command',
      'bindLocalOnly',
      'healthcheck',
      'autoRollback',
      'nodeServiceMode',
      'nodeSiteConfig'
    ];
    const hasConfigPayload = configKeys.some((key) =>
      Object.prototype.hasOwnProperty.call(requestBody, key)
    );
    const pendingConfig =
      service.pendingConfig && typeof service.pendingConfig === 'object'
        ? service.pendingConfig
        : null;
    const configSource = applyConfig && !hasConfigPayload && pendingConfig
      ? pendingConfig
      : requestBody;
    const {
      hostPort,
      envVars = [],
      networkName,
      command,
      bindLocalOnly,
      healthcheck: requestedHealthcheck,
      autoRollback: requestedAutoRollback,
      nodeServiceMode: requestedNodeServiceMode,
      nodeSiteConfig: requestedNodeSiteConfig
    } = configSource || {};
    const { nodeServiceMode, nodeSiteConfig } = resolveNodeServiceConfig(
      {
        nodeServiceMode: requestedNodeServiceMode,
        nodeSiteConfig: requestedNodeSiteConfig
      },
      service
    );
    const isNodeSitesMode = service.templateId === 'node-app' && nodeServiceMode === 'sites';
    const isNodeServiceForConfig =
      service.templateId === 'node-app' ||
      service.templateId === 'node' ||
      String(service.image || '').startsWith('node');
    const resolvedHealthcheck = normalizeHealthcheckConfig(requestedHealthcheck || service.healthcheck);
    const resolvedAutoRollback = parseBooleanOption(requestedAutoRollback, service.autoRollback ?? true);
    const savedEnvVars = mergeEnvVars(
      Array.isArray(envVars) ? envVars : [],
      pendingConfig?.envVars || service.envVars || []
    );
    const savedPort = Number(hostPort) || service.hostPort;
    const savedBindLocal = bindLocalOnly ?? service.bindLocalOnly ?? false;
    const savedNetwork = networkName || service.networkName || 'provirpanel';
    const requestedSavedCommand = command ?? pendingConfig?.command ?? stringifyCommand(service.command);
    const savedCommand =
      isNodeSitesMode ||
      (isNodeServiceForConfig && isAutoNodeLifecycleCommand(normalizeCommand(requestedSavedCommand)))
        ? ''
        : requestedSavedCommand;

    if (!applyConfig) {
      const savedService = {
        ...service,
        pendingConfig: {
          hostPort: savedPort,
          envVars: savedEnvVars,
          networkName: savedNetwork,
          command: savedCommand,
          bindLocalOnly: savedBindLocal,
          healthcheck: resolvedHealthcheck,
          autoRollback: resolvedAutoRollback,
          nodeServiceMode,
          nodeSiteConfig,
          savedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      dockerManager.saveService(savedService);
      appendServiceLog('info', `Configuracao salva sem aplicar para ${service.name}`);
      return res.json({ service: sanitizeServiceForClient(savedService) });
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

    appendServiceLog('info', `Atualizacao de servico iniciada: ${service.name}`);
    if (normalizeEnvVars(envVars).length && !resolvePrimaryVolumeProjectPath(service.volumes)) {
      const volumeInfo = ensureServiceProjectVolume(service);
      service = volumeInfo.service;
      appendServiceLog('info', `Volume padrao garantido para .env de ${service.name}`);
    }

    // Stop current container
    if (service.containerId) {
      try {
        appendServiceLog('info', `Parando container atual ${service.containerId} (${service.name})`);
        await dockerManager.stopContainer(service.containerId);
        appendServiceLog('info', `Removendo container atual ${service.containerId} (${service.name})`);
        await dockerManager.removeContainer(service.containerId);
      } catch (err) {
        // Container might already be stopped/removed
      }
    }

    // Create new container with updated config
    const template =
      SERVICE_TEMPLATES.find((t) => t.id === service.templateId) ||
      { env: [], workdir: null, command: null };
    const previousNodeSiteConfig = service.nodeSiteConfig || null;
    const isNodeService = isNodeServiceForConfig;
    const isNginxStaticService =
      service.templateId === 'nginx-static' ||
      String(service.image || '').startsWith('nginx');
    const projectLaunch = resolveProjectAutoLaunch({
      service,
      isNodeService,
      isNginxStaticService,
      isNodeSitesMode
    });
    const persistedCommand = resolvePersistedProjectCommand(service, isNodeService);
    const canAutoProjectLaunch = Boolean(
      projectLaunch &&
        !persistedCommand &&
        (
          projectLaunch.type === 'project-entrypoint' ||
          service.autoCommandType ||
          service.templateId === 'custom-image' ||
          isJavaRuntimeService(service)
        )
    );
    const projectPath = canAutoProjectLaunch
      ? resolvePrimaryVolumeProjectPath(service.volumes)
      : getNodeServiceProjectPath(service.volumes, nodeServiceMode);
    if (isNodeSitesMode && projectPath?.hostPath) {
      ensureNodeSiteScaffold(projectPath, service.name, nodeSiteConfig, previousNodeSiteConfig);
      appendServiceLog(
        'info',
        `Estrutura de site preparada em ${path.join(projectPath.hostPath, nodeSiteConfig.siteFolder)}`
      );
    }
    const workdir = projectPath?.containerPath || template.workdir || null;
    if (projectPath?.hostPath) {
      appendServiceLog('info', `Projeto resolvido em ${projectPath.hostPath}`);
    } else {
      appendServiceLog('warn', `Nao foi possivel resolver o diretorio do projeto para ${service.name}`);
    }
    const resolvedPort = newPort || service.hostPort;
    const resolvedBindLocal = bindLocalOnly ?? service.bindLocalOnly ?? false;
    const targetNetwork = networkName || service.networkName || 'provirpanel';
    if (!['bridge', 'host', 'none'].includes(targetNetwork)) {
      await dockerManager.ensureNetwork(targetNetwork);
    }
    
    const resolvedEnvVars = savedEnvVars;
    const envProjectPath = getEnvProjectPath(service.volumes, projectPath);
    if (envProjectPath?.hostPath) {
      writeEnvFile(envProjectPath, resolvedEnvVars, template.env);
      appendServiceLog('info', `Arquivo .env atualizado em ${envProjectPath.hostPath}`);
    } else {
      appendServiceLog('warn', `Nao foi possivel resolver diretorio para arquivo .env de ${service.name}`);
    }
    if (projectPath?.hostPath) {
      if (isNodeService && !isNodeSitesMode) {
        const expectedFiles = [
          'package.json',
          'tsconfig.json',
          'app/v1/api/boleto/route.ts',
          'app/v1/api/pix/route.ts',
          'lib/db.ts'
        ];
        const missing = checkProjectFiles(projectPath, expectedFiles);
        if (missing.length) {
          appendServiceLog('warn', `Arquivos ausentes no projeto: ${missing.join(', ')}`);
          missing.forEach((file) => {
            const suggestion = findPathCaseInsensitive(projectPath.hostPath, file);
            if (suggestion) {
              appendServiceLog('warn', `Possivel diferenca de maiusculas: esperado ${file}, encontrado ${suggestion}`);
            }
          });
        }
      }
    }
    let env = buildContainerEnv({
      templateEnv: template.env,
      explicitEnvVars: resolvedEnvVars,
      projectPath: envProjectPath
    });
    env = ensureExplicitContainerEnv(env, resolvedEnvVars);
    appendServiceLog(
      'info',
      `Env do container atualizada para ${service.name}: ${resolvedEnvVars.map((entry) => entry.key).join(', ') || 'nenhuma'}`
    );

    const requestedCommand = normalizeCommand(command);
    const normalizedCommand =
      isNodeSitesMode ||
      (isNodeService && isAutoNodeLifecycleCommand(requestedCommand))
        ? null
        : requestedCommand;
    const hasUserCommand = isNodeSitesMode ? false : Boolean(normalizedCommand || persistedCommand);
    let autoProjectLaunch = null;
    let containerCmd = normalizedCommand || persistedCommand || template.command;
    if (isNodeSitesMode) {
      containerCmd = ['sh', '-c', 'npm install && npm start'];
    } else if (service.templateId === 'node-app' && !normalizedCommand && !persistedCommand) {
      containerCmd = resolveNodeCommand(service.volumes) || containerCmd;
    } else if (!normalizedCommand && !persistedCommand && canAutoProjectLaunch) {
      autoProjectLaunch = projectLaunch;
      containerCmd = projectLaunch.command;
      appendServiceLog(
        'info',
        projectLaunch.type === 'project-entrypoint'
          ? `Entrypoint do projeto detectado para ${service.name}: ${projectLaunch.containerPath}`
          : `JAR detectado para ${service.name}: ${projectLaunch.containerJarPath}`
      );
    }
    if (isNodeService && !hasUserCommand) {
      containerCmd = stripNextStartFlags(containerCmd);
      containerCmd = ensureCommandWorkdir(containerCmd, workdir);
      const updateCmdBefore = stringifyCommand(containerCmd);
      containerCmd = ensureNpmDevDependencies(containerCmd);
      const updateAfterDev = stringifyCommand(containerCmd);
      containerCmd = ensureNextBuildTimeout(containerCmd);
      const updateCmdAfter = stringifyCommand(containerCmd);
      if (updateAfterDev !== updateCmdBefore) {
        appendServiceLog('info', 'Forcando instalacao de dependencias de desenvolvimento para build');
      }
      if (updateCmdAfter !== updateAfterDev) {
        appendServiceLog('info', 'Ajustando timeout do Next.js para build');
      }
    }
    appendServiceLog(
      'info',
      `Comando definido para ${service.name}: ${stringifyCommand(containerCmd) || 'padrao'}`
    );
    if (autoProjectLaunch) {
      env = applyProjectRuntimeEnv(env, projectPath, autoProjectLaunch);
      appendServiceLog(
        'info',
        `Runtime do projeto definido para ${service.name}: ${autoProjectLaunch.containerPath}`
      );
    }
    if (workdir) {
      appendServiceLog('info', `WorkingDir para ${service.name}: ${workdir}`);
    } else {
      appendServiceLog('warn', `WorkingDir nao resolvido para ${service.name}`);
    }
    if (isNodeService && !hasUserCommand) {
      const envBeforeUpdate = env;
      env = ensureNextBuildEnv(env, containerCmd);
      if (env !== envBeforeUpdate) {
        appendServiceLog('info', 'Variavel de ambiente de timeout do Next.js adicionada');
      }
    }

    const containerConfig = {
      name: service.name,
      Labels: buildServiceLabels({
        serviceId: service.id,
        name: service.name,
        templateId: service.templateId,
        parentService: service.parentService,
        hasProject: isNodeSitesMode ? true : service.hasProject
      }),
      HostConfig: {
        NetworkMode: targetNetwork,
        PortBindings: {
          [`${service.containerPort}/tcp`]: [
            resolvedBindLocal
              ? { HostPort: String(resolvedPort), HostIp: '127.0.0.1' }
              : { HostPort: String(resolvedPort) }
          ]
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

    const dockerHealthcheck = buildDockerHealthcheckConfig(resolvedHealthcheck, service.containerPort);
    if (dockerHealthcheck) {
      containerConfig.Healthcheck = dockerHealthcheck;
    }

    if (autoProjectLaunch) {
      containerConfig.Entrypoint = ['sh', '-c'];
      containerConfig.Cmd = [autoProjectLaunch.commandText];
    } else if (containerCmd) {
      containerConfig.Cmd = containerCmd;
    }
    if (workdir) {
      containerConfig.WorkingDir = workdir;
    }

    // For Node.js with project, use npm install and start
    if ((service.hasProject || isNodeSitesMode) && service.templateId === 'node-app' && !containerCmd) {
      containerConfig.Cmd = ['sh', '-c', 'npm install && npm start'];
    }

    appendServiceLog('info', `Garantindo nome livre para ${service.name}`);
    await removeContainerByName(service.name);
    appendServiceLog('info', `Iniciando novo container para ${service.name}`);
    const container = await runContainerWithRetry(service.image, containerConfig, service.name);
    
    // Update service
    const updatedService = {
      ...service,
      containerId: container.Id,
      hostPort: resolvedPort,
      envVars: resolvedEnvVars,
      command: isNodeSitesMode || autoProjectLaunch ? null : containerCmd || null,
      autoCommandType: autoProjectLaunch ? autoProjectLaunch.type : null,
      networkName: targetNetwork,
      bindLocalOnly: resolvedBindLocal,
      pendingConfig: null,
      healthcheck: resolvedHealthcheck,
      autoRollback: resolvedAutoRollback,
      nodeServiceMode,
      nodeSiteConfig,
      hasProject: isNodeSitesMode ? true : service.hasProject,
      url: `http://localhost:${resolvedPort}`,
      serverIP: getLocalIP(),
      externalUrl: resolvedBindLocal ? null : `http://${getLocalIP()}:${resolvedPort}`,
      updatedAt: new Date().toISOString()
    };

    const activeDeployment = (updatedService.deployments || []).find(
      (deployment) => deployment.id === updatedService.activeDeploymentId
    );
    const persistedService = activeDeployment
      ? saveServiceDeploymentState(updatedService, {
          ...activeDeployment,
          envVars: resolvedEnvVars,
          command: updatedService.command,
          autoCommandType: updatedService.autoCommandType,
          healthcheck: resolvedHealthcheck,
          nodeServiceMode,
          nodeSiteConfig,
          status: 'active',
          promotedAt: new Date().toISOString()
        }, activeDeployment.id)
      : dockerManager.saveService(updatedService);
    appendServiceLog('info', `Atualizacao de servico concluida: ${service.name}`);
    res.json({ service: sanitizeServiceForClient(persistedService) });
  } catch (err) {
    appendServiceLog('error', `Erro ao atualizar servico ${req.params.id}: ${err.message}`);
    next(err);
  }
});

const inferProjectContainerPath = (template, service = {}) => {
  const templateVolume = template?.volumes?.find((volume) => volume?.containerPath);
  if (templateVolume?.containerPath) return templateVolume.containerPath;
  if (template?.workdir) return template.workdir;

  const image = String(service.image || template?.image || '').toLowerCase();
  if (image.includes('nginx')) return '/usr/share/nginx/html';
  if (image.includes('node')) return '/usr/src/app';
  return '/app';
};

const ensureServiceProjectVolume = (service) => {
  const volumes = Array.isArray(service.volumes) ? service.volumes : [];
  const existingVolume = volumes.find((m) => m?.hostPath && m?.containerPath);
  if (existingVolume) {
    return { service, projectDir: existingVolume.hostPath };
  }

  const template =
    SERVICE_TEMPLATES.find((t) => t.id === service.templateId) ||
    { volumes: [], workdir: null };
  const hostPath = path.join(dockerBaseDir, service.name);
  const containerPath = inferProjectContainerPath(template, service);
  const nextService = {
    ...service,
    volumes: [...volumes, { hostPath, containerPath }],
    hasProject: true,
    updatedAt: new Date().toISOString()
  };

  fs.mkdirSync(hostPath, { recursive: true });
  dockerManager.saveService(nextService);
  appendServiceLog(
    'info',
    `Volume local criado automaticamente para ${service.name}: ${hostPath}:${containerPath}`
  );
  return { service: nextService, projectDir: hostPath };
};

const sanitizePathSegment = (value, fallback = 'service') => {
  const safe = String(value || fallback).replace(/[^a-zA-Z0-9_.-]/g, '-');
  return safe.replace(/^-+|-+$/g, '') || fallback;
};

const getDeploymentRoot = (service) =>
  path.join(dockerBaseDir, '.versions', sanitizePathSegment(service.id || service.name));

const isPathInside = (candidate, root) => {
  if (!candidate || !root) return false;
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
};

const buildDeploymentDownloadFilename = (service, deployment) => {
  const versionPart =
    deployment.versionLabel ||
    deployment.label ||
    deployment.appVersion ||
    deployment.id ||
    'version';
  return `${sanitizePathSegment(service.name || 'service')}-${sanitizePathSegment(versionPart, 'version')}.tar.gz`;
};

const createDeploymentProjectDir = (service, deploymentId) => {
  const root = getDeploymentRoot(service);
  fs.mkdirSync(root, { recursive: true });
  const projectDir = path.join(root, sanitizePathSegment(deploymentId, crypto.randomUUID()));
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });
  return projectDir;
};

const replacePrimaryVolumeHostPath = (volumes = [], hostPath) => {
  let replaced = false;
  const next = (Array.isArray(volumes) ? volumes : []).map((volume) => {
    if (!replaced && volume?.hostPath && volume?.containerPath) {
      replaced = true;
      return { ...volume, hostPath };
    }
    return volume;
  });
  if (!replaced) {
    next.push({ hostPath, containerPath: '/app' });
  }
  return next;
};

const removeOldDeploymentDirs = (service, deployments = []) => {
  const keepDirs = new Set(deployments.map((deployment) => deployment.projectDir).filter(Boolean));
  const root = getDeploymentRoot(service);
  try {
    if (!fs.existsSync(root)) return;
    fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        const dir = path.join(root, entry.name);
        if (!keepDirs.has(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
  } catch (err) {
    appendServiceLog('warn', `Nao foi possivel limpar versoes antigas de ${service.name}: ${err.message}`);
  }
};

const mergeServiceDeployments = (service, deployment, activeDeploymentId) => {
  const byId = new Map(
    (Array.isArray(service.deployments) ? service.deployments : [])
      .filter((entry) => entry?.id)
      .map((entry) => [entry.id, entry])
  );
  if (deployment?.id) {
    byId.set(deployment.id, {
      ...byId.get(deployment.id),
      ...deployment
    });
  }

  const normalized = Array.from(byId.values())
    .filter((entry) => entry?.id)
    .map((entry) => ({
      ...entry,
      status:
        entry.status === 'failed'
          ? 'failed'
          : entry.id === activeDeploymentId
            ? 'active'
            : 'available'
    }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const keep = [];
  for (const entry of normalized) {
    if (entry.id === activeDeploymentId || keep.length < deploymentVersionLimit) {
      keep.push(entry);
    }
  }

  removeOldDeploymentDirs(service, keep);
  return keep;
};

const saveServiceDeploymentState = (service, deployment, activeDeploymentId = service.activeDeploymentId) => {
  const deployments = mergeServiceDeployments(service, deployment, activeDeploymentId);
  const nextService = {
    ...service,
    activeDeploymentId,
    deployments,
    updatedAt: new Date().toISOString()
  };
  dockerManager.saveService(nextService);
  return nextService;
};

const ensureActiveDeploymentRecord = (service) => {
  const projectPath = resolvePrimaryVolumeProjectPath(service.volumes);
  if (!projectPath?.hostPath) return service;
  const deployments = Array.isArray(service.deployments) ? service.deployments : [];
  const existing =
    deployments.find((deployment) => deployment.id === service.activeDeploymentId) ||
    deployments.find((deployment) => deployment.projectDir === projectPath.hostPath);

  if (existing) {
    return saveServiceDeploymentState(
      service,
      {
        ...existing,
        projectDir: existing.projectDir || projectPath.hostPath,
        status: 'active'
      },
      existing.id
    );
  }

  const now = new Date().toISOString();
  const deployment = {
    id: crypto.randomUUID(),
    label: 'Versao atual',
    filename: null,
    projectDir: projectPath.hostPath,
    envVars: service.envVars || [],
    command: service.command || null,
    autoCommandType: service.autoCommandType || null,
    nodeServiceMode: service.nodeServiceMode || DEFAULT_NODE_SITE_MODE,
    nodeSiteConfig: service.nodeSiteConfig || null,
    healthcheck: normalizeHealthcheckConfig(service.healthcheck),
    status: 'active',
    createdAt: service.updatedAt || service.createdAt || now,
    promotedAt: now
  };

  return saveServiceDeploymentState(service, deployment, deployment.id);
};

const stopAndRemoveContainer = async (containerId, serviceName) => {
  if (!containerId) return;
  try {
    appendServiceLog('info', `Parando container ${containerId} (${serviceName})`);
    await dockerManager.stopContainer(containerId);
  } catch (err) {
    // Container might already be stopped.
  }
  try {
    appendServiceLog('info', `Removendo container ${containerId} (${serviceName})`);
    await dockerManager.removeContainer(containerId);
  } catch (err) {
    // Container might already be removed.
  }
};

const ensureServiceNetwork = async (networkName) => {
  if (!networkName || ['bridge', 'host', 'none'].includes(networkName)) return;
  await dockerManager.ensureNetwork(networkName);
};

const buildServiceContainerConfig = ({
  service,
  name,
  env,
  containerCmd,
  autoProjectLaunch,
  workdir,
  hostPort,
  bindLocalOnly,
  networkName,
  volumes,
  healthcheck,
  hasProject,
  extraLabels = {}
}) => {
  const resolvedHealthcheck = normalizeHealthcheckConfig(healthcheck || service.healthcheck);
  const containerConfig = {
    name,
    Labels: {
      ...buildServiceLabels({
        serviceId: service.id,
        name: service.name,
        templateId: service.templateId,
        parentService: service.parentService,
        hasProject
      }),
      ...extraLabels
    },
    HostConfig: {
      NetworkMode: networkName,
      PortBindings: {
        [`${service.containerPort}/tcp`]: [
          bindLocalOnly
            ? { HostPort: String(hostPort), HostIp: '127.0.0.1' }
            : { HostPort: String(hostPort) }
        ]
      },
      Binds: (volumes || [])
        .filter((m) => m.hostPath && m.containerPath)
        .map((m) => `${m.hostPath}:${m.containerPath}`)
    },
    Env: env,
    ExposedPorts: {
      [`${service.containerPort}/tcp`]: {}
    }
  };

  const dockerHealthcheck = buildDockerHealthcheckConfig(resolvedHealthcheck, service.containerPort);
  if (dockerHealthcheck) {
    containerConfig.Healthcheck = dockerHealthcheck;
  }
  if (autoProjectLaunch) {
    containerConfig.Entrypoint = ['sh', '-c'];
    containerConfig.Cmd = [autoProjectLaunch.commandText];
  } else if (containerCmd) {
    containerConfig.Cmd = containerCmd;
  }
  if (workdir) {
    containerConfig.WorkingDir = workdir;
  }

  return containerConfig;
};

const prepareProjectRuntimeForDeploy = ({
  service,
  envVars = [],
  nodeServiceMode = DEFAULT_NODE_SITE_MODE,
  nodeSiteConfig = null
}) => {
  const template =
    SERVICE_TEMPLATES.find((t) => t.id === service.templateId) ||
    { env: [], workdir: null, command: null };
  const isNodeSitesMode = service.templateId === 'node-app' && nodeServiceMode === 'sites';
  const isNodeService =
    service.templateId === 'node-app' ||
    service.templateId === 'node' ||
    String(service.image || '').startsWith('node');
  const isNginxStaticService =
    service.templateId === 'nginx-static' ||
    String(service.image || '').startsWith('nginx');
  const projectLaunch = resolveProjectAutoLaunch({
    service,
    isNodeService,
    isNginxStaticService,
    isNodeSitesMode
  });
  const persistedCommand = resolvePersistedProjectCommand(service, isNodeService);
  const canAutoProjectLaunch = Boolean(
    projectLaunch &&
      !persistedCommand &&
      (
        projectLaunch.type === 'project-entrypoint' ||
        service.autoCommandType ||
        service.templateId === 'custom-image' ||
        isJavaRuntimeService(service)
      )
  );
  const projectPath = canAutoProjectLaunch
    ? resolvePrimaryVolumeProjectPath(service.volumes)
    : getNodeServiceProjectPath(service.volumes, nodeServiceMode);
  const workdir = projectPath?.containerPath || template.workdir || null;
  if (projectPath?.hostPath) {
    appendServiceLog('info', `Projeto resolvido em ${projectPath.hostPath}`);
  } else {
    appendServiceLog('warn', `Nao foi possivel resolver o diretorio do projeto para ${service.name}`);
  }

  const envProjectPath = getEnvProjectPath(service.volumes, projectPath);
  if (envProjectPath?.hostPath) {
    writeEnvFile(envProjectPath, envVars, template.env);
    appendServiceLog('info', `Arquivo .env atualizado em ${envProjectPath.hostPath}`);
  } else {
    appendServiceLog('warn', `Nao foi possivel resolver diretorio para arquivo .env de ${service.name}`);
  }

  if (projectPath?.hostPath && isNodeService && !isNodeSitesMode) {
    const expectedFiles = [
      'package.json',
      'tsconfig.json',
      'app/v1/api/boleto/route.ts',
      'app/v1/api/pix/route.ts',
      'lib/db.ts'
    ];
    const missing = checkProjectFiles(projectPath, expectedFiles);
    if (missing.length) {
      appendServiceLog('warn', `Arquivos ausentes no projeto: ${missing.join(', ')}`);
      missing.forEach((file) => {
        const suggestion = findPathCaseInsensitive(projectPath.hostPath, file);
        if (suggestion) {
          appendServiceLog('warn', `Possivel diferenca de maiusculas: esperado ${file}, encontrado ${suggestion}`);
        }
      });
    }
  }

  let env = buildContainerEnv({
    templateEnv: template.env,
    explicitEnvVars: envVars,
    projectPath: envProjectPath
  });
  env = ensureExplicitContainerEnv(env, envVars);
  appendServiceLog(
    'info',
    `Env do container atualizada para ${service.name}: ${envVars.map((entry) => entry.key).join(', ') || 'nenhuma'}`
  );

  const hasUserCommand = isNodeSitesMode ? false : !!persistedCommand;
  let autoProjectLaunch = null;
  let containerCmd = persistedCommand || template.command;
  if (isNodeSitesMode) {
    containerCmd = ['sh', '-c', 'npm install && npm start'];
  } else if (isNodeService && !persistedCommand) {
    containerCmd = resolveNodeCommand(service.volumes) || containerCmd;
  } else if (canAutoProjectLaunch) {
    autoProjectLaunch = projectLaunch;
    containerCmd = projectLaunch.command;
    appendServiceLog(
      'info',
      projectLaunch.type === 'project-entrypoint'
        ? `Entrypoint do projeto detectado para ${service.name}: ${projectLaunch.containerPath}`
        : `JAR detectado para ${service.name}: ${projectLaunch.containerJarPath}`
    );
  }
  if (isNodeService && !hasUserCommand) {
    containerCmd = ensureCommandWorkdir(containerCmd, workdir);
    const commandBeforeDev = stringifyCommand(containerCmd);
    containerCmd = ensureNpmDevDependencies(containerCmd);
    const commandAfterDev = stringifyCommand(containerCmd);
    containerCmd = ensureNextBuildTimeout(containerCmd);
    const commandAfterTimeout = stringifyCommand(containerCmd);
    if (commandAfterDev !== commandBeforeDev) {
      appendServiceLog('info', 'Forcando instalacao de dependencias de desenvolvimento para build');
    }
    if (commandAfterTimeout !== commandAfterDev) {
      appendServiceLog('info', 'Ajustando timeout do Next.js para build');
    }
  }
  appendServiceLog('info', `Comando detectado para ${service.name}: ${stringifyCommand(containerCmd) || 'padrao'}`);
  if (autoProjectLaunch) {
    env = applyProjectRuntimeEnv(env, projectPath, autoProjectLaunch);
    appendServiceLog(
      'info',
      `Runtime do projeto definido para ${service.name}: ${autoProjectLaunch.containerPath}`
    );
  }
  if (workdir) {
    appendServiceLog('info', `WorkingDir para ${service.name}: ${workdir}`);
  } else {
    appendServiceLog('warn', `WorkingDir nao resolvido para ${service.name}`);
  }
  if (isNodeService && !hasUserCommand) {
    const envBefore = env;
    env = ensureNextBuildEnv(env, containerCmd);
    if (env !== envBefore) {
      appendServiceLog('info', 'Variavel de ambiente de timeout do Next.js adicionada');
    }
  }

  return {
    template,
    env,
    projectPath,
    envProjectPath,
    containerCmd,
    autoProjectLaunch,
    workdir,
    command: isNodeSitesMode || autoProjectLaunch ? null : containerCmd || null,
    autoCommandType: autoProjectLaunch ? autoProjectLaunch.type : null,
    hasProject: true,
    isNodeSitesMode
  };
};

const startServiceContainerForDeployment = async ({
  service,
  runtime,
  name,
  hostPort,
  bindLocalOnly,
  networkName,
  healthcheck,
  extraLabels = {}
}) => {
  await ensureServiceNetwork(networkName);
  const containerConfig = buildServiceContainerConfig({
    service,
    name,
    env: runtime.env,
    containerCmd: runtime.containerCmd,
    autoProjectLaunch: runtime.autoProjectLaunch,
    workdir: runtime.workdir,
    hostPort,
    bindLocalOnly,
    networkName,
    volumes: service.volumes,
    healthcheck,
    hasProject: true,
    extraLabels
  });
  await removeContainerByName(name);
  return runContainerWithRetry(service.image, containerConfig, name);
};

const describeRuntimeStartStep = (service = {}, runtime = {}, stageLabel = 'versão') => {
  const commandText = stringifyCommand(runtime.containerCmd).toLowerCase();
  const isNodeService =
    service.templateId === 'node-app' ||
    service.templateId === 'node' ||
    String(service.image || '').startsWith('node');
  if (isNodeService && /npm\s+(install|ci)|npm run build|yarn install|pnpm install|pnpm run build/.test(commandText)) {
    return {
      phase: 'compile',
      message: `Instalando dependências e compilando a ${stageLabel} dentro do container...`
    };
  }
  if (isJavaRuntimeService(service) || commandText.includes('java ') || commandText.includes('-jar')) {
    return {
      phase: 'compile',
      message: `Iniciando runtime Java da ${stageLabel}...`
    };
  }
  return {
    phase: 'candidate',
    message: 'Container iniciado; aguardando aplicação responder...'
  };
};

const rollbackToPreviousDeployment = async ({
  service,
  previousDeployment,
  healthcheck,
  networkName,
  bindLocalOnly,
  pushProgress = () => {}
}) => {
  if (!previousDeployment?.projectDir) return null;
  appendServiceLog('warn', `Rollback automatico para ${service.name}: ${previousDeployment.label || previousDeployment.id}`);
  pushProgress(`Rollback automático iniciado para ${previousDeployment.label || previousDeployment.id}`, 'rollback');
  const rollbackService = {
    ...service,
    volumes: replacePrimaryVolumeHostPath(service.volumes, previousDeployment.projectDir),
    command: previousDeployment.command || null,
    autoCommandType: previousDeployment.autoCommandType || null
  };
  const rollbackRuntime = prepareProjectRuntimeForDeploy({
    service: rollbackService,
    envVars: previousDeployment.envVars || service.envVars || [],
    nodeServiceMode: previousDeployment.nodeServiceMode || service.nodeServiceMode || DEFAULT_NODE_SITE_MODE,
    nodeSiteConfig: previousDeployment.nodeSiteConfig || service.nodeSiteConfig || null
  });
  const rollbackContainer = await startServiceContainerForDeployment({
    service: rollbackService,
    runtime: rollbackRuntime,
    name: service.name,
    hostPort: service.hostPort,
    bindLocalOnly,
    networkName,
    healthcheck
  });
  pushProgress('Container anterior recriado, validando saúde...', 'rollback');
  await waitForServiceHealth({
    serviceName: service.name,
    healthcheck,
    hostPort: service.hostPort,
    onProgress: (message) => pushProgress(message, 'healthcheck')
  });
  pushProgress('Rollback automático concluído.', 'rollback');

  const rolledBack = {
    ...rollbackService,
    containerId: rollbackContainer.Id,
    envVars: previousDeployment.envVars || service.envVars || [],
    command: rollbackRuntime.command,
    autoCommandType: rollbackRuntime.autoCommandType,
    healthcheck,
    hasProject: true,
    updatedAt: new Date().toISOString()
  };
  return saveServiceDeploymentState(rolledBack, {
    ...previousDeployment,
    status: 'active',
    promotedAt: new Date().toISOString()
  }, previousDeployment.id);
};

const promoteProjectDeployment = async ({
  service,
  deployment,
  envVars,
  nodeServiceMode,
  nodeSiteConfig,
  healthcheck,
  autoRollback,
  pushProgress = () => {}
}) => {
  const networkName = service.networkName || 'bridge';
  const bindLocalOnly = service.bindLocalOnly ?? false;
  pushProgress('Reservando porta temporária para validar a nova versão...', 'prepare');
  const candidatePort = await dockerManager.findAvailablePort(
    Math.min(65000, Math.max(Number(service.hostPort || service.containerPort || 8080) + 1, 1024))
  );
  if (!candidatePort) {
    throw createHttpError('Nao foi possivel reservar porta temporaria para healthcheck.', 500);
  }

  const previousDeployment = (service.deployments || []).find(
    (entry) => entry.id === service.activeDeploymentId
  );
  const versionVolumes = replacePrimaryVolumeHostPath(service.volumes, deployment.projectDir);
  const candidateService = {
    ...service,
    volumes: versionVolumes,
    healthcheck
  };
  pushProgress('Preparando comando, variáveis e volume da versão candidata...', 'prepare');
  const candidateRuntime = prepareProjectRuntimeForDeploy({
    service: candidateService,
    envVars,
    nodeServiceMode,
    nodeSiteConfig
  });
  pushProgress(`Comando candidato: ${stringifyCommand(candidateRuntime.containerCmd) || 'padrão da imagem'}`, 'prepare');
  const candidateName = `${sanitizePathSegment(service.name)}-candidate-${deployment.id.slice(0, 8)}`;
  let candidateContainer = null;

  try {
    appendServiceLog(
      'info',
      `Iniciando versao candidata ${deployment.id} de ${service.name} na porta ${candidatePort}`
    );
    pushProgress(`Subindo versão candidata em porta temporária ${candidatePort}...`, 'candidate');
    candidateContainer = await startServiceContainerForDeployment({
      service: candidateService,
      runtime: candidateRuntime,
      name: candidateName,
      hostPort: candidatePort,
      bindLocalOnly: true,
      networkName,
      healthcheck,
      extraLabels: {
        'provirpanel.deployment.candidate': 'true',
        'provirpanel.deployment.id': deployment.id
      }
    });
    const candidateStartStep = describeRuntimeStartStep(candidateService, candidateRuntime, 'versão candidata');
    pushProgress(candidateStartStep.message, candidateStartStep.phase);
    const emitCandidateLogs = createDeploymentLogEmitter({
      containerId: candidateContainer?.Id,
      pushProgress,
      phase: candidateStartStep.phase,
      label: 'Logs candidato'
    });
    await emitCandidateLogs();
    pushProgress('Executando healthcheck na versão candidata...', 'healthcheck');
    await waitForServiceHealth({
      serviceName: `${service.name} candidato`,
      healthcheck,
      hostPort: candidatePort,
      onProgress: (message) => pushProgress(message, 'healthcheck'),
      onAttemptFailure: emitCandidateLogs
    });
    pushProgress('Versão candidata aprovada no healthcheck.', 'healthcheck');
  } catch (err) {
    await stopAndRemoveContainer(candidateContainer?.Id, candidateName);
    saveServiceDeploymentState(service, {
      ...deployment,
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: err.message
    }, service.activeDeploymentId);
    appendServiceLog('error', `Versao candidata rejeitada para ${service.name}: ${err.message}`);
    pushProgress(`Versão candidata falhou: ${err.message}`, 'error');
    throw err;
  }

  pushProgress('Removendo container temporário da validação...', 'cleanup');
  await stopAndRemoveContainer(candidateContainer?.Id, candidateName);

  const finalRuntime = prepareProjectRuntimeForDeploy({
    service: candidateService,
    envVars,
    nodeServiceMode,
    nodeSiteConfig
  });
  pushProgress(`Comando definitivo: ${stringifyCommand(finalRuntime.containerCmd) || 'padrão da imagem'}`, 'promote');
  const previousContainerId = service.containerId;
  pushProgress('Parando a versão atual para promover a nova versão...', 'promote');
  await stopAndRemoveContainer(previousContainerId, service.name);
  await removeContainerByName(service.name);

  let finalContainer = null;
  try {
    appendServiceLog('info', `Promovendo versao ${deployment.id} para ${service.name}`);
    pushProgress('Iniciando container definitivo com a nova versão...', 'promote');
    finalContainer = await startServiceContainerForDeployment({
      service: candidateService,
      runtime: finalRuntime,
      name: service.name,
      hostPort: service.hostPort,
      bindLocalOnly,
      networkName,
      healthcheck,
      extraLabels: {
        'provirpanel.deployment.id': deployment.id
      }
    });
    const finalStartStep = describeRuntimeStartStep(candidateService, finalRuntime, 'versão definitiva');
    const finalStartPhase = finalStartStep.phase === 'candidate' ? 'promote' : finalStartStep.phase;
    pushProgress(finalStartStep.message, finalStartPhase);
    const emitFinalLogs = createDeploymentLogEmitter({
      containerId: finalContainer?.Id,
      pushProgress,
      phase: finalStartPhase,
      label: 'Logs definitivo'
    });
    await emitFinalLogs();
    pushProgress('Executando healthcheck final na porta pública...', 'healthcheck');
    await waitForServiceHealth({
      serviceName: service.name,
      healthcheck,
      hostPort: service.hostPort,
      onProgress: (message) => pushProgress(message, 'healthcheck'),
      onAttemptFailure: emitFinalLogs
    });
    pushProgress('Healthcheck final aprovado.', 'healthcheck');
  } catch (err) {
    await stopAndRemoveContainer(finalContainer?.Id, service.name);
    saveServiceDeploymentState(service, {
      ...deployment,
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: err.message
    }, service.activeDeploymentId);
    pushProgress(`Falha ao promover versão: ${err.message}`, 'error');

    if (autoRollback && previousDeployment?.projectDir) {
      const rolledBack = await rollbackToPreviousDeployment({
        service,
        previousDeployment,
        healthcheck,
        networkName,
        bindLocalOnly,
        pushProgress
      });
      if (rolledBack) {
        throw createHttpError(
          `Nova versao falhou e o rollback automatico foi executado: ${err.message}`,
          502
        );
      }
    }
    throw err;
  }

  const promotedDeployment = {
    ...deployment,
    envVars,
    command: finalRuntime.command,
    autoCommandType: finalRuntime.autoCommandType,
    nodeServiceMode,
    nodeSiteConfig,
    healthcheck,
    status: 'active',
    containerId: finalContainer.Id,
    promotedAt: new Date().toISOString()
  };
  const updatedService = {
    ...candidateService,
    containerId: finalContainer.Id,
    envVars,
    command: finalRuntime.command,
    autoCommandType: finalRuntime.autoCommandType,
    hasProject: true,
    healthcheck,
    autoRollback,
    nodeServiceMode,
    nodeSiteConfig,
    url: `http://localhost:${service.hostPort}`,
    serverIP: getLocalIP(),
    externalUrl: bindLocalOnly ? null : `http://${getLocalIP()}:${service.hostPort}`,
    updatedAt: new Date().toISOString()
  };

  appendServiceLog('info', `Versao ${deployment.id} publicada para ${service.name}`);
  pushProgress('Versão publicada e estado salvo no painel.', 'done');
  return saveServiceDeploymentState(updatedService, promotedDeployment, deployment.id);
};

const publishProjectArchive = async (serviceId, file, options = {}) => {
  const progress = Array.isArray(options.progress) ? options.progress : [];
  const progressSessionId = String(options.progressSessionId || '').trim();
  const progressJobId = String(options.progressJobId || '').trim();
  const pushProgress = (message, phase, extra = {}) => {
    const payload = {
      ...(progressJobId ? { jobId: progressJobId } : {}),
      ...extra
    };
    if (typeof options.onProgressEvent === 'function') {
      options.onProgressEvent({
        message,
        phase,
        progressPercent: Object.prototype.hasOwnProperty.call(payload, 'progressPercent')
          ? payload.progressPercent
          : PROJECT_DEPLOY_PHASE_PROGRESS[phase] ?? 50,
        ...payload
      });
    }
    pushDeploymentProgress(progress, progressSessionId, message, phase, payload);
  };
  const services = dockerManager.listServices();
  let service = services.find((s) => s.id === serviceId);
  if (!service) {
    throw createHttpError('Service not found', 404);
  }
  if (!file?.path) {
    throw createHttpError('Nenhum arquivo enviado.', 400);
  }

  appendServiceLog('info', `Atualizacao de projeto iniciada: ${service.name}`);
  pushProgress(`Iniciando publicação de ${service.name}...`, 'prepare');

  const volumeInfo = ensureServiceProjectVolume(service);
  service = ensureActiveDeploymentRecord(volumeInfo.service);
  pushProgress('Volume do projeto localizado e versão atual registrada.', 'prepare');

  const { nodeServiceMode, nodeSiteConfig } = resolveNodeServiceConfig(
    {
      nodeServiceMode: options.nodeServiceMode,
      nodeSiteConfig: options.nodeSiteConfig
    },
    service
  );
  const isNodeSitesMode = service.templateId === 'node-app' && nodeServiceMode === 'sites';
  if (service.templateId === 'node-app') {
    pushProgress(
      isNodeSitesMode
        ? `Modo Node Sites: publicando arquivos buildados em ${nodeSiteConfig.siteFolder}.`
        : 'Modo Node Serviço: publicando fonte completo para instalar, buildar e iniciar.',
      'prepare'
    );
  }
  const healthcheck = normalizeHealthcheckConfig(options.healthcheck || service.healthcheck);
  const autoRollback = parseBooleanOption(options.autoRollback, service.autoRollback ?? true);
  const deploymentId = crypto.randomUUID();
  const projectDir = createDeploymentProjectDir(service, deploymentId);
  const versionVolumes = replacePrimaryVolumeHostPath(service.volumes, projectDir);
  const uploadTargetDir = isNodeSitesMode
    ? path.join(projectDir, normalizeNodeSiteFolder(nodeSiteConfig.siteFolder))
    : projectDir;
  pushProgress(`Diretório da nova versão criado: ${path.basename(projectDir)}`, 'prepare');

  fs.mkdirSync(projectDir, { recursive: true });
  if (isNodeSitesMode) {
    ensureNodeSiteScaffold(
      { hostPath: projectDir, containerPath: versionVolumes?.[0]?.containerPath || '/usr/src/app' },
      service.name,
      nodeSiteConfig,
      service.nodeSiteConfig
    );
    fs.mkdirSync(uploadTargetDir, { recursive: true });
    pushProgress(`Estrutura Node Sites preparada em ${nodeSiteConfig.siteFolder}.`, 'prepare');
  }

  cleanDirectory(uploadTargetDir);
  const archivePath = file.path;
  try {
    appendServiceLog('info', `Extraindo arquivo ${file.originalname} em ${uploadTargetDir}`);
    pushProgress(`Extraindo ${file.originalname || 'arquivo enviado'}...`, 'extract');
    await extractArchiveTo(archivePath, uploadTargetDir, file.originalname);
    pushProgress('Arquivo extraído com sucesso.', 'extract');
  } finally {
    fs.unlink(archivePath, () => {});
  }

  const isNginxStaticService =
    service.templateId === 'nginx-static' ||
    String(service.image || '').startsWith('nginx');
  if (isNginxStaticService) {
    const normalized = normalizeStaticSiteRoot(projectDir);
    if (!normalized) {
      appendServiceLog('error', `Upload sem index.html para serviço estático ${service.name}`);
      pushProgress('Falha: index.html não encontrado para site estático.', 'error');
      throw createHttpError(
        'Arquivo inválido para site estático: index.html não encontrado no .zip/.tar.',
        400
      );
    }
    pushProgress('Raiz do site estático normalizada.', 'prepare');
  }
  if (isNodeSitesMode) {
    const normalized = normalizeStaticSiteRoot(
      uploadTargetDir,
      normalizeFallbackFile(nodeSiteConfig.fallbackFile)
    );
    if (!normalized) {
      appendServiceLog(
        'warn',
        `Upload do site ${service.name} sem arquivo fallback ${nodeSiteConfig.fallbackFile} na raiz`
      );
      pushProgress(`Aviso: fallback ${nodeSiteConfig.fallbackFile} não encontrado na raiz.`, 'prepare');
    } else {
      pushProgress(`Fallback ${nodeSiteConfig.fallbackFile} encontrado.`, 'prepare');
    }
  }

  const resolvedEnvVars = Array.isArray(options.envVars)
    ? mergeEnvVars(options.envVars, service.envVars || [])
    : service.envVars || [];
  pushProgress(`Variáveis de ambiente preparadas: ${resolvedEnvVars.map((entry) => entry.key).join(', ') || 'nenhuma'}.`, 'prepare');
  const versionMetadata = buildDeploymentVersionMetadata(
    options.versionMetadata,
    service.deployments || []
  );
  pushProgress(`Versão registrada como ${versionMetadata.label}.`, 'prepare');
  const deployment = {
    id: deploymentId,
    label: versionMetadata.label,
    filename: safeUploadFilename(file.originalname || 'project.zip', 'project.zip'),
    appVersion: versionMetadata.appVersion,
    buildNumber: versionMetadata.buildNumber,
    changeType: versionMetadata.changeType,
    versionMode: versionMetadata.mode,
    versionLabel: versionMetadata.label,
    versionMetadata,
    projectDir,
    envVars: resolvedEnvVars,
    healthcheck,
    autoRollback,
    nodeServiceMode,
    nodeSiteConfig,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  const updatedService = await promoteProjectDeployment({
    service,
    deployment,
    envVars: resolvedEnvVars,
    nodeServiceMode,
    nodeSiteConfig,
    healthcheck,
    autoRollback,
    pushProgress
  });

  appendServiceLog('info', `Atualizacao de projeto concluida: ${service.name}`);
  pushProgress('Publicação concluída.', 'done', {
    service: sanitizeServiceForClient(updatedService)
  });
  return updatedService;
};

const startProjectPublishJob = ({
  serviceId,
  file = null,
  fileFactory = null,
  options = {},
  cleanup = null
}) => {
  const jobId = crypto.randomUUID();
  const progress = Array.isArray(options.progress) ? options.progress : [];
  const progressSessionId = String(options.progressSessionId || '').trim();
  const job = {
    id: jobId,
    serviceId,
    status: 'queued',
    phase: 'prepare',
    progressPercent: PROJECT_DEPLOY_PHASE_PROGRESS.prepare,
    message: 'Publicação recebida. Processamento iniciado em segundo plano.',
    progress,
    progressSessionId,
    createdAt: new Date().toISOString()
  };
  projectDeployJobs.set(jobId, job);

  const updateJob = (patch = {}) => {
    const current = projectDeployJobs.get(jobId) || job;
    const next = {
      ...current,
      ...patch,
      progress
    };
    projectDeployJobs.set(jobId, next);
    return next;
  };

  pushDeploymentProgress(progress, progressSessionId, job.message, 'prepare', { jobId });

  setImmediate(async () => {
    updateJob({
      status: 'processing',
      phase: 'process',
      progressPercent: PROJECT_DEPLOY_PHASE_PROGRESS.process,
      message: 'Processando publicação no servidor.',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    pushDeploymentProgress(progress, progressSessionId, 'Processando publicação no servidor...', 'process', { jobId });

    try {
      const publishFile = typeof fileFactory === 'function' ? fileFactory(jobId) : file;
      const updatedService = await publishProjectArchive(serviceId, publishFile, {
        ...options,
        progress,
        progressSessionId,
        progressJobId: jobId,
        onProgressEvent: (event = {}) => {
          updateJob({
            status: event.phase === 'done' ? 'success' : event.phase === 'error' ? 'error' : 'processing',
            phase: event.phase || 'process',
            progressPercent: event.progressPercent ?? PROJECT_DEPLOY_PHASE_PROGRESS[event.phase] ?? 50,
            message: event.message || '',
            error: event.error || null,
            service: event.service || projectDeployJobs.get(jobId)?.service || null,
            updatedAt: new Date().toISOString()
          });
        }
      });
      updateJob({
        status: 'success',
        phase: 'done',
        progressPercent: PROJECT_DEPLOY_PHASE_PROGRESS.done,
        message: 'Publicação concluída.',
        service: updatedService,
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      });
    } catch (err) {
      const message = err?.message || 'Erro ao publicar projeto';
      updateJob({
        status: 'error',
        phase: 'error',
        progressPercent: PROJECT_DEPLOY_PHASE_PROGRESS.error,
        message,
        error: message,
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      });
      appendServiceLog('error', `Erro no job de publicacao ${jobId}: ${message}`);
      pushDeploymentProgress(progress, progressSessionId, `Falha na publicação: ${message}`, 'error', {
        jobId,
        error: message
      });
    } finally {
      if (typeof cleanup === 'function') {
        try {
          cleanup();
        } catch (cleanupErr) {
          appendServiceLog('warn', `Falha ao limpar job ${jobId}: ${cleanupErr.message}`);
        }
      }
      setTimeout(() => {
        projectDeployJobs.delete(jobId);
      }, 30 * 60 * 1000);
    }
  });

  return job;
};

router.post('/services/:id/project-upload', upload.single('archive'), async (req, res, next) => {
  const progress = [];
  try {
    const services = dockerManager.listServices();
    const service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    if (!req.file?.path) {
      throw createHttpError('Nenhum arquivo enviado.', 400);
    }
    const progressSessionId = String(req.body?.progressSessionId || '');
    const job = startProjectPublishJob({
      serviceId: req.params.id,
      file: req.file,
      options: {
        envVars: parseEnvVarsPayload(req.body?.envVars),
        healthcheck: parseHealthcheckPayload(req.body?.healthcheck),
        autoRollback: req.body?.autoRollback,
        versionMetadata: parseVersionMetadataPayload(req.body?.versionMetadata),
        nodeServiceMode: req.body?.nodeServiceMode,
        nodeSiteConfig: parseJsonObjectPayload(req.body?.nodeSiteConfig, 'nodeSiteConfig'),
        progressSessionId,
        progress
      },
      cleanup: () => {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
      }
    });
    res.status(202).json({
      accepted: true,
      message: 'Arquivo recebido. Publicação em segundo plano iniciada.',
      jobId: job.id,
      job: sanitizeProjectDeployJob(job),
      progress
    });
  } catch (err) {
    appendServiceLog('error', `Erro ao iniciar atualizacao de projeto ${req.params.id}: ${err.message}`);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    sendProgressError(res, err, progress);
  }
});

router.get('/services/:id/project-upload/jobs/:jobId', (req, res) => {
  const job = projectDeployJobs.get(req.params.jobId);
  if (!job || job.serviceId !== req.params.id) {
    return res.status(404).json({ message: 'Job de publicação não encontrado' });
  }
  return res.json({ job: sanitizeProjectDeployJob(job) });
});

router.post('/services/:id/project-upload/init', (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    const service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    const uploadId = crypto.randomUUID();
    const totalChunks = Number(req.body?.totalChunks || 0);
    if (!Number.isInteger(totalChunks) || totalChunks < 1) {
      return res.status(400).json({ message: 'totalChunks inválido' });
    }

    writeChunkMetadata(uploadId, {
      type: 'project-upload',
      serviceId: req.params.id,
      filename: safeUploadFilename(req.body?.filename, 'project.zip'),
      size: Number(req.body?.size || 0),
      envVars: parseEnvVarsPayload(req.body?.envVars),
      healthcheck: parseHealthcheckPayload(req.body?.healthcheck),
      autoRollback: req.body?.autoRollback,
      versionMetadata: parseVersionMetadataPayload(req.body?.versionMetadata),
      nodeServiceMode: req.body?.nodeServiceMode,
      nodeSiteConfig: parseJsonObjectPayload(req.body?.nodeSiteConfig, 'nodeSiteConfig'),
      progressSessionId: String(req.body?.progressSessionId || ''),
      totalChunks,
      createdAt: new Date().toISOString()
    });

    res.json({ uploadId });
  } catch (err) {
    next(err);
  }
});

router.post('/services/:id/project-upload/chunk', upload.single('chunk'), (req, res, next) => {
  try {
    const metadata = persistChunkFile(req.body?.uploadId, req.body?.chunkIndex, req.file);
    if (metadata.type !== 'project-upload' || metadata.serviceId !== req.params.id) {
      return res.status(400).json({ message: 'Upload inválido para este serviço' });
    }
    res.json({ ok: true, chunkIndex: Number(req.body?.chunkIndex) });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

router.post('/services/:id/project-upload/complete', async (req, res, next) => {
  const uploadId = req.body?.uploadId;
  const progress = [];
  try {
    const metadata = ensureChunkUploadReady(uploadId);
    if (metadata.type !== 'project-upload' || metadata.serviceId !== req.params.id) {
      return res.status(400).json({ message: 'Upload inválido para este serviço' });
    }
    pushDeploymentProgress(
      progress,
      metadata.progressSessionId,
      'Arquivo recebido em partes. Publicação em segundo plano iniciada.',
      'upload'
    );
    const job = startProjectPublishJob({
      serviceId: req.params.id,
      fileFactory: (jobId) => {
        pushDeploymentProgress(progress, metadata.progressSessionId, 'Remontando arquivo enviado em partes...', 'upload', {
          jobId
        });
        const { archivePath, filename } = assembleChunkUpload(uploadId);
        pushDeploymentProgress(
          progress,
          metadata.progressSessionId,
          'Arquivo remontado. Iniciando processamento no servidor...',
          'upload',
          { jobId }
        );
        return {
          path: archivePath,
          originalname: filename
        };
      },
      options: {
        envVars: metadata.envVars || null,
        healthcheck: metadata.healthcheck || null,
        autoRollback: metadata.autoRollback,
        versionMetadata: metadata.versionMetadata || null,
        nodeServiceMode: metadata.nodeServiceMode,
        nodeSiteConfig: metadata.nodeSiteConfig || null,
        progressSessionId: metadata.progressSessionId,
        progress
      },
      cleanup: () => cleanupChunkUpload(uploadId)
    });
    res.status(202).json({
      accepted: true,
      message: 'Arquivo recebido. Publicação em segundo plano iniciada.',
      jobId: job.id,
      job: sanitizeProjectDeployJob(job),
      progress
    });
  } catch (err) {
    let progressSessionId = '';
    try {
      progressSessionId = readChunkMetadata(uploadId)?.metadata?.progressSessionId || '';
    } catch (metadataErr) {
      progressSessionId = '';
    }
    if (progressSessionId) {
      pushDeploymentProgress(progress, progressSessionId, `Falha na publicação: ${err.message}`, 'error');
    }
    appendServiceLog('error', `Erro ao finalizar upload em partes ${req.params.id}: ${err.message}`);
    sendProgressError(res, err, progress);
  }
});

router.get('/services/:id/versions', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    let service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    service = ensureActiveDeploymentRecord(service);
    res.json({ versions: (service.deployments || []).map(sanitizeDeploymentForClient) });
  } catch (err) {
    next(err);
  }
});

router.get('/services/:id/versions/:versionId/download', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    let service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    service = ensureActiveDeploymentRecord(service);
    const deployment = (service.deployments || []).find((entry) => entry.id === req.params.versionId);
    if (!deployment) {
      return res.status(404).json({ message: 'Versao nao encontrada' });
    }
    if (!deployment.projectDir || !fs.existsSync(deployment.projectDir)) {
      return res.status(404).json({ message: 'Arquivos da versao nao encontrados' });
    }
    const stat = fs.statSync(deployment.projectDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ message: 'Versao nao aponta para uma pasta valida' });
    }

    const filename = buildDeploymentDownloadFilename(service, deployment);
    appendServiceLog('info', `Download da versao ${deployment.id} iniciado para ${service.name}`);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await pipeline(tarfs.pack(deployment.projectDir), zlib.createGzip(), res);
  } catch (err) {
    appendServiceLog('error', `Erro ao baixar versao ${req.params.versionId}: ${err.message}`);
    if (res.headersSent) return;
    next(err);
  }
});

router.delete('/services/:id/versions/:versionId', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    let service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    service = ensureActiveDeploymentRecord(service);
    const deployment = (service.deployments || []).find((entry) => entry.id === req.params.versionId);
    if (!deployment) {
      return res.status(404).json({ message: 'Versao nao encontrada' });
    }
    if (deployment.id === service.activeDeploymentId || deployment.status === 'active') {
      return res.status(400).json({ message: 'Nao e possivel remover a versao ativa.' });
    }

    const remainingDeployments = (service.deployments || [])
      .filter((entry) => entry.id !== deployment.id)
      .map((entry) => ({
        ...entry,
        status:
          entry.status === 'failed'
            ? 'failed'
            : entry.id === service.activeDeploymentId
              ? 'active'
              : 'available'
      }));

    const updatedService = dockerManager.saveService({
      ...service,
      deployments: remainingDeployments,
      updatedAt: new Date().toISOString()
    });

    const deploymentRoot = getDeploymentRoot(service);
    const projectDirStillUsed = remainingDeployments.some(
      (entry) => entry.projectDir && path.resolve(entry.projectDir) === path.resolve(deployment.projectDir || '')
    );
    if (
      deployment.projectDir &&
      !projectDirStillUsed &&
      isPathInside(deployment.projectDir, deploymentRoot)
    ) {
      try {
        fs.rmSync(deployment.projectDir, { recursive: true, force: true });
      } catch (err) {
        appendServiceLog(
          'warn',
          `Versao ${deployment.id} removida do registro, mas a pasta nao pode ser apagada: ${err.message}`
        );
      }
    }

    appendServiceLog('info', `Versao ${deployment.id} removida de ${service.name}`);
    res.json({
      service: sanitizeServiceForClient(updatedService),
      removedVersionId: deployment.id
    });
  } catch (err) {
    appendServiceLog('error', `Erro ao remover versao ${req.params.versionId}: ${err.message}`);
    next(err);
  }
});

router.post('/services/:id/rollback', async (req, res, next) => {
  try {
    const services = dockerManager.listServices();
    let service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    service = ensureActiveDeploymentRecord(service);
    const versionId = req.body?.versionId || req.body?.deploymentId;
    const deployment = (service.deployments || []).find((entry) => entry.id === versionId);
    if (!deployment) {
      return res.status(404).json({ message: 'Versao nao encontrada' });
    }
    if (!deployment.projectDir || !fs.existsSync(deployment.projectDir)) {
      return res.status(400).json({ message: 'Arquivos da versao nao encontrados' });
    }
    if (deployment.id === service.activeDeploymentId) {
      return res.json({ service: sanitizeServiceForClient(service) });
    }

    const healthcheck = normalizeHealthcheckConfig(req.body?.healthcheck || service.healthcheck);
    const autoRollback = parseBooleanOption(req.body?.autoRollback, service.autoRollback ?? true);
    const updatedService = await promoteProjectDeployment({
      service,
      deployment: {
        ...deployment,
        status: 'pending',
        rollbackFrom: service.activeDeploymentId,
        rollbackAt: new Date().toISOString()
      },
      envVars: deployment.envVars || service.envVars || [],
      nodeServiceMode: deployment.nodeServiceMode || service.nodeServiceMode || DEFAULT_NODE_SITE_MODE,
      nodeSiteConfig: deployment.nodeSiteConfig || service.nodeSiteConfig || null,
      healthcheck,
      autoRollback
    });
    res.json({ service: sanitizeServiceForClient(updatedService) });
  } catch (err) {
    appendServiceLog('error', `Erro ao executar rollback ${req.params.id}: ${err.message}`);
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
      // Try to find in stacks
      const StackManager = require("../services/StackManager");
      const sm = new StackManager();
      const stacks = sm.listStacks();
      let foundStack = null;
      let foundSvc = null;
      for (const stack of stacks) {
        const svc = (stack.services || []).find((s) => s.id === req.params.id);
        if (svc) { foundStack = stack; foundSvc = svc; break; }
      }
      if (foundSvc) {
        // Stop and remove container by ID or by name pattern
        const ids = Array.isArray(foundSvc.containerIds) && foundSvc.containerIds.length
          ? foundSvc.containerIds
          : (foundSvc.containerId ? [foundSvc.containerId] : []);
        for (const cid of ids) {
          try {
            const c = dockerManager.docker.getContainer(cid);
            await c.stop().catch(() => {});
            await c.remove({ force: true });
          } catch { /* ignore */ }
        }
        // Also try to find by container name pattern (provir-STACKID-SVCNAME)
        if (!ids.length || ids.every((cid) => !cid)) {
          try {
            const containers = await dockerManager.docker.listContainers({ all: true });
            const namePattern = `provir-${foundStack.id.slice(0, 8)}-${foundSvc.name}`;
            const matches = containers.filter((c) => (c.Names || []).some((n) => n.includes(namePattern)));
            for (const m of matches) {
              try {
                const c = dockerManager.docker.getContainer(m.Id);
                await c.stop().catch(() => {});
                await c.remove({ force: true });
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        }
        // Remove service from stack
        sm.removeService(foundStack.id, req.params.id);
        return res.json({ status: "removed" });
      }
      // Try as raw container ID
      try {
        const container = dockerManager.docker.getContainer(req.params.id);
        const info = await container.inspect();
        await container.stop().catch(() => {});
        await container.remove({ force: true });
        return res.json({ status: "removed" });
      } catch {
        return res.status(404).json({ message: "Service not found" });
      }
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
  const cookieHeader = handshake.headers && handshake.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, pair) => {
      const index = pair.indexOf('=');
      if (index === -1) return acc;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
    return cookies[cookieName] || cookies.token || null;
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
    command: [
      'sh',
      '-c',
      'printf "server { listen 80; server_name _; root /usr/share/nginx/html; index index.html; location / { try_files \\$uri \\$uri/ /index.html; } }" > /etc/nginx/conf.d/default.conf && nginx -g "daemon off;"'
    ],
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
        try { currentStream.destroy(); } catch (e) { /* ignore */ }
        currentStream = null;
      }

      try {
        const stream = await dockerManager.getContainerLogs(containerId, { tail: tail || 200 });
        if (!stream || typeof stream.on !== 'function') {
          // Not a stream — emit as single chunk
          const text = stream ? String(stream) : '';
          if (text) socket.emit('log', { data: text, ts: Date.now() });
          return;
        }
        currentStream = stream;
        stream.on('data', (chunk) => {
          socket.emit('log', { data: chunk.toString(), ts: Date.now() });
        });
        stream.on('end', () => {
          socket.emit('end', { message: 'Log stream ended' });
          currentStream = null;
        });
        stream.on('error', (err) => {
          socket.emit('error', { message: err.message || 'Stream error' });
          currentStream = null;
        });
      } catch (err) {
        socket.emit('error', { message: err.message || 'Failed to stream logs' });
      }
    });

    socket.on('disconnect', () => {
      if (currentStream) {
        try { currentStream.destroy(); } catch (e) { /* ignore */ }
        currentStream = null;
      }
    });
  });
};

module.exports = {
  router,
  initDockerSocket
};
