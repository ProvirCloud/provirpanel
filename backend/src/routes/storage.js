'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const StorageManager = require('../services/StorageManager');
const { StorageEnvironmentManager, DEFAULT_PERMISSIONS } = require('../services/StorageEnvironmentManager');
const { MultiStorageService, UnsupportedStorageProviderError } = require('../services/MultiStorageService');

const router = express.Router();
const storageManager = new StorageManager();
const environmentManager = new StorageEnvironmentManager();
const multiStorage = new MultiStorageService({ environmentManager });
const upload = multer({ storage: multer.memoryStorage() });
const chunkUpload = multer({ dest: path.join(require('os').tmpdir(), 'provirpanel-storage-chunks') });
const EMAIL_ASSETS_DIR = '/email-assets';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const crypto = require('crypto');
const storageChunkRoot = path.join(require('os').tmpdir(), 'provirpanel-storage-chunks');
fs.mkdirSync(storageChunkRoot, { recursive: true });

const sanitizeFilename = (name) => {
  const base = path.basename(name || 'image');
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized || 'image';
};

const ensureUniqueName = (dirPath, filename) => {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = `${base}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(dirPath, candidate))) {
    candidate = `${base}-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
};

const mimeToExt = (mime) => {
  if (!mime) return '';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/svg+xml') return '.svg';
  return '';
};

const requireAdmin = (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Forbidden' });
    return false;
  }
  return true;
};

const getEnvironmentId = (req) => req.query.environmentId || req.body?.environmentId || null;

const getEnvironmentOrFail = (req) => multiStorage.getEnvironment(getEnvironmentId(req));

const assertPermission = (req, action) => {
  const environment = getEnvironmentOrFail(req);
  multiStorage.assertPermission(environment.id, req.user?.role || 'viewer', action);
  return environment;
};

const getDownloadName = (targetPath = '/', fallback = 'download') => path.basename(targetPath) || fallback;
const IMAGE_MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const buildUnsupportedReadPayload = (req, environment, extra = {}) => ({
  unsupported: true,
  message: `O provider ${environment.provider} ainda nao esta habilitado neste painel.`,
  environment,
  environments: environmentManager.getEnvironmentView(req.user?.role || 'viewer').environments,
  ...extra
});

const withEnvironment = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    next(err);
  }
};

router.get('/providers', (req, res) => {
  res.json(environmentManager.getEnvironmentView(req.user?.role || 'viewer'));
});

router.post('/environments', withEnvironment(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  await multiStorage.validateEnvironmentConfig(req.body || {});
  const environment = environmentManager.createEnvironment({
    name: req.body?.name,
    provider: req.body?.provider,
    isActive: req.body?.isActive !== false,
    config: req.body?.config || {},
    permissions: req.body?.permissions || DEFAULT_PERMISSIONS
  });
  res.status(201).json({ environment });
}));

router.put('/environments/:id', withEnvironment(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  await multiStorage.validateEnvironmentConfig(req.body || {});
  const environment = environmentManager.updateEnvironment(req.params.id, {
    name: req.body?.name,
    provider: req.body?.provider,
    isActive: req.body?.isActive !== false,
    config: req.body?.config || {},
    permissions: req.body?.permissions || DEFAULT_PERMISSIONS
  });
  res.json({ environment });
}));

router.delete('/environments/:id', withEnvironment(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  environmentManager.deleteEnvironment(req.params.id);
  res.json({ status: 'deleted' });
}));

router.get('/', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'list');
  try {
    const result = await multiStorage.listFiles(environment.id, req.query.path || '/', {
      pageSize: req.query.pageSize,
      pageToken: req.query.pageToken
    });
    res.json({ items: result.items || [], pagination: result.pagination || null, environment });
  } catch (err) {
    if (err instanceof UnsupportedStorageProviderError) {
      return res.json(buildUnsupportedReadPayload(req, environment, {
        items: [],
        pagination: { pageSize: 0, nextPageToken: null, hasMore: false }
      }));
    }
    throw err;
  }
}));

