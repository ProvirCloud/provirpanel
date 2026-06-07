'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const multer = require('multer');
const DockerManager = require('../services/DockerManager');
const NginxManager = require('../services/NginxManager');
const { StorageEnvironmentManager, DEFAULT_PERMISSIONS } = require('../services/StorageEnvironmentManager');

const router = express.Router();
const dockerManager = new DockerManager();
const nginxManager = new NginxManager();
const storageEnvironmentManager = new StorageEnvironmentManager();

const uploadTempDir = path.join(os.tmpdir(), 'provirpanel-sites-upload');
const chunkUploadRoot = path.join(os.tmpdir(), 'provirpanel-sites-chunks');
fs.mkdirSync(uploadTempDir, { recursive: true });
fs.mkdirSync(chunkUploadRoot, { recursive: true });

const upload = multer({ dest: uploadTempDir });
const registryPath = process.env.SITES_REGISTRY || path.join(__dirname, '../../data/sites.json');
const fallbackSitesBaseDir = path.join(__dirname, '../../data/sites');
const configuredSitesBaseDir =
  process.env.SITES_BASE_DIR ||
  (process.env.CLOUDPAINEL_PROJECTS_DIR
    ? path.join(process.env.CLOUDPAINEL_PROJECTS_DIR, 'sites')
    : fallbackSitesBaseDir);
let sitesBaseDir = configuredSitesBaseDir;
const legacySitesNetworkName = process.env.SITES_DOCKER_NETWORK || 'provirpanel';
const sitesNetworkPrefix = process.env.SITES_DOCKER_NETWORK_PREFIX || legacySitesNetworkName;
const sitesProxyBaseDomain = String(process.env.SITES_PROXY_BASE_DOMAIN || 'localhost')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '') || 'localhost';
const wordpressImage = process.env.WORDPRESS_IMAGE || 'wordpress:latest';
const configuredDatabaseImage = process.env.WORDPRESS_DB_IMAGE || 'mariadb:11';
const fallbackDatabaseImages = process.env.WORDPRESS_DB_FALLBACK_IMAGES
  ? process.env.WORDPRESS_DB_FALLBACK_IMAGES.split(',').map((image) => image.trim()).filter(Boolean)
  : (process.env.WORDPRESS_DB_IMAGE ? [] : ['mysql:8']);
const databaseImageCandidates = [configuredDatabaseImage, ...fallbackDatabaseImages].filter(
  (image, index, list) => image && list.indexOf(image) === index
);

fs.mkdirSync(path.dirname(registryPath), { recursive: true });
try {
  fs.mkdirSync(sitesBaseDir, { recursive: true });
} catch (err) {
  if (sitesBaseDir !== fallbackSitesBaseDir) {
    console.warn(`[Sites] Diretório ${sitesBaseDir} indisponível, usando ${fallbackSitesBaseDir}: ${err.message}`);
    sitesBaseDir = fallbackSitesBaseDir;
    fs.mkdirSync(sitesBaseDir, { recursive: true });
  } else {
    throw err;
  }
}
if (!fs.existsSync(registryPath)) {
  fs.writeFileSync(registryPath, '[]', 'utf8');
}

const createHttpError = (message, status = 500) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const runCommand = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 25 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${err.message}${stderr ? `: ${stderr}` : ''}`;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const dockerExecShell = (containerId, script, env = {}, options = {}) => {
  const args = ['exec'];
  Object.entries(env).forEach(([key, value]) => {
    args.push('-e', `${key}=${value ?? ''}`);
  });
  args.push(containerId, 'sh', '-lc', script);
  return runCommand('docker', args, { timeout: 900000, ...options });
};

const dockerExecRootShell = (containerId, script, env = {}, options = {}) => {
  const args = ['exec', '-u', '0'];
  Object.entries(env).forEach(([key, value]) => {
    args.push('-e', `${key}=${value ?? ''}`);
  });
  args.push(containerId, 'sh', '-lc', script);
  return runCommand('docker', args, { timeout: 900000, ...options });
};

const readSites = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
};

const writeSites = (sites) => {
  fs.writeFileSync(registryPath, JSON.stringify(sites, null, 2), 'utf8');
};

const saveSite = (site) => {
  const sites = readSites();
  const index = sites.findIndex((entry) => entry.id === site.id);
  if (index >= 0) {
    sites[index] = site;
  } else {
    sites.push(site);
  }
  writeSites(sites);
  return site;
};

const randomPassword = (size = 18) =>
  crypto
    .randomBytes(size)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, size);

const slugify = (value, fallback = 'site') => {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
};

const buildSiteNetworkName = (siteSlug, shortId) => {
  const prefix = slugify(sitesNetworkPrefix, 'provirpanel').slice(0, 24);
  const safeSiteSlug = slugify(siteSlug, 'site').slice(0, 28);
  return `${prefix}-${safeSiteSlug}-${shortId}`;
};

const getSiteNetworkName = (site = {}) =>
  site.networkName || site.dockerNetwork || legacySitesNetworkName;

const normalizeDomain = (domain) => {
  const value = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!value || !/^[a-z0-9.-]+$/.test(value) || !value.includes('.')) {
    throw createHttpError('Domínio inválido', 400);
  }
  return value;
};

const normalizeOptionalDomain = (domain) => {
  const value = String(domain || '').trim();
  return value ? normalizeDomain(value) : '';
};

const normalizeProxyPath = (proxyPath) => {
  const raw = String(proxyPath || '').trim();
  if (!raw) return '/';
  const withoutQuery = raw.split(/[?#]/)[0].trim();
  const normalized = `/${withoutQuery.replace(/^\/+/, '')}`
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '') || '/';
  if (normalized !== '/' && (!/^\/[a-zA-Z0-9._~/-]+$/.test(normalized) || normalized.includes('/../') || normalized.endsWith('/..'))) {
    throw createHttpError('Path do proxy inválido. Use caminhos simples, por exemplo /bio', 400);
  }
  return normalized;
};

const buildSiteProxyHost = (slug, shortId) =>
  `${slugify(slug, 'site')}-${String(shortId || '').slice(0, 8)}.${sitesProxyBaseDomain}`;

const getSiteProxyHost = (site = {}) =>
  site.proxyHost || buildSiteProxyHost(site.slug || site.name || 'site', site.id || crypto.randomUUID());

const getSitePrimaryHost = (site = {}) =>
  site.domain || getSiteProxyHost(site);

const getSiteScheme = (site = {}) =>
  site.domain && site.ssl ? 'https' : 'http';

const safeUploadFilename = (filename, fallback = 'wordpress-backup.zip') => {
  const base = path.basename(String(filename || fallback)).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || fallback;
};

const sanitizeUploadId = (uploadId) => {
  const value = String(uploadId || '');
  if (!/^[a-f0-9-]{36}$/i.test(value)) {
    throw createHttpError('Upload inválido', 400);
  }
  return value;
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
  fs.renameSync(file.path, path.join(uploadDir, `chunk-${index}`));
  return metadata;
};

const assembleChunkUpload = (uploadId) => {
  const { uploadDir, metadata } = readChunkMetadata(uploadId);
  const totalChunks = Number(metadata.totalChunks);
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    throw createHttpError('Total de chunks inválido', 400);
  }

  const filename = safeUploadFilename(metadata.filename);
  const archivePath = path.join(uploadDir, filename);
  if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  for (let index = 0; index < totalChunks; index += 1) {
    const chunkPath = path.join(uploadDir, `chunk-${index}`);
    if (!fs.existsSync(chunkPath)) {
      throw createHttpError(`Chunk ${index + 1}/${totalChunks} ausente`, 400);
    }
    fs.appendFileSync(archivePath, fs.readFileSync(chunkPath));
  }
  return { archivePath, filename };
};

const ensureExtractor = async (command, hint) => {
  try {
    await runCommand('which', [command]);
  } catch (err) {
    throw new Error(`${command} não encontrado. Instale ${hint || command} para extrair arquivos.`);
  }
};

const flattenSingleRootDir = (targetDir, maxPasses = 4) => {
  let pass = 0;
  while (pass < maxPasses) {
    pass += 1;
    let entries = [];
    try {
      entries = fs.readdirSync(targetDir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    const visibleEntries = entries.filter((entry) => entry.name !== '__MACOSX' && entry.name !== '.DS_Store');
    const dirs = visibleEntries.filter((entry) => entry.isDirectory());
    const files = visibleEntries.filter((entry) => entry.isFile());
    if (files.length > 0 || dirs.length !== 1) return;
    const rootDir = path.join(targetDir, dirs[0].name);
    fs.readdirSync(rootDir).forEach((entry) => {
      fs.renameSync(path.join(rootDir, entry), path.join(targetDir, entry));
    });
    fs.rmdirSync(rootDir);
  }
};

const extractArchiveTo = async (archivePath, targetDir, archiveName) => {
  const lower = (archiveName || archivePath).toLowerCase();
  if (lower.endsWith('.zip')) {
    await ensureExtractor('unzip', 'unzip');
    await runCommand('unzip', ['-o', archivePath, '-d', targetDir]);
    flattenSingleRootDir(targetDir);
    return true;
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await ensureExtractor('tar', 'tar');
    await runCommand('tar', ['-xzf', archivePath, '-C', targetDir]);
    flattenSingleRootDir(targetDir);
    return true;
  }
  if (lower.endsWith('.tar')) {
    await ensureExtractor('tar', 'tar');
    await runCommand('tar', ['-xf', archivePath, '-C', targetDir]);
    flattenSingleRootDir(targetDir);
    return true;
  }
  return false;
};

const walkTree = (rootDir, visitor, options = {}) => {
  const maxDepth = options.maxDepth ?? 8;
  const maxEntries = options.maxEntries ?? 9000;
  let visited = 0;

  const walk = (dir, depth) => {
    if (visited >= maxEntries || depth < 0) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return null;
    }
    const direct = visitor(dir, entries);
    if (direct) return direct;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['__MACOSX', 'node_modules', '.git'].includes(entry.name)) continue;
      visited += 1;
      const found = walk(path.join(dir, entry.name), depth - 1);
      if (found) return found;
    }
    return null;
  };

  return walk(rootDir, maxDepth);
};

const findFirstSqlFile = (rootDir) =>
  walkTree(rootDir, (_dir, entries) => {
    const sql = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'));
    return sql ? path.join(_dir, sql.name) : null;
  });

const findWpContentDir = (rootDir) =>
  walkTree(rootDir, (dir, entries) => {
    if (path.basename(dir) !== 'wp-content') return null;
    const names = new Set(entries.map((entry) => entry.name));
    const score = ['plugins', 'themes', 'uploads'].filter((name) => names.has(name)).length;
    return score >= 1 ? dir : null;
  });

const findWordPressRoot = (rootDir) =>
  walkTree(rootDir, (dir, entries) => {
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has('wp-config.php') || (names.has('wp-content') && names.has('wp-admin'))) {
      return dir;
    }
    return null;
  });

const detectTablePrefixFromTables = (tableNames = []) => {
  const suffixes = ['users', 'usermeta', 'sitemeta', 'blogs', 'blogmeta', 'site', 'options'];
  for (const suffix of suffixes) {
    const tableName = tableNames.find((name) => String(name || '').endsWith(suffix));
    if (!tableName) continue;
    const prefix = String(tableName).slice(0, -suffix.length);
    if (/^[a-zA-Z0-9_]+$/.test(prefix) && !/\d_$/.test(prefix)) {
      return prefix;
    }
  }
  return null;
};

const isSubsiteTablePrefix = (prefix = '') => /\d_$/.test(String(prefix || ''));

const stripSubsiteTablePrefix = (prefix = '') => String(prefix || '').replace(/\d+_$/, '');

const resolveWordPressTablePrefix = (tables = [], detectedPrefix = 'wp_') => {
  const detected = /^[a-zA-Z0-9_]+$/.test(detectedPrefix || '') ? detectedPrefix : 'wp_';
  const tableSet = new Set(tables);
  const candidates = [];

  const detectedBase = isSubsiteTablePrefix(detected) ? stripSubsiteTablePrefix(detected) : detected;
  if (detectedBase) candidates.push(detectedBase);

  const inferred = detectTablePrefixFromTables(tables);
  if (inferred) candidates.push(inferred);

  const subsiteOptionPrefixes = tables
    .map((tableName) => String(tableName || '').match(/^([a-zA-Z0-9_]+?)\d+_options$/)?.[1])
    .filter(Boolean);
  candidates.push(...subsiteOptionPrefixes);
  candidates.push(detected);
  candidates.push('wp_');

  for (const prefix of Array.from(new Set(candidates.filter(Boolean)))) {
    if (
      tableSet.has(`${prefix}blogs`) &&
      tableSet.has(`${prefix}site`) &&
      tableSet.has(`${prefix}sitemeta`)
    ) {
      return prefix;
    }
  }

  for (const prefix of Array.from(new Set(candidates.filter(Boolean)))) {
    if (!isSubsiteTablePrefix(prefix) && hasWordPressCoreTables(tables, prefix)) {
      return prefix;
    }
  }

  return detectedBase || detected || 'wp_';
};

const detectTablePrefixFromSql = (sqlFile) => {
  if (!sqlFile || !fs.existsSync(sqlFile)) return 'wp_';
  const fd = fs.openSync(sqlFile, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(fs.statSync(sqlFile).size, 8 * 1024 * 1024));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    const sample = buffer.toString('utf8');
    const tableNames = Array.from(sample.matchAll(/(?:CREATE TABLE|INSERT INTO|DROP TABLE IF EXISTS)\s+`?([a-zA-Z0-9_]+)`?/gi))
      .map((match) => match[1])
      .filter(Boolean);
    const detected = detectTablePrefixFromTables(tableNames);
    if (detected) return detected;
    const match =
      sample.match(/CREATE TABLE\s+`?([a-zA-Z0-9_]+)options`?/i) ||
      sample.match(/INSERT INTO\s+`?([a-zA-Z0-9_]+)options`?/i);
    return match?.[1] || 'wp_';
  } finally {
    fs.closeSync(fd);
  }
};

const copyDirectoryContents = (sourceDir, targetDir) => {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.readdirSync(sourceDir).forEach((entry) => {
    fs.cpSync(path.join(sourceDir, entry), path.join(targetDir, entry), { recursive: true, force: true });
  });
};

const escapeSql = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

const quoteSqlIdentifier = (identifier) => {
  const value = String(identifier || '');
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw createHttpError(`Identificador SQL inválido: ${value}`, 400);
  }
  return `\`${value}\``;
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getSafeTablePrefix = (site) => {
  const prefix = site.wordpress?.tablePrefix || 'wp_';
  return /^[a-zA-Z0-9_]+$/.test(prefix) ? prefix : 'wp_';
};

