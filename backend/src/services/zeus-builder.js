'use strict';

/**
 * Zeus Builder — serviço de pipeline (application layer) no PAINEL.
 *
 * Responsabilidades:
 *  - Orquestrar o pipeline Discovery → Architecture → Plan(+Spec) → Approval.
 *  - Persistir TUDO no Postgres via Prisma (multi-tenant por clienteId + userId),
 *    de modo que a sessão seja retomável e o gateway permaneça stateless.
 *  - Chamar o "cérebro" LLM no gateway (rotas /api/build/*), passando a persona
 *    do agente (arquiteto/planejador) vinda de services/ai-agents.js.
 *
 * Isolamento (regra não-negociável): toda query monta o filtro de escopo no
 * servidor (clienteId + userId). Nunca confia em id vindo do cliente sem checar
 * a posse. Ver docs/PLANO-AGENTE-ARQUITETO.md §4.3.
 */

const prisma = require('../config/prisma');
const aiAgents = require('./ai-agents');

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://localhost:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';

// Estágios da state machine (persistidos em agent_sessions.stage).
const STAGES = Object.freeze({
  DISCOVERY: 'discovery',
  ARCHITECTURE: 'architecture',
  PLANNING: 'planning',
  AWAITING_APPROVAL: 'awaiting_approval',
  APPROVED: 'approved',
  BUILDING: 'building',
  DONE: 'done',
});

/** Chamada autenticada ao gateway (x-api-key). `timeoutMs` configurável por chamada. */
async function gatewayPost(path, body, timeoutMs = 120000) {
  const res = await fetch(`${ZEUS_GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data.error || `Gateway error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Monta o filtro de escopo multi-tenant (sempre no servidor). */
function scopeWhere(user, clienteId) {
  return { userId: user.id, clienteId: clienteId || null };
}

/** Registra um evento append-only na sessão. */
async function logEvent(sessionId, { role, agent = null, content = null, data = null, tokensIn = 0, tokensOut = 0 }) {
  return prisma.agentSessionEvent.create({
    data: { sessionId, role, agent, content, data: data || undefined, tokensIn, tokensOut },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Casos de uso
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um projeto + sessão inicial (estágio discovery).
 * @param {{id:string, role:string}} user
 * @param {object} input - { name, kind?, gitUrl?, clienteId?, channel? }
 */
async function createProject(user, input = {}) {
  const clienteId = input.clienteId || null;
  const project = await prisma.agentProject.create({
    data: {
      clienteId,
      userId: user.id,
      name: input.name || 'Novo projeto',
      kind: input.kind === 'existing' ? 'existing' : 'new',
      gitUrl: input.gitUrl || null,
      status: STAGES.DISCOVERY,
    },
  });
  const session = await prisma.agentSession.create({
    data: {
      projectId: project.id,
      clienteId,
      userId: user.id,
      channel: input.channel === 'cli' ? 'cli' : 'panel',
      stage: STAGES.DISCOVERY,
    },
  });
  await logEvent(session.id, { role: 'system', content: `Projeto "${project.name}" criado (kind=${project.kind}).` });
  return { project, session };
}

/** Carrega uma sessão garantindo posse (escopo). Lança 404 se não pertencer. */
async function getOwnedSession(user, sessionId, clienteId) {
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, ...scopeWhere(user, clienteId) },
    include: { project: true },
  });
  if (!session) {
    const err = new Error('Sessão não encontrada');
    err.status = 404;
    throw err;
  }
  return session;
}

/**
 * Passo de descoberta: grava a mensagem do usuário, chama o gateway (persona do
 * arquiteto/planejador), persiste o retorno e avança o estágio se pronto.
 */
async function discover(user, sessionId, message, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  await logEvent(session.id, { role: 'user', content: message });

  // Contexto = últimos eventos relevantes da sessão (retomável).
  const context = await buildSessionContext(session.id);
  const persona = aiAgents.getPersona('arquiteto_software');

  const { discovery } = await gatewayPost('/api/build/discovery', { message, context, persona });

  await logEvent(session.id, { role: 'assistant', agent: 'arquiteto_software', data: discovery,
    content: discovery.entendimento || null });

  // Avança para arquitetura quando o modelo sinaliza que há requisitos suficientes.
  if (discovery.pronto_para_arquitetura) {
    await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.ARCHITECTURE } });
    await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: STAGES.ARCHITECTURE } });
  }
  return { stage: discovery.pronto_para_arquitetura ? STAGES.ARCHITECTURE : STAGES.DISCOVERY, discovery };
}

/**
 * Descoberta em STREAMING (SSE). Faz pipe do gateway /converse-stream para o
 * `res` do cliente (token a token), persiste a mensagem do usuário e a resposta
 * do agente, e avança o estágio quando o modelo sinaliza que está pronto.
 * O `res` já deve ter os headers SSE setados pela rota.
 * @param {(o:object)=>void} send - função para emitir eventos SSE ao cliente
 */