router.get('/tree', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'list');
  try {
    const tree = await multiStorage.listTree(environment.id);
    res.json({
      tree,
      environment,
      environments: environmentManager.getEnvironmentView(req.user?.role || 'viewer').environments
    });
  } catch (err) {
    if (err instanceof UnsupportedStorageProviderError) {
      return res.json(buildUnsupportedReadPayload(req, environment, { tree: [] }));
    }
    throw err;
  }
}));

router.get('/projects', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'list');
  try {
    const projects = await multiStorage.listTree(environment.id);
    res.json({ projects, environment });
  } catch (err) {
    if (err instanceof UnsupportedStorageProviderError) {
      return res.json(buildUnsupportedReadPayload(req, environment, { projects: [] }));
    }
    throw err;
  }
}));

router.get('/stats', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'list');
  try {
    const stats = multiStorage.getStats(environment.id);
    res.json({ stats, environment });
  } catch (err) {
    if (err instanceof UnsupportedStorageProviderError) {
      return res.json(buildUnsupportedReadPayload(req, environment, {
        stats: { used: 0, total: 0 }
      }));
    }
    throw err;
  }
}));

router.post('/upload', upload.array('files'), withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'upload');
  const destination = req.body.path || '/';
  const files = req.files || [];
  const uploaded = await multiStorage.uploadFiles(environment.id, files, destination);
  res.json({ uploaded, environment });
}));

// Chunked upload endpoints for large files
router.post('/upload/init', withEnvironment(async (req, res) => {
  assertPermission(req, 'upload');
  const totalChunks = Number(req.body?.totalChunks || 0);
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    return res.status(400).json({ message: 'totalChunks inv\u00e1lido' });
  }
  const uploadId = crypto.randomUUID();
  const uploadDir = path.join(storageChunkRoot, uploadId);
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'metadata.json'), JSON.stringify({
    uploadId,
    filename: req.body?.filename || 'file',
    totalChunks,
    size: Number(req.body?.size || 0),
    path: req.body?.path || '/',
    environmentId: req.body?.environmentId || req.environmentId,
    createdAt: new Date().toISOString()
  }));
  res.json({ uploadId });
}));

router.post('/upload/chunk', chunkUpload.single('chunk'), withEnvironment(async (req, res) => {
  assertPermission(req, 'upload');
  const uploadId = req.body?.uploadId;
  const chunkIndex = Number(req.body?.chunkIndex);
  if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return res.status(400).json({ message: 'uploadId e chunkIndex obrigat\u00f3rios' });
  }
  const uploadDir = path.join(storageChunkRoot, uploadId);
  if (!fs.existsSync(path.join(uploadDir, 'metadata.json'))) {
    return res.status(404).json({ message: 'Upload n\u00e3o encontrado' });
  }
  if (req.file?.path) {
    fs.renameSync(req.file.path, path.join(uploadDir, `chunk-${chunkIndex}`));
  }
  res.json({ ok: true, chunkIndex });
}));

router.post('/upload/complete', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'upload');
  const uploadId = req.body?.uploadId;
  const uploadDir = path.join(storageChunkRoot, uploadId || '');
  const metadataPath = path.join(uploadDir, 'metadata.json');
  if (!uploadId || !fs.existsSync(metadataPath)) {
    return res.status(404).json({ message: 'Upload n\u00e3o encontrado' });
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const totalChunks = Number(metadata.totalChunks);
  const assembledPath = path.join(uploadDir, metadata.filename);
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(uploadDir, `chunk-${i}`);
    if (!fs.existsSync(chunkPath)) {
      return res.status(400).json({ message: `Chunk ${i + 1}/${totalChunks} ausente` });
    }
    fs.appendFileSync(assembledPath, fs.readFileSync(chunkPath));
  }
  const fileObj = {
    originalname: metadata.filename,
    buffer: fs.readFileSync(assembledPath),
    size: fs.statSync(assembledPath).size
  };
  const uploaded = await multiStorage.uploadFiles(environment.id, [fileObj], metadata.path || '/');
  fs.rmSync(uploadDir, { recursive: true, force: true });
  res.json({ uploaded, environment });
}));