const getSiteBaseUrl = (site) => `${getSiteScheme(site)}://${getSitePrimaryHost(site)}`;

const getSiteProxyPath = (site = {}) => normalizeProxyPath(site.proxyPath || '/');

const getSitePublicPath = (site = {}) => site.domain ? '/' : getSiteProxyPath(site);

const getSiteUrl = (site) => {
  const publicPath = getSitePublicPath(site);
  return publicPath === '/' ? getSiteBaseUrl(site) : `${getSiteBaseUrl(site)}${publicPath}`;
};

const buildNginxProxyHeaders = (extraHeaders = '') => `        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
${extraHeaders}        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;`;

const buildNginxProxyLocation = (hostPort, proxyPath = '/') => {
  const normalizedPath = normalizeProxyPath(proxyPath);
  if (normalizedPath === '/') {
    return `    location / {
        proxy_pass http://127.0.0.1:${hostPort};
${buildNginxProxyHeaders()}    }`;
  }
  return `    location = ${normalizedPath} {
        return 301 ${normalizedPath}/;
    }

    location ${normalizedPath}/ {
        proxy_pass http://127.0.0.1:${hostPort}/;
${buildNginxProxyHeaders(`        proxy_set_header X-Forwarded-Prefix ${normalizedPath};\n`)}    }

    location ~ ^/(wp-admin|wp-login\\.php|wp-content|wp-includes|wp-json|xmlrpc\\.php)(/|$) {
        return 302 ${normalizedPath}$request_uri;
    }

    location = / {
        return 302 ${normalizedPath}/;
    }`;
};

const buildNginxServerBlock = (serverNames, hostPort, proxyPath = '/') => `server {
    listen 80;
    server_name ${serverNames.join(' ') || '_'};
    client_max_body_size 800m;

${buildNginxProxyLocation(hostPort, proxyPath)}
}
`;

const buildNginxConfig = (site, hostPort) => {
  const blocks = [];
  if (site.domain) {
    blocks.push(buildNginxServerBlock([site.domain], hostPort, '/'));
  }
  blocks.push(buildNginxServerBlock([getSiteProxyHost(site)], hostPort, getSiteProxyPath(site)));
  return blocks.join('\n');
};

const writeNginxSite = (site, warnings) => {
  const configSlug = slugify(site.domain || getSiteProxyHost(site), 'site');
  const filename = site.nginxConfigName || `site-${configSlug}-${site.id.slice(0, 8)}.conf`;
  const content = buildNginxConfig(site, site.port);
  try {
    nginxManager.saveConfig(filename, content, { skipValidation: true });
    const configPath = nginxManager.resolveConfigPath(filename);
    if (path.resolve(configPath).startsWith(path.resolve(nginxManager.sitesAvailable))) {
      try {
        nginxManager.enableConfig(filename);
      } catch (err) {
        warnings.push(`Nginx salvo, mas não foi possível habilitar/recarregar automaticamente: ${err.message}`);
      }
    } else {
      try {
        nginxManager.reload();
      } catch (err) {
        warnings.push(`Nginx salvo, mas o reload falhou: ${err.message}`);
      }
    }
    return filename;
  } catch (err) {
    warnings.push(`Não foi possível criar o site no Nginx Manager: ${err.message}`);
    return filename;
  }
};

const createLabels = (site, role, serviceId, name) => ({
  'provirpanel.managed': 'true',
  'provirpanel.service.id': serviceId,
  'provirpanel.service.name': name,
  'provirpanel.template.id': role === 'wordpress' ? 'site-wordpress' : 'site-wordpress-db',
  'provirpanel.has_project': role === 'wordpress' ? 'true' : 'false',
  'provirpanel.site.id': site.id,
  'provirpanel.site.role': role,
  'provirpanel.site.network': getSiteNetworkName(site)
});

const removeContainerByName = async (name) => {
  try {
    const containers = await dockerManager.docker.listContainers({ all: true });
    const match = containers.find((container) => (container.Names || []).includes(`/${name}`));
    if (match) {
      await dockerManager.docker.getContainer(match.Id).remove({ force: true });
    }
  } catch (err) {
    // ignore old container cleanup
  }
};

const ensureImage = async (imageName, progress) => {
  const attempts = Math.max(1, Number(process.env.DOCKER_PULL_RETRIES || 3));
  try {
    await dockerManager.docker.getImage(imageName).inspect();
    progress.push(`Imagem ${imageName} já existe localmente`);
    return imageName;
  } catch (err) {
    // Image is not local yet.
  }

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      progress.push(`Baixando imagem ${imageName} (${attempt}/${attempts})`);
      await dockerManager.pullImage(imageName, (message) => {
        if (message) progress.push(message);
      }, { allowAny: true });
      return imageName;
    } catch (err) {
      lastError = err;
      progress.push(`Falha ao baixar ${imageName}: ${err.message}`);
      if (attempt < attempts) {
        const delayMs = Math.min(20000, attempt * 5000);
        progress.push(`Tentando novamente em ${Math.round(delayMs / 1000)}s`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError || new Error(`Não foi possível baixar ${imageName}`);
};

const ensureFirstAvailableImage = async (imageNames, progress, label) => {
  const errors = [];
  for (const imageName of imageNames) {
    try {
      return await ensureImage(imageName, progress);
    } catch (err) {
      errors.push(`${imageName}: ${err.message}`);
      progress.push(`Imagem ${imageName} indisponível para ${label}`);
    }
  }
  throw new Error(`Nenhuma imagem disponível para ${label}. ${errors.join(' | ')}`);
};

const getDatabaseContainerEnv = (imageName, databaseName, dbPassword, rootPassword) => {
  const lower = String(imageName || '').toLowerCase();
  const isMySql = lower.includes('mysql') && !lower.includes('mariadb');
  if (isMySql) {
    return [
      `MYSQL_DATABASE=${databaseName}`,
      'MYSQL_USER=wordpress',
      `MYSQL_PASSWORD=${dbPassword}`,
      `MYSQL_ROOT_PASSWORD=${rootPassword}`
    ];
  }
  return [
    `MARIADB_DATABASE=${databaseName}`,
    'MARIADB_USER=wordpress',
    `MARIADB_PASSWORD=${dbPassword}`,
    `MARIADB_ROOT_PASSWORD=${rootPassword}`
  ];
};

const containerEnvToRegistryEntries = (env = []) =>
  env.map((entry) => {
    const [key, ...valueParts] = String(entry).split('=');
    return {
      key,
      value: valueParts.join('='),
      secret: key.includes('PASSWORD')
    };
  });

const inspectContainerStatus = async (containerId) => {
  if (!containerId) return 'missing';
  try {
    const inspect = await dockerManager.docker.getContainer(containerId).inspect();
    return inspect?.State?.Running ? 'running' : inspect?.State?.Status || 'stopped';
  } catch (err) {
    return 'missing';
  }
};

const SECRET_MASK = '******';

const sanitizeSiteForClient = (site) => ({
  ...site,
  database: site.database
    ? {
        ...site.database,
        password: site.database.password ? SECRET_MASK : '',
        rootPassword: site.database.rootPassword ? SECRET_MASK : ''
      }
    : site.database,
  wordpress: site.wordpress
    ? {
        ...site.wordpress,
        adminPassword: site.wordpress.adminPassword ? SECRET_MASK : ''
      }
    : site.wordpress
});

const decorateSite = async (site) => {
  const wordpressStatus = await inspectContainerStatus(site.containers?.wordpress);
  const databaseStatus = await inspectContainerStatus(site.containers?.database);
  const normalizedSite = {
    ...site,
    proxyHost: site.proxyHost || getSiteProxyHost(site),
    proxyPath: getSiteProxyPath(site)
  };
  return sanitizeSiteForClient({
    ...normalizedSite,
    url: getSiteUrl(normalizedSite),
    status: wordpressStatus === 'running' && databaseStatus === 'running' ? 'running' : 'attention',
    wordpressStatus,
    databaseStatus
  });
};

const runSql = async (site, sql) => {
  if (!site.containers?.database) {
    throw createHttpError('Container de banco não encontrado para este site', 400);
  }
  const db = site.database || {};
  const script = [
    'set -e',
    'CLIENT="$(command -v mariadb || command -v mysql)"',
    '"$CLIENT" -u"$PROVIR_DB_USER" -p"$PROVIR_DB_PASS" "$PROVIR_DB_NAME" -e "$PROVIR_SQL"'
  ].join('\n');
  return dockerExecShell(site.containers.database, script, {
    PROVIR_DB_USER: db.user || 'wordpress',
    PROVIR_DB_PASS: db.password || '',
    PROVIR_DB_NAME: db.name || 'wordpress',
    PROVIR_SQL: sql
  });
};

const runSqlRows = async (site, sql) => {
  if (!site.containers?.database) {
    throw createHttpError('Container de banco não encontrado para este site', 400);
  }
  const db = site.database || {};
  const script = [
    'set -e',
    'CLIENT="$(command -v mariadb || command -v mysql)"',
    '"$CLIENT" -N -B -u"$PROVIR_DB_USER" -p"$PROVIR_DB_PASS" "$PROVIR_DB_NAME" -e "$PROVIR_SQL"'
  ].join('\n');
  const result = await dockerExecShell(site.containers.database, script, {
    PROVIR_DB_USER: db.user || 'wordpress',
    PROVIR_DB_PASS: db.password || '',
    PROVIR_DB_NAME: db.name || 'wordpress',
    PROVIR_SQL: sql
  });
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t'));
};

const listDatabaseTables = async (site) =>
  (await runSqlRows(site, 'SHOW TABLES;')).map((row) => row[0]).filter(Boolean);

const hasTable = (tables = [], tableName) => tables.includes(tableName);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDatabase = async (site, progress) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      await runSql(site, 'SELECT 1;');
      progress.push('Banco WordPress pronto para conexões');
      return;
    } catch (err) {
      lastError = err;
      await sleep(1500);
    }
  }
  throw new Error(`Banco do WordPress não ficou pronto a tempo: ${lastError?.message || 'timeout'}`);
};

