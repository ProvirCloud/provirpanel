'use strict';

/**
 * AI User Profiler (silencioso)
 *
 * Infere o nível de conhecimento do usuário a partir de sinais das mensagens,
 * SEM expor esse nível na UI. O nível é usado apenas para adaptar o tom das
 * respostas (Fase 4): avançado → técnico e direto; iniciante → exemplos simples.
 *
 * Estratégia: acumula sinais leves (contadores) em ai_user_profiles.signals
 * (JSONB) e recalcula skill_level quando o usuário não fez override manual
 * (skill_level = 'auto').
 *
 * É best-effort: nunca lança para o fluxo de chat.
 */

const pool = require('../config/database');

// Vocabulário técnico → sinal de usuário avançado.
const TECH_TERMS_RE = /\b(docker|container|kubernetes|k8s|nginx|proxy|upstream|systemd|pm2|jwt|oauth|tls|ssl|ca|regex|env|dockerfile|compose|webhook|ci\/cd|pipeline|migration|schema|index|query|sql|jsonb|socket|websocket|sse|stdout|stderr|kill|chmod|chown|sudo|ssh|dns|cname|mx|waf|iptables|cron|api|endpoint|payload|stack trace|deploy|rollback|branch|commit|rebase|merge)\b/i;

// Pedidos de explicação simples/passo-a-passo → sinal de iniciante.
const NOVICE_RE = /\b(o que é|como faço|passo a passo|n[aã]o sei|n[aã]o entendo|explica|simples|f[aá]cil|iniciante|leigo|para leigos|o que significa|serve para que)\b/i;

function defaultSignals() {
  return { turns: 0, techHits: 0, noviceHits: 0, avgLen: 0, commandLike: 0 };
}

function inferLevel(sig) {
  if (!sig || sig.turns < 3) return 'auto'; // poucos dados → não decide ainda
  const techRatio = sig.techHits / Math.max(1, sig.turns);
  const noviceRatio = sig.noviceHits / Math.max(1, sig.turns);
  const cmdRatio = sig.commandLike / Math.max(1, sig.turns);

  if (techRatio >= 0.5 || cmdRatio >= 0.3) return 'avancado';
  if (noviceRatio >= 0.4 && techRatio < 0.2) return 'iniciante';
  return 'intermediario';
}

async function loadProfile(userId) {
  const { rows } = await pool.query(
    `SELECT user_id AS "userId", skill_level AS "skillLevel", signals, summary
       FROM ai_user_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Registra uma mensagem do usuário e atualiza sinais/nível (se em 'auto').
 * @returns {Promise<string>} skill_level efetivo após o update.
 */
async function recordUserMessage(userId, message) {
  try {
    if (!userId) return 'auto';
    const text = String(message || '');
    const profile = await loadProfile(userId);
    const sig = { ...defaultSignals(), ...(profile?.signals || {}) };

    sig.turns += 1;
    if (TECH_TERMS_RE.test(text)) sig.techHits += 1;
    if (NOVICE_RE.test(text)) sig.noviceHits += 1;
    // "command-like": contém flags/paths/comandos típicos.
    if (/(^|\s)(-{1,2}[a-z]|\/[\w./-]+|sudo |git |npm |docker |psql |curl )/i.test(text)) {
      sig.commandLike += 1;
    }
    // média móvel simples do tamanho
    sig.avgLen = Math.round(((sig.avgLen * (sig.turns - 1)) + text.length) / sig.turns);

    const currentLevel = profile?.skillLevel || 'auto';
    // Só recalcula automaticamente se o usuário não fez override manual.
    const effective = currentLevel === 'auto' ? inferLevel(sig) : currentLevel;

    await pool.query(
      `INSERT INTO ai_user_profiles (user_id, skill_level, signals, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET signals = $3,
             skill_level = CASE WHEN ai_user_profiles.skill_level = 'auto'
                                THEN $2 ELSE ai_user_profiles.skill_level END,
             updated_at = NOW()`,
      [userId, effective, JSON.stringify(sig)]
    );

    // Nível efetivo para o prompt: se override manual, usa-o; senão o inferido.
    return currentLevel === 'auto' ? effective : currentLevel;
  } catch (err) {
    console.warn('[ai-user-profiler] falhou:', err.message);
    return 'auto';
  }
}

/**
 * Retorna o nível efetivo atual (para montar o system prompt), sem gravar.
 */
async function getEffectiveLevel(userId) {
  try {
    const profile = await loadProfile(userId);
    if (!profile) return 'auto';
    if (profile.skillLevel && profile.skillLevel !== 'auto') return profile.skillLevel;
    return inferLevel(profile.signals);
  } catch {
    return 'auto';
  }
}

/**
 * Define override manual de nível (via endpoint de perfil).
 */
async function setSkillLevel(userId, level) {
  const valid = ['auto', 'iniciante', 'intermediario', 'avancado'];
  if (!valid.includes(level)) throw new Error('skill_level inválido');
  await pool.query(
    `INSERT INTO ai_user_profiles (user_id, skill_level, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET skill_level = $2, updated_at = NOW()`,
    [userId, level]
  );
  return level;
}

module.exports = {
  recordUserMessage,
  getEffectiveLevel,
  setSkillLevel,
  loadProfile,
  inferLevel,
};
