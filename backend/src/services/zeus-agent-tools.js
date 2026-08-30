'use strict';

/**
 * Zeus Agent Tools — Fase 1 (READ-ONLY)
 *
 * Catálogo de ferramentas que o agente Zeus pode chamar via tool-use (Bedrock
 * Converse API). Todas as ferramentas apenas LEEM/LISTAM dados — nenhuma executa
 * ação destrutiva (start/stop/restart/delete). Cada ferramenta consulta as rotas
 * REST locais do próprio painel usando o JWT do usuário autenticado, de modo que
 * as permissões por role continuam sendo respeitadas.
 */

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

/**
 * Faz um GET autenticado numa rota local do painel.
 * @param {string} pathname - caminho (ex.: '/docker/services')
 * @param {string} token - JWT do usuário (sem o prefixo 'Bearer ')
 */
async function localGet(pathname, token) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = (body && body.error) || (body && body.message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

const fmtBytes = (b) => {
  if (b == null) return '?';
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)}GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)}MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${b}B`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Definição do catálogo de ferramentas (toolSpec para a Converse API)
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_DEFS = [
  {
    name: 'list_services',
    description:
      'Lista os serviços/containers Docker gerenciados pelo painel, com nome, imagem, status (running/stopped), portas e grupo. Use para responder "quais serviços/containers existem", "o que está rodando", "status dos serviços".',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_service_metrics',
    description:
      'Retorna métricas em tempo real (CPU, RAM, rede, disco, uptime, restarts) de um serviço Docker específico. Requer o id do serviço, obtido via list_services.',
    inputSchema: {
      type: 'object',
      properties: {
        serviceId: { type: 'string', description: 'ID do serviço Docker (campo id de list_services)' },
      },
      required: ['serviceId'],
    },
  },
  {
    name: 'list_docker_containers',
    description:
      'Lista TODOS os containers Docker do host (inclusive não gerenciados pelo painel), com nome, imagem, estado e portas. Use para uma visão bruta do Docker além dos serviços gerenciados.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_databases',
    description:
      'Lista as conexões de banco de dados cadastradas no painel (nome, tipo, host, porta, database, projetos associados). NÃO retorna senhas. Use para "quais bancos existem", "listar conexões de banco".',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_sites',
    description:
      'Lista os sites (ex.: WordPress) gerenciados pelo painel, com domínio, status, SSL e proxy.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_server_metrics',
    description:
      'Retorna métricas gerais da máquina/servidor: uso de CPU, memória (RAM) e disco. Use para "como está o servidor", "uso de CPU/RAM/disco da máquina".',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_nginx',
    description:
      'Lista os virtual hosts do Nginx configurados (domínios, se está ativo e SSL).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Implementações — cada uma recebe (input, token) e devolve um objeto JSON
// compacto e legível para o modelo.
// ─────────────────────────────────────────────────────────────────────────────

const IMPLS = {
  async list_services(_input, token) {
    const data = await localGet('/docker/services', token);
    const services = Array.isArray(data) ? data : (data.services || []);
    return {
      count: services.length,
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        image: s.image,
        status: s.status || s.runtimeState || 'unknown',
        ports: s.ports,
        group: s.group || s.uiGroupId || null,
      })),
    };
  },

  async get_service_metrics(input, token) {
    const id = input.serviceId;
    if (!id) throw new Error('serviceId é obrigatório');
    const data = await localGet(`/docker/services/${encodeURIComponent(id)}/metrics`, token);
    const m = data?.metrics?.current || data?.metrics || {};
    return {
      serviceId: id,
      cpuPercent: m.cpuPercent ?? null,
      memoryUsage: fmtBytes(m.memoryUsage),
      memoryPercent: m.memoryPercent ?? null,
      network: { in: fmtBytes(m.networkRxBytes), out: fmtBytes(m.networkTxBytes) },
      disk: { read: fmtBytes(m.diskReadBytes), write: fmtBytes(m.diskWriteBytes) },
      restartCount: m.restartCount ?? null,
      uptimeSeconds: m.uptimeSeconds ?? null,
    };
  },

  async list_docker_containers(_input, token) {
    const data = await localGet('/docker/containers', token);
    const containers = Array.isArray(data) ? data : (data.containers || []);
    return {
      count: containers.length,
      containers: containers.map((c) => ({
        id: (c.Id || c.id || '').slice(0, 12),
        name: Array.isArray(c.Names) ? c.Names[0]?.replace(/^\//, '') : (c.name || c.Name),
        image: c.Image || c.image,
        state: c.State || c.state,
        status: c.Status || c.status,
        ports: c.Ports || c.ports,
      })),
    };
  },

  async list_databases(_input, token) {
    const rows = await localGet('/api/database-connections', token);
    const list = Array.isArray(rows) ? rows : (rows.connections || []);
    return {
      count: list.length,
      databases: list.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        host: r.host,
        port: r.port,
        database: r.database,
        projects: Array.isArray(r.projects) ? r.projects.map((p) => p.name || p.id || p) : [],
      })),
    };
  },

  async list_sites(_input, token) {
    const data = await localGet('/sites', token);
    const sites = data.sites || data || [];
    return {
      count: sites.length,
      sites: sites.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        status: s.status,
        ssl: !!s.ssl,
        behindProxy: !!s.behindProxy,
      })),
    };
  },

  async get_server_metrics(_input, token) {
    const m = await localGet('/api/metrics', token);
    const disk = Array.isArray(m.disk) ? m.disk[0] : m.disk;
    return {
      cpu: m.cpu?.usage ?? m.cpu ?? null,
      memory: {
        usedPercent: m.memory?.usedPercent ?? m.memory?.used ?? null,
        total: m.memory?.total ?? null,
      },
      disk: disk ? { usedPercent: disk.usedPercent ?? disk.use ?? null, total: disk.total ?? null } : null,
    };
  },

  async list_nginx(_input, token) {
    const data = await localGet('/nginx/servers', token);
    const servers = Array.isArray(data) ? data : (data.servers || []);
    return {
      count: servers.length,
      vhosts: servers.map((s) => ({
        id: s.id,
        name: s.name,
        domains: s.domains || s.serverNames,
        enabled: s.enabled !== false,
        ssl: s.ssl ?? null,
      })),
    };
  },
};

/**
 * Executa uma ferramenta pelo nome.
 * @param {string} name
 * @param {Object} input
 * @param {string} token - JWT do usuário
 * @returns {Promise<Object>} resultado (será serializado como toolResult)
 */
async function runTool(name, input, token) {
  const impl = IMPLS[name];
  if (!impl) throw new Error(`Ferramenta desconhecida: ${name}`);
  return impl(input || {}, token);
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 2 — WRITE TOOLS (ações que alteram estado). NUNCA executam no loop do
// agente: são interceptadas para gerar uma proposta que exige confirmação humana.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Metadados de cada write tool:
 *  - requiredRole: 'admin' | 'viewer'  (mínimo necessário; admin sempre pode)
 *  - risk: 'low' | 'medium' | 'high'
 *  - executes: se false, a ação nunca é executada (ex.: delete → só explica)
 *  - rollback: descrição de como reverter
 */
const WRITE_TOOL_META = {
  restart_service: { requiredRole: 'viewer', risk: 'low', executes: true, rollback: 'Reiniciar novamente / restaurar estado anterior' },
  start_service: { requiredRole: 'admin', risk: 'medium', executes: true, rollback: 'Parar o serviço (estava parado antes)' },
  stop_service: { requiredRole: 'admin', risk: 'medium', executes: true, rollback: 'Iniciar o serviço (estava rodando antes)' },
  update_service: { requiredRole: 'admin', risk: 'high', executes: true, rollback: 'Rollback para a versão (deployment) anterior via /services/:id/rollback' },
  create_service: { requiredRole: 'admin', risk: 'high', executes: true, rollback: 'Remover o serviço recém-criado (requer ação manual: delete não é automático)' },
  delete_service: { requiredRole: 'admin', risk: 'high', executes: false, rollback: 'N/A — delete não é executado pelo agente' },
};

const WRITE_TOOL_DEFS = [
  {
    name: 'restart_service',
    description: 'Reinicia um serviço Docker gerenciado. Requer serviceId (obtenha via list_services). Ação com confirmação obrigatória.',
    inputSchema: { type: 'object', properties: { serviceId: { type: 'string' }, serviceName: { type: 'string', description: 'nome do serviço (para exibir na confirmação)' } }, required: ['serviceId'] },
  },
  {
    name: 'start_service',
    description: 'Inicia um serviço Docker gerenciado que está parado. Requer serviceId. Ação com confirmação obrigatória (somente admin).',
    inputSchema: { type: 'object', properties: { serviceId: { type: 'string' }, serviceName: { type: 'string' } }, required: ['serviceId'] },
  },
  {
    name: 'stop_service',
    description: 'Para um serviço Docker gerenciado que está rodando. Requer serviceId. Ação com confirmação obrigatória (somente admin).',
    inputSchema: { type: 'object', properties: { serviceId: { type: 'string' }, serviceName: { type: 'string' } }, required: ['serviceId'] },
  },
  {
    name: 'update_service',
    description: 'Atualiza a configuração de um serviço (envs, imagem, portas, etc.). Faz backup/versionamento para permitir rollback. Requer serviceId e um objeto updates. Confirmação obrigatória (somente admin).',
    inputSchema: { type: 'object', properties: { serviceId: { type: 'string' }, serviceName: { type: 'string' }, updates: { type: 'object', description: 'campos a atualizar' } }, required: ['serviceId', 'updates'] },
  },
  {
    name: 'create_service',
    description: 'Cria um novo serviço Docker. Requer ao menos name e imagem/template. Confirmação obrigatória (somente admin). Se faltar informação essencial, pergunte ao usuário em vez de assumir.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, config: { type: 'object', description: 'templateId/imageName, hostPort, volumeMappings, envVars, etc.' } }, required: ['name'] },
  },
  {
    name: 'delete_service',
    description: 'Solicitação para REMOVER um serviço. O agente NÃO executa remoção — apenas explica o impacto e verifica se há bloqueios/dependências. Use quando o usuário pedir para apagar/remover/deletar um serviço.',
    inputSchema: { type: 'object', properties: { serviceId: { type: 'string' }, serviceName: { type: 'string' } }, required: ['serviceId'] },
  },
];

const WRITE_TOOL_NAMES = new Set(WRITE_TOOL_DEFS.map((t) => t.name));

/**
 * Verifica se o role pode PROPOR/EXECUTAR uma write tool.
 * admin: tudo. viewer (e demais não-admin): apenas restart_service.
 */
function canRoleUseWriteTool(role, toolName) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return true;
  // Não-admin: só restart
  return toolName === 'restart_service';
}

/**
 * Captura o estado atual de um serviço (para snapshot de rollback).
 */
async function snapshotService(serviceId, token) {
  try {
    const data = await localGet('/docker/services', token);
    const services = Array.isArray(data) ? data : (data.services || []);
    const s = services.find((x) => x.id === serviceId);
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      status: s.status || s.runtimeState || 'unknown',
      activeDeploymentId: s.activeDeploymentId || null,
    };
  } catch {
    return null;
  }
}

/**
 * POST autenticado numa rota local do painel.
 */
async function localPost(pathname, body, token, method = 'POST') {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    const msg = (parsed && (parsed.error || parsed.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return parsed;
}

/**
 * Executores das write tools. Cada um retorna { result, rollback } onde
 * rollback descreve como reverter (e uma referência utilizável quando houver).
 * NUNCA chame isto diretamente do loop do agente — só via /zeus/agent/confirm.
 */
const WRITE_IMPLS = {
  async restart_service(input, token) {
    const before = await snapshotService(input.serviceId, token);
    const r = await localPost(`/docker/services/${encodeURIComponent(input.serviceId)}/restart`, {}, token);
    return { result: { action: 'restart', status: 'ok', service: r?.name || input.serviceId }, rollback: { type: 'restart', before, ref: input.serviceId } };
  },
  async start_service(input, token) {
    const before = await snapshotService(input.serviceId, token);
    const r = await localPost(`/docker/services/${encodeURIComponent(input.serviceId)}/start`, {}, token);
    // rollback: se estava parado antes, reverter = stop
    return { result: { action: 'start', status: 'ok', service: r?.name || input.serviceId }, rollback: { type: 'stop', before, ref: input.serviceId, reversible: before?.status !== 'running' } };
  },
  async stop_service(input, token) {
    const before = await snapshotService(input.serviceId, token);
    const r = await localPost(`/docker/services/${encodeURIComponent(input.serviceId)}/stop`, {}, token);
    // rollback: se estava rodando antes, reverter = start
    return { result: { action: 'stop', status: 'ok', service: r?.name || input.serviceId }, rollback: { type: 'start', before, ref: input.serviceId, reversible: before?.status === 'running' } };
  },
  async update_service(input, token) {
    const before = await snapshotService(input.serviceId, token);
    const r = await localPost(`/docker/services/${encodeURIComponent(input.serviceId)}`, input.updates || {}, token, 'PUT');
    // rollback via versão anterior (deployment) — referência guardada para /services/:id/rollback
    return {
      result: { action: 'update', status: 'ok', service: r?.service?.name || input.serviceId },
      rollback: { type: 'version_rollback', ref: input.serviceId, previousDeploymentId: before?.activeDeploymentId || null, endpoint: `/docker/services/${input.serviceId}/rollback` },
    };
  },
  async create_service(input, token) {
    const payload = { name: input.name, ...(input.config || {}) };
    const r = await localPost('/docker/services', payload, token);
    const newId = r?.service?.id || r?.id || null;
    return { result: { action: 'create', status: 'ok', service: input.name, id: newId }, rollback: { type: 'manual_delete', ref: newId, note: 'Reverter um create = remover o serviço (delete não é automático).' } };
  },
};

/**
 * Executa uma write tool (SÓ chamada a partir de /zeus/agent/confirm, após gate de role).
 */
async function runWriteTool(name, input, token) {
  const meta = WRITE_TOOL_META[name];
  if (!meta) throw new Error(`Write tool desconhecida: ${name}`);
  if (!meta.executes) {
    throw new Error(`A ação "${name}" não é executável pelo agente (apenas explicação).`);
  }
  const impl = WRITE_IMPLS[name];
  if (!impl) throw new Error(`Executor ausente para: ${name}`);
  return impl(input || {}, token);
}

module.exports = {
  TOOL_DEFS,
  runTool,
  WRITE_TOOL_DEFS,
  WRITE_TOOL_META,
  WRITE_TOOL_NAMES,
  canRoleUseWriteTool,
  runWriteTool,
};
