'use strict';

/**
 * infraLogger — Logger de ações de infraestrutura para treinamento de AI.
 *
 * Cada ação de infra executada no painel é registrada como uma linha JSONL
 * (JSON Lines) no arquivo training/infra-actions.jsonl.
 *
 * Formato de cada entrada:
 * {
 *   "timestamp": "ISO string",
 *   "action": "stack.create | stack.start | service.add | service.configure | ...",
 *   "user": "username do operador",
 *   "stackId": "UUID | null",
 *   "stackName": "string | null",
 *   "stackEnvironment": "production | staging | development",
 *   "client": "string | null",
 *   "serviceId": "UUID | null",
 *   "serviceName": "string | null",
 *   "serviceRole": "string | null",
 *   "input": { /* dados de entrada da ação *\/ },
 *   "output": { /* resultado da ação *\/ },
 *   "context": { /* contexto adicional *\/ },
 *   "duration_ms": number,
 *   "success": boolean,
 *   "error": "string | null"
 * }
 *
 * Ações registradas:
 *   stack.create       — nova stack criada
 *   stack.update       — metadados da stack atualizados
 *   stack.delete       — stack deletada
 *   stack.start        — stack inteira iniciada
 *   stack.stop         — stack inteira parada
 *   stack.clone        — stack clonada para novo ambiente
 *   service.add        — serviço adicionado à stack
 *   service.update     — configuração de serviço atualizada
 *   service.remove     — serviço removido da stack
 *   service.start      — serviço individual iniciado
 *   service.stop       — serviço individual parado
 *   service.restart    — serviço reiniciado
 *   compose.export     — docker-compose.yml exportado
 *   blueprint.apply    — blueprint aplicado para criar stack
 *
 * Este log é a fonte primária de dados para treinar o agente de AI que
 * automatizará a criação de infraestruturas de clientes.
 */

const fs = require('fs');
const path = require('path');

const TRAINING_DIR = path.join(__dirname, '../../data/training');
const ACTIONS_FILE = path.join(TRAINING_DIR, 'infra-actions.jsonl');
const SUMMARY_FILE = path.join(TRAINING_DIR, 'action-summary.json');

// Garante que o diretório existe
fs.mkdirSync(TRAINING_DIR, { recursive: true });

/**
 * Registra uma ação de infraestrutura.
 *
 * @param {string} action - Tipo da ação (ex: "stack.create")
 * @param {Object} data - Dados da ação
 * @param {string} [data.user] - Usuário que executou
 * @param {string} [data.stackId]
 * @param {string} [data.stackName]
 * @param {string} [data.stackEnvironment]
 * @param {string} [data.client]
 * @param {string} [data.serviceId]
 * @param {string} [data.serviceName]
 * @param {string} [data.serviceRole]
 * @param {Object} [data.input] - Dados de entrada
 * @param {Object} [data.output] - Resultado
 * @param {Object} [data.context] - Contexto adicional
 * @param {number} [data.duration_ms]
 * @param {boolean} [data.success]
 * @param {string} [data.error]
 */
const logAction = (action, data = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    user: data.user || 'system',
    stackId: data.stackId || null,
    stackName: data.stackName || null,
    stackEnvironment: data.stackEnvironment || null,
    client: data.client || null,
    serviceId: data.serviceId || null,
    serviceName: data.serviceName || null,
    serviceRole: data.serviceRole || null,
    input: data.input || null,
    output: data.output || null,
    context: data.context || null,
    duration_ms: data.duration_ms || null,
    success: data.success !== undefined ? data.success : true,
    error: data.error || null
  };

  // Remove secrets das variáveis de ambiente antes de logar
  if (entry.input?.services) {
    entry.input.services = entry.input.services.map((svc) => ({
      ...svc,
      env: (svc.env || []).map((e) => ({
        key: e.key,
        value: e.secret ? '[SECRET]' : e.value,
        secret: e.secret
      }))
    }));
  }
  if (entry.input?.env) {
    entry.input.env = entry.input.env.map((e) => ({
      key: e.key,
      value: e.secret ? '[SECRET]' : e.value,
      secret: e.secret
    }));
  }

  // Escreve no arquivo JSONL (append)
  fs.appendFile(ACTIONS_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) {
      console.warn('[infraLogger] Falha ao gravar log de treinamento:', err.message);
    }
  });

  // Atualiza sumário de forma assíncrona
  updateSummary(action, entry.success).catch(() => {});
};

/**
 * Wrapper para medir duração e logar ação com resultado.
 * Uso: await withLog('stack.create', { user, input }, async () => { ... })
 */
const withLog = async (action, meta, fn) => {
  const start = Date.now();
  try {
    const result = await fn();
    logAction(action, {
      ...meta,
      output: result,
      duration_ms: Date.now() - start,
      success: true
    });
    return result;
  } catch (err) {
    logAction(action, {
      ...meta,
      duration_ms: Date.now() - start,
      success: false,
      error: err.message
    });
    throw err;
  }
};

/**
 * Mantém um sumário de ações para análise rápida.
 */
const updateSummary = async (action, success) => {
  let summary = {};
  try {
    if (fs.existsSync(SUMMARY_FILE)) {
      summary = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
    }
  } catch {
    summary = {};
  }

  if (!summary.total) summary.total = 0;
  if (!summary.byAction) summary.byAction = {};
  if (!summary.lastUpdated) summary.lastUpdated = null;

  summary.total++;
  summary.byAction[action] = (summary.byAction[action] || 0) + 1;
  if (!success) summary.errors = (summary.errors || 0) + 1;
  summary.lastUpdated = new Date().toISOString();

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
};

/**
 * Retorna sumário das ações registradas.
 */
const getSummary = () => {
  try {
    if (fs.existsSync(SUMMARY_FILE)) {
      return JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
    }
  } catch {
    // Ignora erro
  }
  return { total: 0, byAction: {}, errors: 0, lastUpdated: null };
};

/**
 * Retorna as últimas N ações do log.
 */
const getRecentActions = (limit = 50) => {
  try {
    if (!fs.existsSync(ACTIONS_FILE)) return [];
    const content = fs.readFileSync(ACTIONS_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line)).reverse();
  } catch {
    return [];
  }
};

module.exports = { logAction, withLog, getSummary, getRecentActions };
