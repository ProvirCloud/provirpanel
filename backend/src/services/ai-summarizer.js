'use strict';

/**
 * AI Summarizer
 *
 * Quando o histórico de uma conversa excede o orçamento de tokens, resumimos as
 * mensagens antigas (as que ficaram fora do trecho verbatim) e acumulamos no
 * campo `summary` da conversa. Isso evita estourar o contexto do modelo.
 *
 * O resumo é gerado pelo Gateway Zeus (Ollama, barato) via /api/chat/direct.
 * É best-effort: se falhar, mantém o resumo anterior e não bloqueia o chat.
 */

const store = require('./ai-conversation-store');

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://localhost:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';

const SUMMARY_SYSTEM = `Você é um resumidor de conversas técnicas do Provir Cloud Panel.
Receberá o resumo anterior (se houver) e novas mensagens antigas de uma conversa entre
um usuário e o assistente Zeus. Produza um ÚNICO resumo consolidado, conciso e factual,
em português, preservando: decisões tomadas, ações executadas, identificadores (serviços,
containers, domínios), pendências e preferências do usuário. Não invente. Máx. ~200 palavras.`;

function renderMessages(messages) {
  return messages
    .map((m) => `${m.role === 'assistant' ? 'Assistente' : 'Usuário'}: ${(m.content || '').trim()}`)
    .filter((l) => l.length > 12)
    .join('\n');
}

async function callDirect(messages) {
  const res = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({ messages, options: { large: false } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Gateway direct falhou (${res.status})`);
  const data = await res.json();
  // O gateway pode responder { content } ou { message: { content } }
  return data.content || data.message?.content || data.text || '';
}

/**
 * Resume as mensagens antigas e atualiza o summary da conversa, SE necessário.
 * Chame após persistir a resposta do assistente.
 *
 * @returns {Promise<boolean>} true se resumiu, false se nada a fazer/falhou.
 */
async function summarizeIfNeeded(conversationId) {
  try {
    const { summary, overBudget, olderMessages } = await store.buildModelHistory(conversationId);
    if (!overBudget || olderMessages.length === 0) return false;

    const previous = summary ? `Resumo anterior:\n${summary}\n\n` : '';
    const novo = renderMessages(olderMessages);
    if (!novo) return false;

    const userPrompt = `${previous}Novas mensagens a incorporar:\n${novo}\n\nProduza o resumo consolidado.`;
    const condensed = await callDirect([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: userPrompt },
    ]);

    if (condensed && condensed.trim()) {
      await store.setSummary(conversationId, condensed.trim());
      return true;
    }
    return false;
  } catch (err) {
    // best-effort — não quebra o fluxo do chat
    console.warn('[ai-summarizer] falhou:', err.message);
    return false;
  }
}

module.exports = { summarizeIfNeeded };
