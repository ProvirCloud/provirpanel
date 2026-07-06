'use strict';

const express = require('express');
const crypto = require('crypto');
const prisma = require('../config/prisma');

const router = express.Router();

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://177.104.174.71:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || '';
const ENC_KEY = (process.env.JWT_SECRET || 'change-me').slice(0, 32).padEnd(32, '0');

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

// LIST
router.get('/database-connections', async (req, res, next) => {
  try {
    const rows = await prisma.databaseConnection.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows.map(r => ({ ...r, password: '••••••' })));
  } catch (err) { next(err); }
});

// CREATE
router.post('/database-connections', async (req, res, next) => {
  try {
    const { name, type, host, port, user, password, database, projects } = req.body;
    if (!name || !type || !host || !port || !user || !password || !database) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }
    const conn = await prisma.databaseConnection.create({
      data: { name, type, host, port: Number(port), user, password: encrypt(password), database, projects: Array.isArray(projects) ? projects : [] }
    });
    res.status(201).json({ ...conn, password: '••••••' });
  } catch (err) { next(err); }
});

// DELETE
router.delete('/database-connections/:id', async (req, res, next) => {
  try {
    await prisma.databaseConnection.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// TEST CONNECTION
router.post('/database-connections/:id/test', async (req, res, next) => {
  try {
    const conn = await prisma.databaseConnection.findUnique({ where: { id: req.params.id } });
    if (!conn) return res.status(404).json({ error: 'Conexão não encontrada' });
    const password = decrypt(conn.password);
    const result = await testConnection(conn.type, { host: conn.host, port: conn.port, user: conn.user, password, database: conn.database });
    res.json(result);
  } catch (err) { next(err); }
});

// INDEX SCHEMA
router.post('/database-connections/:id/index', async (req, res, next) => {
  try {
    const conn = await prisma.databaseConnection.findUnique({ where: { id: req.params.id } });
    if (!conn) return res.status(404).json({ error: 'Conexão não encontrada' });
    const password = decrypt(conn.password);
    const documents = await extractSchema(conn.type, { host: conn.host, port: conn.port, user: conn.user, password, database: conn.database, connectionId: conn.id });
    if (!documents.length) return res.json({ success: false, error: 'Nenhuma tabela/collection encontrada' });

    const collection = conn.projects?.length ? `project_${conn.projects[0].id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : `db_${conn.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
    const gatewayRes = await fetch(`${ZEUS_GATEWAY_URL}/api/index/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({ collection, documents })
    });
    const data = await gatewayRes.json();
    if (!gatewayRes.ok) return res.status(gatewayRes.status).json(data);
    res.json({ success: true, indexed: documents.length, collection, ...data });
  } catch (err) { next(err); }
});

// --- Helpers ---

async function testConnection(type, { host, port, user, password, database }) {
  if (type === 'postgres') {
    const { Client } = require('pg');
    const client = new Client({ host, port, user, password, database, connectionTimeoutMillis: 5000 });
    try { await client.connect(); await client.query('SELECT 1'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
    finally { await client.end().catch(() => {}); }
  }
  if (type === 'mysql') {
    const mysql = require('mysql2/promise');
    let conn;
    try { conn = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 5000 }); await conn.query('SELECT 1'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
    finally { if (conn) await conn.end().catch(() => {}); }
  }
  if (type === 'mongodb') {
    const { MongoClient } = require('mongodb');
    const uri = `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?authSource=admin`;
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try { await client.connect(); await client.db(database).command({ ping: 1 }); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
    finally { await client.close().catch(() => {}); }
  }
  return { success: false, error: 'Tipo não suportado' };
}

async function extractSchema(type, { host, port, user, password, database, connectionId }) {
  if (type === 'postgres') return extractPostgres({ host, port, user, password, database, connectionId });
  if (type === 'mysql') return extractMysql({ host, port, user, password, database, connectionId });
  if (type === 'mongodb') return extractMongo({ host, port, user, password, database, connectionId });
  return [];
}

async function extractPostgres({ host, port, user, password, database, connectionId }) {
  const { Client } = require('pg');
  const client = new Client({ host, port, user, password, database });
  await client.connect();
  try {
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name
    `);
    const docs = [];
    for (const { table_name } of tables) {
      const { rows: cols } = await client.query(`
        SELECT c.column_name, c.data_type, c.is_nullable,
          CASE WHEN pk.column_name IS NOT NULL THEN 'PK' ELSE NULL END as pk,
          fk.foreign_table || '.' || fk.foreign_column as fk_ref
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
        ) pk ON pk.column_name = c.column_name
        LEFT JOIN (
          SELECT kcu.column_name, ccu.table_name as foreign_table, ccu.column_name as foreign_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
          WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
        ) fk ON fk.column_name = c.column_name
        WHERE c.table_name = $1 AND c.table_schema = 'public'
        ORDER BY c.ordinal_position
      `, [table_name]);
      const colDescs = cols.map(c => {
        let desc = `${c.column_name} (${c.data_type}`;
        if (c.pk) desc += ' PK';
        if (c.fk_ref) desc += ` FK→${c.fk_ref}`;
        if (c.is_nullable === 'NO' && !c.pk) desc += ' NOT NULL';
        return desc + ')';
      });
      docs.push({
        content: `Tabela: ${table_name}\nColunas: ${colDescs.join(', ')}`,
        metadata: { source: 'database', type: 'postgres', table: table_name, connection_id: connectionId }
      });
    }
    return docs;
  } finally { await client.end(); }
}

async function extractMysql({ host, port, user, password, database, connectionId }) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ host, port, user, password, database });
  try {
    const [tables] = await conn.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`, [database]);
    const docs = [];
    for (const row of tables) {
      const tableName = row.TABLE_NAME || row.table_name;
      const [cols] = await conn.query(`
        SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_KEY,
          k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME
        FROM information_schema.columns c
        LEFT JOIN information_schema.key_column_usage k
          ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
        WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
        ORDER BY c.ORDINAL_POSITION
      `, [database, tableName]);
      const colDescs = cols.map(c => {
        let desc = `${c.COLUMN_NAME} (${c.DATA_TYPE}`;
        if (c.COLUMN_KEY === 'PRI') desc += ' PK';
        if (c.REFERENCED_TABLE_NAME) desc += ` FK→${c.REFERENCED_TABLE_NAME}.${c.REFERENCED_COLUMN_NAME}`;
        if (c.IS_NULLABLE === 'NO' && c.COLUMN_KEY !== 'PRI') desc += ' NOT NULL';
        return desc + ')';
      });
      docs.push({
        content: `Tabela: ${tableName}\nColunas: ${colDescs.join(', ')}`,
        metadata: { source: 'database', type: 'mysql', table: tableName, connection_id: connectionId }
      });
    }
    return docs;
  } finally { await conn.end(); }
}

async function extractMongo({ host, port, user, password, database, connectionId }) {
  const { MongoClient } = require('mongodb');
  const uri = `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?authSource=admin`;
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(database);
    const collections = await db.listCollections().toArray();
    const docs = [];
    for (const col of collections) {
      const sample = await db.collection(col.name).aggregate([{ $sample: { size: 20 } }]).toArray();
      if (!sample.length) continue;
      const fields = new Map();
      for (const doc of sample) {
        for (const [key, val] of Object.entries(doc)) {
          const type = Array.isArray(val) ? 'array' : typeof val === 'object' && val !== null ? (val.constructor?.name === 'ObjectId' ? 'ObjectId' : 'object') : typeof val;
          if (!fields.has(key)) fields.set(key, new Set());
          fields.get(key).add(type);
        }
      }
      const fieldDescs = [...fields.entries()].map(([k, types]) => `${k} (${[...types].join('|')})`);
      docs.push({
        content: `Collection: ${col.name}\nCampos inferidos (amostra ${sample.length} docs): ${fieldDescs.join(', ')}`,
        metadata: { source: 'database', type: 'mongodb', collection: col.name, connection_id: connectionId }
      });
    }
    return docs;
  } finally { await client.close(); }
}

module.exports = router;