const repairDatabaseFilesystemPermissions = async (site) => {
  if (!site.containers?.database) return;
  const db = site.database || {};
  const script = [
    'set -e',
    'DB_OWNER="$(stat -c "%U:%G" /var/lib/mysql 2>/dev/null || echo mysql:mysql)"',
    'if id mysql >/dev/null 2>&1; then DB_OWNER="mysql:mysql"; fi',
    'chown -R "$DB_OWNER" /var/lib/mysql',
    'chmod 750 /var/lib/mysql 2>/dev/null || true',
    'if [ -n "$PROVIR_DB_NAME" ] && [ -d "/var/lib/mysql/$PROVIR_DB_NAME" ]; then',
    '  find "/var/lib/mysql/$PROVIR_DB_NAME" -type d -exec chmod 750 {} + 2>/dev/null || true',
    '  find "/var/lib/mysql/$PROVIR_DB_NAME" -type f -exec chmod 660 {} + 2>/dev/null || true',
    'fi'
  ].join('\n');
  await dockerExecRootShell(site.containers.database, script, {
    PROVIR_DB_NAME: db.name || 'wordpress'
  });
};

const importSqlFile = async (site, sqlFile) => {
  const db = site.database || {};
  const remotePath = '/tmp/provirpanel-import.sql';
  await repairDatabaseFilesystemPermissions(site);
  await runCommand('docker', ['cp', sqlFile, `${site.containers.database}:${remotePath}`], { timeout: 900000 });
  const script = [
    'set -e',
    'CLIENT="$(command -v mariadb || command -v mysql)"',
    '"$CLIENT" -u"$PROVIR_DB_USER" -p"$PROVIR_DB_PASS" "$PROVIR_DB_NAME" < /tmp/provirpanel-import.sql',
    'rm -f /tmp/provirpanel-import.sql'
  ].join('\n');
  return dockerExecShell(site.containers.database, script, {
    PROVIR_DB_USER: db.user || 'wordpress',
    PROVIR_DB_PASS: db.password || '',
    PROVIR_DB_NAME: db.name || 'wordpress'
  });
};

const normalizeWordPressPath = (value = '/') => {
  let normalized = String(value || '/').trim() || '/';
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (!normalized.endsWith('/')) normalized = `${normalized}/`;
  return normalized.replace(/\/{2,}/g, '/');
};

const buildWordPressUrl = (site, pathname = '/') => {
  const base = getSiteBaseUrl(site);
  const normalizedPath = normalizeWordPressPath(pathname);
  if (normalizedPath === '/') return base;
  return `${base}${normalizedPath.replace(/\/$/, '')}`;
};