async function discoverStream(user, sessionId, message, send, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  await logEvent(session.id, { role: 'user', content: message });
  send({ type: 'user_saved' });

  const context = await buildSessionContext(session.id);
  const persona = aiAgents.getPersona('arquiteto_software');

  // Abre o stream do gateway e repassa os tokens ao cliente.
  const resp = await fetch(`${ZEUS_GATEWAY_URL}/api/build/converse-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({ message, context, persona, attachment: opts.attachment || null, stage: session.stage }),
  });
  if (!resp.ok || !resp.body) {
    const t = await resp.text().catch(() => '');
    send({ type: 'error', error: `Gateway stream falhou (${resp.status}) ${t.slice(0, 120)}` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', fullText = '', ready = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === 'token') { fullText += ev.content || ''; send({ type: 'token', content: ev.content }); }
      else if (ev.type === 'questions') { send({ type: 'questions', questions: ev.questions }); }
      else if (ev.type === 'done') { ready = !!ev.ready; if (ev.text) fullText = ev.text; }
      else if (ev.type === 'error') { send({ type: 'error', error: ev.error }); }
    }
  }

  await logEvent(session.id, { role: 'assistant', agent: 'arquiteto_software', content: fullText });

  const inDiscovery = session.stage === STAGES.DISCOVERY;
  if (ready && inDiscovery) {
    await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.ARCHITECTURE } });
    await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: STAGES.ARCHITECTURE } });
    send({ type: 'stage', stage: STAGES.ARCHITECTURE });
  }
  // `ready` só dispara o CTA de plano quando ainda estamos na descoberta;
  // fora dela é conversa de acompanhamento e não deve reiniciar o fluxo.
  send({ type: 'done', text: fullText, ready: ready && inDiscovery });
}

/**
 * Gera arquitetura + plano estruturado e persiste o plano (versão nova).
 * Move a sessão para AWAITING_APPROVAL.
 */
async function architectAndPlan(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const context = await buildSessionContext(session.id);
  const personaArch = aiAgents.getPersona('arquiteto_software');

  // 1) Arquitetura
  const { architecture } = await gatewayPost('/api/build/architecture', { context, persona: personaArch });
  await logEvent(session.id, { role: 'assistant', agent: 'arquiteto_software', data: architecture,
    content: architecture.resumo || null });

  // 2) Plano estruturado (planner do gateway)
  const planMsg = `Arquitetura aprovada tecnicamente:\n${JSON.stringify(architecture, null, 2)}\n\nGere o plano de execução.`;
  const { plan } = await gatewayPost('/api/build/plan', { message: planMsg, context });

  // 3) Persistir plano como nova versão
  const last = await prisma.agentPlan.findFirst({
    where: { projectId: session.projectId }, orderBy: { version: 'desc' },
  });
  const version = (last?.version || 0) + 1;
  const savedPlan = await prisma.agentPlan.create({
    data: {
      projectId: session.projectId,
      version,
      title: plan.titulo || `Plano v${version}`,
      summary: plan.resumo || null,
      content: { architecture, plan },
      status: 'proposed',
    },
  });

  await prisma.agentSession.update({
    where: { id: session.id },
    data: { stage: STAGES.AWAITING_APPROVAL, activePlanId: savedPlan.id },
  });
  await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: STAGES.AWAITING_APPROVAL } });
  await logEvent(session.id, { role: 'stage', content: `Plano v${version} proposto; aguardando aprovação.`, data: { planId: savedPlan.id } });

  return { architecture, plan: savedPlan };
}

/**
 * Approval gate: usuário aprova o plano ativo. Só o dono pode aprovar.
 * Marca o plano approved e a sessão APPROVED (pronto para execução na Fase 2).
 */
async function approvePlan(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  if (!session.activePlanId) {
    const err = new Error('Não há plano ativo para aprovar'); err.status = 400; throw err;
  }
  const plan = await prisma.agentPlan.update({
    where: { id: session.activePlanId },
    data: { status: 'approved', approvedAt: new Date(), approvedBy: user.id },
  });
  await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.APPROVED } });
  await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: STAGES.APPROVED } });
  await logEvent(session.id, { role: 'stage', content: `Plano ${plan.title} APROVADO pelo usuário.`, data: { planId: plan.id } });
  return { approved: true, plan };
}

/**
 * Remove um projeto (e tudo em cascata: sessões, eventos, planos, specs,
 * wireframes, build runs, tasks). Só o dono, dentro do escopo, pode remover.
 * Também limpa o workspace de arquivos gerados, se existir.
 */
async function deleteProject(user, projectId, opts = {}) {
  const project = await prisma.agentProject.findFirst({
    where: { id: projectId, ...scopeWhere(user, opts.clienteId) },
  });
  if (!project) { const e = new Error('Projeto não encontrado'); e.status = 404; throw e; }

  // Remove o workspace em disco (best-effort, dentro do PROJECTS_DIR).
  try {
    const dir = workspaceDir(project);
    if (dir.startsWith(PROJECTS_DIR) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}

  // Cascade delete (o schema define onDelete: Cascade a partir de agent_projects).
  await prisma.agentProject.delete({ where: { id: project.id } });
  return { deleted: true, id: project.id };
}

/** Retoma uma sessão: devolve estágio, plano ativo e histórico. */
async function resumeSession(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  // Recupera builds órfãos ANTES de montar o estado: um run que ficou `running`
  // sem progresso (processo morto/reiniciado) nunca se finaliza sozinho e faz a
  // UI girar pra sempre. Marca como `failed` para o usuário ver o que houve.
  await reapStaleRuns(session.projectId);
  // Reconciliação: se o último build teve sucesso mas a sessão não avançou
  // (descompasso stage vs run), corrige para `done` — evita a UI ficar presa em
  // "Build" com loading eterno após um build concluído.
  await reconcileStageWithRun(session);
  const activePlan = session.activePlanId
    ? await prisma.agentPlan.findUnique({ where: { id: session.activePlanId } })
    : null;
  const events = await prisma.agentSessionEvent.findMany({
    where: { sessionId: session.id }, orderBy: { createdAt: 'asc' }, take: 200,
  });
  // Último build run (+tasks) e último wireframe: permitem reconstruir a UI
  // (progresso do build, link, wireframe) após um refresh — sem depender de
  // estado só-em-memória do cliente.
  const lastRun = await prisma.agentBuildRun.findFirst({
    where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' },
  });
  let buildTasks = [];
  if (lastRun) {
    const rows = await prisma.agentTask.findMany({ where: { buildRunId: lastRun.id }, orderBy: { seq: 'asc' } });
    buildTasks = rows.map((t) => {
      let arquivos = [];
      try { arquivos = JSON.parse(t.result || '{}').arquivos || []; } catch {}
      return { seq: t.seq, descricao: t.descricao, tipo: t.tipo, status: t.status, arquivos };
    });
  }
  const lastWireframe = await prisma.agentWireframe.findFirst({
    where: { projectId: session.projectId }, orderBy: { version: 'desc' },
  });
  let wireframeSvg = null;
  if (lastWireframe?.imagePath) { try { wireframeSvg = fs.readFileSync(lastWireframe.imagePath, 'utf-8'); } catch {} }

  // Fase do build: resume o progresso (task X de N) para dar visibilidade do que
  // está acontecendo. `phase` é uma leitura de alto nível derivada do run+tasks.
  let buildPhase = null;
  if (lastRun) {
    const total = buildTasks.length;
    const done = buildTasks.filter((t) => t.status === 'done').length;
    const running = buildTasks.find((t) => t.status === 'running') || null;
    const failed = buildTasks.filter((t) => t.status === 'failed').length;
    let label;
    if (lastRun.status === 'succeeded') label = `Build concluído (${done}/${total} tarefas).`;
    else if (lastRun.status === 'failed') label = `Build falhou${running ? ` na tarefa "${running.descricao}"` : ''}.`;
    else if (lastRun.status === 'running') label = running
      ? `Executando tarefa ${running.seq}/${total}: ${running.descricao}`
      : (total ? `Preparando… (${done}/${total})` : 'Decompondo o plano em tarefas…');
    else label = 'Build na fila.';
    buildPhase = {
      status: lastRun.status, total, done, failed,
      current: running ? { seq: running.seq, descricao: running.descricao } : null,
      label,
    };
  }

  return {
    session, activePlan, events,
    lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, devStackUrl: lastRun.devStackUrl, costUsd: lastRun.costUsd, tasks: buildTasks } : null,
    buildPhase,
    wireframeSvg,
  };
}

// Um run `running` cujo `updatedAt` ficou parado por mais que este limite é
// considerado órfão (processo morto/reiniciado) e é finalizado como `failed`.
// Durante um build ativo o run é "tocado" (touchBuildRun) a cada task, então
// isso NÃO mata builds em andamento — só os que realmente pararam.
const STALE_RUN_MS = Number(process.env.ZEUS_BUILD_STALE_MS || 6 * 60 * 1000);

/**
 * Finaliza builds órfãos de um projeto (status `running` sem progresso recente).
 * Marca o run como `failed`, suas tasks `running` como `failed`, e devolve o
 * projeto para `approved` (permite retomar o build). Best-effort, idempotente.
 * @returns {Promise<number>} quantidade de runs recuperados
 */
async function reapStaleRuns(projectId) {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const stale = await prisma.agentBuildRun.findMany({
    where: { projectId, status: 'running', updatedAt: { lt: cutoff } },
  });
  for (const run of stale) {
    await prisma.agentTask.updateMany({
      where: { buildRunId: run.id, status: 'running' },
      data: { status: 'failed' },
    });
    await prisma.agentBuildRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: `Build interrompido (sem progresso por mais de ${Math.round(STALE_RUN_MS / 60000)} min — processo reiniciado ou travado). Você pode executar o build novamente.`,
      },
    });
    // Devolve o projeto/sessão para um estado retomável (plano segue aprovado).
    await prisma.agentProject.update({ where: { id: projectId }, data: { status: STAGES.APPROVED } });
    const sess = await prisma.agentSession.findFirst({ where: { projectId }, orderBy: { updatedAt: 'desc' } });
    if (sess) {
      await prisma.agentSession.update({ where: { id: sess.id }, data: { stage: STAGES.APPROVED } });
      await logEvent(sess.id, { role: 'system', content: `Build ${run.id.slice(0, 8)} recuperado (órfão) e marcado como falho. Pronto para reexecutar.` });
    }
  }
  return stale.length;
}

/** "Toca" o run em andamento para sinalizar vida (evita ser marcado como órfão). */
async function touchBuildRun(runId) {
  try { await prisma.agentBuildRun.update({ where: { id: runId }, data: { updatedAt: new Date() } }); } catch {}
}

/**
 * Sincroniza o stage da sessão com o resultado do último build run. Se o run
 * mais recente foi `succeeded` mas a sessão ficou atrás (ex.: `approved`/`building`),
 * avança para `done`. Muta o objeto `session` recebido para o retorno refletir.
 */
async function reconcileStageWithRun(session) {
  const lastRun = await prisma.agentBuildRun.findFirst({
    where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' },
  });
  if (!lastRun) return;
  const terminalStages = [STAGES.DONE, 'provisioned'];
  if (lastRun.status === 'succeeded' && !terminalStages.includes(session.stage)) {
    await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.DONE } });
    await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: 'done' } });
    session.stage = STAGES.DONE; // reflete no retorno de resumeSession
  }
}

/** Lista projetos do escopo do usuário. */
async function listProjects(user, opts = {}) {
  return prisma.agentProject.findMany({
    where: scopeWhere(user, opts.clienteId),
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
}

/** Retorna a sessão mais recente de um projeto (garante posse pelo escopo). */
async function latestSessionForProject(user, projectId, opts = {}) {
  const project = await prisma.agentProject.findFirst({
    where: { id: projectId, ...scopeWhere(user, opts.clienteId) },
  });
  if (!project) { const e = new Error('Projeto não encontrado'); e.status = 404; throw e; }
  const session = await prisma.agentSession.findFirst({
    where: { projectId }, orderBy: { updatedAt: 'desc' },
  });
  if (!session) { const e = new Error('Projeto sem sessão'); e.status = 404; throw e; }
  return resumeSession(user, session.id, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 2 — Dev Executor + provisão de stack dev
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECTS_DIR = process.env.CLOUDPAINEL_PROJECTS_DIR
  ? path.join(process.env.CLOUDPAINEL_PROJECTS_DIR, 'zeus-builder')
  : path.join(process.cwd(), 'backend/data/projects/zeus-builder');

/** Resolve (e cria) o diretório de workspace de um projeto, com slug seguro. */
function workspaceDir(project) {
  const slug = String(project.name || 'projeto')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'projeto';
  const dir = path.join(PROJECTS_DIR, `${slug}-${project.id.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Escreve um arquivo no workspace, com validação anti path-traversal. */
function writeWorkspaceFile(baseDir, relPath, content) {
  if (typeof relPath !== 'string' || relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error(`Caminho de arquivo inválido: ${relPath}`);
  }
  const full = path.resolve(baseDir, relPath);
  if (!full.startsWith(path.resolve(baseDir) + path.sep)) {
    throw new Error(`Caminho fora do workspace: ${relPath}`);
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : String(content ?? ''), 'utf-8');
  return path.relative(baseDir, full);
}

/**
 * Executa o build de um plano aprovado: cria um AgentBuildRun (serve de fila/lock
 * multi-instância), decompõe o plano em micro-tasks, executa cada task de código
 * via gateway /dev-task e aplica os arquivos no workspace do projeto.
 *
 * @param {{id:string, role:string}} user
 * @param {string} sessionId
 * @param {object} opts - { clienteId?, instanceId? }
 */
async function executeBuild(user, sessionId, opts = {}) {
  const emit = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  if (session.stage !== STAGES.APPROVED || !session.activePlanId) {
    const err = new Error('A sessão precisa ter um plano APROVADO antes de executar'); err.status = 400; throw err;
  }
  const plan = await prisma.agentPlan.findUnique({ where: { id: session.activePlanId } });
  if (!plan || plan.status !== 'approved') {
    const err = new Error('Plano ativo não está aprovado'); err.status = 400; throw err;
  }

  // Budget guard: bloqueia se o tenant estourou o teto mensal (Fase 4).
  await assertWithinBudget(user, session.clienteId);

  // Cria o build run (fila). Em multi-instância, o claim é atômico via updateMany.
  const run = await prisma.agentBuildRun.create({
    data: {
      projectId: session.projectId, planId: plan.id,
      clienteId: session.clienteId, userId: user.id, status: 'queued',
    },
  });
  const instanceId = opts.instanceId || `${require('os').hostname()}#${process.pid}`;
  const claim = await prisma.agentBuildRun.updateMany({
    where: { id: run.id, status: 'queued' },
    data: { status: 'running', claimedBy: instanceId, startedAt: new Date() },
  });
  if (claim.count !== 1) {
    const err = new Error('Build run já reivindicado por outra instância'); err.status = 409; throw err;
  }
  await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: 'building' } });
  await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.BUILDING } });
  await logEvent(session.id, { role: 'stage', content: `Build iniciado (run ${run.id.slice(0, 8)}).`, data: { runId: run.id } });

  const arquitetura = plan.content?.architecture || null;
  const planStruct = plan.content?.plan || plan.content || {};
  const baseDir = workspaceDir(session.project);
  const written = [];
  let accumulatedContext = '';

  try {
    // 1) Decompõe o plano em micro-tasks (gateway reusa planner.breakIntoMicroTasks).
    const { microTasks } = await gatewayPost('/api/build/decompose', { plan: planStruct });
    emit({ type: 'decomposed', total: microTasks.length, tasks: microTasks.map((t, i) => ({ seq: i + 1, descricao: t.descricao || `Task ${i + 1}`, tipo: t.tipo || t.type || 'codigo' })) });

    // 2) Executa cada task; para as de código, aplica arquivos no workspace.
    let seq = 0;
    let totalIn = 0, totalOut = 0, totalCost = 0;
    for (const mt of microTasks) {
      seq += 1;
      await touchBuildRun(run.id); // sinaliza vida ao reaper de órfãos
      emit({ type: 'task_start', seq, total: microTasks.length, descricao: mt.descricao || `Task ${seq}`, tipo: mt.tipo || mt.type || 'codigo' });
      const taskRow = await prisma.agentTask.create({
        data: {
          planId: plan.id, buildRunId: run.id, seq,
          descricao: mt.descricao || `Task ${seq}`, tipo: mt.tipo || mt.type || 'codigo',
          prompt: mt.prompt || mt.descricao || '', status: 'running',
        },
      });

      const resp = await gatewayPost('/api/build/dev-task', {
        task: mt, context: accumulatedContext, arquitetura,
        arquivosExistentes: [...new Set(written)], // evita duplicar arquivos já criados
      }, 240000); // 4 min: geração de código pode ser pesada
      const dev = resp.dev || {};
      const usage = resp.usage || { inputTokens: 0, outputTokens: 0 };
      totalIn += usage.inputTokens || 0;
      totalOut += usage.outputTokens || 0;
      totalCost += resp.costUsd || 0;

      const applied = [];
      for (const f of (dev.arquivos || [])) {
        const rel = writeWorkspaceFile(baseDir, f.path, f.conteudo);
        applied.push(rel);
        written.push(rel);
      }
      accumulatedContext += `\n--- Task ${seq} (${taskRow.descricao}) ---\nArquivos: ${applied.join(', ')}\n${dev.observacoes || ''}\n`;

      await prisma.agentTask.update({
        where: { id: taskRow.id },
        data: {
          status: 'done',
          result: JSON.stringify({ arquivos: applied, comandos: dev.comandos || [], observacoes: dev.observacoes }),
          tokensIn: usage.inputTokens || 0, tokensOut: usage.outputTokens || 0,
        },
      });
      emit({ type: 'task_done', seq, total: microTasks.length, descricao: taskRow.descricao, arquivos: applied });
    }

    const finishedRun = await prisma.agentBuildRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded', finishedAt: new Date(),
        tokensIn: totalIn, tokensOut: totalOut, costUsd: totalCost,
      },
    });
    await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: 'done' } });
    await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.DONE } });
    await logEvent(session.id, { role: 'stage', content: `Build concluído: ${written.length} arquivo(s). Custo estimado US$ ${totalCost.toFixed(4)} (${totalIn + totalOut} tokens).`, data: { runId: run.id, arquivos: written, costUsd: totalCost } });
    emit({ type: 'build_done', arquivos: written, costUsd: totalCost, tokens: totalIn + totalOut });

    return { run: finishedRun, workspace: baseDir, arquivos: written, costUsd: totalCost, tokens: { in: totalIn, out: totalOut } };
  } catch (err) {
    await prisma.agentBuildRun.update({
      where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(err.message).slice(0, 2000) },
    });
    await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: 'error' } });
    await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.APPROVED } });
    await logEvent(session.id, { role: 'system', content: `Build falhou: ${err.message}` });
    throw err;
  }
}