router.get('/email-images', withEnvironment(async (req, res) => {
  try {
    const items = await storageManager.listFiles(EMAIL_ASSETS_DIR);
    const images = items
      .filter((item) => !item.isDir && item.isImage)
      .map((item) => ({
        ...item,
        publicUrl: `/api/public/storage/image?path=${encodeURIComponent(item.path)}`
      }));
    res.json({ images });
  } catch (err) {
    if (err.message === 'Invalid path' || err.code === 'ENOENT') {
      return res.json({ images: [] });
    }
    throw err;
  }
}));

router.post('/email-images/upload', upload.single('file'), withEnvironment(async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'file is required' });
  }
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return res.status(400).json({ message: 'file must be an image' });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return res.status(400).json({ message: 'image too large' });
  }
  const assetsDir = storageManager.safeResolve(EMAIL_ASSETS_DIR);
  await fs.promises.mkdir(assetsDir, { recursive: true });

  const ext = mimeToExt(file.mimetype) || path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.includes(ext)) {
    return res.status(400).json({ message: 'unsupported image type' });
  }
  const safeBase = sanitizeFilename(path.basename(file.originalname, path.extname(file.originalname)));
  const filename = ensureUniqueName(assetsDir, `${safeBase}${ext}`);
  const targetPath = path.join(assetsDir, filename);
  await fs.promises.writeFile(targetPath, file.buffer);

  const publicPath = path.join(EMAIL_ASSETS_DIR, filename);
  return res.json({
    image: {
      name: filename,
      path: publicPath,
      publicUrl: `/api/public/storage/image?path=${encodeURIComponent(publicPath)}`
    }
  });
}));

router.post('/email-images/from-url', withEnvironment(async (req, res) => {
  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ message: 'url is required' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return res.status(400).json({ message: 'invalid url' });
  }

  const response = await axios.get(parsed.toString(), {
    responseType: 'arraybuffer',
    timeout: 10000,
    maxContentLength: MAX_IMAGE_BYTES
  });

  const contentType = response.headers['content-type'] || '';
  if (!contentType.startsWith('image/')) {
    return res.status(400).json({ message: 'url is not an image' });
  }

  const contentLength = Number(response.headers['content-length'] || 0);
  if (contentLength && contentLength > MAX_IMAGE_BYTES) {
    return res.status(400).json({ message: 'image too large' });
  }

  const buffer = Buffer.from(response.data);
  if (buffer.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ message: 'image too large' });
  }

  const assetsDir = storageManager.safeResolve(EMAIL_ASSETS_DIR);
  await fs.promises.mkdir(assetsDir, { recursive: true });

  const extFromMime = mimeToExt(contentType);
  const extFromUrl = path.extname(parsed.pathname).toLowerCase();
  const ext = ALLOWED_IMAGE_EXT.includes(extFromMime)
    ? extFromMime
    : ALLOWED_IMAGE_EXT.includes(extFromUrl)
      ? extFromUrl
      : '.png';

  const baseName = sanitizeFilename(path.basename(parsed.pathname, path.extname(parsed.pathname)) || 'remote-image');
  const filename = ensureUniqueName(assetsDir, `${baseName}${ext}`);
  const targetPath = path.join(assetsDir, filename);
  await fs.promises.writeFile(targetPath, buffer);

  const publicPath = path.join(EMAIL_ASSETS_DIR, filename);
  res.json({
    image: {
      name: filename,
      path: publicPath,
      publicUrl: `/api/public/storage/image?path=${encodeURIComponent(publicPath)}`
    }
  });
}));

router.post('/create', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'create');
  const { path: basePath = '/', name, type } = req.body || {};
  if (!name || !type) {
    return res.status(400).json({ message: 'name and type are required' });
  }
  const targetPath = path.join(basePath, name);
  const result = await multiStorage.createEntry(environment.id, targetPath, type);
  res.json({ ...result, environment });
}));

