'use strict';

const express = require('express');
const CICDManager = require('../services/CICDManager');

const router = express.Router();
const ciCdManager = new CICDManager();

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