/**
 * Provisiona a stack dev chamando a API interna do painel (/api/docker/services),
 * reusando toda a infra existente (Docker + porta + Nginx). Retorna o link.
 *
 * Segue o padrão do zeus-agent-tools: chama a rota REST local com o JWT do usuário,
 * respeitando permissões por role. NÃO reimplementa a criação de serviço.
 *
 * @param {{id:string, role:string}} user
 * @param {string} sessionId
 * @param {object} opts - { token (JWT do usuário), templateId?, hostPort?, clienteId?, baseDomain? }
 */
async function provisionDevStack(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  if (!opts.token) { const e = new Error('token do usuário é obrigatório para provisionar'); e.status = 400; throw e; }

  const port = process.env.PORT || 3000;
  const base = `http://localhost:${port}`;
  const serviceName = `dev-${String(session.project.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${session.projectId.slice(0, 6)}`;
  const body = {
    templateId: opts.templateId || 'node-app',
    name: serviceName,
    envVars: opts.envVars || [],
    createProject: false,
    bindLocalOnly: true,
  };

  const resp = await fetch(`${base}/api/docker/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!resp.ok) { const e = new Error(data.message || `Falha ao provisionar (${resp.status})`); e.status = resp.status; throw e; }

  // Monta o link no domínio (se baseDomain informado) ou usa host:porta.
  const resolvedPort = data.port || data.resolvedPort || null;
  const link = opts.baseDomain
    ? `https://${serviceName}.${opts.baseDomain}`
    : (resolvedPort ? `http://localhost:${resolvedPort}` : null);

  // Registra o link no build run mais recente do projeto.
  const lastRun = await prisma.agentBuildRun.findFirst({
    where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' },
  });
  if (lastRun) {
    await prisma.agentBuildRun.update({ where: { id: lastRun.id }, data: { devStackUrl: link } });
  }
  await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: 'provisioned' } });
  await logEvent(session.id, { role: 'stage', content: `Stack dev provisionada: ${link || serviceName}`, data: { service: data, link } });

  return { service: data, link, serviceName };
}

// ─────────────────────────────────────────────────────────────────────────────
// Publicação com domínio (subdomínio | proxy por path), DNS Cloudflare, Nginx,
// e exibição de credenciais quando o app gerado tem auth.
// ─────────────────────────────────────────────────────────────────────────────

let _nginx = null, _cloudflare = null;
function nginxMgr() { if (!_nginx) _nginx = new (require('./NginxManager'))(); return _nginx; }
function cloudflareMgr() { if (!_cloudflare) _cloudflare = new (require('./CloudflareManager'))(); return _cloudflare; }

let _docker = null;
function dockerMgr() { if (!_docker) _docker = new (require('./DockerManager'))(); return _docker; }

/** Testa se uma porta está livre no host (bind real em 127.0.0.1). */
function isHostPortFree(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    try { server.listen(port, '127.0.0.1'); } catch { resolve(false); }
  });
}

