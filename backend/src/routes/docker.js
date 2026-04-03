'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const DockerManager = require('../services/DockerManager');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const multer = require('multer');

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });
const dockerManager = new DockerManager();
const serviceLogsPath = path.join(__dirname, '..', 'logs', 'service-updates.log');
fs.mkdirSync(path.dirname(serviceLogsPath), { recursive: true });
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cookieName = process.env.AUTH_COOKIE_NAME || 'provirpanel_token';
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
  let value = rawValue ?? '';
  if (value === '' && Object.prototype.hasOwnProperty.call(process.env, key)) {
    value = process.env[key] ?? '';
  }
  const text = String(value);
  return text.replace(ENV_REFERENCE_PATTERN, (token, bracketed, simple) => {
    const refKey = bracketed || simple;
    if (Object.prototype.hasOwnProperty.call(lookup, refKey)) {
      return lookup[refKey];
    }
    if (Object.prototype.hasOwnProperty.call(process.env, refKey)) {
      return process.env[refKey] ?? '';
    }
    return token;
  });
};

const buildContainerEnv = ({ templateEnv = [], explicitEnvVars = [], projectPath = null }) => {
  const envFromFile = readProjectEnvVars(projectPath);
  const merged = mergeEnvEntries(templateEnv, envFromFile, explicitEnvVars);
  const rawLookup = Object.fromEntries(
    merged.map((entry) => [entry.key, String(entry.value ?? '')])
  );
  return merged.map((entry) => `${entry.key}=${resolveEnvValue(entry.key, entry.value, rawLookup)}`);
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
  envVars: maskEnvVars(service.envVars || [])
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

const resolveNodeCommand = (volumes = []) => {
  const project = resolveProjectPathFromVolume(volumes);
  if (!project?.hostPath) return null;

  const packagePath = path.join(project.hostPath, 'package.json');
  if (!fs.existsSync(packagePath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const scripts = pkg && typeof pkg === 'object' ? pkg.scripts || {} : {};
    const deps = (pkg && typeof pkg === 'object' ? pkg.dependencies || {} : {}) || {};
    const hasNext = Boolean(deps.next);
    const startScript = typeof scripts.start === 'string' ? scripts.start.trim() : '';
    if (hasNext && startScript.startsWith('next start')) {
      return ['sh', '-c', 'npm install && npm run build && next start'];
    }
    if (scripts.start) {
      return ['sh', '-c', 'npm install && npm run start'];
    }
    if (scripts.dev) {
      return ['sh', '-c', 'npm install && npm run dev'];
    }
    if (pkg.main) {
      return ['sh', '-c', `npm install && node ${pkg.main}`];
    }
  } catch (err) {
    return null;
  }

  return ['sh', '-c', 'npm install && npm start'];
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
  throw new Error('Formato de arquivo não suportado. Use .zip, .tar, .tar.gz ou .tgz.');
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
  const existingEnv = readProjectEnvVars(projectPath);
  const merged = mergeEnvEntries(templateEnv, existingEnv, envVars);
  if (!merged.length) return;
  const content = merged.map((entry) => `${entry.key}=${entry.value ?? ''}`).join('\n') + '\n';
  fs.writeFileSync(path.join(projectPath.hostPath, '.env'), content, 'utf8');
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
  return resolveProjectPathFromVolume(volumes);
};

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

router.post('/images/build', upload.single('contextArchive'), async (req, res, next) => {
  const progress = [];
  let tempDir = null;
  try {
    const imageName = String(req.body?.imageName || '').trim();
    const dockerfileContent = String(req.body?.dockerfileContent || '').trim();
    const dockerfilePathInput = String(req.body?.dockerfilePath || '').trim();
    const buildArgsRaw = String(req.body?.buildArgs || '').trim();

    if (!imageName) {
      return res.status(400).json({ message: 'imageName is required' });
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provir-build-'));
    progress.push(`📁 Contexto temporario criado: ${tempDir}`);

    if (req.file?.path) {
      progress.push(`📦 Extraindo arquivo ${req.file.originalname}...`);
      await extractArchiveTo(req.file.path, tempDir, req.file.originalname);
      fs.unlink(req.file.path, () => {});
    }

    let dockerfileName = 'Dockerfile';
    if (dockerfileContent) {
      if (dockerfilePathInput && !isSafeRelativePath(dockerfilePathInput)) {
        return res.status(400).json({ message: 'dockerfilePath inválido' });
      }
      dockerfileName = dockerfilePathInput || 'Dockerfile';
      const dockerfileFullPath = path.join(tempDir, dockerfileName);
      fs.mkdirSync(path.dirname(dockerfileFullPath), { recursive: true });
      fs.writeFileSync(dockerfileFullPath, dockerfileContent, 'utf8');
      progress.push(`📝 Dockerfile salvo em ${dockerfileName}`);
    } else if (dockerfilePathInput) {
      if (!isSafeRelativePath(dockerfilePathInput)) {
        return res.status(400).json({ message: 'dockerfilePath inválido' });
      }
      const dockerfileFullPath = path.join(tempDir, dockerfilePathInput);
      if (!fs.existsSync(dockerfileFullPath)) {
        return res.status(400).json({ message: `Dockerfile não encontrado no contexto: ${dockerfilePathInput}` });
      }
      dockerfileName = dockerfilePathInput;
      progress.push(`📄 Usando Dockerfile existente: ${dockerfileName}`);
    } else {
      const defaultDockerfile = path.join(tempDir, 'Dockerfile');
      if (!fs.existsSync(defaultDockerfile)) {
        return res.status(400).json({
          message: 'Envie dockerfileContent ou um contexto com arquivo Dockerfile'
        });
      }
      progress.push('📄 Usando Dockerfile padrão do contexto');
    }

    let buildArgs = undefined;
    if (buildArgsRaw) {
      try {
        const parsed = JSON.parse(buildArgsRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          buildArgs = parsed;
        }
      } catch (err) {
        return res.status(400).json({ message: 'buildArgs deve ser um JSON válido' });
      }
    }

    progress.push(`🔨 Iniciando build da imagem ${imageName}...`);
    await dockerManager.buildImage(
      imageName,
      tempDir,
      (msg) => {
        if (msg) progress.push(msg);
      },
      { dockerfileName, buildArgs }
    );
    progress.push(`✅ Build finalizado: ${imageName}`);

    return res.json({ status: 'built', imageName, progress });
  } catch (err) {
    progress.push(`❌ Falha no build: ${err.message}`);
    return res.status(500).json({ message: err.message || 'Build failed', progress });
  } finally {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    if (tempDir) {
      fs.rm(tempDir, { recursive: true, force: true }, () => {});
    }
  }
});

router.get('/services', async (req, res, next) => {
  await sendServicesResponse(res, next);
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
    if (projectPath?.hostPath) {
      writeEnvFile(projectPath, normalizedEnvVars, template.env);
      progress.push(`📝 .env gerado em ${projectPath.hostPath}`);
    } else {
      progress.push('⚠️ Nao foi possivel resolver o diretorio do projeto para gerar .env');
    }
    let env = buildContainerEnv({
      templateEnv: template.env,
      explicitEnvVars: normalizedEnvVars,
      projectPath
    });

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
          User: 'root',
          HostConfig: {
            NetworkMode: networkName,
            PortBindings: {
              '80/tcp': [pgAdminPortBinding]
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
    const {
      hostPort,
      envVars = [],
      networkName,
      command,
      bindLocalOnly,
      nodeServiceMode: requestedNodeServiceMode,
      nodeSiteConfig: requestedNodeSiteConfig
    } = req.body || {};
    const services = dockerManager.listServices();
    const service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    const { nodeServiceMode, nodeSiteConfig } = resolveNodeServiceConfig(
      {
        nodeServiceMode: requestedNodeServiceMode,
        nodeSiteConfig: requestedNodeSiteConfig
      },
      service
    );
    const isNodeSitesMode = service.templateId === 'node-app' && nodeServiceMode === 'sites';

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
    const projectPath = getNodeServiceProjectPath(service.volumes, nodeServiceMode);
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
    
    const resolvedEnvVars = mergeEnvVars(envVars, service.envVars || []);
    if (projectPath?.hostPath) {
      writeEnvFile(projectPath, resolvedEnvVars, template.env);
      appendServiceLog('info', `Arquivo .env atualizado em ${projectPath.hostPath}`);
      if (!isNodeSitesMode) {
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
      projectPath
    });

    const normalizedCommand = isNodeSitesMode ? null : normalizeCommand(command);
    const hasUserCommand = isNodeSitesMode ? false : !!normalizedCommand;
    let containerCmd = normalizedCommand || service.command || template.command;
    if (isNodeSitesMode) {
      containerCmd = ['sh', '-c', 'npm install && npm start'];
    } else if (service.templateId === 'node-app' && !normalizedCommand && !service.command) {
      containerCmd = resolveNodeCommand(service.volumes) || containerCmd;
    }
    if (!hasUserCommand) {
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
      `Comando definido para ${service.name}: ${containerCmd ? containerCmd.join(' ') : 'padrao'}`
    );
    if (workdir) {
      appendServiceLog('info', `WorkingDir para ${service.name}: ${workdir}`);
    } else {
      appendServiceLog('warn', `WorkingDir nao resolvido para ${service.name}`);
    }
    if (!hasUserCommand) {
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

    if (containerCmd) {
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
      command: isNodeSitesMode ? null : containerCmd || null,
      networkName: targetNetwork,
      bindLocalOnly: resolvedBindLocal,
      nodeServiceMode,
      nodeSiteConfig,
      hasProject: isNodeSitesMode ? true : service.hasProject,
      url: `http://localhost:${resolvedPort}`,
      serverIP: getLocalIP(),
      externalUrl: resolvedBindLocal ? null : `http://${getLocalIP()}:${resolvedPort}`,
      updatedAt: new Date().toISOString()
    };

    dockerManager.saveService(updatedService);
    appendServiceLog('info', `Atualizacao de servico concluida: ${service.name}`);
    res.json({ service: sanitizeServiceForClient(updatedService) });
  } catch (err) {
    appendServiceLog('error', `Erro ao atualizar servico ${req.params.id}: ${err.message}`);
    next(err);
  }
});

router.post('/services/:id/project-upload', upload.single('archive'), async (req, res, next) => {
  let service = null;
  try {
    const services = dockerManager.listServices();
    service = services.find((s) => s.id === req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    }

    appendServiceLog('info', `Atualizacao de projeto iniciada: ${service.name}`);

    const projectDir = service.volumes?.find((m) => m.hostPath)?.hostPath;
    if (!projectDir) {
      return res.status(400).json({ message: 'Volume do serviço não encontrado.' });
    }

    const { nodeServiceMode, nodeSiteConfig } = resolveNodeServiceConfig({}, service);
    const isNodeSitesMode = service.templateId === 'node-app' && nodeServiceMode === 'sites';
    const uploadTargetDir = isNodeSitesMode
      ? path.join(projectDir, normalizeNodeSiteFolder(nodeSiteConfig.siteFolder))
      : projectDir;

    fs.mkdirSync(projectDir, { recursive: true });
    if (isNodeSitesMode) {
      ensureNodeSiteScaffold(
        { hostPath: projectDir, containerPath: service.volumes?.[0]?.containerPath || '/usr/src/app' },
        service.name,
        nodeSiteConfig,
        service.nodeSiteConfig
      );
      fs.mkdirSync(uploadTargetDir, { recursive: true });
    }
    // Replace published project content to avoid stale files in static deployments.
    cleanDirectory(uploadTargetDir);
    const archivePath = req.file.path;
    try {
      appendServiceLog('info', `Extraindo arquivo ${req.file.originalname} em ${uploadTargetDir}`);
      await extractArchiveTo(archivePath, uploadTargetDir, req.file.originalname);
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
        return res.status(400).json({
          message: 'Arquivo inválido para site estático: index.html não encontrado no .zip/.tar.'
        });
      }
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
      }
    }

    const template =
      SERVICE_TEMPLATES.find((t) => t.id === service.templateId) ||
      { env: [], workdir: null, command: null };
    const projectPath = getNodeServiceProjectPath(service.volumes, nodeServiceMode);
    const workdir = projectPath?.containerPath || template.workdir || null;
    if (projectPath?.hostPath) {
      appendServiceLog('info', `Projeto resolvido em ${projectPath.hostPath}`);
    } else {
      appendServiceLog('warn', `Nao foi possivel resolver o diretorio do projeto para ${service.name}`);
    }

    const resolvedEnvVars = service.envVars || [];
    if (projectPath?.hostPath) {
      writeEnvFile(projectPath, resolvedEnvVars, template.env);
      appendServiceLog('info', `Arquivo .env atualizado em ${projectPath.hostPath}`);
      if (!isNodeSitesMode) {
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
      projectPath
    });

    const isNodeService =
      service.templateId === 'node-app' ||
      service.templateId === 'node' ||
      String(service.image || '').startsWith('node');
    const hasUserCommand = isNodeSitesMode ? false : !!service.command;
    let containerCmd = service.command || template.command;
    if (isNodeSitesMode) {
      containerCmd = ['sh', '-c', 'npm install && npm start'];
    } else if (isNodeService && !service.command) {
      containerCmd = resolveNodeCommand(service.volumes) || containerCmd;
    }
    if (isNodeService && !hasUserCommand) {
      containerCmd = ensureCommandWorkdir(containerCmd, workdir);
      const uploadCmdBefore = stringifyCommand(containerCmd);
      containerCmd = ensureNpmDevDependencies(containerCmd);
      const uploadAfterDev = stringifyCommand(containerCmd);
      containerCmd = ensureNextBuildTimeout(containerCmd);
      const uploadCmdAfter = stringifyCommand(containerCmd);
      if (uploadAfterDev !== uploadCmdBefore) {
        appendServiceLog('info', 'Forcando instalacao de dependencias de desenvolvimento para build');
      }
      if (uploadCmdAfter !== uploadAfterDev) {
        appendServiceLog('info', 'Ajustando timeout do Next.js para build');
      }
    }
    appendServiceLog('info', `Comando detectado para ${service.name}: ${containerCmd ? containerCmd.join(' ') : 'padrao'}`);
    if (workdir) {
      appendServiceLog('info', `WorkingDir para ${service.name}: ${workdir}`);
    } else {
      appendServiceLog('warn', `WorkingDir nao resolvido para ${service.name}`);
    }
    if (isNodeService && !hasUserCommand) {
      const envBeforeUpload = env;
      env = ensureNextBuildEnv(env, containerCmd);
      if (env !== envBeforeUpload) {
        appendServiceLog('info', 'Variavel de ambiente de timeout do Next.js adicionada');
      }
    }

    if (service.containerId) {
      try {
        appendServiceLog('info', `Parando container atual ${service.containerId} (${service.name})`);
        await dockerManager.stopContainer(service.containerId);
        appendServiceLog('info', `Removendo container atual ${service.containerId} (${service.name})`);
        await dockerManager.removeContainer(service.containerId);
      } catch (err) {
        // ignore
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
        NetworkMode: service.networkName || 'bridge',
        PortBindings: {
          [`${service.containerPort}/tcp`]: [
            service.bindLocalOnly
              ? { HostPort: String(service.hostPort), HostIp: '127.0.0.1' }
              : { HostPort: String(service.hostPort) }
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

    if (containerCmd) {
      containerConfig.Cmd = containerCmd;
    }
    if (workdir) {
      containerConfig.WorkingDir = workdir;
    }

    appendServiceLog('info', `Garantindo nome livre para ${service.name}`);
    await removeContainerByName(service.name);
    appendServiceLog('info', `Iniciando novo container para ${service.name}`);
    const container = await runContainerWithRetry(service.image, containerConfig, service.name);

    const updatedService = {
      ...service,
      containerId: container.Id,
      command: isNodeSitesMode ? null : containerCmd || null,
      updatedAt: new Date().toISOString()
    };

    dockerManager.saveService(updatedService);
    appendServiceLog('info', `Atualizacao de projeto concluida: ${service.name}`);
    res.json({ service: sanitizeServiceForClient(updatedService) });
  } catch (err) {
    appendServiceLog('error', `Erro ao atualizar projeto ${service?.name || req.params.id}: ${err.message}`);
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
        currentStream.destroy();
        currentStream = null;
      }

      try {
        currentStream = await dockerManager.getContainerLogs(containerId, { tail });
        currentStream.on('data', (chunk) => {
          socket.emit('log', { data: chunk.toString(), ts: Date.now() });
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
