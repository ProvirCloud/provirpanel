'use strict';

const express = require('express');
const path = require('path');
const StorageManager = require('../services/StorageManager');

const router = express.Router();
const storageManager = new StorageManager();
const EMAIL_ASSETS_DIR = '/email-assets';
const ALLOWED_IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

router.get('/image', async (req, res, next) => {
  try {
    const targetPath = req.query.path;
    if (!targetPath) {
      return res.status(400).json({ message: 'path is required' });
    }

    const resolved = storageManager.safeResolve(targetPath);
    const assetsRoot = storageManager.safeResolve(EMAIL_ASSETS_DIR);
    const normalizedRoot = assetsRoot.endsWith(path.sep) ? assetsRoot : `${assetsRoot}${path.sep}`;
    if (!resolved.startsWith(normalizedRoot)) {
      return res.status(404).json({ message: 'Not found' });
    }

    const ext = path.extname(resolved).toLowerCase();
    if (!ALLOWED_IMAGE_EXT.includes(ext)) {
      return res.status(400).json({ message: 'Not an image' });
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(resolved);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
