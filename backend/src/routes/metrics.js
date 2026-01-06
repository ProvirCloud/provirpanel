'use strict';

const express = require('express');
const MetricsCollector = require('../services/MetricsCollector');

const router = express.Router();
const metricsCollector = new MetricsCollector();

router.get('/', async (req, res, next) => {
  try {
    const metrics = await metricsCollector.collect();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