/**
 * Resolve a porta do HOST para o proxy, VALIDANDO conflito antes de configurar.
 * `declaredPort` é a porta que o app usa/quer. Se estiver ocupada (por Docker ou
 * outro processo), aloca a próxima livre via DockerManager.findAvailablePort.
 * @returns {Promise<{port, declaredPort, changed, inUse, source}>}
 */
async function resolveHostPort(declaredPort, source) {
  const declared = Number(declaredPort) || null;
  if (declared) {
    let dockerUsed = [];
    try { dockerUsed = await dockerMgr().getUsedPorts(); } catch {}
    const free = (await isHostPortFree(declared)) && !dockerUsed.includes(declared);
    if (free) return { port: declared, declaredPort: declared, changed: false, inUse: false, source };
    // conflito → aloca a próxima livre a partir de 8000 (faixa usada pelo painel)
    let alt = null;
    try { alt = await dockerMgr().findAvailablePort(8000); } catch {}
    if (!alt) { // fallback: varre a partir da declarada
      let p = declared + 1;
      while (p < 65535 && !(await isHostPortFree(p))) p++;
      alt = p < 65535 ? p : null;
    }
    return { port: alt, declaredPort: declared, changed: true, inUse: true, source };
  }
  // sem porta declarada: aloca uma livre
  let alt = null;
  try { alt = await dockerMgr().findAvailablePort(8000); } catch {}
  return { port: alt, declaredPort: null, changed: !!alt, inUse: false, source };
}

const SERVER_PUBLIC_IP = process.env.SERVER_PUBLIC_IP || null;

/** IP público do servidor (para instruir A record). Best-effort. */
async function serverPublicIp() {
  if (SERVER_PUBLIC_IP) return SERVER_PUBLIC_IP;
  try {
    const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(4000) });
    if (r.ok) return (await r.text()).trim();
  } catch {}
  return null;
}

/**
 * Opções de publicação para a UI: zonas Cloudflare gerenciadas (domínios que o
 * painel controla o DNS), IP do servidor (para domínios externos) e a porta do
 * último build/stack provisionado (alvo do proxy).
 */
