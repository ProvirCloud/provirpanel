'use strict';

const express = require('express');
const axios = require('axios');
const https = require('https');
const { Client } = require('pg');
const prisma = require('../config/prisma');

const router = express.Router();

const normalizePath = (value) => {
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
};

const normalizeMethod = (value) => String(value || 'GET').toUpperCase();

const validateSql = (sql) => {
  if (!sql || typeof sql !== 'string') return 'SQL obrigatorio';
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) return 'Apenas SELECT permitido';
  if (trimmed.includes(';')) return 'Nao use ";" no SQL';
  const forbidden = /insert|update|delete|drop|alter|truncate|create|grant|revoke/i;
  if (forbidden.test(trimmed)) return 'SQL contem comando nao permitido';
  return null;
};

const buildTlsAgent = (route) => {
  if (!route.tlsEnabled) return null;
  if (!route.tlsCert || !route.tlsKey) return null;
  return new https.Agent({
    cert: route.tlsCert,
    key: route.tlsKey,
    ca: route.tlsCa || undefined,
    rejectUnauthorized: route.tlsRejectUnauthorized !== false
  });
};

const buildTargetUrl = (route, req) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (route.type === 'external') {
    const base = route.targetUrl || '';
    return `${base}${query}`;
  }
  const protocol = route.tlsEnabled ? 'https' : 'http';
  const basePath = route.targetPath || route.path;
  return `${protocol}://${route.targetHost}:${route.targetPort}${basePath}${query}`;
};

const executeRoute = async (route, req) => {
  if (route.type === 'postgres') {
    const err = validateSql(route.sqlQuery);
    if (err) {
      throw new Error(err);
    }
    const client = new Client({
      host: route.dbHost,
      port: route.dbPort || 5432,
      database: route.dbName,
      user: route.dbUser,
      password: route.dbPassword,
      ssl: route.dbSsl ? { rejectUnauthorized: false } : false
    });
    await client.connect();
    const result = await client.query(route.sqlQuery);
    await client.end();
    return { status: 200, data: result.rows };
  }

  const url = buildTargetUrl(route, req);
  const agent = buildTlsAgent(route);
  const response = await axios({
    method: route.method,
    url,
    data: req.body,
    headers: {
      ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {})
    },
    httpsAgent: agent || undefined,
    validateStatus: () => true
  });
  return { status: response.status, data: response.data };
};

router.get('/routes', async (req, res, next) => {
  try {
    const routes = await prisma.apiGatewayRoute.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ routes });
  } catch (err) {
    next(err);
  }
});

router.post('/routes', async (req, res, next) => {
  try {
    const payload = req.body || {};
    if (!payload.name || !payload.method || !payload.path || !payload.type) {
      return res.status(400).json({ message: 'name, method, path and type are required' });
    }
    if (payload.type === 'postgres') {
      const sqlError = validateSql(payload.sqlQuery || '');
      if (sqlError) {
        return res.status(400).json({ message: sqlError });
      }
    }
    const route = await prisma.apiGatewayRoute.create({
      data: {
        name: payload.name,
        method: normalizeMethod(payload.method),
        path: normalizePath(payload.path),
        type: payload.type,
        targetUrl: payload.targetUrl || null,
        targetHost: payload.targetHost || null,
        targetPort: payload.targetPort ? Number(payload.targetPort) : null,
        targetPath: payload.targetPath ? normalizePath(payload.targetPath) : null,
        dbHost: payload.dbHost || null,
        dbPort: payload.dbPort ? Number(payload.dbPort) : null,
        dbName: payload.dbName || null,
        dbUser: payload.dbUser || null,
        dbPassword: payload.dbPassword || null,
        dbSsl: !!payload.dbSsl,
        sqlQuery: payload.sqlQuery || null,
        tlsEnabled: !!payload.tlsEnabled,
        tlsCert: payload.tlsCert || null,
        tlsKey: payload.tlsKey || null,
        tlsCa: payload.tlsCa || null,
        tlsRejectUnauthorized: payload.tlsRejectUnauthorized !== false
      }
    });
    res.json({ route });
  } catch (err) {
    next(err);
  }
});

router.put('/routes/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const payload = req.body || {};
    if (!payload.name || !payload.method || !payload.path || !payload.type) {
      return res.status(400).json({ message: 'name, method, path and type are required' });
    }
    if (payload.type === 'postgres') {
      const sqlError = validateSql(payload.sqlQuery || '');
      if (sqlError) {
        return res.status(400).json({ message: sqlError });
      }
    }
    const route = await prisma.apiGatewayRoute.update({
      where: { id },
      data: {
        name: payload.name,
        method: normalizeMethod(payload.method),
        path: normalizePath(payload.path),
        type: payload.type,
        targetUrl: payload.targetUrl || null,
        targetHost: payload.targetHost || null,
        targetPort: payload.targetPort ? Number(payload.targetPort) : null,
        targetPath: payload.targetPath ? normalizePath(payload.targetPath) : null,
        dbHost: payload.dbHost || null,
        dbPort: payload.dbPort ? Number(payload.dbPort) : null,
        dbName: payload.dbName || null,
        dbUser: payload.dbUser || null,
        dbPassword: payload.dbPassword || null,
        dbSsl: !!payload.dbSsl,
        sqlQuery: payload.sqlQuery || null,
        tlsEnabled: !!payload.tlsEnabled,
        tlsCert: payload.tlsCert || null,
        tlsKey: payload.tlsKey || null,
        tlsCa: payload.tlsCa || null,
        tlsRejectUnauthorized: payload.tlsRejectUnauthorized !== false
      }
    });
    res.json({ route });
  } catch (err) {
    next(err);
  }
});

router.delete('/routes/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.apiGatewayRoute.delete({ where: { id } });
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/test', async (req, res, next) => {
  try {
    const payload = req.body || {};
    const route = payload.id
      ? await prisma.apiGatewayRoute.findUnique({ where: { id: Number(payload.id) } })
      : payload;
    if (!route) {
      return res.status(404).json({ message: 'Route not found' });
    }
    const fakeReq = {
      method: route.method,
      path: route.path,
      url: route.path,
      body: payload.body || {},
      headers: {}
    };
    const result = await executeRoute(route, fakeReq);
    res.status(result.status).json({ data: result.data });
  } catch (err) {
    next(err);
  }
});

router.use(async (req, res, next) => {
  try {
    const route = await prisma.apiGatewayRoute.findFirst({
      where: {
        method: normalizeMethod(req.method),
        path: normalizePath(req.path)
      }
    });
    if (!route) {
      return next();
    }
    const result = await executeRoute(route, req);
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
