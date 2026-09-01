'use strict';

/**
 * AI Upload Store — CRUD dos uploads do chat (Fase 5). Raw pg, parametrizado.
 * updated_at é setado explicitamente (o @updatedAt do Prisma não vira default no
 * banco e o db push removeria um default manual — mesmo gotcha das tabelas ai_*).
 */

const pool = require('../config/database');

async function createUpload({ userId, conversationId, filename, mime, sizeBytes, kind, intent, tmpPath }) {
  const { rows } = await pool.query(
    `INSERT INTO ai_uploads (user_id, conversation_id, filename, mime, size_bytes, kind, intent, status, tmp_path, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'received',$8, NOW())
     RETURNING id, kind, intent, status, filename, created_at AS "createdAt"`,
    [userId, conversationId || null, filename, mime || null, sizeBytes || 0, kind || 'other', intent || 'auto', tmpPath || null]
  );
  return rows[0];
}

async function getUpload(id, { userId, role }) {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", conversation_id AS "conversationId", filename, mime,
            size_bytes AS "sizeBytes", kind, intent, status, tmp_path AS "tmpPath",
            storage_path AS "storagePath", analysis, decision, error,
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM ai_uploads WHERE id = $1`,
    [id]
  );
  const u = rows[0];
  if (!u) return null;
  if (role !== 'admin' && u.userId !== userId) return null;
  return u;
}

async function setStatus(id, status, extra = {}) {
  const fields = ['status = $2', 'updated_at = NOW()'];
  const params = [id, status];
  if (extra.analysis !== undefined) { params.push(JSON.stringify(extra.analysis)); fields.push(`analysis = $${params.length}`); }
  if (extra.decision !== undefined) { params.push(JSON.stringify(extra.decision)); fields.push(`decision = $${params.length}`); }
  if (extra.storagePath !== undefined) { params.push(extra.storagePath); fields.push(`storage_path = $${params.length}`); }
  if (extra.error !== undefined) { params.push(extra.error); fields.push(`error = $${params.length}`); }
  const { rows } = await pool.query(
    `UPDATE ai_uploads SET ${fields.join(', ')} WHERE id = $1
     RETURNING id, kind, status, analysis, decision, storage_path AS "storagePath", error`,
    params
  );
  return rows[0];
}

module.exports = { createUpload, getUpload, setStatus };
