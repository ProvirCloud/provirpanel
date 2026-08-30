'use strict';

/**
 * Zeus Agent Router (híbrido, conservador)
 *
 * Decide se uma mensagem do chat pode ser respondida por um LLM local barato
 * (Ollama) ou se precisa do Bedrock (tool-use / RAG / dados reais).
 *
 * Princípio CONSERVADOR: na dúvida → Bedrock. Só roteia para o Ollama quando a
 * mensagem é claramente conversacional/trivial e NÃO menciona nada de infra,
 * dados do painel ou ações. Isso evita mandar para o modelo local pedidos que
 * dependem de ferramentas (que ele não tem).
 */

// Termos que indicam necessidade de DADOS REAIS, INFRA ou AÇÃO → sempre Bedrock.
// Cobre PT/EN e nomes/temas das ferramentas do agente.
const INFRA_ACTION_RE = new RegExp(
  [
    // recursos/infra
    'servi[cç]o', 'service', 'container', 'docker', 'nginx', 'banco', 'database',
    'db\\b', 'sql', 'postgres', 'mysql', 'mongo', 'redis',
    'site', 'dom[ií]nio', 'domain', 'dns', 'ssl', 'https', 'porta', 'port',
    'm[eé]trica', 'metric', 'cpu', 'ram', 'mem[oó]ria', 'memory', 'disco', 'disk',
    'log', 'uptime', 'status', 'health', 'stack', 'deploy', 'volume', 'imagem', 'image',
    'servidor', 'server', 'm[aá]quina', 'machine', 'host', 'painel', 'panel',
    // ações
    'reinicie', 'reiniciar', 'restart', 'inicie', 'iniciar', 'start',
    'pare', 'parar', 'stop', 'atualize', 'atualizar', 'update',
    'crie', 'criar', 'create', 'remova', 'remover', 'apague', 'apagar', 'delete', 'deletar',
    'liste', 'listar', 'list', 'mostre', 'mostrar', 'show',
    'quantos', 'quantas', 'quais', 'rodando', 'ativo', 'ativos', 'parado', 'offline', 'online',
    'configure', 'configurar', 'execute', 'executar', 'rode', 'rodar',
  ].join('|'),
  'i'
);

// Padrões claramente TRIVIAIS/conversacionais (whitelist estreita).
// Usamos lookahead unicode (?![\p{L}]) em vez de \b porque, em JS, o word
// boundary \b não reconhece letras acentuadas (á, é, ê...) como parte da
// palavra, o que fazia "olá" e "você" não casarem.
const GREETING_RE = /^(ol[aá]|oi|e a[ií]|opa|bom dia|boa tarde|boa noite|hey|hi|hello|yo)(?![\p{L}])/iu;
const THANKS_RE = /(?<![\p{L}])(obrigad[oa]|valeu|thanks|thank you|agrade[cç]|tks|vlw)(?![\p{L}])/iu;
const SMALLTALK_RE = /(?<![\p{L}])(tudo bem|como vai|beleza|de boa|quem [eé] voc[eê]|o que voc[eê] (faz|pode fazer)|who are you|what can you do|tchau|bye|at[eé] mais)(?![\p{L}])/iu;
// "ajuda"/"help" isolado só é trivial em mensagens muito curtas (ver isTrivialChat).
const HELP_RE = /(?<![\p{L}])(ajuda|help)(?![\p{L}])/iu;

/**
 * Retorna true se a mensagem for trivial o suficiente para o LLM local.
 * @param {string} message
 * @returns {boolean}
 */
function isTrivialChat(message) {
  if (!message || typeof message !== 'string') return false;
  const text = message.trim();
  if (!text) return false;

  // Mensagens longas raramente são triviais — vão para o Bedrock.
  if (text.length > 120) return false;

  // Qualquer sinal de infra/dados/ação → Bedrock (conservador).
  if (INFRA_ACTION_RE.test(text)) return false;

  // Só considera trivial se casar explicitamente um padrão conversacional.
  const trivial = GREETING_RE.test(text) || THANKS_RE.test(text) || SMALLTALK_RE.test(text);
  // "ajuda"/"help" isolado é trivial apenas em mensagens bem curtas (<= 40 chars);
  // em frases longas/vagas, preferimos o Bedrock (conservador).
  const shortHelp = text.length <= 40 && HELP_RE.test(text);
  return trivial || shortHelp;
}

/**
 * Decide o provider: 'ollama' (trivial) ou 'bedrock' (default/robusto).
 * @param {string} message
 * @param {Array} [history]
 * @returns {'ollama'|'bedrock'}
 */
function routeProvider(message, history) {
  // Se há histórico recente com uso de ferramentas, mantém no Bedrock por
  // coerência de contexto (evita "trocar de cérebro" no meio da conversa).
  if (Array.isArray(history) && history.some((h) => h && h.tool)) return 'bedrock';
  return isTrivialChat(message) ? 'ollama' : 'bedrock';
}

module.exports = { isTrivialChat, routeProvider };
