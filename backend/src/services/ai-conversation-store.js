'use strict';

/**
 * AI Conversation Store
 *
 * Persistência de conversas e mensagens do assistente principal, escopada por
 * usuário (e opcionalmente por cliente). Usa o pool PostgreSQL compartilhado.
 *
 * Todas as queries são parametrizadas ($1, $2, ...) — nunca concatenamos SQL.
 */

const pool = require('../config/database');

// Estimativa barata de tokens (~4 chars/token). Suficiente para orçamento de
// contexto; não precisa ser exata.
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

// Limite de tokens do histórico enviado ao modelo antes de acionar o resumo.
const HISTORY_TOKEN_BUDGET = Number(process.env.AI_HISTORY_TOKEN_BUDGET || 6000);
// Nº máximo de mensagens recentes mantidas verbatim no histórico do modelo.
const MAX_VERBATIM_MESSAGES = Number(process.env.AI_MAX_VERBATIM_MESSAGES || 20);

// ─── Conversas ───────────────────────────────────────────────────────────────

async function listConversations(userId, { clienteId, includeArchived = false } = {}) {
  const params = [userId];
  let where = 'user_id = $1';
  if (clienteId) {
    params.push(clienteId);
    where += ` AND cliente_id = $${params.length}`;
  }
  if (!includeArchived) {
    where += ' AND archived = false';
  }
  const { rows } = await pool.query(
    `SELECT id, title, agent, cliente_id AS "clienteId", archived, summary_tokens AS "summaryTokens",
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM ai_conversations
      WHERE ${where}
      ORDER BY updated_at DESC`,
    params
  );
  return rows;
}

async function createConversation(userId, { title, agent, clienteId } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO ai_conversations (user_id, cliente_id, title, agent, updated_at)
     VALUES ($1, $2, COALESCE($3, 'Nova conversa'), COALESCE($4, 'auto'), NOW())
     RETURNING id, title, agent, cliente_id AS "clienteId", archived,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [userId, clienteId || null, title || null, agent || null]
  );
  return rows[0];
}

/**
 * Busca uma conversa garantindo autorização. Admin pode acessar qualquer uma;
 * demais perfis só as próprias. Retorna null se não existir/sem permissão.
 */
async function getConversation(conversationId, { userId, role } = {}) {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", cliente_id AS "clienteId", title, agent, summary,
            summary_tokens AS "summaryTokens", metadata, archived,
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM ai_conversations WHERE id = $1`,
    [conversationId]
  );
  const conv = rows[0];
  if (!conv) return null;
  if (role !== 'admin' && conv.userId !== userId) return null;
  return conv;
}

async function getMessages(conversationId, { limit } = {}) {
  const params = [conversationId];
  let sql = `SELECT id, role, content, blocks, tokens, created_at AS "createdAt"
               FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC`;
  if (limit) {
    params.push(limit);
    // Pega as mais recentes e reordena ascendente
    sql = `SELECT * FROM (
             SELECT id, role, content, blocks, tokens, created_at AS "createdAt"
               FROM ai_messages WHERE conversation_id = $1
               ORDER BY created_at DESC LIMIT $2
           ) t ORDER BY t."createdAt" ASC`;
  }
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function updateConversation(conversationId, { userId, role }, patch = {}) {
  const conv = await getConversation(conversationId, { userId, role });
  if (!conv) return null;

  const fields = [];
  const params = [];
  const allowed = { title: 'title', agent: 'agent', archived: 'archived' };
  for (const [key, col] of Object.entries(allowed)) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (!fields.length) return conv;
  params.push(conversationId);
  const { rows } = await pool.query(
    `UPDATE ai_conversations SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id, title, agent, cliente_id AS "clienteId", archived,
                created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  return rows[0];
}

async function deleteConversation(conversationId, { userId, role }) {
  const conv = await getConversation(conversationId, { userId, role });
  if (!conv) return false;
  await pool.query('DELETE FROM ai_conversations WHERE id = $1', [conversationId]);
  return true;
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

/**
 * Insere uma mensagem e atualiza o updated_at da conversa (para ordenação).
 * `blocks` é opcional (JSONB) para blocos interativos.
 */
async function addMessage(conversationId, { role, content, blocks } = {}) {
  const tokens = estimateTokens(content) + (blocks ? estimateTokens(JSON.stringify(blocks)) : 0);
  const { rows } = await pool.query(
    `INSERT INTO ai_messages (conversation_id, role, content, blocks, tokens)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, role, content, blocks, tokens, created_at AS "createdAt"`,
    [conversationId, role, content ?? null, blocks ? JSON.stringify(blocks) : null, tokens]
  );
  await pool.query('UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
  return rows[0];
}

/**
 * Se a conversa ainda tiver o título padrão, deriva um título curto da primeira
 * mensagem do usuário. Best-effort (não lança).
 */
async function maybeAutoTitle(conversationId, firstUserText) {
  try {
    if (!firstUserText) return;
    const clean = String(firstUserText).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!clean) return;
    await pool.query(
      `UPDATE ai_conversations SET title = $2
         WHERE id = $1 AND (title = 'Nova conversa' OR title IS NULL OR title = '')`,
      [conversationId, clean]
    );
  } catch { /* best-effort */ }
}

// ─── Histórico para o modelo (com orçamento de tokens) ───────────────────────

/**
 * Monta o histórico a ser enviado ao modelo respeitando um teto de tokens.
 * Retorna:
 *   - summary: resumo acumulado da conversa (pode ser null)
 *   - messages: mensagens recentes verbatim [{ role, content }]
 *   - overBudget: true se as mensagens antigas ainda-não-resumidas excedem o teto
 *                 (sinal para o summarizer rodar)
 *   - olderMessages: mensagens que ficaram de fora (candidatas a resumo)
 */
async function buildModelHistory(conversationId) {
  const conv = (await pool.query(
    'SELECT summary FROM ai_conversations WHERE id = $1', [conversationId]
  )).rows[0];
  const summary = conv ? conv.summary : null;

  const all = await getMessages(conversationId);
  // Considera só user/assistant no histórico do modelo (system/tool são internos).
  const dialog = all.filter((m) => m.role === 'user' || m.role === 'assistant');

  const recent = [];
  let budget = HISTORY_TOKEN_BUDGET;
  // Percorre do mais recente para o mais antigo somando tokens.
  for (let i = dialog.length - 1; i >= 0; i--) {
    const m = dialog[i];
    if (recent.length >= MAX_VERBATIM_MESSAGES) break;
    if (budget - m.tokens < 0 && recent.length > 0) break;
    recent.unshift({ role: m.role, content: m.content || '' });
    budget -= m.tokens;
  }

  const keptCount = recent.length;
  const olderMessages = dialog.slice(0, Math.max(0, dialog.length - keptCount));
  const overBudget = olderMessages.length > 0;

  return { summary, messages: recent, overBudget, olderMessages };
}

async function setSummary(conversationId, summary) {
  const tokens = estimateTokens(summary);
  await pool.query(
    'UPDATE ai_conversations SET summary = $2, summary_tokens = $3 WHERE id = $1',
    [conversationId, summary || null, tokens]
  );
}

module.exports = {
  estimateTokens,
  HISTORY_TOKEN_BUDGET,
  MAX_VERBATIM_MESSAGES,
  listConversations,
  createConversation,
  getConversation,
  getMessages,
  updateConversation,
  deleteConversation,
  addMessage,
  maybeAutoTitle,
  buildModelHistory,
  setSummary,
};