const parsePhpDefineValue = (content = '', constantName) => {
  const regex = new RegExp(`define\\s*\\(\\s*['"]${constantName}['"]\\s*,\\s*([^;]+)\\)`, 'i');
  const match = content.match(regex);
  if (!match) return null;
  const raw = match[1].trim();
  if (/^true$/i.test(raw)) return true;
  if (/^false$/i.test(raw)) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  const stringMatch = raw.match(/^['"]([\s\S]*)['"]$/);
  return stringMatch ? stringMatch[1] : raw;
};

const readWordPressConfigMetadata = (wordpressRoot) => {
  if (!wordpressRoot) return {};
  const configPath = path.join(wordpressRoot, 'wp-config.php');
  if (!fs.existsSync(configPath)) return {};
  const content = fs.readFileSync(configPath, 'utf8');
  return {
    multisite: parsePhpDefineValue(content, 'MULTISITE') === true,
    subdomainInstall: parsePhpDefineValue(content, 'SUBDOMAIN_INSTALL'),
    domainCurrentSite: parsePhpDefineValue(content, 'DOMAIN_CURRENT_SITE'),
    pathCurrentSite: parsePhpDefineValue(content, 'PATH_CURRENT_SITE'),
    siteIdCurrentSite: parsePhpDefineValue(content, 'SITE_ID_CURRENT_SITE'),
    blogIdCurrentSite: parsePhpDefineValue(content, 'BLOG_ID_CURRENT_SITE')
  };
};

const formatPhpValue = (value) => {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
};

const upsertPhpDefine = (content, constantName, value) => {
  const line = `define('${constantName}', ${formatPhpValue(value)});`;
  const regex = new RegExp(`define\\s*\\(\\s*['"]${constantName}['"]\\s*,\\s*[^;]+\\);`, 'i');
  if (regex.test(content)) return content.replace(regex, line);
  const marker = '/* That\'s all, stop editing!';
  const markerIndex = content.indexOf(marker);
  if (markerIndex >= 0) {
    return `${content.slice(0, markerIndex).trimEnd()}\n${line}\n\n${content.slice(markerIndex)}`;
  }
  const requireMatch = content.match(/require_once\s+ABSPATH\s*\.\s*['"]wp-settings\.php['"]\s*;/i);
  if (requireMatch?.index !== undefined) {
    return `${content.slice(0, requireMatch.index).trimEnd()}\n${line}\n\n${content.slice(requireMatch.index)}`;
  }
  return `${content.trimEnd()}\n${line}\n`;
};

const hasPhpDefine = (content = '', constantName) => {
  const regex = new RegExp(`define\\s*\\(\\s*['"]${constantName}['"]\\s*,`, 'i');
  return regex.test(content);
};

const setPhpTablePrefix = (content, tablePrefix) => {
  const safePrefix = /^[a-zA-Z0-9_]+$/.test(tablePrefix) ? tablePrefix : 'wp_';
  const line = `$table_prefix = '${safePrefix}';`;
  if (/\$table_prefix\s*=\s*[^;]+;/i.test(content)) {
    return content.replace(/\$table_prefix\s*=\s*[^;]+;/i, line);
  }
  const marker = '/* That\'s all, stop editing!';
  const markerIndex = content.indexOf(marker);
  if (markerIndex >= 0) {
    return `${content.slice(0, markerIndex).trimEnd()}\n${line}\n\n${content.slice(markerIndex)}`;
  }
  return `${content.trimEnd()}\n${line}\n`;
};

const normalizeDbHost = (host) => {
  const value = String(host || '').trim();
  if (!value) return '';
  return value.includes(':') ? value : `${value}:3306`;
};

const resolveSiteDatabaseHost = async (site) => {
  const explicitHost = normalizeDbHost(site.database?.host || site.database?.dbHost);
  if (explicitHost) return explicitHost;

  const services = dockerManager.readRegistry();
  const databaseService = services.find((service) =>
    service.id === site.services?.database ||
    (service.siteId === site.id && service.siteRole === 'database')
  );
  if (databaseService?.name) {
    return normalizeDbHost(databaseService.name);
  }

  if (site.containers?.database) {
    try {
      const inspect = await dockerManager.docker.getContainer(site.containers.database).inspect();
      const containerName = String(inspect?.Name || '').replace(/^\//, '');
      if (containerName) return normalizeDbHost(containerName);
    } catch {
      // Fall back to the deterministic container name below.
    }
  }

  return normalizeDbHost(`site-${slugify(site.slug || site.name, 'wordpress')}-${String(site.id || '').slice(0, 8)}-db`);
};

const patchWordPressDatabaseDefines = async (site, content) => {
  const db = site.database || {};
  const dbPassword = db.password || '';
  if (!dbPassword || dbPassword === SECRET_MASK) {
    throw createHttpError('Senha do banco indisponível para atualizar wp-config.php', 400);
  }

  let nextContent = content;
  nextContent = upsertPhpDefine(nextContent, 'DB_NAME', db.name || 'wordpress');
  nextContent = upsertPhpDefine(nextContent, 'DB_USER', db.user || 'wordpress');
  nextContent = upsertPhpDefine(nextContent, 'DB_PASSWORD', dbPassword);
  nextContent = upsertPhpDefine(nextContent, 'DB_HOST', await resolveSiteDatabaseHost(site));
  return nextContent;
};

const readWordPressConfigFile = async (site) => {
  const configPath = path.join(site.paths?.wordpress || '', 'wp-config.php');
  if (site.paths?.wordpress && fs.existsSync(configPath)) {
    try {
      return { content: fs.readFileSync(configPath, 'utf8'), source: 'host' };
    } catch (err) {
      if (!site.containers?.wordpress) throw err;
    }
  }

  if (!site.containers?.wordpress) {
    return { content: '', source: 'missing' };
  }

  const result = await dockerExecRootShell(
    site.containers.wordpress,
    '[ -f /var/www/html/wp-config.php ] && cat /var/www/html/wp-config.php || true'
  );
  const content = String(result.stdout || '');
  return { content, source: content ? 'container' : 'missing' };
};

const writeWordPressConfigFile = async (site, content) => {
  const configPath = path.join(site.paths?.wordpress || '', 'wp-config.php');
  if (site.paths?.wordpress && fs.existsSync(path.dirname(configPath))) {
    try {
      fs.writeFileSync(configPath, content, 'utf8');
      return;
    } catch (err) {
      if (!['EACCES', 'EPERM', 'ENOENT'].includes(err.code) || !site.containers?.wordpress) {
        throw err;
      }
    }
  }

  if (!site.containers?.wordpress) {
    throw createHttpError('Container WordPress indisponível para atualizar wp-config.php', 400);
  }

  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const script = [
    'set -e',
    'CONFIG=/var/www/html/wp-config.php',
    'TMPF=$(mktemp)',
    'printf "%s" "$PROVIR_CONFIG_B64" | base64 -d > "$TMPF"',
    'chown www-data:www-data "$TMPF" 2>/dev/null || true',
    'chmod 660 "$TMPF" 2>/dev/null || true',
    'mv "$TMPF" "$CONFIG"'
  ].join('\n');
  await dockerExecRootShell(site.containers.wordpress, script, {
    PROVIR_CONFIG_B64: encoded
  });
};

const patchWordPressConfigForHostChange = async (site) => {
  const configFile = await readWordPressConfigFile(site);
  if (!configFile.content) {
    return { patched: false, message: 'wp-config.php não encontrado para ajustar domínio' };
  }

  let content = configFile.content;
  content = await patchWordPressDatabaseDefines(site, content);
  content = setPhpTablePrefix(content, getSafeTablePrefix(site));
  const multisite = parsePhpDefineValue(content, 'MULTISITE') === true || Boolean(site.wordpress?.multisite);
  const targetUrl = getSiteUrl(site);
  const targetPath = site.domain ? '/' : normalizeWordPressPath(getSiteProxyPath(site));

  if (multisite) {
    content = upsertPhpDefine(content, 'WP_ALLOW_MULTISITE', true);
    content = upsertPhpDefine(content, 'MULTISITE', true);
    content = upsertPhpDefine(content, 'DOMAIN_CURRENT_SITE', getSitePrimaryHost(site));
    content = upsertPhpDefine(content, 'PATH_CURRENT_SITE', targetPath);
    content = upsertPhpDefine(content, 'SITE_ID_CURRENT_SITE', Number(parsePhpDefineValue(content, 'SITE_ID_CURRENT_SITE') || 1));
    content = upsertPhpDefine(content, 'BLOG_ID_CURRENT_SITE', Number(parsePhpDefineValue(content, 'BLOG_ID_CURRENT_SITE') || 1));
    if (hasPhpDefine(content, 'WP_HOME')) content = upsertPhpDefine(content, 'WP_HOME', targetUrl);
    if (hasPhpDefine(content, 'WP_SITEURL')) content = upsertPhpDefine(content, 'WP_SITEURL', targetUrl);
  } else {
    content = upsertPhpDefine(content, 'WP_HOME', targetUrl);
    content = upsertPhpDefine(content, 'WP_SITEURL', targetUrl);
  }

  await writeWordPressConfigFile(site, content);
  await repairWordPressFilesystemPermissions(site);
  return { patched: true, source: configFile.source };
};

const patchWordPressConfigForRestore = async (site, restoreConfig = {}) => {
  const configFile = await readWordPressConfigFile(site);
  if (!configFile.content) {
    return { patched: false, message: 'wp-config.php não encontrado para ajustar prefixo/multisite' };
  }
  let content = configFile.content;
  content = await patchWordPressDatabaseDefines(site, content);
  content = setPhpTablePrefix(content, restoreConfig.tablePrefix || getSafeTablePrefix(site));
  if (restoreConfig.multisite) {
    const currentSitePath = site.domain
      ? normalizeWordPressPath(restoreConfig.pathCurrentSite || '/')
      : normalizeWordPressPath(getSiteProxyPath(site));
    content = upsertPhpDefine(content, 'WP_ALLOW_MULTISITE', true);
    content = upsertPhpDefine(content, 'MULTISITE', true);
    content = upsertPhpDefine(content, 'SUBDOMAIN_INSTALL', Boolean(restoreConfig.subdomainInstall));
    content = upsertPhpDefine(content, 'DOMAIN_CURRENT_SITE', getSitePrimaryHost(site));
    content = upsertPhpDefine(content, 'PATH_CURRENT_SITE', currentSitePath);
    content = upsertPhpDefine(content, 'SITE_ID_CURRENT_SITE', Number(restoreConfig.siteIdCurrentSite || 1));
    content = upsertPhpDefine(content, 'BLOG_ID_CURRENT_SITE', Number(restoreConfig.blogIdCurrentSite || 1));
  }
  await writeWordPressConfigFile(site, content);
  await repairWordPressFilesystemPermissions(site);
  return { patched: true, source: configFile.source };
};

const verifyWordPressDatabaseConnection = async (site) => {
  if (!site.containers?.wordpress) {
    return { ok: false, message: 'Container WordPress indisponível para validar conexão com banco' };
  }
  const script = [
    'set -e',
    'php -r \'',
    '$c = file_get_contents("/var/www/html/wp-config.php");',
    'function wpdef($c, $name) {',
    '  if (preg_match("/define\\\\s*\\\\(\\\\s*[\\\\\\\"\\\\\\x27]".$name."[\\\\\\\"\\\\\\x27]\\\\s*,\\\\s*[\\\\\\\"\\\\\\x27]([^\\\\\\\"\\\\\\x27]*)[\\\\\\\"\\\\\\x27]\\\\s*\\\\)/i", $c, $m)) return $m[1];',
    '  return "";',
    '}',
    '$host = wpdef($c, "DB_HOST");',
    '$name = wpdef($c, "DB_NAME");',
    '$user = wpdef($c, "DB_USER");',
    '$pass = wpdef($c, "DB_PASSWORD");',
    '$port = 3306;',
    'if (strpos($host, ":") !== false) { [$host, $port] = explode(":", $host, 2); $port = (int)$port; }',
    '$mysqli = @mysqli_init();',
    'if (!$mysqli || !@$mysqli->real_connect($host, $user, $pass, $name, $port)) { fwrite(STDERR, "DB_CONNECT_FAILED host=".$host." db=".$name." user=".$user." error=".mysqli_connect_error()); exit(12); }',
    'echo "DB_CONNECT_OK host=".$host." db=".$name." user=".$user;',
    '\''
  ].join('\n');
  try {
    const result = await dockerExecShell(site.containers.wordpress, script, {}, { timeout: 30000 });
    return { ok: true, message: String(result.stdout || '').trim() || 'DB_CONNECT_OK' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
};

const updateOptionTableUrls = async (site, tableName, url, tables = null) => {
  if (tables && !hasTable(tables, tableName)) return false;
  await runSql(
    site,
    `UPDATE ${quoteSqlIdentifier(tableName)} SET option_value='${escapeSql(url)}' WHERE option_name IN ('siteurl','home');`
  );
  return true;
};

const isMultisiteDatabase = (tables = [], prefix = 'wp_') =>
  hasTable(tables, `${prefix}site`) &&
  hasTable(tables, `${prefix}blogs`) &&
  hasTable(tables, `${prefix}sitemeta`);

const hasWordPressCoreTables = (tables = [], prefix = 'wp_') =>
  hasTable(tables, `${prefix}options`) ||
  hasTable(tables, `${prefix}users`) ||
  hasTable(tables, `${prefix}blogs`);

const inferSubdomainInstallFromDatabase = async (site, tables = [], prefix = 'wp_') => {
  const blogsTable = `${prefix}blogs`;
  if (!hasTable(tables, blogsTable)) return false;
  const blogs = (await runSqlRows(
    site,
    `SELECT blog_id,domain,path FROM ${quoteSqlIdentifier(blogsTable)} ORDER BY blog_id;`
  )).map(([blogId, domain, blogPath]) => ({
    blogId: Number(blogId),
    domain: String(domain || ''),
    path: normalizeWordPressPath(blogPath || '/')
  }));
  const primary = blogs.find((blog) => blog.blogId === 1) || blogs[0];
  if (!primary) return false;
  return blogs.some((blog) => blog.blogId > 1 && blog.domain && blog.domain !== primary.domain);
};

const replaceDomainSuffix = (domain, oldPrimaryDomain, newPrimaryDomain) => {
  const current = String(domain || '').trim();
  if (!current || !oldPrimaryDomain) return current || newPrimaryDomain;
  if (current === oldPrimaryDomain) return newPrimaryDomain;
  if (current.endsWith(`.${oldPrimaryDomain}`)) {
    return `${current.slice(0, -oldPrimaryDomain.length)}${newPrimaryDomain}`;
  }
  return current;
};

const updateMultisiteUrls = async (site, tables = [], restoreConfig = {}) => {
  const prefix = resolveWordPressTablePrefix(tables, restoreConfig.tablePrefix || getSafeTablePrefix(site));
  const siteTable = `${prefix}site`;
  const blogsTable = `${prefix}blogs`;
  const sitemetaTable = `${prefix}sitemeta`;
  const currentSitePath = site.domain
    ? normalizeWordPressPath(restoreConfig.pathCurrentSite || '/')
    : normalizeWordPressPath(getSiteProxyPath(site));
  const targetHost = getSitePrimaryHost(site);
  let oldPrimaryDomain = restoreConfig.domainCurrentSite || '';

  if (hasTable(tables, siteTable)) {
    const rows = await runSqlRows(
      site,
      `SELECT domain,path FROM ${quoteSqlIdentifier(siteTable)} ORDER BY id LIMIT 1;`
    );
    oldPrimaryDomain = oldPrimaryDomain || rows[0]?.[0] || '';
    await runSql(
      site,
      `UPDATE ${quoteSqlIdentifier(siteTable)} SET domain='${escapeSql(targetHost)}', path='${escapeSql(currentSitePath)}' ORDER BY id LIMIT 1;`
    );
  }

  let blogs = [];
  if (hasTable(tables, blogsTable)) {
    blogs = (await runSqlRows(
      site,
      `SELECT blog_id,domain,path FROM ${quoteSqlIdentifier(blogsTable)} ORDER BY blog_id;`
    )).map(([blogId, domain, blogPath]) => ({
      blogId: Number(blogId),
      domain,
      path: normalizeWordPressPath(blogPath || '/')
    })).filter((blog) => Number.isFinite(blog.blogId) && blog.blogId > 0);

    for (const blog of blogs) {
      const nextDomain = blog.blogId === 1
        ? targetHost
        : replaceDomainSuffix(blog.domain, oldPrimaryDomain, targetHost);
      const nextPath = blog.blogId === 1 ? currentSitePath : blog.path;
      await runSql(
        site,
        `UPDATE ${quoteSqlIdentifier(blogsTable)} SET domain='${escapeSql(nextDomain)}', path='${escapeSql(nextPath)}' WHERE blog_id=${blog.blogId};`
      );
      blog.domain = nextDomain;
      blog.path = nextPath;
    }
  }

  if (hasTable(tables, sitemetaTable)) {
    const networkUrl = `${buildWordPressUrl(site, currentSitePath)}/`.replace(/([^/])\/+$/, '$1/');
    await runSql(
      site,
      `UPDATE ${quoteSqlIdentifier(sitemetaTable)} SET meta_value='${escapeSql(networkUrl)}' WHERE meta_key='siteurl';`
    );
  }

  const optionTables = new Set([`${prefix}options`]);
  blogs.forEach((blog) => {
    const tableName = blog.blogId === 1 ? `${prefix}options` : `${prefix}${blog.blogId}_options`;
    optionTables.add(tableName);
  });
  tables
    .filter((tableName) => new RegExp(`^${escapeRegExp(prefix)}\\d+_options$`).test(tableName))
    .forEach((tableName) => optionTables.add(tableName));

  for (const tableName of optionTables) {
    if (!hasTable(tables, tableName)) continue;
    const blogMatch = tableName.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)_options$`));
    const blog = blogMatch
      ? blogs.find((entry) => entry.blogId === Number(blogMatch[1]))
      : blogs.find((entry) => entry.blogId === 1);
    const url = blog
      ? buildWordPressUrl({ ...site, domain: blog.domain }, blog.path)
      : buildWordPressUrl(site, currentSitePath);
    await updateOptionTableUrls(site, tableName, url, tables);
  }
};

const updateWordPressUrls = async (site, restoreConfig = {}) => {
  const tables = await listDatabaseTables(site);
  const prefix = resolveWordPressTablePrefix(tables, restoreConfig.tablePrefix || getSafeTablePrefix(site));
  const url = getSiteUrl(site);
  const optionsTable = `${prefix}options`;
  if (!hasTable(tables, optionsTable)) {
    throw createHttpError(`Tabela ${optionsTable} não encontrada após importação. Verifique table_prefix/wp-config.php.`, 400);
  }
  await updateOptionTableUrls(site, optionsTable, url, tables);
  const multisite = restoreConfig.multisite || site.wordpress?.multisite || isMultisiteDatabase(tables, prefix);
  if (multisite) {
    await updateMultisiteUrls(site, tables, { ...restoreConfig, tablePrefix: prefix });
  }
  return { tablePrefix: prefix, multisite, url };
};

const repairWordPressFilesystemPermissions = async (site) => {
  if (!site.containers?.wordpress) return;
  const script = [
    'set -e',
    'for i in $(seq 1 40); do',
    '  [ -e /var/www/html/wp-config.php ] && break',
    '  sleep 1',
    'done',
    'chown -R www-data:www-data /var/www/html',
    'find /var/www/html -type d -exec chmod 755 {} +',
    'find /var/www/html -type f -exec chmod 644 {} +',
    'if [ -d /var/www/html/wp-content ]; then',
    '  find /var/www/html/wp-content -type d -exec chmod 775 {} +',
    '  find /var/www/html/wp-content -type f -exec chmod 664 {} +',
    'fi',
    'if [ -f /var/www/html/wp-config.php ]; then',
    '  chmod 660 /var/www/html/wp-config.php',
    'fi'
  ].join('\n');
  await dockerExecRootShell(site.containers.wordpress, script);
};

const cleanupWordPressCacheFiles = (site) => {
  const wordpressRoot = site.paths?.wordpress;
  if (!wordpressRoot) return [];

  const cachePaths = [
    'wp-content/litespeed',
    'wp-content/cache/litespeed',
    'wp-content/cache/autoptimize',
    'wp-content/cache/wp-rocket',
    'wp-content/cache/min',
    'wp-content/cache/busting',
    'wp-content/cache/critical-css',
    'wp-content/cache/page_enhanced',
    'wp-content/cache/supercache',
    'wp-content/cache/wpo-cache',
    'wp-content/cache/breeze',
    'wp-content/cache/hummingbird',
    'wp-content/cache/comet-cache',
    'wp-content/cache/asset-cleanup',
    'wp-content/cache/css',
    'wp-content/cache/js',
    'wp-content/uploads/ao_ccss',
    'wp-content/advanced-cache.php',
    'wp-content/wp-cache-config.php'
  ];

  const removed = [];
  const removePath = (relativePath) => {
    const target = path.join(wordpressRoot, relativePath);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(relativePath);
    }
  };

  cachePaths.forEach(removePath);

  const cacheDir = path.join(wordpressRoot, 'wp-content/cache');
  if (fs.existsSync(cacheDir)) {
    fs.readdirSync(cacheDir, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isDirectory()) return;
      if (/^(autoptimize|litespeed|rocket|wpo|breeze|hummingbird)/i.test(entry.name)) {
        removePath(`wp-content/cache/${entry.name}`);
      }
    });
  }

  const uploadsSitesDir = path.join(wordpressRoot, 'wp-content/uploads/sites');
  if (fs.existsSync(uploadsSitesDir)) {
    fs.readdirSync(uploadsSitesDir, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) return;
      removePath(`wp-content/uploads/sites/${entry.name}/ao_ccss`);
    });
  }

  return removed;
};

const getWordPressOptionTables = (tables = [], prefix = 'wp_') => {
  const optionTables = new Set();
  if (hasTable(tables, `${prefix}options`)) optionTables.add(`${prefix}options`);
  const subsiteRegex = new RegExp(`^${escapeRegExp(prefix)}\\d+_options$`);
  tables
    .filter((tableName) => subsiteRegex.test(tableName))
    .forEach((tableName) => optionTables.add(tableName));
  return Array.from(optionTables);
};

const truncateCacheTablesIfPresent = async (site, tables) => {
  if (!tables.length) return;
  const db = site.database || {};
  const script = [
    'set -e',
    'CLIENT="$(command -v mariadb || command -v mysql)"',
    'for TABLE in $PROVIR_TABLES; do',
    '  if "$CLIENT" -N -B -u"$PROVIR_DB_USER" -p"$PROVIR_DB_PASS" "$PROVIR_DB_NAME" -e "SHOW TABLES LIKE \'$TABLE\'" | grep -qx "$TABLE"; then',
    '    "$CLIENT" -u"$PROVIR_DB_USER" -p"$PROVIR_DB_PASS" "$PROVIR_DB_NAME" -e "TRUNCATE TABLE $TABLE"',
    '  fi',
    'done'
  ].join('\n');
  await dockerExecShell(site.containers.database, script, {
    PROVIR_DB_USER: db.user || 'wordpress',
    PROVIR_DB_PASS: db.password || '',
    PROVIR_DB_NAME: db.name || 'wordpress',
    PROVIR_TABLES: tables.join(' ')
  });
};

const cleanupWordPressCacheDatabase = async (site) => {
  const tables = await listDatabaseTables(site);
  const prefix = resolveWordPressTablePrefix(tables, getSafeTablePrefix(site));
  const optionTables = getWordPressOptionTables(tables, prefix);
  if (!optionTables.length) return { tablePrefix: prefix, optionTables: 0 };

  const disabledOptions = [
    'litespeed.conf.guest',
    'litespeed.conf.guest_optm',
    'litespeed.conf.cache-resources',
    'litespeed.conf.optm-css_min',
    'litespeed.conf.optm-css_comb',
    'litespeed.conf.optm-css_comb_ext_inl',
    'litespeed.conf.optm-css_async',
    'litespeed.conf.optm-css_async_inline',
    'litespeed.conf.optm-js_min',
    'litespeed.conf.optm-js_comb',
    'litespeed.conf.optm-js_comb_ext_inl',
    'litespeed.conf.optm-js_defer',
    'litespeed.conf.optm-guest_only',
    'autoptimize_html',
    'autoptimize_js',
    'autoptimize_css',
    'autoptimize_css_defer',
    'autoptimize_css_inline',
    'autoptimize_css_include_inline',
    'autoptimize_css_datauris',
    'autoptimize_css_justhead',
    'autoptimize_js_include_inline',
    'autoptimize_js_trycatch',
    'autoptimize_imgopt_lazyload'
  ];
  const deletedOptions = [
    'litespeed.purge.queue',
    'litespeed.purge.queue2',
    'autoptimize_cache_size',
    'autoptimize_cache_cleaned',
    'rewrite_rules',
    '_site_transient_theme_roots',
    '_site_transient_timeout_theme_roots',
    '_site_transient_update_themes',
    '_site_transient_timeout_update_themes',
    '_transient_theme_roots',
    '_transient_timeout_theme_roots',
    '_transient_update_themes',
    '_transient_timeout_update_themes'
  ];
  const transientPatterns = [
    '_transient_litespeed%',
    '_site_transient_litespeed%',
    '_transient_timeout_litespeed%',
    '_site_transient_timeout_litespeed%',
    '_transient_rocket%',
    '_site_transient_rocket%',
    '_transient_timeout_rocket%',
    '_site_transient_timeout_rocket%',
    '_transient_autoptimize%',
    '_site_transient_autoptimize%',
    '_transient_timeout_autoptimize%',
    '_site_transient_timeout_autoptimize%',
    '_transient_rsssl%',
    '_site_transient_rsssl%',
    '_transient_timeout_rsssl%',
    '_site_transient_timeout_rsssl%'
  ];
  const quotedOptions = disabledOptions.map((name) => `'${escapeSql(name)}'`).join(',');
  const quotedDeletedOptions = deletedOptions.map((name) => `'${escapeSql(name)}'`).join(',');
  const deleteCacheWhere = [
    `option_name IN (${quotedDeletedOptions})`,
    "option_name LIKE 'autoptimize_cache_%'",
    "option_name LIKE 'ao_ccss_%'",
    ...transientPatterns.map((pattern) => `option_name LIKE '${escapeSql(pattern)}'`)
  ].join(' OR ');
  const sql = optionTables
    .map((tableName) => {
      const table = quoteSqlIdentifier(tableName);
      return [
        `UPDATE ${table} SET option_value='' WHERE option_name IN (${quotedOptions});`,
        `DELETE FROM ${table} WHERE ${deleteCacheWhere};`
      ].join(' ');
    })
    .join(' ');
  await runSql(site, sql);
  await truncateCacheTablesIfPresent(site, [
    `${prefix}litespeed_url`,
    `${prefix}litespeed_url_file`,
    `${prefix}litespeed_img_optm`,
    `${prefix}litespeed_img_optming`
  ]);
  return { tablePrefix: prefix, optionTables: optionTables.length };
};

const cleanupWordPressAfterMigration = async (site) => {
  const removed = cleanupWordPressCacheFiles(site);
  const databaseCleanup = await cleanupWordPressCacheDatabase(site);
  return { removed, databaseCleanup };
};

const createWordPressSite = async (body = {}) => {
  const name = String(body.name || body.clientName || '').trim();
  if (!name) {
    throw createHttpError('Nome do site obrigatório', 400);
  }
  const id = crypto.randomUUID();
  const slug = slugify(name, 'wordpress');
  const shortId = id.slice(0, 8);
  const domain = normalizeOptionalDomain(body.domain);
  const proxyHost = buildSiteProxyHost(slug, shortId);
  const proxyPath = normalizeProxyPath(body.proxyPath);
  const siteDir = path.join(sitesBaseDir, `${slug}-${shortId}`);
  const wordpressDir = path.join(siteDir, 'wordpress');
  const databaseDir = path.join(siteDir, 'database');
  const phpDir = path.join(siteDir, 'php');
  const migrationsDir = path.join(siteDir, 'migrations');
  fs.mkdirSync(wordpressDir, { recursive: true });
  fs.mkdirSync(databaseDir, { recursive: true });
  fs.mkdirSync(phpDir, { recursive: true });
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(
    path.join(phpDir, 'provirpanel.ini'),
    [
      'upload_max_filesize=800M',
      'post_max_size=800M',
      'memory_limit=512M',
      'max_execution_time=300',
      'max_input_time=300'
    ].join('\n'),
    'utf8'
  );

  const progress = [];
  const warnings = [];
  const dbPassword = randomPassword(22);
  const rootPassword = randomPassword(24);
  const adminPassword = String(body.adminPassword || '').trim() || randomPassword(18);
  const databaseName = slugify(body.dbName || `${slug}_wp`, 'wordpress').replace(/-/g, '_').slice(0, 48);
  const dbContainerName = `site-${slug}-${shortId}-db`;
  const wordpressContainerName = `site-${slug}-${shortId}-wp`;
  const wordpressServiceId = `${id}-wordpress`;
  const databaseServiceId = `${id}-database`;
  const port = await dockerManager.findAvailablePort(Number(process.env.SITES_PORT_START || 8100));
  if (!port) {
    throw createHttpError('Nenhuma porta local disponível para publicar o WordPress', 500);
  }

  const site = {
    id,
    type: 'wordpress',
    name,
    slug,
    domain,
    proxyHost,
    proxyPath,
    proxyMode: !domain,
    port,
    ssl: domain ? Boolean(body.ssl) : false,
    url: getSiteUrl({ domain, proxyHost, proxyPath, ssl: domain ? Boolean(body.ssl) : false }),
    localUrl: `http://localhost:${port}`,
    networkName: buildSiteNetworkName(slug, shortId),
    siteDir,
    paths: {
      wordpress: wordpressDir,
      wpContent: path.join(wordpressDir, 'wp-content'),
      database: databaseDir,
      migrations: migrationsDir
    },
    containers: {},
    services: {
      wordpress: wordpressServiceId,
      database: databaseServiceId
    },
    images: {
      wordpress: wordpressImage,
      database: configuredDatabaseImage
    },
    database: {
      name: databaseName,
      user: 'wordpress',
      password: dbPassword,
      rootPassword
    },
    wordpress: {
      adminUser: String(body.adminUser || 'admin').trim() || 'admin',
      adminEmail: String(body.adminEmail || '').trim(),
      adminPassword,
      tablePrefix: 'wp_'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const siteNetworkName = getSiteNetworkName(site);
  await dockerManager.ensureNetwork(siteNetworkName);
  const selectedDatabaseImage = await ensureFirstAvailableImage(databaseImageCandidates, progress, 'banco de dados WordPress');
  const selectedWordPressImage = await ensureImage(wordpressImage, progress);
  const databaseContainerEnv = getDatabaseContainerEnv(selectedDatabaseImage, databaseName, dbPassword, rootPassword);
  site.images = {
    wordpress: selectedWordPressImage,
    database: selectedDatabaseImage
  };
  await removeContainerByName(dbContainerName);
  await removeContainerByName(wordpressContainerName);

  progress.push(`Criando banco ${selectedDatabaseImage} com volume local`);
  const dbContainer = await dockerManager.docker.createContainer({
    Image: selectedDatabaseImage,
    name: dbContainerName,
    Labels: createLabels(site, 'database', databaseServiceId, dbContainerName),
    Env: databaseContainerEnv,
    HostConfig: {
      NetworkMode: siteNetworkName,
      Binds: [`${databaseDir}:/var/lib/mysql`]
    }
  });
  await dbContainer.start();
  const dbInspect = await dbContainer.inspect();
  site.containers.database = dbInspect.Id;
  await waitForDatabase(site, progress);
  try {
    await repairDatabaseFilesystemPermissions(site);
    progress.push('Permissões do volume do banco ajustadas');
  } catch (err) {
    warnings.push(`Banco criado, mas o ajuste de permissões do volume falhou: ${err.message}`);
  }

  progress.push('Criando WordPress com PHP ajustado para uploads grandes');
  const wpContainer = await dockerManager.docker.createContainer({
    Image: selectedWordPressImage,
    name: wordpressContainerName,
    Labels: createLabels(site, 'wordpress', wordpressServiceId, wordpressContainerName),
    Env: [
      `WORDPRESS_DB_HOST=${dbContainerName}:3306`,
      `WORDPRESS_DB_NAME=${databaseName}`,
      'WORDPRESS_DB_USER=wordpress',
      `WORDPRESS_DB_PASSWORD=${dbPassword}`,
      'WORDPRESS_TABLE_PREFIX=wp_',
      "WORDPRESS_CONFIG_EXTRA=if (isset(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') { \$_SERVER['HTTPS'] = 'on'; }\ndefine('FORCE_SSL_ADMIN', false);\ndefine('FS_METHOD', 'direct');\ndefine('WP_MEMORY_LIMIT', '256M');\ndefine('WP_MAX_MEMORY_LIMIT', '512M');"
    ],
    ExposedPorts: {
      '80/tcp': {}
    },
    HostConfig: {
      NetworkMode: siteNetworkName,
      PortBindings: {
        '80/tcp': [{ HostPort: String(port), HostIp: '127.0.0.1' }]
      },
      Binds: [
        `${wordpressDir}:/var/www/html`,
        `${path.join(phpDir, 'provirpanel.ini')}:/usr/local/etc/php/conf.d/provirpanel.ini:ro`
      ]
    }
  });
  await wpContainer.start();
  const wpInspect = await wpContainer.inspect();
  site.containers.wordpress = wpInspect.Id;
  try {
    await repairWordPressFilesystemPermissions(site);
    progress.push('Permissões do WordPress ajustadas para o PHP gravar wp-config.php e wp-content');
  } catch (err) {
    warnings.push(`WordPress criado, mas o ajuste de permissões falhou: ${err.message}`);
  }

  site.nginxConfigName = writeNginxSite(site, warnings);
  saveSite(site);

  dockerManager.saveService({
    id: databaseServiceId,
    name: dbContainerName,
    templateId: 'site-wordpress-db',
    image: selectedDatabaseImage,
    containerId: dbInspect.Id,
    hostPort: null,
    containerPort: 3306,
    volumes: [{ hostPath: databaseDir, containerPath: '/var/lib/mysql' }],
    envVars: containerEnvToRegistryEntries(databaseContainerEnv),
    networkName: siteNetworkName,
    bindLocalOnly: true,
    url: null,
    externalUrl: null,
    createdAt: site.createdAt,
    hasProject: false,
    siteId: site.id,
    siteRole: 'database'
  });

  dockerManager.saveService({
    id: wordpressServiceId,
    name: wordpressContainerName,
    templateId: 'site-wordpress',
    image: selectedWordPressImage,
    containerId: wpInspect.Id,
    hostPort: port,
    containerPort: 80,
    volumes: [
      { hostPath: wordpressDir, containerPath: '/var/www/html' },
      { hostPath: path.join(phpDir, 'provirpanel.ini'), containerPath: '/usr/local/etc/php/conf.d/provirpanel.ini' }
    ],
    envVars: [
      { key: 'WORDPRESS_DB_HOST', value: `${dbContainerName}:3306` },
      { key: 'WORDPRESS_DB_NAME', value: databaseName },
      { key: 'WORDPRESS_DB_USER', value: 'wordpress' },
      { key: 'WORDPRESS_DB_PASSWORD', value: dbPassword, secret: true },
      { key: 'WORDPRESS_TABLE_PREFIX', value: 'wp_' }
    ],
    networkName: siteNetworkName,
    bindLocalOnly: true,
    url: `http://localhost:${port}`,
    externalUrl: getSiteUrl(site),
    createdAt: site.createdAt,
    hasProject: true,
    siteId: site.id,
    siteRole: 'wordpress'
  });

  progress.push('Site salvo no painel');
  return { site, progress, warnings };
};

const getSiteOr404 = (siteId) => {
  const site = readSites().find((entry) => entry.id === siteId);
  if (!site) {
    throw createHttpError('Site não encontrado', 404);
  }
  return site;
};

const syncSiteWordPressServiceUrl = (site) => {
  const services = dockerManager.readRegistry();
  const wordpressService = services.find((service) =>
    service.id === site.services?.wordpress ||
    (service.siteId === site.id && service.siteRole === 'wordpress')
  );
  if (!wordpressService) return false;
  dockerManager.saveService({
    ...wordpressService,
    externalUrl: getSiteUrl(site)
  });
  return true;
};

const buildWpContentStorageId = (site) => `site-${site.id}-wp-content`;

const ensureWpContentStorageEnvironment = async (site) => {
  if (!site.paths?.wordpress) {
    throw createHttpError('Pasta do WordPress não encontrada para este site', 400);
  }
  const wpContentPath = site.paths.wpContent || path.join(site.paths.wordpress, 'wp-content');
  fs.mkdirSync(wpContentPath, { recursive: true });
  ['themes', 'plugins', 'uploads'].forEach((entry) => {
    fs.mkdirSync(path.join(wpContentPath, entry), { recursive: true });
  });
  try {
    fs.rmdirSync(path.join(wpContentPath, 'docker'));
  } catch {
    // Keep the folder if it does not exist or has any user content.
  }

  try {
    await repairWordPressFilesystemPermissions(site);
  } catch {
    // Permission repair is best-effort; the file manager still points to the correct folder.
  }

  const environmentId = buildWpContentStorageId(site);
  const payload = {
    id: environmentId,
    name: `WP Content - ${site.name}`,
    provider: 'local',
    isActive: true,
    config: {
      basePath: wpContentPath
    },
    permissions: DEFAULT_PERMISSIONS
  };
  let environment;
  const existing = storageEnvironmentManager.listEnvironments().find((env) => env.id === environmentId);
  if (existing) {
    environment = storageEnvironmentManager.updateEnvironment(environmentId, payload);
  } else {
    environment = storageEnvironmentManager.createEnvironment(payload);
  }

  site.wpContentStorage = {
    environmentId,
    basePath: wpContentPath,
    paths: {
      root: '/',
      themes: '/themes',
      plugins: '/plugins',
      uploads: '/uploads'
    },
    updatedAt: new Date().toISOString()
  };
  site.paths = {
    ...(site.paths || {}),
    wpContent: wpContentPath
  };
  site.updatedAt = new Date().toISOString();
  saveSite(site);

  return {
    environment,
    wpContentStorage: site.wpContentStorage,
    fileManagerUrl: `/files?environmentId=${encodeURIComponent(environmentId)}&path=%2F`
  };
};

const removeContainerById = async (containerId, warnings, label) => {
  if (!containerId) return;
  try {
    await dockerManager.docker.getContainer(containerId).remove({ force: true });
  } catch (err) {
    warnings.push(`${label} não foi removido automaticamente: ${err.message}`);
  }
};

const sanitizeSiteForBackupConfig = (site) => ({
  ...sanitizeSiteForClient(site),
  backupNote: 'Senhas sensíveis foram mascaradas. Atualize wp-config.php com as credenciais da nova instância ao restaurar.'
});

const buildRestoreReadme = (site, filename) => `# Restaurar WordPress - ${site.name}

Backup gerado pelo ProvirPanel em ${new Date().toISOString()}.

## Conteúdo do pacote

- \`wordpress/\`: arquivos do WordPress, incluindo \`wp-content\`, plugins, temas, uploads e \`wp-config.php\` quando existir.
- \`database/wordpress.sql\`: dump do banco de dados.
- \`config/provirpanel-site.json\`: metadados do site no painel, com senhas mascaradas.
- \`config/nginx.conf\`: configuração Nginx usada pelo painel, quando disponível.

## Restaurar em uma instância básica de WordPress

1. Crie uma instalação limpa de WordPress com MySQL ou MariaDB.
2. Pare temporariamente o WordPress ou coloque o site em manutenção.
3. Copie o conteúdo da pasta \`wordpress/\` para a raiz pública da nova instalação.
4. Ajuste permissões: diretórios \`755\`, arquivos \`644\` e \`wp-content\` gravável pelo usuário do PHP.
5. Crie um banco vazio e importe o dump:

\`\`\`bash
mysql -u USUARIO -p NOME_DO_BANCO < database/wordpress.sql
\`\`\`

6. Edite \`wp-config.php\` e atualize \`DB_NAME\`, \`DB_USER\`, \`DB_PASSWORD\` e \`DB_HOST\`.
7. Se o domínio mudou, atualize \`siteurl\` e \`home\` no banco:

\`\`\`sql
UPDATE wp_options SET option_value='https://novo-dominio.com.br' WHERE option_name IN ('siteurl','home');
\`\`\`

8. Se o backup for WordPress Multisite, valide também:

- \`wp-config.php\` precisa manter \`MULTISITE\`, \`SUBDOMAIN_INSTALL\`, \`DOMAIN_CURRENT_SITE\`, \`PATH_CURRENT_SITE\`, \`SITE_ID_CURRENT_SITE\` e \`BLOG_ID_CURRENT_SITE\`.
- O \`$table_prefix\` do \`wp-config.php\` precisa bater com as tabelas importadas.
- Atualize \`wp_site\`, \`wp_blogs\`, \`wp_sitemeta.siteurl\` e as tabelas \`wp_2_options\`, \`wp_3_options\` etc. quando existirem.
- Preserve \`wp-content/uploads/sites/{ID}\`, pois os uploads dos sites filhos ficam nessa estrutura.

9. Limpe caches de plugins e, se necessário, gere novamente links permanentes no painel do WordPress.
10. Aponte o Nginx/Apache para a nova raiz pública e valide o acesso ao \`/wp-admin\`.

Arquivo: ${filename}
URL original: ${getSiteUrl(site)}
`;

const dumpDatabaseToFile = async (site, sqlFile) => {
  if (!site.containers?.database) {
    throw createHttpError('Container de banco não encontrado para este site', 400);
  }
  const status = await inspectContainerStatus(site.containers.database);
  if (status !== 'running') {
    throw createHttpError('O banco precisa estar em execução para gerar o backup completo.', 400);
  }
  const db = site.database || {};
  const script = [
    'set -e',
    'DUMP="$(command -v mariadb-dump || command -v mysqldump)"',
    '"$DUMP" --single-transaction --quick --routines --triggers -u"$PROVIR_DB_USER" -p"$PROVIR_DB_PASS" "$PROVIR_DB_NAME"'
  ].join('\n');
  const result = await dockerExecShell(
    site.containers.database,
    script,
    {
      PROVIR_DB_USER: db.user || 'wordpress',
      PROVIR_DB_PASS: db.password || '',
      PROVIR_DB_NAME: db.name || 'wordpress'
    },
    { maxBuffer: 1024 * 1024 * 1024 }
  );
  fs.writeFileSync(sqlFile, result.stdout, 'utf8');
};

const generateSiteBackup = async (site) => {
  if (!site.paths?.wordpress || !fs.existsSync(site.paths.wordpress)) {
    throw createHttpError('Pasta do WordPress não encontrada para backup', 400);
  }

  const backupId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const backupDir = path.join(site.paths?.backups || path.join(site.siteDir, 'backups'));
  const stagingDir = path.join(backupDir, `work-${backupId}`);
  const filename = `${slugify(site.name, 'wordpress')}-${backupId}.tar.gz`;
  const archivePath = path.join(backupDir, filename);
  fs.mkdirSync(path.join(stagingDir, 'database'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'config'), { recursive: true });

  try {
    await dumpDatabaseToFile(site, path.join(stagingDir, 'database', 'wordpress.sql'));
    fs.writeFileSync(path.join(stagingDir, 'README-restore.md'), buildRestoreReadme(site, filename), 'utf8');
    fs.writeFileSync(
      path.join(stagingDir, 'config', 'provirpanel-site.json'),
      JSON.stringify(sanitizeSiteForBackupConfig(site), null, 2),
      'utf8'
    );
    if (site.nginxConfigName) {
      try {
        const nginxConfigPath = nginxManager.resolveConfigPath(site.nginxConfigName);
        if (fs.existsSync(nginxConfigPath)) {
          fs.copyFileSync(nginxConfigPath, path.join(stagingDir, 'config', 'nginx.conf'));
        }
      } catch (err) {
        fs.writeFileSync(path.join(stagingDir, 'config', 'nginx-warning.txt'), err.message, 'utf8');
      }
    }

    const wordpressLink = path.join(stagingDir, 'wordpress');
    try {
      fs.symlinkSync(site.paths.wordpress, wordpressLink, 'dir');
    } catch (err) {
      fs.cpSync(site.paths.wordpress, wordpressLink, { recursive: true, force: true });
    }

    await ensureExtractor('tar', 'tar');
    await runCommand('tar', ['-czhf', archivePath, '-C', stagingDir, '.'], { timeout: 900000, maxBuffer: 50 * 1024 * 1024 });
    site.lastBackup = {
      id: backupId,
      filename,
      archivePath,
      createdAt: new Date().toISOString()
    };
    site.updatedAt = new Date().toISOString();
    saveSite(site);
    return { archivePath, filename, stagingDir };
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }
};

const removeSite = async (site, options = {}) => {
  const confirmName = String(options.confirmName || '').trim();
  if (confirmName !== site.name) {
    throw createHttpError('Digite o nome exato do site para confirmar a exclusão.', 400);
  }

  const warnings = [];
  await removeContainerById(site.containers?.wordpress, warnings, 'Container WordPress');
  await removeContainerById(site.containers?.database, warnings, 'Container de banco');

  if (site.nginxConfigName) {
    try {
      nginxManager.deleteConfig(site.nginxConfigName);
      try {
        nginxManager.reload();
      } catch (err) {
        warnings.push(`Nginx removido, mas o reload falhou: ${err.message}`);
      }
    } catch (err) {
      warnings.push(`Configuração Nginx não foi removida: ${err.message}`);
    }
  }

  [site.services?.wordpress, site.services?.database].filter(Boolean).forEach((serviceId) => {
    try {
      dockerManager.removeService(serviceId);
    } catch (err) {
      warnings.push(`Serviço ${serviceId} não foi removido do registro: ${err.message}`);
    }
  });

  const wpContentStorageId = site.wpContentStorage?.environmentId || buildWpContentStorageId(site);
  try {
    storageEnvironmentManager.deleteEnvironment(wpContentStorageId);
  } catch (err) {
    if (!/not found/i.test(err.message || '')) {
      warnings.push(`Ambiente wp-content não foi removido: ${err.message}`);
    }
  }

  const networkName = getSiteNetworkName(site);
  if (networkName && networkName !== legacySitesNetworkName) {
    try {
      await runCommand('docker', ['network', 'rm', networkName], { timeout: 30000 });
    } catch (err) {
      warnings.push(`Rede Docker ${networkName} não foi removida: ${err.message}`);
    }
  }

  if (options.removeFiles !== false && site.siteDir) {
    try {
      fs.rmSync(site.siteDir, { recursive: true, force: true });
    } catch (err) {
      warnings.push(`Arquivos locais não foram removidos: ${err.message}`);
    }
  }

  writeSites(readSites().filter((entry) => entry.id !== site.id));
  return warnings;
};

const requireMigrationTargetReady = async (site) => {
  if (!site?.containers?.database) {
    throw createHttpError('A migração precisa de um site WordPress criado com banco de dados.', 400);
  }
  const databaseStatus = await inspectContainerStatus(site.containers.database);
  if (databaseStatus !== 'running') {
    throw createHttpError('A migração precisa de um site WordPress criado com o banco em execução.', 400);
  }
};

const processMigrationArchive = async (siteId, file) => {
  if (!file?.path) {
    throw createHttpError('Arquivo de migração obrigatório', 400);
  }
  const site = getSiteOr404(siteId);
  await requireMigrationTargetReady(site);
  const migrationId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const migrationDir = path.join(site.paths?.migrations || path.join(site.siteDir, 'migrations'), migrationId);
  fs.mkdirSync(migrationDir, { recursive: true });

  const originalName = file.originalname || file.filename || 'backup';
  const lowerName = originalName.toLowerCase();
  const actions = [];
  let sqlFile = null;
  let extractionDir = migrationDir;

  try {
    if (lowerName.endsWith('.sql')) {
      sqlFile = path.join(migrationDir, safeUploadFilename(originalName, 'wordpress.sql'));
      fs.copyFileSync(file.path, sqlFile);
      actions.push('Dump SQL identificado');
    } else {
      const extracted = await extractArchiveTo(file.path, extractionDir, originalName);
      if (!extracted) {
        const savedPath = path.join(migrationDir, safeUploadFilename(originalName, 'wordpress-backup.bin'));
        fs.copyFileSync(file.path, savedPath);
        throw createHttpError('Formato salvo, mas ainda não suportado para extração automática. Use .zip, .tar, .tar.gz, .tgz ou .sql.', 400);
      }
      actions.push('Backup extraído para análise');
      sqlFile = findFirstSqlFile(extractionDir);
    }

    const wpContentDir = fs.existsSync(extractionDir) ? findWpContentDir(extractionDir) : null;
    const wordpressRoot = fs.existsSync(extractionDir) ? findWordPressRoot(extractionDir) : null;
    const wordpressConfigMetadata = readWordPressConfigMetadata(wordpressRoot);

    if (wpContentDir) {
      copyDirectoryContents(wpContentDir, path.join(site.paths.wordpress, 'wp-content'));
      actions.push('wp-content copiado para o volume local do WordPress');
    }

    if (wordpressRoot && fs.existsSync(path.join(wordpressRoot, '.htaccess'))) {
      fs.copyFileSync(path.join(wordpressRoot, '.htaccess'), path.join(site.paths.wordpress, '.htaccess'));
      actions.push('.htaccess copiado');
    }

    if (sqlFile) {
      const detectedTablePrefix = detectTablePrefixFromSql(sqlFile);
      await importSqlFile(site, sqlFile);
      const tables = await listDatabaseTables(site);
      const tablePrefix = resolveWordPressTablePrefix(tables, detectedTablePrefix);
      const multisite = wordpressConfigMetadata.multisite || isMultisiteDatabase(tables, tablePrefix);
      const subdomainInstall = wordpressConfigMetadata.subdomainInstall ?? (
        multisite ? await inferSubdomainInstallFromDatabase(site, tables, tablePrefix) : false
      );
      const restoreConfig = {
        ...wordpressConfigMetadata,
        tablePrefix,
        multisite,
        subdomainInstall,
        pathCurrentSite: normalizeWordPressPath(wordpressConfigMetadata.pathCurrentSite || '/'),
        siteIdCurrentSite: Number(wordpressConfigMetadata.siteIdCurrentSite || 1),
        blogIdCurrentSite: Number(wordpressConfigMetadata.blogIdCurrentSite || 1)
      };
      site.wordpress = {
        ...(site.wordpress || {}),
        tablePrefix,
        multisite,
        multisiteConfig: multisite
          ? {
              subdomainInstall: Boolean(restoreConfig.subdomainInstall),
              pathCurrentSite: restoreConfig.pathCurrentSite,
              siteIdCurrentSite: restoreConfig.siteIdCurrentSite,
              blogIdCurrentSite: restoreConfig.blogIdCurrentSite
            }
          : null
      };
      actions.push(`Banco importado com prefixo ${tablePrefix}${multisite ? ' (multisite detectado)' : ''}`);
      try {
        const patchResult = await patchWordPressConfigForRestore(site, restoreConfig);
        actions.push(
          patchResult.patched
            ? `wp-config.php ajustado para prefixo ${tablePrefix}${multisite ? ' e multisite' : ''}`
            : patchResult.message
        );
        if (patchResult.patched) {
          const dbCheck = await verifyWordPressDatabaseConnection(site);
          actions.push(dbCheck.ok ? `Conexão WordPress -> banco validada (${dbCheck.message})` : `Conexão WordPress -> banco falhou: ${dbCheck.message}`);
        }
      } catch (err) {
        actions.push(`Banco importado, mas o ajuste do wp-config.php falhou: ${err.message}`);
      }
      try {
        await updateWordPressUrls(site, restoreConfig);
        actions.push(
          multisite
            ? `URLs do multisite ajustadas para ${getSiteUrl(site)}`
            : `siteurl/home ajustados para ${getSiteUrl(site)}`
        );
      } catch (err) {
        actions.push(`Banco importado, mas o ajuste de domínio falhou: ${err.message}`);
      }
      try {
        const cacheCleanup = await cleanupWordPressAfterMigration(site);
        const removedCachePaths = cacheCleanup.removed || [];
        const optionTables = cacheCleanup.databaseCleanup?.optionTables || 0;
        actions.push(
          removedCachePaths.length || optionTables
            ? `Cache/otimizacoes do backup limpos (${removedCachePaths.length} caminhos removidos, ${optionTables} tabelas de opções)`
            : 'Otimizacoes de cache do backup desativadas'
        );
      } catch (err) {
        actions.push(`Backup restaurado, mas a limpeza de cache/otimizacao falhou: ${err.message}`);
      }
    }
    if (wpContentDir || wordpressRoot || sqlFile) {
      try {
        await repairWordPressFilesystemPermissions(site);
        actions.push('Permissões do WordPress ajustadas para wp-config.php e wp-content');
      } catch (err) {
        actions.push(`Backup restaurado, mas o ajuste de permissões falhou: ${err.message}`);
      }
    }

    site.lastMigration = {
      id: migrationId,
      filename: originalName,
      sqlFound: Boolean(sqlFile),
      wpContentFound: Boolean(wpContentDir),
      wordpressRootFound: Boolean(wordpressRoot),
      multisite: Boolean(site.wordpress?.multisite),
      actions,
      createdAt: new Date().toISOString()
    };
    site.updatedAt = new Date().toISOString();
    saveSite(site);

    return {
      site,
      migration: site.lastMigration
    };
  } finally {
    fs.unlink(file.path, () => {});
  }
};

const permissionsFixedCache = new Set();

const autoFixPermissionsIfNeeded = async (site) => {
  if (!site.containers?.wordpress) return;
  if (permissionsFixedCache.has(site.id)) return;
  const status = await inspectContainerStatus(site.containers.wordpress);
  if (status !== 'running') return;
  permissionsFixedCache.add(site.id);
  repairWordPressFilesystemPermissions(site).catch(() => {});
};

router.get('/', async (_req, res, next) => {
  try {
    const rawSites = readSites();
    const sites = await Promise.all(rawSites.map(decorateSite));
    // Auto-fix permissions in background for running sites
    rawSites.forEach((site) => autoFixPermissionsIfNeeded(site));
    res.json({ sites, baseDir: sitesBaseDir });
  } catch (err) {
    next(err);
  }
});

router.post('/wordpress', async (req, res, next) => {
  try {
    const result = await createWordPressSite(req.body);
    res.status(201).json({
      ...result,
      site: await decorateSite(result.site)
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/domain', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    const oldConfigName = site.nginxConfigName;
    const nextDomain = normalizeOptionalDomain(req.body?.domain);
    const nextProxyPath = normalizeProxyPath(req.body?.proxyPath ?? site.proxyPath);
    site.proxyHost = site.proxyHost || buildSiteProxyHost(site.slug || site.name, site.id);
    site.proxyPath = nextProxyPath;
    site.domain = nextDomain;
    site.proxyMode = !nextDomain;
    if (req.body?.ssl !== undefined) site.ssl = nextDomain ? Boolean(req.body.ssl) : false;
    if (!nextDomain) site.ssl = false;
    site.url = getSiteUrl(site);
    site.updatedAt = new Date().toISOString();
    const warnings = [];
    site.nginxConfigName = `site-${slugify(nextDomain || getSiteProxyHost(site))}-${site.id.slice(0, 8)}.conf`;
    writeNginxSite(site, warnings);
    if (oldConfigName && oldConfigName !== site.nginxConfigName) {
      try {
        nginxManager.deleteConfig(oldConfigName);
      } catch (err) {
        warnings.push(`Configuração Nginx antiga não foi removida: ${err.message}`);
      }
    }
    try {
      const urlUpdate = await updateWordPressUrls(site);
      site.wordpress = {
        ...(site.wordpress || {}),
        tablePrefix: urlUpdate.tablePrefix,
        multisite: Boolean(urlUpdate.multisite)
      };
    } catch (err) {
      warnings.push(`Host salvo, mas não foi possível ajustar siteurl/home no banco: ${err.message}`);
    }
    try {
      const patchResult = await patchWordPressConfigForHostChange(site);
      if (!patchResult.patched) {
        warnings.push(patchResult.message);
      } else {
        const dbCheck = await verifyWordPressDatabaseConnection(site);
        if (!dbCheck.ok) {
          warnings.push(`wp-config.php ajustado, mas a conexão WordPress -> banco falhou: ${dbCheck.message}`);
        }
      }
    } catch (err) {
      warnings.push(`Host salvo, mas não foi possível ajustar wp-config.php: ${err.message}`);
    }
    try {
      const cacheCleanup = await cleanupWordPressAfterMigration(site);
      const removedCachePaths = cacheCleanup.removed || [];
      const optionTables = cacheCleanup.databaseCleanup?.optionTables || 0;
      if (removedCachePaths.length || optionTables) {
        warnings.push(`Cache/otimizações antigos limpos (${removedCachePaths.length} caminhos, ${optionTables} tabelas de opções).`);
      }
    } catch (err) {
      warnings.push(`Host salvo, mas a limpeza de cache/otimização falhou: ${err.message}`);
    }
    try {
      syncSiteWordPressServiceUrl(site);
    } catch (err) {
      warnings.push(`Host salvo, mas a URL externa do serviço não foi sincronizada: ${err.message}`);
    }
    saveSite(site);
    res.json({ site: await decorateSite(site), warnings });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/fix-permissions', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    if (!site.containers?.wordpress) {
      return res.status(400).json({ message: 'Container WordPress não encontrado' });
    }
    await repairWordPressFilesystemPermissions(site);
    site.updatedAt = new Date().toISOString();
    saveSite(site);
    res.json({ site: await decorateSite(site), message: 'Permissões corrigidas' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cleanup-cache', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    const cacheCleanup = await cleanupWordPressAfterMigration(site);
    try {
      await repairWordPressFilesystemPermissions(site);
    } catch {
      // A limpeza já foi executada; permissão é ajuste complementar.
    }
    site.lastCacheCleanup = {
      removedPaths: cacheCleanup.removed || [],
      optionTables: cacheCleanup.databaseCleanup?.optionTables || 0,
      tablePrefix: cacheCleanup.databaseCleanup?.tablePrefix || site.wordpress?.tablePrefix || 'wp_',
      createdAt: new Date().toISOString()
    };
    site.updatedAt = new Date().toISOString();
    saveSite(site);
    res.json({
      site: await decorateSite(site),
      cleanup: site.lastCacheCleanup
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/fix-ssl', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    if (!site.containers?.wordpress) {
      return res.status(400).json({ message: 'Container WordPress não encontrado' });
    }
    const patchLine = 'if (isset($_SERVER["HTTP_X_FORWARDED_PROTO"]) && $_SERVER["HTTP_X_FORWARDED_PROTO"] === "https") { $_SERVER["HTTPS"] = "on"; }';
    const script = [
      'set -e',
      'CONFIG=/var/www/html/wp-config.php',
      'if [ ! -f "$CONFIG" ]; then echo "wp-config.php not found"; exit 1; fi',
      'if grep -q "HTTP_X_FORWARDED_PROTO" "$CONFIG"; then echo "already patched"; exit 0; fi',
      'TMPF=$(mktemp)',
      'echo "<?php" > "$TMPF"',
      'echo "$PROVIR_PATCH_LINE" >> "$TMPF"',
      'tail -n +2 "$CONFIG" >> "$TMPF"',
      'mv "$TMPF" "$CONFIG"',
      'echo "patched"'
    ].join('\n');
    const result = await dockerExecRootShell(site.containers.wordpress, script, {
      PROVIR_PATCH_LINE: patchLine
    });
    site.ssl = true;
    site.url = getSiteUrl(site);
    site.updatedAt = new Date().toISOString();
    const warnings = [];
    try {
      await updateWordPressUrls(site);
    } catch (err) {
      warnings.push(`wp-config.php corrigido, mas o ajuste de siteurl/home falhou: ${err.message}`);
    }
    try {
      await cleanupWordPressAfterMigration(site);
    } catch (err) {
      warnings.push(`HTTPS ativado, mas a limpeza de cache/otimização falhou: ${err.message}`);
    }
    saveSite(site);
    res.json({ site: await decorateSite(site), output: result.stdout?.trim(), warnings });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    const username = String(req.body?.username || site.wordpress?.adminUser || 'admin').trim();
    const rawPassword = String(req.body?.password || '').trim();
    const shouldChangePassword = Boolean(rawPassword || req.body?.generatePassword);
    const password = shouldChangePassword ? rawPassword || randomPassword(18) : null;
    const email = String(req.body?.email || '').trim();
    const displayName = String(req.body?.displayName || '').trim();
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const prefix = getSafeTablePrefix(site);
    const userCheck = await runSql(
      site,
      `SELECT ID FROM ${prefix}users WHERE user_login='${escapeSql(username)}' LIMIT 1;`
    );
    if (!/\d+/.test(userCheck.stdout || '')) {
      throw createHttpError('Usuário WordPress não encontrado', 404);
    }
    const assignments = [];
    if (shouldChangePassword) assignments.push(`user_pass=MD5('${escapeSql(password)}')`);
    if (email) assignments.push(`user_email='${escapeSql(email)}'`);
    if (displayName) assignments.push(`display_name='${escapeSql(displayName)}'`, `user_nicename='${escapeSql(slugify(displayName, username))}'`);
    const metaRows = [
      firstName ? ['first_name', firstName] : null,
      lastName ? ['last_name', lastName] : null,
      displayName ? ['nickname', displayName] : null
    ].filter(Boolean);
    const metaSql = metaRows.length
      ? [
          `SET @provir_user_id := (SELECT ID FROM ${prefix}users WHERE user_login='${escapeSql(username)}' LIMIT 1);`,
          `DELETE FROM ${prefix}usermeta WHERE user_id=@provir_user_id AND meta_key IN (${metaRows.map(([key]) => `'${escapeSql(key)}'`).join(',')});`,
          metaRows
            .map(([key, value]) => `INSERT INTO ${prefix}usermeta (user_id, meta_key, meta_value) SELECT @provir_user_id, '${escapeSql(key)}', '${escapeSql(value)}' WHERE @provir_user_id IS NOT NULL;`)
            .join(' ')
        ].join(' ')
      : '';
    if (!assignments.length && !metaRows.length) {
      throw createHttpError('Informe uma senha nova, marque gerar senha ou altere algum dado do perfil.', 400);
    }
    const updateUserSql = assignments.length
      ? `UPDATE ${prefix}users SET ${assignments.join(', ')} WHERE user_login='${escapeSql(username)}' LIMIT 1;`
      : '';
    await runSql(
      site,
      `${updateUserSql} ${metaSql}`
    );
    site.wordpress = {
      ...(site.wordpress || {}),
      adminUser: username,
      adminEmail: email || site.wordpress?.adminEmail,
      adminDisplayName: displayName || site.wordpress?.adminDisplayName,
      adminFirstName: firstName || site.wordpress?.adminFirstName,
      adminLastName: lastName || site.wordpress?.adminLastName,
      ...(shouldChangePassword ? { lastPasswordResetAt: new Date().toISOString() } : {})
    };
    site.updatedAt = new Date().toISOString();
    saveSite(site);
    res.json({ site: await decorateSite(site), username, password, generated: shouldChangePassword && !rawPassword });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/backup', async (req, res, next) => {
  let stagingDir = null;
  try {
    const site = getSiteOr404(req.params.id);
    const backup = await generateSiteBackup(site);
    stagingDir = backup.stagingDir;
    res.setHeader('X-ProvirPanel-Backup-File', backup.filename);
    res.download(backup.archivePath, backup.filename, (err) => {
      if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
    next(err);
  }
});

router.post('/:id/wp-content/storage', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    const result = await ensureWpContentStorageEnvironment(site);
    res.json({
      ...result,
      site: await decorateSite(site)
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/db/optimize', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    const db = site.database || {};
    const script = [
      'set -e',
      'CLIENT="$(command -v mariadb-check || command -v mysqlcheck)"',
      '"$CLIENT" -u"$PROVIR_DB_USER" -p"$PROVIR_DB_PASS" --optimize "$PROVIR_DB_NAME"'
    ].join('\n');
    const result = await dockerExecShell(site.containers.database, script, {
      PROVIR_DB_USER: db.user || 'wordpress',
      PROVIR_DB_PASS: db.password || '',
      PROVIR_DB_NAME: db.name || 'wordpress'
    });
    site.lastDbOptimizeAt = new Date().toISOString();
    site.updatedAt = new Date().toISOString();
    saveSite(site);
    res.json({ site: await decorateSite(site), output: result.stdout || result.stderr || 'OK' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/migrate', upload.single('backup'), async (req, res, next) => {
  try {
    const result = await processMigrationArchive(req.params.id, req.file);
    res.json({
      ...result,
      site: await decorateSite(result.site)
    });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

router.post('/:id/migrate/init', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    await requireMigrationTargetReady(site);
    const totalChunks = Number(req.body?.totalChunks || 0);
    if (!Number.isInteger(totalChunks) || totalChunks < 1) {
      return res.status(400).json({ message: 'totalChunks inválido' });
    }
    const uploadId = crypto.randomUUID();
    writeChunkMetadata(uploadId, {
      type: 'site-migration',
      siteId: req.params.id,
      filename: safeUploadFilename(req.body?.filename),
      size: Number(req.body?.size || 0),
      totalChunks,
      createdAt: new Date().toISOString()
    });
    res.json({ uploadId });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/migrate/chunk', upload.single('chunk'), (req, res, next) => {
  try {
    const metadata = persistChunkFile(req.body?.uploadId, req.body?.chunkIndex, req.file);
    if (metadata.type !== 'site-migration' || metadata.siteId !== req.params.id) {
      return res.status(400).json({ message: 'Upload inválido para este site' });
    }
    res.json({ ok: true, chunkIndex: Number(req.body?.chunkIndex) });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

router.post('/:id/migrate/complete', async (req, res, next) => {
  const uploadId = req.body?.uploadId;
  try {
    const { metadata } = readChunkMetadata(uploadId);
    if (metadata.type !== 'site-migration' || metadata.siteId !== req.params.id) {
      return res.status(400).json({ message: 'Upload inválido para este site' });
    }
    const { archivePath, filename } = assembleChunkUpload(uploadId);
    const result = await processMigrationArchive(req.params.id, {
      path: archivePath,
      originalname: filename
    });
    cleanupChunkUpload(uploadId);
    res.json({
      ...result,
      site: await decorateSite(result.site)
    });
  } catch (err) {
    if (uploadId) cleanupChunkUpload(uploadId);
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const site = getSiteOr404(req.params.id);
    const warnings = await removeSite(site, {
      confirmName: req.body?.confirmName,
      removeFiles: req.body?.removeFiles !== false
    });
    res.json({ ok: true, removedId: site.id, warnings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