async function publishOptions(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  let zones = [];
  try { zones = (await cloudflareMgr().listZones()).map((z) => ({ name: z.name, zoneId: z.zoneId, status: z.status })); } catch {}
  const ip = await serverPublicIp();
  // Detecta a porta-alvo automaticamente: stack provisionada OU código gerado.
  const lastRun = await prisma.agentBuildRun.findFirst({ where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' } });
  const portInfo = detectAppPort(session.project, lastRun?.devStackUrl);
  // Valida disponibilidade no HOST (evita conflito com Docker/outros serviços).
  const hostPort = await resolveHostPort(portInfo.port, portInfo.source);
  const auth = detectAuth(session.project);
  return {
    managedZones: zones,            // domínios que o painel gerencia DNS (config automática)
    serverIp: ip,                   // p/ instruções de DNS de domínio externo
    suggestedSubdomain: slugName(session.project.name),
    targetPort: hostPort.port,      // porta do HOST já VALIDADA (livre) para o proxy
    declaredPort: portInfo.port,    // porta que o app declara internamente
    portSource: portInfo.source,    // de onde veio a porta declarada
    portChanged: hostPort.changed,  // true se a declarada estava ocupada e realocamos
    portConflict: hostPort.inUse,   // true se a porta declarada está em uso
    hasAuth: auth.hasAuth,
    modes: ['subdomain', 'proxy'],
  };
}

function slugName(name) {
  return String(name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'app';
}

/**
 * Descobre a porta do app AUTOMATICAMENTE. Ordem:
 *  1) porta da stack já provisionada (link localhost:porta no build run)
 *  2) porta declarada no CÓDIGO GERADO (.env PORT=, app.listen(N)/listen({port}),
 *     Dockerfile EXPOSE, docker-compose ports)
 *  3) fallback por framework (NestJS/Express=3000, Next=3000, etc.)
 * Retorna { port, source }.
 */
function detectAppPort(project, lastRunUrl) {
  // 1) da stack provisionada
  const m = String(lastRunUrl || '').match(/localhost:(\d+)/);
  if (m) return { port: Number(m[1]), source: 'stack provisionada' };

  const baseDir = workspaceDir(project);
  if (!fs.existsSync(baseDir)) return { port: 3000, source: 'padrão' };

  // coleta arquivos relevantes (sem node_modules)
  const files = [];
  (function walk(dir, depth) {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (['node_modules', '.git', '.wireframes', 'dist', 'build'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else files.push(full);
    }
  })(baseDir, 0);

  const read = (f) => { try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; } };
  const validPort = (n) => { const p = Number(n); return p >= 1 && p <= 65535 ? p : null; };

  // 2a) .env / .env.example → PORT=
  for (const f of files.filter((f) => /\.env(\.\w+)?$/i.test(path.basename(f)))) {
    const mm = read(f).match(/^\s*(?:APP_|SERVER_)?PORT\s*=\s*["']?(\d{2,5})/mi);
    if (mm && validPort(mm[1])) return { port: Number(mm[1]), source: `.env (${path.relative(baseDir, f)})` };
  }
  // 2b) docker-compose ports "8080:3000" → porta interna (destino)
  for (const f of files.filter((f) => /docker-compose/i.test(path.basename(f)))) {
    const mm = read(f).match(/(\d{2,5})\s*:\s*(\d{2,5})/);
    if (mm && validPort(mm[2])) return { port: Number(mm[2]), source: 'docker-compose' };
  }
  // 2c) Dockerfile EXPOSE
  for (const f of files.filter((f) => /^Dockerfile/i.test(path.basename(f)))) {
    const mm = read(f).match(/EXPOSE\s+(\d{2,5})/i);
    if (mm && validPort(mm[1])) return { port: Number(mm[1]), source: 'Dockerfile EXPOSE' };
  }
  // 2d) código: app.listen(3000) / listen({ port: 3000 }) / listen(process.env.PORT || 3000)
  const codeFiles = files.filter((f) => /\.(ts|js|mjs)$/i.test(f) && /(main|server|index|app|bootstrap)/i.test(path.basename(f)));
  for (const f of [...codeFiles, ...files.filter((f) => /\.(ts|js|mjs)$/i.test(f))]) {
    const txt = read(f);
    let mm = txt.match(/listen\s*\(\s*(\d{2,5})/) // listen(3000)
      || txt.match(/listen\s*\([^)]*?\|\|\s*(\d{2,5})/) // listen(process.env.PORT || 3000)
      || txt.match(/port\s*[:=]\s*(?:process\.env\.\w+\s*\|\|\s*)?(\d{2,5})/i); // port: 3000
    if (mm && validPort(mm[1])) return { port: Number(mm[1]), source: `código (${path.relative(baseDir, f)})` };
  }
  // 3) fallback por framework
  let stackHint = 3000;
  const pkg = files.find((f) => path.basename(f) === 'package.json');
  if (pkg) {
    const t = read(pkg);
    if (/"next"/.test(t)) stackHint = 3000;
    else if (/"@nestjs\/core"/.test(t) || /"express"/.test(t)) stackHint = 3000;
    else if (/"fastify"/.test(t)) stackHint = 3000;
  }
  return { port: stackHint, source: 'padrão do framework' };
}

/**
 * Detecta se o app gerado tem autenticação e tenta extrair credenciais seed.
 * Heurística: procura arquivos de auth no workspace e credenciais em .env/seed.
 * NUNCA inventa senha; se não achar credenciais explícitas, informa a origem.
 */
function detectAuth(project) {
  const baseDir = workspaceDir(project);
  const out = { hasAuth: false, evidencias: [], credenciais: null, nota: null };
  if (!fs.existsSync(baseDir)) return out;
  const files = [];
  (function walk(dir, depth) {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.wireframes') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else files.push(full);
    }
  })(baseDir, 0);

  const authRe = /(auth|login|jwt|passport|guard|bcrypt|session)/i;
  const authFiles = files.filter((f) => authRe.test(path.basename(f)));
  if (authFiles.length) { out.hasAuth = true; out.evidencias = authFiles.slice(0, 8).map((f) => path.relative(baseDir, f)); }

  // Procura credenciais seed em .env* e arquivos de seed.
  const credFiles = files.filter((f) => /\.env(\.\w+)?$|seed|fixture|initial/i.test(path.basename(f)));
  const creds = {};
  for (const f of credFiles) {
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf-8'); } catch { continue; }
    // pares chave=valor de admin/user/senha
    const userM = txt.match(/(?:ADMIN_USER|ADMIN_EMAIL|DEFAULT_USER|SEED_USER|LOGIN)\s*[=:]\s*["']?([^\s"'#]+)/i);
    const passM = txt.match(/(?:ADMIN_PASS(?:WORD)?|DEFAULT_PASS(?:WORD)?|SEED_PASS(?:WORD)?)\s*[=:]\s*["']?([^\s"'#]+)/i);
    if (userM && !creds.login) creds.login = userM[1];
    if (passM && !creds.senha) creds.senha = passM[1];
    if (userM || passM) creds.origem = path.relative(baseDir, f);
  }
  if (creds.login || creds.senha) {
    out.hasAuth = true;
    out.credenciais = creds;
  } else if (out.hasAuth) {
    out.nota = 'O app tem autenticação, mas não há credenciais seed fixas no código. As credenciais são criadas em runtime (registro/seed do banco). Verifique a documentação/seed do projeto.';
  }
  return out;
}

/**
 * Encontra um diretório de cert Let's Encrypt VÁLIDO para o fqdn.
 *
 * Estratégia robusta (o usuário do node NÃO tem sudo nem lê /etc/letsencrypt):
 * lê os vhosts JÁ EXISTENTES do Nginx e extrai o `ssl_certificate` em uso. Se
 * algum vhost da MESMA zona (wildcard *.zona) já usa um cert, reusa esse mesmo
 * caminho — é garantidamente válido (o Nginx já carrega). Só então tenta o cert
 * exato do FQDN. Retorna o diretório do cert ou null.
 */
function findCertDir(fqdn, zone) {
  const zoneName = zone?.name || fqdn.split('.').slice(-2).join('.');
  const dirs = ['/etc/nginx/sites-available', '/etc/nginx/sites-enabled', '/etc/nginx/conf.d'];
  const certPaths = new Set();
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(d); } catch { continue; }
    for (const f of files) {
      let txt = '';
      try { txt = fs.readFileSync(path.join(d, f), 'utf8'); } catch { continue; }
      const m = txt.match(/ssl_certificate\s+(\S+?)\/fullchain\.pem\s*;/);
      if (m) certPaths.add(m[1]); // ex.: /etc/letsencrypt/live/zeusengine.com.br
    }
  }
  // 1) cert exato do FQDN, se algum vhost usa
  for (const c of certPaths) if (c.endsWith(`/${fqdn}`)) return c;
  // 2) cert wildcard da zona (o que openui/comfyui usam): /etc/letsencrypt/live/<zona>
  for (const c of certPaths) if (c.endsWith(`/${zoneName}`)) return c;
  // 3) fallback: se só há UM cert em uso no servidor e o fqdn é subdomínio da
  //    zona desse cert, assume wildcard (cobre *.zona).
  if (certPaths.size >= 1 && fqdn.endsWith(`.${zoneName}`)) {
    for (const c of certPaths) if (c.includes(`/${zoneName}`)) return c;
  }
  return null;
}

/**
 * Gera o conteúdo de um vhost Nginx (subdomínio) com proxy para a porta local.
 * Se `certDir` for válido → vhost HTTPS com redirect. Se NÃO houver cert → gera
 * vhost SÓ HTTP (porta 80), que NUNCA quebra o `nginx -t`.
 */
function buildVhost(fqdn, port, certDir) {
  const up = `zeus_${slugName(fqdn).replace(/-/g, '_')}_${port}`;
  const secHeaders = `    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;`;
  const proxyBlock = `    client_max_body_size 64m;

    location / {
        proxy_pass http://${up};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }`;

  const header = `# Gerado pelo Zeus Builder para ${fqdn} -> localhost:${port}
upstream ${up} {
    server 127.0.0.1:${port};
}`;

  // Sem cert válido → vhost SÓ HTTP (funciona, não quebra o Nginx).
  if (!certDir) {
    return `${header}
server {
    listen 80;
    server_name ${fqdn};
    server_tokens off;
${secHeaders}
${proxyBlock}
}
`;
  }

  // Com cert válido → HTTPS com redirect de HTTP.
  return `${header}
server {
    listen 80;
    server_name ${fqdn};
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${fqdn};

    ssl_certificate ${certDir}/fullchain.pem;
    ssl_certificate_key ${certDir}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    server_tokens off;

${secHeaders}
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
${proxyBlock}
}
`;
}

/**
 * Publica o app com domínio.
 * @param {object} opts - {
 *   clienteId?, mode: 'subdomain'|'proxy', domain: 'app.zeusengine.com.br',
 *   port?: number (alvo), pathPrefix?: '/app' (modo proxy), dryRun?: boolean
 * }
 * Comportamento:
 *  - Se a zona do domínio é GERENCIADA no Cloudflare → cria DNS + configura Nginx
 *    e retorna { domain, url, applied:true }.
 *  - Se NÃO é gerenciada → retorna instruções de DNS (dnsInstructions) e NÃO toca
 *    no DNS; o Nginx é configurado mesmo assim (aplica quando o DNS propagar).
 */
async function publishWithDomain(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const mode = opts.mode === 'proxy' ? 'proxy' : 'subdomain';
  const domain = String(opts.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    const e = new Error('Domínio inválido'); e.status = 400; throw e;
  }
  // Descobre a porta declarada e VALIDA disponibilidade no host antes de configurar.
  const lastRun = await prisma.agentBuildRun.findFirst({ where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' } });
  const detected = detectAppPort(session.project, lastRun?.devStackUrl);
  const declaredPort = Number(opts.port) || detected.port;
  const hostPort = await resolveHostPort(declaredPort, opts.port ? 'informada' : detected.source);
  const port = hostPort.port;
  if (!port) { const e = new Error('Não foi possível alocar uma porta livre no host.'); e.status = 400; throw e; }

  // Zona gerenciada? (o painel controla o DNS deste domínio)
  let zones = [];
  try { zones = await cloudflareMgr().listZones(); } catch {}
  const zone = zones.find((z) => domain === z.name || domain.endsWith('.' + z.name));
  const managed = !!zone;
  const ip = await serverPublicIp();
  const auth = detectAuth(session.project);

  const result = { mode, domain, port, managed, auth, dryRun: !!opts.dryRun };
  // Transparência sobre a porta: se a declarada estava ocupada, informamos a troca.
  result.portInfo = {
    declared: hostPort.declaredPort, host: port, changed: hostPort.changed, source: hostPort.source,
  };
  if (hostPort.changed) {
    result.portNote = `A porta ${hostPort.declaredPort} estava em uso (conflito). O proxy foi configurado para a porta livre ${port}. Garanta que o app rode nessa porta ou mapeie o container para ${port}.`;
  }

  if (mode === 'proxy') {
    // Proxy por path em um domínio existente: registra rota (proxy-routes.json)
    // no padrão já usado pelo painel; a aplicação no vhost é responsabilidade do
    // gestor de proxy existente. Aqui devolvemos a rota montada.
    const pathPrefix = ('/' + String(opts.pathPrefix || slugName(session.project.name)).replace(/^\/+/, '')).replace(/\/+$/, '');
    result.url = `https://${domain}${pathPrefix}`;
    result.pathPrefix = pathPrefix;
    result.note = 'Modo proxy: adicione esta rota ao domínio existente pelo gestor de Nginx/Proxy do painel (targetPort abaixo).';
    result.proxyRoute = { url: result.url, pathPrefix, targetIP: '127.0.0.1', targetPort: port };
    if (!managed) result.dnsInstructions = dnsInstructionsFor(domain, ip, zone);
    await logEvent(session.id, { role: 'stage', content: `Publicação (proxy) preparada: ${result.url} -> 127.0.0.1:${port}`, data: result });
    return result;
  }

  // ── modo subdomain: gera vhost Nginx dedicado ──
  const fqdn = domain;
  // Cert válido? Procura fullchain.pem DE VERDADE: primeiro o do FQDN, depois o
  // wildcard da zona. Só considera se o arquivo existe (evita apontar p/ cert
  // inexistente, que quebra o `nginx -t` e derruba TODO o Nginx).
  const certDir = findCertDir(fqdn, zone);
  const filename = fqdn; // nome do arquivo de vhost = fqdn
  const vhost = buildVhost(fqdn, port, certDir);
  const scheme = certDir ? 'https' : 'http';
  result.url = `${scheme}://${fqdn}`;
  result.vhostFilename = filename;
  result.hasCert = !!certDir;
  if (!certDir) result.sslNote = `Publicado em HTTP. Emita o SSL (certbot) para ${fqdn} pelo painel para habilitar HTTPS.`;

  if (opts.dryRun) {
    result.vhostPreview = vhost;
    result.wouldCreateDns = managed;
    if (!managed) result.dnsInstructions = dnsInstructionsFor(fqdn, ip, zone);
    return result;
  }

  // 1) DNS: se gerenciado, cria/garante o registro apontando p/ o servidor.
  if (managed && zone) {
    try {
      await cloudflareMgr().createDnsRecord(zone.zoneId, {
        type: 'A', name: fqdn, content: ip, ttl: 1, proxied: true,
      });
      result.dnsApplied = true;
    } catch (e) {
      // registro pode já existir; não falha a publicação por isso
      result.dnsApplied = false; result.dnsWarning = e.message;
    }
  } else {
    result.dnsInstructions = dnsInstructionsFor(fqdn, ip, zone);
  }

  // 2) Nginx: cria vhost, valida e recarrega. Rede de segurança: se `nginx -t`
  //    falhar, REMOVE o vhost e recarrega para NUNCA deixar o Nginx quebrado (502).
  const mgr = nginxMgr();
  try {
    try { mgr.deleteConfig(filename); } catch {} // idempotente: remove versão antiga
    mgr.createConfig(filename, vhost);
    try { mgr.enableConfig(filename); } catch {}
    const test = mgr.testConfig();
    if (test && test.valid === false) {
      // rollback: remove o arquivo E recarrega para descartar a config inválida
      try { mgr.deleteConfig(filename); } catch {}
      try { mgr.reload(); } catch {}
      const e = new Error(`nginx -t falhou (vhost revertido): ${test.error || 'config inválida'}`); e.status = 400; throw e;
    }
    mgr.reload();
    result.nginxApplied = true;
  } catch (e) {
    // garante que não fica lixo quebrando o Nginx
    try { mgr.deleteConfig(filename); mgr.reload(); } catch {}
    result.nginxApplied = false; result.nginxError = e.message;
    if (e.status) throw e;
  }

  // 4) Persiste o link e o estado.
  if (lastRun) await prisma.agentBuildRun.update({ where: { id: lastRun.id }, data: { devStackUrl: result.url } });
  await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: 'provisioned' } });
  await prisma.agentSession.update({ where: { id: session.id }, data: { stage: 'provisioned' } });
  await logEvent(session.id, { role: 'stage', content: `Publicado em ${result.url} (nginx=${result.nginxApplied}, dns=${result.dnsApplied ?? 'manual'}).`, data: result });
  return result;
}

/** Monta instruções de DNS para um domínio NÃO gerenciado pelo painel. */
function dnsInstructionsFor(fqdn, ip, zone) {
  const isApex = zone ? fqdn === zone.name : fqdn.split('.').length <= 2;
  if (!ip) {
    return { note: 'Não foi possível detectar o IP público do servidor. Configure um registro A apontando o domínio para o IP deste servidor.' };
  }
  return {
    note: `Crie este registro DNS no provedor do domínio "${fqdn}". Após propagar (minutos a horas), o site responde.`,
    record: { type: 'A', name: isApex ? '@' : fqdn.split('.')[0], value: ip, proxied: 'opcional (Cloudflare)', ttl: 'auto' },
    exemplo: `${isApex ? '@' : fqdn.split('.')[0]}  A  ${ip}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Painel do projeto (pós-build): ver o código gerado, editar arquivos/config,
// rodar novamente. Tudo escopado ao workspace do projeto, anti path-traversal.
// ─────────────────────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set(['node_modules', '.git', '.wireframes', 'dist', 'build', '.next', 'coverage']);
const MAX_FILE_BYTES = 512 * 1024; // 512KB por arquivo no editor

/** Garante que um path relativo fica dentro do workspace (defesa anti traversal). */
function safeJoin(baseDir, relPath) {
  if (typeof relPath !== 'string' || relPath.includes('\0')) throw Object.assign(new Error('path inválido'), { status: 400 });
  const clean = relPath.replace(/^\/+/, '');
  const full = path.resolve(baseDir, clean);
  if (full !== path.resolve(baseDir) && !full.startsWith(path.resolve(baseDir) + path.sep)) {
    throw Object.assign(new Error('path fora do workspace'), { status: 400 });
  }
  return full;
}

/** Lista a árvore de arquivos do workspace (hierárquica, estilo file explorer). */
async function listWorkspaceFiles(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const baseDir = workspaceDir(session.project);
  function build(dir, depth) {
    if (depth > 8) return [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    const nodes = [];
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env' && e.name !== '.env.example') {
        if (IGNORED_DIRS.has(e.name)) continue;
      }
      if (IGNORED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(baseDir, full);
      if (e.isDirectory()) {
        nodes.push({ name: e.name, path: rel, type: 'dir', children: build(full, depth + 1) });
      } else {
        let size = 0; try { size = fs.statSync(full).size; } catch {}
        nodes.push({ name: e.name, path: rel, type: 'file', size });
      }
    }
    // pastas primeiro, depois arquivos, alfabético
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return nodes;
  }
  const exists = fs.existsSync(baseDir);
  return { root: session.project.name, exists, tree: exists ? build(baseDir, 0) : [] };
}

/** Lê o conteúdo de UM arquivo do workspace (texto). */
async function readWorkspaceFileByPath(user, sessionId, relPath, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const baseDir = workspaceDir(session.project);
  const full = safeJoin(baseDir, relPath);
  let stat; try { stat = fs.statSync(full); } catch { throw Object.assign(new Error('Arquivo não encontrado'), { status: 404 }); }
  if (!stat.isFile()) throw Object.assign(new Error('Não é um arquivo'), { status: 400 });
  if (stat.size > MAX_FILE_BYTES) return { path: relPath, tooLarge: true, size: stat.size, content: '' };
  // heurística binário: se tem null byte nos primeiros KB, não abre no editor
  const buf = fs.readFileSync(full);
  const sample = buf.subarray(0, 4096);
  if (sample.includes(0)) return { path: relPath, binary: true, size: stat.size, content: '' };
  return { path: relPath, size: stat.size, content: buf.toString('utf-8') };
}

/** Salva a edição de UM arquivo (reusa a validação de writeWorkspaceFile). */
async function saveWorkspaceFileByPath(user, sessionId, relPath, content, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const baseDir = workspaceDir(session.project);
  const rel = writeWorkspaceFile(baseDir, relPath, typeof content === 'string' ? content : String(content ?? ''));
  await logEvent(session.id, { role: 'system', content: `Arquivo editado no painel: ${rel}` });
  return { saved: true, path: rel };
}

/** Config editável do projeto: env vars (.env), porta e domínio publicado. */
async function getProjectConfig(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const baseDir = workspaceDir(session.project);
  // lê .env (raiz) se existir
  let envText = '';
  for (const cand of ['.env', '.env.example']) {
    const f = path.join(baseDir, cand);
    if (fs.existsSync(f)) { try { envText = fs.readFileSync(f, 'utf-8'); break; } catch {} }
  }
  const lastRun = await prisma.agentBuildRun.findFirst({ where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' } });
  const detected = detectAppPort(session.project, lastRun?.devStackUrl);
  const meta = session.project.metadata || {};
  return {
    env: envText,
    port: meta.publishedPort || detected.port,
    portSource: detected.source,
    domain: meta.publishedDomain || null,
    url: lastRun?.devStackUrl || null,
    stage: session.stage,
  };
}

/** Salva config: grava .env e persiste porta/domínio na metadata do projeto. */
async function saveProjectConfig(user, sessionId, cfg = {}, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const baseDir = workspaceDir(session.project);
  if (typeof cfg.env === 'string') {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, '.env'), cfg.env, 'utf-8');
  }
  const meta = { ...(session.project.metadata || {}) };
  if (cfg.port !== undefined) meta.publishedPort = Number(cfg.port) || meta.publishedPort;
  if (cfg.domain !== undefined) meta.publishedDomain = cfg.domain || null;
  await prisma.agentProject.update({ where: { id: session.projectId }, data: { metadata: meta } });
  await logEvent(session.id, { role: 'system', content: 'Configuração do projeto atualizada (env/porta/domínio).' });
  return { saved: true, port: meta.publishedPort, domain: meta.publishedDomain };
}

/**
 * "Rodar novamente": reexecuta o build a partir do plano aprovado. Reaproveita
 * executeBuild (com lock/stream). Coloca a sessão de volta em `approved` para o
 * executeBuild aceitar. Suporta streaming via opts.onEvent.
 */
async function rerun(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  if (!session.activePlanId) { const e = new Error('Sem plano para rodar novamente.'); e.status = 400; throw e; }
  // garante estado aprovado para o executeBuild (idempotente).
  if (session.stage !== STAGES.APPROVED) {
    await prisma.agentSession.update({ where: { id: session.id }, data: { stage: STAGES.APPROVED } });
  }
  await prisma.agentPlan.updateMany({ where: { id: session.activePlanId, status: { not: 'approved' } }, data: { status: 'approved' } });
  return executeBuild(user, sessionId, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ajuste incremental (chat de edição) + Play rápido (sem LLM)
// ─────────────────────────────────────────────────────────────────────────────

// Extensões de código/config que fazem sentido enviar ao modelo como contexto de edição.
const EDITABLE_EXT = /\.(html?|css|scss|js|jsx|mjs|ts|tsx|json|ya?ml|env|ini|conf|md|sql|py|go|rs|php|vue|svelte|txt)$/i;
const EDIT_CONTEXT_MAX_FILES = 40;
const EDIT_CONTEXT_MAX_BYTES = 8 * 1024; // por arquivo enviado ao modelo

/** Coleta arquivos de texto do workspace (path + conteúdo) para dar contexto à edição. */
function collectWorkspaceFiles(baseDir, { maxFiles = EDIT_CONTEXT_MAX_FILES, maxBytes = EDIT_CONTEXT_MAX_BYTES } = {}) {
  const files = [];
  const tree = [];
  (function walk(dir, depth) {
    if (depth > 8 || files.length >= maxFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(baseDir, full);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      tree.push(rel);
      if (files.length >= maxFiles) continue;
      if (!EDITABLE_EXT.test(e.name)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const buf = fs.readFileSync(full);
        if (buf.subarray(0, 2048).includes(0)) continue; // binário
        files.push({ path: rel, conteudo: buf.toString('utf-8').slice(0, maxBytes) });
      } catch {}
    }
  })(baseDir, 0);
  return { files, tree };
}

/**
 * Ajuste CIRÚRGICO de um projeto já construído (chat de edição). NÃO regera o app:
 * manda a instrução + arquivos atuais ao gateway /api/build/edit, que devolve
 * SOMENTE os arquivos alterados. Aplica os diffs no workspace. Rápido e barato.
 *
 * Emite eventos (opts.onEvent) para feedback ao vivo: edit_start, files_read,
 * applied (por arquivo), edit_done.
 *
 * @param {object} opts - { clienteId?, onEvent? }
 */
async function editCode(user, sessionId, instrucao, opts = {}) {
  const emit = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  if (!instrucao || !String(instrucao).trim()) {
    const e = new Error('Descreva o ajuste desejado.'); e.status = 400; throw e;
  }
  const baseDir = workspaceDir(session.project);
  if (!fs.existsSync(baseDir)) {
    const e = new Error('Este projeto ainda não tem código gerado.'); e.status = 400; throw e;
  }
  // Guard de orçamento: edição consome tokens (bem menos que um build, mas conta).
  await assertWithinBudget(user, session.clienteId);

  await logEvent(session.id, { role: 'user', content: `[ajuste] ${instrucao}` });
  emit({ type: 'edit_start' });

  const { files, tree } = collectWorkspaceFiles(baseDir);
  emit({ type: 'files_read', total: files.length });

  const plan = session.activePlanId ? await prisma.agentPlan.findUnique({ where: { id: session.activePlanId } }) : null;
  const arquitetura = plan?.content?.architecture || null;

  const resp = await gatewayPost('/api/build/edit', {
    instrucao, arquivos: files, arvore: tree, arquitetura,
  }, 180000);
  const edit = resp.edit || {};
  const usage = resp.usage || { inputTokens: 0, outputTokens: 0 };
  const costUsd = resp.costUsd || 0;

  const changed = [];
  for (const f of (edit.arquivos || [])) {
    if (!f || typeof f.path !== 'string') continue;
    if (f.acao === 'remover') {
      try {
        const full = safeJoin(baseDir, f.path);
        if (fs.existsSync(full)) { fs.rmSync(full, { force: true }); changed.push({ path: f.path, acao: 'remover' }); emit({ type: 'applied', path: f.path, acao: 'remover' }); }
      } catch {}
      continue;
    }
    try {
      const rel = writeWorkspaceFile(baseDir, f.path, f.conteudo);
      changed.push({ path: rel, acao: f.acao || 'editar' });
      emit({ type: 'applied', path: rel, acao: f.acao || 'editar' });
    } catch (e) {
      emit({ type: 'apply_error', path: f.path, error: e.message });
    }
  }

  // Registra custo do ajuste num build run leve (kind implícito) para o relatório mensal.
  try {
    await prisma.agentBuildRun.create({
      data: {
        projectId: session.projectId, planId: session.activePlanId || null,
        clienteId: session.clienteId, userId: user.id, status: 'succeeded',
        startedAt: new Date(), finishedAt: new Date(),
        tokensIn: usage.inputTokens || 0, tokensOut: usage.outputTokens || 0, costUsd,
      },
    });
  } catch {}

  await logEvent(session.id, {
    role: 'assistant', agent: 'desenvolvedor',
    content: `Ajuste aplicado: ${changed.length} arquivo(s). ${edit.resumo || ''}`.trim(),
    data: { arquivos: changed, resumo: edit.resumo, observacoes: edit.observacoes, costUsd },
    tokensIn: usage.inputTokens || 0, tokensOut: usage.outputTokens || 0,
  });
  emit({ type: 'edit_done', arquivos: changed, resumo: edit.resumo || '', observacoes: edit.observacoes || '', costUsd });

  return { arquivos: changed, resumo: edit.resumo || '', observacoes: edit.observacoes || '', costUsd };
}

/** Detecta se o projeto é um site estático (só HTML/CSS/JS, sem package.json com start). */
function detectRunKind(baseDir) {
  const pkgPath = path.join(baseDir, 'package.json');
  const hasIndexHtml = fs.existsSync(path.join(baseDir, 'index.html'))
    || fs.existsSync(path.join(baseDir, 'public', 'index.html'));
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      // Tem script de start/dev → app Node (precisa processo rodando).
      if (scripts.start || scripts.dev || scripts.serve) return 'node';
    } catch {}
  }
  if (hasIndexHtml) return 'static';
  return 'node';
}

/**
 * PLAY — provisiona (1ª vez) ou REINICIA (próximas) o serviço do projeto, SEM LLM.
 * Este é o caminho rápido: o código já existe no workspace; aqui só colocamos/
 * recolocamos o app no ar. Nunca chama o gateway/modelo.
 *
 * Estratégia:
 *  - Se já existe um serviço registrado na metadata do projeto e ele ainda existe
 *    no Docker → REINICIA (restart) e devolve o link. Instantâneo.
 *  - Senão → cria o serviço UMA vez montando o workspace como volume, persiste o
 *    serviceId na metadata, e devolve o link.
 *
 * @param {object} opts - { token (JWT), baseDomain?, clienteId? }
 */
async function runProject(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  if (!opts.token) { const e = new Error('token do usuário é obrigatório para rodar'); e.status = 400; throw e; }
  const baseDir = workspaceDir(session.project);
  if (!fs.existsSync(baseDir)) { const e = new Error('Este projeto ainda não tem código gerado.'); e.status = 400; throw e; }

  const port = process.env.PORT || 3000;
  const base = `http://localhost:${port}`;
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` };
  const meta = { ...(session.project.metadata || {}) };

  // 1) Já existe serviço? Tenta REINICIAR (rápido, sem recriar).
  if (meta.serviceId) {
    try {
      const r = await fetch(`${base}/api/docker/services/${meta.serviceId}/restart`, {
        method: 'POST', headers: authHeaders, signal: AbortSignal.timeout(60000),
      });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        const link = meta.publishedDomain ? (meta.publishedUrl || `https://${meta.publishedDomain}`) : (meta.runUrl || null);
        await logEvent(session.id, { role: 'stage', content: `▶️ Serviço reiniciado (Play).`, data: { serviceId: meta.serviceId, link } });
        return { action: 'restarted', serviceId: meta.serviceId, link, service: data };
      }
      // 404/410 → serviço sumiu; cai para recriar abaixo.
    } catch { /* recria abaixo */ }
  }

  // 2) Primeira execução: cria o serviço montando o workspace como volume.
  const kind = detectRunKind(baseDir);
  const detected = detectAppPort(session.project, null);
  const serviceName = `dev-${slugName(session.project.name)}-${session.projectId.slice(0, 6)}`;

  // Template + volume: estático → nginx servindo o workspace; node → node-app com o código.
  const body = kind === 'static'
    ? {
        templateId: 'custom-image', imageName: 'nginx:alpine', containerPort: 80,
        name: serviceName, createProject: false, bindLocalOnly: true,
        volumeMappings: [{ hostPath: baseDir, containerPath: '/usr/share/nginx/html' }],
      }
    : {
        templateId: 'node-app', name: serviceName, createProject: false, bindLocalOnly: true,
        envVars: opts.envVars || [],
        volumeMappings: [{ hostPath: baseDir, containerPath: '/app' }],
      };

  const resp = await fetch(`${base}/api/docker/services`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!resp.ok) { const e = new Error(data.message || `Falha ao rodar (${resp.status})`); e.status = resp.status; throw e; }

  const resolvedPort = data.port || data.resolvedPort || (data.service && data.service.port) || detected.port;
  const serviceId = data.id || (data.service && data.service.id) || null;
  const link = opts.baseDomain ? `https://${serviceName}.${opts.baseDomain}` : (resolvedPort ? `http://localhost:${resolvedPort}` : null);

  meta.serviceId = serviceId;
  meta.runUrl = link;
  meta.runKind = kind;
  await prisma.agentProject.update({ where: { id: session.projectId }, data: { metadata: meta, status: 'provisioned' } });
  // Registra o link no build run mais recente (compat com a UI existente).
  const lastRun = await prisma.agentBuildRun.findFirst({ where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' } });
  if (lastRun) { try { await prisma.agentBuildRun.update({ where: { id: lastRun.id }, data: { devStackUrl: link } }); } catch {} }
  await logEvent(session.id, { role: 'stage', content: `▶️ Play: serviço "${serviceName}" no ar (${kind}). ${link || ''}`.trim(), data: { serviceId, link, kind } });

  return { action: 'created', serviceId, link, serviceName, kind, service: data };
}


// ─────────────────────────────────────────────────────────────────────────────

/** Diretório onde os SVGs de wireframe são guardados. */
function wireframesDir(project) {
  const dir = path.join(workspaceDir(project), '.wireframes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Gera (ou altera) um wireframe SVG para a sessão. Persiste em agent_wireframes
 * (versionado) e grava o .svg no workspace. `feedback` + versão anterior = alteração.
 * @param {object} opts - { clienteId?, descricao, feedback?, exemplo?({mimeType,data}) }
 */
async function generateWireframe(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);

  // Se houver versão anterior e feedback, passa o SVG atual para alteração.
  const last = await prisma.agentWireframe.findFirst({
    where: { projectId: session.projectId }, orderBy: { version: 'desc' },
  });
  let svgAtual = null;
  if (last && opts.feedback && last.imagePath) {
    try { svgAtual = fs.readFileSync(last.imagePath, 'utf-8'); } catch {}
  }

  const descricao = opts.descricao
    || `Wireframe para o projeto "${session.project.name}"`;
  const { svg } = await gatewayPost('/api/build/wireframe', {
    descricao, feedback: opts.feedback || '', exemplo: opts.exemplo || null, svgAtual,
  });

  const version = (last?.version || 0) + 1;
  const dir = wireframesDir(session.project);
  const filePath = path.join(dir, `wireframe-v${version}.svg`);
  fs.writeFileSync(filePath, svg, 'utf-8');

  const row = await prisma.agentWireframe.create({
    data: {
      projectId: session.projectId, version,
      prompt: opts.feedback ? `[alteração] ${opts.feedback}` : descricao,
      imagePath: filePath, status: 'generated', feedback: opts.feedback || null,
    },
  });
  await logEvent(session.id, { role: 'assistant', agent: 'ux_designer',
    content: `Wireframe v${version} gerado.`, data: { wireframeId: row.id, version } });

  return { wireframe: row, svg };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 4 — custo por run, budget guard, revisor, estudo do existente, auditoria
// ─────────────────────────────────────────────────────────────────────────────

// Teto de custo mensal por tenant (USD). Configurável por env; default alinhado
// ao alvo de ~US$100/mês combinado — por tenant deixamos folga menor.
const TENANT_MONTHLY_BUDGET_USD = Number(process.env.ZEUS_TENANT_BUDGET_USD || 100);

/** Soma o custo dos build runs do tenant no mês corrente. */
async function tenantMonthCost(clienteId, userId) {
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const runs = await prisma.agentBuildRun.findMany({
    where: { clienteId: clienteId || null, userId, createdAt: { gte: start } },
    select: { costUsd: true },
  });
  return runs.reduce((sum, r) => sum + Number(r.costUsd || 0), 0);
}

/**
 * Verifica se o tenant ainda tem orçamento no mês. Lança 402 se estourar.
 * Chamado ANTES de iniciar um build (que é o que consome tokens de verdade).
 */
async function assertWithinBudget(user, clienteId) {
  const spent = await tenantMonthCost(clienteId, user.id);
  if (spent >= TENANT_MONTHLY_BUDGET_USD) {
    const err = new Error(`Orçamento mensal do tenant esgotado (US$ ${spent.toFixed(2)} / US$ ${TENANT_MONTHLY_BUDGET_USD}). Novos builds bloqueados até o próximo ciclo.`);
    err.status = 402;
    throw err;
  }
  return { spent, budget: TENANT_MONTHLY_BUDGET_USD, remaining: TENANT_MONTHLY_BUDGET_USD - spent };
}

/** Relatório de custo do escopo (mês corrente + acumulado por run). */
async function costReport(user, opts = {}) {
  const clienteId = opts.clienteId || null;
  const spent = await tenantMonthCost(clienteId, user.id);
  const recentRuns = await prisma.agentBuildRun.findMany({
    where: scopeWhere(user, clienteId),
    orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, status: true, costUsd: true, tokensIn: true, tokensOut: true, createdAt: true, projectId: true },
  });
  return {
    mesCorrente: { gastoUsd: Math.round(spent * 1e4) / 1e4, budgetUsd: TENANT_MONTHLY_BUDGET_USD, restanteUsd: Math.round((TENANT_MONTHLY_BUDGET_USD - spent) * 1e4) / 1e4 },
    runs: recentRuns,
  };
}

/**
 * Revisor: pega os arquivos gerados pelo último build run e submete ao gateway
 * /review. Persiste o veredito como evento. Não altera arquivos — só avalia.
 */
async function reviewBuild(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const lastRun = await prisma.agentBuildRun.findFirst({
    where: { projectId: session.projectId }, orderBy: { createdAt: 'desc' },
  });
  if (!lastRun) { const e = new Error('Nenhum build para revisar'); e.status = 400; throw e; }

  // Lê os arquivos do workspace referenciados pelas tasks do run.
  const baseDir = workspaceDir(session.project);
  const tasks = await prisma.agentTask.findMany({ where: { buildRunId: lastRun.id }, orderBy: { seq: 'asc' } });
  const arquivos = [];
  for (const t of tasks) {
    try {
      const meta = JSON.parse(t.result || '{}');
      for (const rel of (meta.arquivos || [])) {
        const full = path.resolve(baseDir, rel);
        if (full.startsWith(path.resolve(baseDir) + path.sep) && fs.existsSync(full)) {
          arquivos.push({ path: rel, conteudo: fs.readFileSync(full, 'utf-8') });
        }
      }
    } catch {}
  }
  if (!arquivos.length) { const e = new Error('Nenhum arquivo encontrado para revisar'); e.status = 400; throw e; }

  const plan = session.activePlanId ? await prisma.agentPlan.findUnique({ where: { id: session.activePlanId } }) : null;
  const { review } = await gatewayPost('/api/build/review', {
    arquivos, plano: plan?.content?.plan || null, arquitetura: plan?.content?.architecture || null,
  });
  await logEvent(session.id, { role: 'assistant', agent: 'revisor',
    content: `Revisão: ${review.aprovado ? 'APROVADO' : 'REPROVADO'} (nota ${review.nota}). ${review.resumo || ''}`,
    data: { review, runId: lastRun.id } });
  return { review };
}

/**
 * Estudo do software existente: clona o repo git do projeto e faz uma análise
 * (boas práticas, performance, segurança, vulnerabilidades) via gateway.
 * Reusa o executor Bedrock (não depende de embeddings/Ollama). Read-only.
 */
async function studyExisting(user, sessionId, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  if (!session.project.gitUrl) { const e = new Error('Projeto não tem gitUrl (kind=existing)'); e.status = 400; throw e; }

  await prisma.agentProject.update({ where: { id: session.projectId }, data: { status: 'studying' } });
  // Delega a análise ao gateway (usa o papel 'arch'); o gateway faz o clone/leitura.
  const { analise } = await gatewayPost('/api/build/study', {
    gitUrl: session.project.gitUrl, branch: session.project.gitBranch || null,
  });
  await prisma.agentProject.update({
    where: { id: session.projectId },
    data: { metadata: { ...(session.project.metadata || {}), estudo: analise } },
  });
  await logEvent(session.id, { role: 'assistant', agent: 'arquiteto_software',
    content: 'Estudo do sistema existente concluído.', data: { analise } });
  return { analise };
}

/** Aprova/rejeita o wireframe ativo (última versão). */
async function reviewWireframe(user, sessionId, decision, opts = {}) {
  const session = await getOwnedSession(user, sessionId, opts.clienteId);
  const last = await prisma.agentWireframe.findFirst({
    where: { projectId: session.projectId }, orderBy: { version: 'desc' },
  });
  if (!last) { const e = new Error('Nenhum wireframe para revisar'); e.status = 400; throw e; }
  const status = decision === 'approved' ? 'approved' : 'rejected';
  const row = await prisma.agentWireframe.update({ where: { id: last.id }, data: { status } });
  await logEvent(session.id, { role: 'stage', content: `Wireframe v${last.version} ${status}.`, data: { wireframeId: last.id } });
  return { wireframe: row };
}

/** Monta um contexto textual a partir dos eventos recentes da sessão. */
async function buildSessionContext(sessionId) {
  const events = await prisma.agentSessionEvent.findMany({
    where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 40,
  });
  return events
    .map((e) => {
      if (e.data) return `[${e.role}${e.agent ? '/' + e.agent : ''}] ${JSON.stringify(e.data).slice(0, 1200)}`;
      return e.content ? `[${e.role}] ${e.content}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  STAGES,
  createProject,
  discover,
  discoverStream,
  architectAndPlan,
  approvePlan,
  resumeSession,
  listProjects,
  latestSessionForProject,
  deleteProject,
  getOwnedSession,
  executeBuild,
  provisionDevStack,
  publishOptions,
  publishWithDomain,
  detectAuth,
  listWorkspaceFiles,
  readWorkspaceFileByPath,
  saveWorkspaceFileByPath,
  getProjectConfig,
  saveProjectConfig,
  rerun,
  editCode,
  runProject,
  generateWireframe,
  reviewWireframe,
  reviewBuild,
  studyExisting,
  costReport,
  assertWithinBudget,
  _internal: { buildSessionContext, gatewayPost, scopeWhere, workspaceDir, writeWorkspaceFile, tenantMonthCost, reapStaleRuns, touchBuildRun },
};
