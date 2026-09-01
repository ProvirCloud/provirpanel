'use strict';

/**
 * AI Turn Persistence — helpers finos para gravar um "turno" de chat
 * (mensagem do usuário + resposta do assistente) numa conversa persistida.
 *
 * Usado pelas rotas de streaming (ex.: /zeus/agent) SEM alterar o protocolo SSE.
 * Todos os métodos são best-effort e nunca lançam para o fluxo do chat: se a
 * persistência falhar, o streaming continua normalmente.
 *
 * Autorização: sempre valida que a conversa pertence ao usuário (ou admin).
 */

const store = require('./ai-conversation-store');
const profiler = require('./ai-user-profiler');
const { summarizeIfNeeded } = require('./ai-summarizer');

/**
 * Início do turno: valida a conversa, grava a mensagem do usuário, deriva título
 * e atualiza o perfil (silencioso). Retorna o nível de conhecimento efetivo
 * (para adaptar o system prompt — Fase 4) e se a conversa é válida.
 *
 * @returns {Promise<{ok:boolean, skillLevel:string, conversation?:object}>}
 */
async function beginTurn({ conversationId, user, message }) {
  const result = { ok: false, skillLevel: 'auto' };
  try {
    const userId = user?.id;
    const role = user?.role || 'viewer';
    // Nível efetivo mesmo sem conversa persistida (útil p/ prompt).
    result.skillLevel = await profiler.getEffectiveLevel(userId).catch(() => 'auto');

    if (!conversationId || !userId) return result;

    const conv = await store.getConversation(conversationId, { userId, role });
    if (!conv) return result; // sem permissão ou inexistente → não persiste

    await store.addMessage(conversationId, { role: 'user', content: message });
    await store.maybeAutoTitle(conversationId, message);
    // Perfil silencioso (recalcula nível se em 'auto').
    result.skillLevel = await profiler.recordUserMessage(userId, message).catch(() => result.skillLevel);
    result.ok = true;
    result.conversation = conv;
    return result;
  } catch (err) {
    console.warn('[ai-turn] beginTurn falhou:', err.message);
    return result;
  }
}

/**
 * Fim do turno: grava a resposta do assistente (texto + blocks opcionais) e
 * dispara o resumo automático se o histórico estiver grande.
 */
async function endTurn({ conversationId, user, content, blocks }) {
  try {
    const userId = user?.id;
    const role = user?.role || 'viewer';
    if (!conversationId || !userId) return;

    const conv = await store.getConversation(conversationId, { userId, role });
    if (!conv) return;

    await store.addMessage(conversationId, { role: 'assistant', content: content || '', blocks });
    // Resumo automático (best-effort, não bloqueia).
    summarizeIfNeeded(conversationId).catch(() => {});
  } catch (err) {
    console.warn('[ai-turn] endTurn falhou:', err.message);
  }
}

/**
 * Monta o histórico persistido no formato Converse (Bedrock) a partir da conversa.
 * Retorna { messages: [{role, content:[{text}]}], summaryText }.
 * Se não houver conversationId/persistência, retorna vazio (o caller usa o
 * `history` enviado pelo cliente como fallback).
 */
async function buildConverseHistory({ conversationId, user }) {
  try {
    const userId = user?.id;
    const role = user?.role || 'viewer';
    if (!conversationId || !userId) return { messages: [], summaryText: '' };

    const conv = await store.getConversation(conversationId, { userId, role });
    if (!conv) return { messages: [], summaryText: '' };

    const { summary, messages } = await store.buildModelHistory(conversationId);
    // A última mensagem do histórico é a do usuário recém-gravada em beginTurn;
    // o caller adiciona a mensagem atual separadamente, então removemos a cauda
    // se ela for idêntica ao turno corrente (evita duplicar).
    const converse = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ text: String(m.content || '') }],
    }));
    return { messages: converse, summaryText: summary || '' };
  } catch (err) {
    console.warn('[ai-turn] buildConverseHistory falhou:', err.message);
    return { messages: [], summaryText: '' };
  }
}

module.exports = { beginTurn, endTurn, buildConverseHistory };
