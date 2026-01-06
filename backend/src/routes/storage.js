'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const StorageManager = require('../services/StorageManager');

const router = express.Router();
const storageManager = new StorageManager();
const upload = multer({ storage: multer.memoryStorage() });

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
    const content = await storageManager.readFile(req.query.path);
    res.json({ content });
  } catch (err) {
    next(err);
  }
});

router.put('/file', async (req, res, next) => {
  try {
    const { path: targetPath, content } = req.body || {};
    if (!targetPath) {
      return res.status(400).json({ message: 'path is required' });
    }
    await storageManager.writeFile(targetPath, content ?? '');
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
