'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const StorageManager = require('../services/StorageManager');

const router = express.Router();
const storageManager = new StorageManager();
const upload = multer({ storage: multer.memoryStorage() });
const EMAIL_ASSETS_DIR = '/email-assets';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

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

router.get('/', async (req, res, next) => {
  try {
    const items = await storageManager.listFiles(req.query.path || '/');
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/tree', async (req, res, next) => {
  try {
    const projects = await storageManager.listProjects();
    const tree = projects.map((project) => ({
      name: project.name,
      path: project.path
    }));
    res.json({ tree });
  } catch (err) {
    next(err);
  }
});

router.get('/projects', async (req, res, next) => {
  try {
    const projects = await storageManager.listProjects();
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', (req, res) => {
  const stats = storageManager.getStorageStats();
  res.json({ stats });
});

router.post('/upload', upload.array('files'), async (req, res, next) => {
  try {
    const destination = req.body.path || '/';
    const files = req.files || [];
    const uploaded = await Promise.all(
      files.map((file) => storageManager.uploadFile(file, destination))
    );
    res.json({ uploaded });
  } catch (err) {
    next(err);
  }
});

router.get('/email-images', async (req, res, next) => {
  try {
    const items = await storageManager.listFiles(EMAIL_ASSETS_DIR);
    const images = items
      .filter((item) => !item.isDir && item.isImage)
      .map((item) => ({
        ...item,
        publicUrl: `/public/storage/image?path=${encodeURIComponent(item.path)}`
      }));
    res.json({ images });
  } catch (err) {
    if (err.message === 'Invalid path' || err.code === 'ENOENT') {
      return res.json({ images: [] });
    }
    return next(err);
  }
});

router.post('/email-images/upload', upload.single('file'), async (req, res, next) => {
  try {
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
        publicUrl: `/public/storage/image?path=${encodeURIComponent(publicPath)}`
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/email-images/from-url', async (req, res, next) => {
  try {
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
    return res.json({
      image: {
        name: filename,
        path: publicPath,
        publicUrl: `/public/storage/image?path=${encodeURIComponent(publicPath)}`
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/create', async (req, res, next) => {
  try {
    const { path: basePath = '/', name, type } = req.body || {};
    if (!name || !type) {
      return res.status(400).json({ message: 'name and type are required' });
    }
    const targetPath = path.join(basePath, name);
    if (type === 'folder') {
      await storageManager.createFolder(targetPath);
    } else {
      const resolved = storageManager.safeResolve(targetPath);
      await require('fs').promises.writeFile(resolved, '');
    }
    return res.json({ status: 'created' });
  } catch (err) {
    return next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    await storageManager.deleteFile(req.query.path);
    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/download', async (req, res, next) => {
  try {
    const targetPath = storageManager.safeResolve(req.query.path);
    res.download(targetPath);
  } catch (err) {
    next(err);
  }
});

router.get('/preview', async (req, res, next) => {
  try {
    const targetPath = storageManager.safeResolve(req.query.path);
    const ext = path.extname(targetPath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
      return res.status(400).json({ message: 'Not an image' });
    }
    return res.sendFile(targetPath);
  } catch (err) {
    return next(err);
  }
});

router.get('/pdf', async (req, res, next) => {
  try {
    const targetPath = storageManager.safeResolve(req.query.path);
    const ext = path.extname(targetPath).toLowerCase();
    if (ext !== '.pdf') {
      return res.status(400).json({ message: 'Not a pdf' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(targetPath);
  } catch (err) {
    return next(err);
  }
});

router.get('/media', async (req, res, next) => {
  try {
    const targetPath = storageManager.safeResolve(req.query.path);
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
    res.setHeader('Content-Type', mime);
    return res.sendFile(targetPath);
  } catch (err) {
    return next(err);
  }
});

router.get('/file', async (req, res, next) => {
  try {
    const targetPath = req.query.path;
    
    // Se o arquivo não tem extensão de diretório, tenta na raiz do projeto primeiro
    if (targetPath && !targetPath.includes('/')) {
      const projectRoot = path.resolve(process.cwd());
      const absolutePath = path.join(projectRoot, targetPath);
      
      try {
        const content = await require('fs').promises.readFile(absolutePath, 'utf8');
        return res.json({ content });
      } catch (err) {
        // Se não encontrar na raiz, tenta no storage
      }
    }
    
    // Se o path começa com /, tenta ler do diretório do projeto
    if (targetPath && targetPath.startsWith('/') && !targetPath.startsWith('/home')) {
      const projectRoot = path.resolve(process.cwd());
      const absolutePath = path.join(projectRoot, targetPath);
      
      if (absolutePath.startsWith(projectRoot)) {
        try {
          const content = await require('fs').promises.readFile(absolutePath, 'utf8');
          return res.json({ content });
        } catch (err) {
          // Se não encontrar, tenta no storage normal
        }
      }
    }
    
    // Fallback para o storage normal
    try {
      const content = await storageManager.readFile(targetPath);
      res.json({ content });
    } catch (err) {
      res.status(404).json({ message: 'Arquivo não encontrado' });
    }
  } catch (err) {
    next(err);
  }
});

router.put('/file', async (req, res, next) => {
  try {
    const targetPath = req.query.path || req.body.path;
    const content = req.body.content || req.body;
    
    if (!targetPath) {
      return res.status(400).json({ message: 'path is required' });
    }
    
    // Se o arquivo não tem extensão de diretório, tenta salvar na raiz do projeto primeiro
    if (targetPath && !targetPath.includes('/')) {
      const projectRoot = path.resolve(process.cwd());
      const absolutePath = path.join(projectRoot, targetPath);
      
      try {
        await require('fs').promises.writeFile(absolutePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
        return res.json({ status: 'saved' });
      } catch (err) {
        // Se não conseguir, tenta no storage
      }
    }
    
    // Se o path começa com /, tenta salvar no diretório do projeto
    if (targetPath.startsWith('/') && !targetPath.startsWith('/home')) {
      const projectRoot = path.resolve(process.cwd());
      const absolutePath = path.join(projectRoot, targetPath);
      
      if (absolutePath.startsWith(projectRoot)) {
        try {
          await require('fs').promises.writeFile(absolutePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
          return res.json({ status: 'saved' });
        } catch (err) {
          // Se não conseguir, tenta no storage normal
        }
      }
    }
    
    // Fallback para o storage normal
    await storageManager.writeFile(targetPath, typeof content === 'string' ? content : JSON.stringify(content));
    res.json({ status: 'saved' });
  } catch (err) {
    next(err);
  }
});

router.post('/move', async (req, res, next) => {
  try {
    const { fromPath, toPath } = req.body || {};
    if (!fromPath || !toPath) {
      return res.status(400).json({ message: 'fromPath and toPath are required' });
    }
    await storageManager.moveFile(fromPath, toPath);
    res.json({ status: 'moved' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