router.post('/extract', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'write');
  const { path: archivePath, destinationPath } = req.body || {};
  if (!archivePath) {
    return res.status(400).json({ message: 'path is required' });
  }
  const extracted = await multiStorage.extractArchive(environment.id, archivePath, destinationPath);
  res.json({ status: 'extracted', extracted, environment });
}));

router.delete('/', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'delete');
  const result = await multiStorage.deleteEntry(environment.id, req.query.path);
  res.json({ ...result, environment });
}));

router.get('/download', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'download');
  const file = await multiStorage.readBinaryFile(environment.id, req.query.path);
  res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName || getDownloadName(req.query.path)}"`);
  res.send(file.buffer);
}));

router.get('/preview', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'preview');
  const targetPath = String(req.query.path || '');
  const ext = path.extname(targetPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
    return res.status(400).json({ message: 'Not an image' });
  }
  const file = await multiStorage.readBinaryFile(environment.id, targetPath);
  res.setHeader('Content-Type', file.contentType || IMAGE_MIME_MAP[ext] || 'application/octet-stream');
  res.send(file.buffer);
}));

router.get('/pdf', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'preview');
  const targetPath = String(req.query.path || '');
  if (path.extname(targetPath).toLowerCase() !== '.pdf') {
    return res.status(400).json({ message: 'Not a pdf' });
  }
  const file = await multiStorage.readBinaryFile(environment.id, targetPath);
  res.setHeader('Content-Type', 'application/pdf');
  res.send(file.buffer);
}));

router.get('/media', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'preview');
  const targetPath = String(req.query.path || '');
  const ext = path.extname(targetPath).toLowerCase();
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska'
  };
  const mime = mimeMap[ext];
  if (!mime) {
    return res.status(400).json({ message: 'Not a supported media type' });
  }
  const file = await multiStorage.readBinaryFile(environment.id, targetPath);
  res.setHeader('Content-Type', mime);
  res.send(file.buffer);
}));

router.get('/file', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'read');
  const content = await multiStorage.readTextFile(environment.id, req.query.path);
  res.json({ content, environment });
}));

router.put('/file', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'write');
  const targetPath = req.query.path || req.body.path;
  const content = req.body.content || req.body;
  if (!targetPath) {
    return res.status(400).json({ message: 'path is required' });
  }
  const result = await multiStorage.writeTextFile(
    environment.id,
    targetPath,
    typeof content === 'string' ? content : JSON.stringify(content)
  );
  res.json({ ...result, environment });
}));

router.post('/move', withEnvironment(async (req, res) => {
  const environment = assertPermission(req, 'move');
  const { fromPath, toPath } = req.body || {};
  if (!fromPath || !toPath) {
    return res.status(400).json({ message: 'fromPath and toPath are required' });
  }
  const result = await multiStorage.moveEntry(environment.id, fromPath, toPath);
  res.json({ ...result, environment });
}));

router.post('/copy', withEnvironment(async (req, res) => {
  const sourceEnvironmentId = req.body?.sourceEnvironmentId;
  const targetEnvironmentId = req.body?.targetEnvironmentId;
  const sourcePath = req.body?.sourcePath;
  const targetPath = req.body?.targetPath;
  if (!sourceEnvironmentId || !targetEnvironmentId || !sourcePath) {
    return res.status(400).json({ message: 'sourceEnvironmentId, targetEnvironmentId and sourcePath are required' });
  }

  multiStorage.assertPermission(sourceEnvironmentId, req.user?.role || 'viewer', 'read');
  multiStorage.assertPermission(targetEnvironmentId, req.user?.role || 'viewer', 'write');
  const result = await multiStorage.copyBetweenEnvironments({
    sourceEnvironmentId,
    sourcePath,
    targetEnvironmentId,
    targetPath
  });
  res.json(result);
}));

module.exports = router;
