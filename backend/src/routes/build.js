'use strict';

/**
 * Zeus Builder — rotas do PAINEL (/build e /api/build).
 *
 * Fica sob authMiddleware (JWT). `req.user = { id, role, username }`.
 * A persistência (sessão/plano) e o escopo multi-tenant são feitos no serviço
 * zeus-builder.js; aqui só validamos entrada, roles e formatamos a resposta.
 *
 * Permissões:
 *  - viewer: pode ver (listar projetos, retomar sessão).
 *  - dev/admin: pode criar projeto, conduzir descoberta, gerar plano e aprovar.
 */

const { Router } = require('express');
const builder = require('../services/zeus-builder');

const router = Router();

function canWrite(role) {
  return role === 'admin' || role === 'dev';
}

function requireWrite(req, res) {
  if (!canWrite(req.user.role)) {
    res.status(403).json({ message: 'Permissão insuficiente (requer dev ou admin)' });
    return false;
  }
  return true;
}

// Extrai clienteId opcional do body/query (escopo multi-cliente).
function clienteIdOf(req) {
  return req.body?.clienteId || req.query?.clienteId || null;
}

// GET /build/projects — lista projetos do escopo do usuário
router.get('/build/projects', async (req, res, next) => {
  try {
    const projects = await builder.listProjects(req.user, { clienteId: clienteIdOf(req) });
    res.json({ projects });
  } catch (err) { next(err); }
});

// POST /build/projects — cria projeto + sessão inicial
router.post('/build/projects', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { name, kind, gitUrl, channel } = req.body || {};
    const out = await builder.createProject(req.user, {
      name, kind, gitUrl, channel, clienteId: clienteIdOf(req),
    });
    res.status(201).json(out);
  } catch (err) { next(err); }
});

