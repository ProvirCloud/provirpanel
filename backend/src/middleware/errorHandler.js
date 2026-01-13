'use strict';

const fs = require('fs');
const path = require('path');

const appLogsPath = path.join(__dirname, '..', 'logs', 'app.log');
fs.mkdirSync(path.dirname(appLogsPath), { recursive: true });

module.exports = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    source: 'backend',
    message: `${req.method} ${req.originalUrl} -> ${message}`
  };
  fs.appendFile(appLogsPath, `${JSON.stringify(entry)}\n`, () => {});
  res.status(status).json({
    message
  });
};