// DELETE /build/projects/:id — remove o projeto e tudo em cascata
router.delete('/build/projects/:id', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const out = await builder.deleteProject(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /build/projects/:id/session — retoma a sessão mais recente do projeto
router.get('/build/projects/:id/session', async (req, res, next) => {
  try {
    const out = await builder.latestSessionForProject(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /build/sessions/:id — retoma sessão (estágio, plano ativo, histórico)
router.get('/build/sessions/:id', async (req, res, next) => {
  try {
    const out = await builder.resumeSession(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/discovery — passo de descoberta (faz perguntas)
router.post('/build/sessions/:id/discovery', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ message: 'message é obrigatório' });
    const out = await builder.discover(req.user, req.params.id, message, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/plan — gera arquitetura + plano (aguarda aprovação)
router.post('/build/sessions/:id/plan', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const out = await builder.architectAndPlan(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/approve — approval gate
router.post('/build/sessions/:id/approve', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const out = await builder.approvePlan(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// Extrai o JWT do request (header Bearer ou cookie) para chamadas internas.
function tokenOf(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, t] = authHeader.split(' ');
  if (scheme === 'Bearer' && t) return t;
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)(?:provirpanel_token|token)=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// POST /build/sessions/:id/execute — executa o build do plano aprovado (aplica arquivos)
router.post('/build/sessions/:id/execute', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const out = await builder.executeBuild(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/provision — provisiona a stack dev e devolve o link
router.post('/build/sessions/:id/provision', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { templateId, hostPort, envVars, baseDomain } = req.body || {};
    const out = await builder.provisionDevStack(req.user, req.params.id, {
      token: tokenOf(req), templateId, hostPort, envVars, baseDomain, clienteId: clienteIdOf(req),
    });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /build/sessions/:id/publish-options — opções para a UI (zonas gerenciadas,
// IP do servidor, porta-alvo, se o app tem auth, modos disponíveis).
router.get('/build/sessions/:id/publish-options', async (req, res, next) => {
  try {
    const out = await builder.publishOptions(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/publish — publica o app com domínio.
// body: { mode: 'subdomain'|'proxy', domain, port?, pathPrefix?, dryRun? }
router.post('/build/sessions/:id/publish', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { mode, domain, port, pathPrefix, dryRun } = req.body || {};
    if (!domain) return res.status(400).json({ message: 'domain é obrigatório' });
    const out = await builder.publishWithDomain(req.user, req.params.id, {
      mode, domain, port, pathPrefix, dryRun: dryRun === true, clienteId: clienteIdOf(req),
    });
    res.json(out);
  } catch (err) { next(err); }
});

// ── Painel do projeto (pós-build): ver arquivos, editar, config, rodar de novo ──

// GET /build/sessions/:id/files — árvore de arquivos do workspace gerado
router.get('/build/sessions/:id/files', async (req, res, next) => {
  try {
    const out = await builder.listWorkspaceFiles(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /build/sessions/:id/file?path=... — lê UM arquivo (texto)
router.get('/build/sessions/:id/file', async (req, res, next) => {
  try {
    const p = req.query.path;
    if (!p) return res.status(400).json({ message: 'path é obrigatório' });
    const out = await builder.readWorkspaceFileByPath(req.user, req.params.id, String(p), { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// PUT /build/sessions/:id/file — salva edição de UM arquivo. body: { path, content }
router.put('/build/sessions/:id/file', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { path: p, content } = req.body || {};
    if (!p) return res.status(400).json({ message: 'path é obrigatório' });
    const out = await builder.saveWorkspaceFileByPath(req.user, req.params.id, String(p), content, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /build/sessions/:id/config — config do projeto (env/porta/domínio)
router.get('/build/sessions/:id/config', async (req, res, next) => {
  try {
    const out = await builder.getProjectConfig(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// PUT /build/sessions/:id/config — salva config. body: { env?, port?, domain? }
router.put('/build/sessions/:id/config', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { env, port, domain } = req.body || {};
    const out = await builder.saveProjectConfig(req.user, req.params.id, { env, port, domain }, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/rerun — roda novamente (rebuild) com progresso SSE
router.post('/build/sessions/:id/rerun', async (req, res) => {
  const send = initSSE(res);
  try {
    if (!canWrite(req.user.role)) { send({ type: 'error', error: 'Permissão insuficiente' }); return res.end(); }
    await builder.rerun(req.user, req.params.id, { clienteId: clienteIdOf(req), onEvent: send });
    res.write('data: [DONE]\n\n'); res.end();
  } catch (err) {
    send({ type: 'error', error: err.message }); res.end();
  }
});

// POST /build/sessions/:id/run — PLAY rápido: provisiona (1ª vez) ou reinicia o
// serviço do projeto. NÃO usa LLM, NÃO rebuilda. Devolve o link. body: { baseDomain? }
router.post('/build/sessions/:id/run', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { baseDomain, envVars } = req.body || {};
    const out = await builder.runProject(req.user, req.params.id, {
      token: tokenOf(req), baseDomain, envVars, clienteId: clienteIdOf(req),
    });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/edit — AJUSTE incremental (chat de edição) com progresso
// SSE. Edita SÓ os arquivos afetados, sem rebuild. body: { instrucao }
router.post('/build/sessions/:id/edit', async (req, res) => {
  const send = initSSE(res);
  try {
    if (!canWrite(req.user.role)) { send({ type: 'error', error: 'Permissão insuficiente' }); return res.end(); }
    const { instrucao, message } = req.body || {};
    const texto = instrucao || message;
    if (!texto) { send({ type: 'error', error: 'instrucao é obrigatória' }); return res.end(); }
    await builder.editCode(req.user, req.params.id, texto, { clienteId: clienteIdOf(req), onEvent: send });
    res.write('data: [DONE]\n\n'); res.end();
  } catch (err) {
    send({ type: 'error', error: err.message }); res.end();
  }
});

// POST /build/sessions/:id/wireframe — gera/altera o wireframe (SVG)
// body: { descricao?, feedback?, exemplo?: { mimeType, data(base64) } }
router.post('/build/sessions/:id/wireframe', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const { descricao, feedback, exemplo } = req.body || {};
    const out = await builder.generateWireframe(req.user, req.params.id, {
      descricao, feedback, exemplo, clienteId: clienteIdOf(req),
    });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/wireframe/review — aprova/rejeita o wireframe ativo
// body: { decision: 'approved' | 'rejected' }
router.post('/build/sessions/:id/wireframe/review', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const out = await builder.reviewWireframe(req.user, req.params.id, req.body?.decision, {
      clienteId: clienteIdOf(req),
    });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/review — revisor avalia os arquivos do último build
router.post('/build/sessions/:id/review', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const out = await builder.reviewBuild(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /build/sessions/:id/study — estuda o software existente (git) do projeto
router.post('/build/sessions/:id/study', async (req, res, next) => {
  try {
    if (!requireWrite(req, res)) return;
    const out = await builder.studyExisting(req.user, req.params.id, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /build/cost — relatório de custo do escopo (mês corrente + runs recentes)
router.get('/build/cost', async (req, res, next) => {
  try {
    const out = await builder.costReport(req.user, { clienteId: clienteIdOf(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// Helper: prepara a resposta para SSE.
function initSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  return (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
}

// POST /build/sessions/:id/chat — descoberta conversacional em STREAMING (SSE)
router.post('/build/sessions/:id/chat', async (req, res) => {
  const send = initSSE(res);
  try {
    if (!canWrite(req.user.role)) { send({ type: 'error', error: 'Permissão insuficiente' }); return res.end(); }
    const { message, attachment } = req.body || {};
    if (!message && !attachment) { send({ type: 'error', error: 'message é obrigatório' }); return res.end(); }
    await builder.discoverStream(req.user, req.params.id, message || '(anexo enviado)', send, { clienteId: clienteIdOf(req), attachment: attachment || null });
    res.write('data: [DONE]\n\n'); res.end();
  } catch (err) {
    send({ type: 'error', error: err.message }); res.end();
  }
});

// POST /build/sessions/:id/build-stream — executa o build com progresso ao vivo (SSE)
router.post('/build/sessions/:id/build-stream', async (req, res) => {
  const send = initSSE(res);
  try {
    if (!canWrite(req.user.role)) { send({ type: 'error', error: 'Permissão insuficiente' }); return res.end(); }
    await builder.executeBuild(req.user, req.params.id, { clienteId: clienteIdOf(req), onEvent: send });
    res.write('data: [DONE]\n\n'); res.end();
  } catch (err) {
    send({ type: 'error', error: err.message }); res.end();
  }
});

// GET /build/cli/install — instruções e comando para instalar o CLI pelo painel.
// O painel pode executar `installCommand` no Terminal integrado (CommandExecutor).
router.get('/build/cli/install', (req, res) => {
  const cliDir = process.env.ZEUS_CLI_DIR || '/opt/zeus-ai/gateway/cli';
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    cliDir,
    // Instala o CLI globalmente a partir do diretório local (sem registry externo).
    installCommand: `npm install -g ${cliDir}`,
    // Após instalar, autentica o CLI apontando para este painel.
    loginHint: `zeus login --url ${baseUrl} --token <SEU_JWT>`,
    bin: 'zeus',
  });
});

module.exports = router;
