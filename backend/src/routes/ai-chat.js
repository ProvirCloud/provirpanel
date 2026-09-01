'use strict';

/**
 * Rotas de persistência do Assistente principal (chat).
 *
 * Montadas sob /ai e /api/ai, DEPOIS do authMiddleware — portanto req.user
 * ({ id, role, username }) está sempre disponível.
 *
 * Escopo/autorização:
 *  - Cada usuário só enxerga/edita as próprias conversas.
 *  - Admin pode acessar qualquer conversa (getConversation trata isso).
 */

const { Router } = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const store = require('./../services/ai-conversation-store');
const profiler = require('./../services/ai-user-profiler');
const aiAgents = require('./../services/ai-agents');
const uploadStore = require('./../services/ai-upload-store');
const { analyze, classifyKind, isValidIntent, isActiveIntent, extractTextForIndex } = require('./../services/ai-upload-analyzer');
const wizard = require('./../services/ai-publish-wizard');
const { StorageEnvironmentManager } = require('./../services/StorageEnvironmentManager');

const router = Router();

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://localhost:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';

// Collection privada do dono (isolamento por cliente; senão por usuário).
const privateCollectionFor = ({ clienteId, userId }) => {
  const safe = (v) => String(v || '').replace(/[^a-zA-Z0-9_]/g, '_');
  return clienteId ? `client_${safe(clienteId)}` : `user_${safe(userId)}`;
};

// Indexa texto no Gateway (Qdrant) numa collection privada.
const indexPrivate = async ({ text, collection, metadata }) => {
  const res = await fetch(`${ZEUS_GATEWAY_URL}/api/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({ text, collection, metadata }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Falha ao indexar: ${t.slice(0, 200)}`); }
  return res.json();
};

const LOCAL_BASE = () => `http://localhost:${process.env.PORT || 3000}`;

// Torna os arquivos de uma pasta legíveis (dirs 755, files 644). Necessário
// porque arquivos extraídos de um zip podem vir com modo restritivo (ex.: 600),
// impedindo o nginx de servi-los (403). O backend roda como o mesmo owner (uid 1000).
const makeReadableRecursive = (dir) => {
  try {
    const st = fs.statSync(dir);
    if (st.isDirectory()) {
      fs.chmodSync(dir, 0o755);
      for (const entry of fs.readdirSync(dir)) makeReadableRecursive(path.join(dir, entry));
    } else {
      fs.chmodSync(dir, 0o644);
    }
  } catch { /* best-effort */ }
};

// Faz deploy do código (archive) para dentro de um serviço já criado, reusando
// o fluxo existente POST /docker/services/:id/project-upload (multipart).
const deployProjectArchive = async ({ serviceId, tmpPath, filename, token }) => {
  const buf = fs.readFileSync(tmpPath);
  const form = new FormData();
  // Blob a partir do buffer (Node 18+ tem Blob/FormData globais).
  form.append('archive', new Blob([buf]), filename || 'project.zip');
  const res = await fetch(`${LOCAL_BASE()}/docker/services/${encodeURIComponent(serviceId)}/project-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(600000),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body.message || body.error || `Falha no deploy do projeto (${res.status})`);

  // O deploy roda em segundo plano (202 + jobId). Aguardamos concluir.
  const jobId = body.jobId;
  if (!jobId) return body;
  const deadline = Date.now() + 8 * 60 * 1000; // 8 min
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const jr = await fetch(`${LOCAL_BASE()}/docker/services/${encodeURIComponent(serviceId)}/project-upload/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!jr.ok) continue;
    const job = await jr.json();
    const st = job.status || job.job?.status;
    if (st === 'completed' || st === 'done' || st === 'success') return job;
    if (st === 'error' || st === 'failed') throw new Error(job.message || job.error || 'Falha na publicação do código.');
  }
  throw new Error('Tempo esgotado aguardando a publicação do código.');
};

// Cria um vhost de proxy no Nginx apontando para a porta do serviço.
const createProxyVhost = async ({ domain, port, token }) => {
  const res = await fetch(`${LOCAL_BASE()}/nginx/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: domain,
      primary_domain: domain,
      server_type: 'proxy',
      proxy_host: 'localhost',
      proxy_port: Number(port),
      listen_port: 80,
      ssl_type: 'letsencrypt',
      websocket_enabled: true,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body.error || body.message || `Falha ao criar vhost (${res.status})`);
  return body;
};

// Upload temporário isolado para anexos do chat.
const AI_UPLOAD_TMP = path.join(os.tmpdir(), 'provirpanel-ai-uploads');
fs.mkdirSync(AI_UPLOAD_TMP, { recursive: true });
const aiUpload = multer({
  dest: AI_UPLOAD_TMP,
  limits: { fileSize: 512 * 1024 * 1024 }, // 512MB
});
const storageEnvManager = new StorageEnvironmentManager();

const uid = (req) => req.user?.id;
const role = (req) => req.user?.role || 'viewer';

// ─── Conversas ───────────────────────────────────────────────────────────────

// GET /ai/conversations?clienteId=&archived=
router.get('/conversations', async (req, res, next) => {
  try {
    const list = await store.listConversations(uid(req), {
      clienteId: req.query.clienteId || undefined,
      includeArchived: req.query.archived === 'true',
    });
    res.json({ conversations: list });
  } catch (err) { next(err); }
});

// POST /ai/conversations  { title?, agent?, clienteId? }
router.post('/conversations', async (req, res, next) => {
  try {
    const { title, agent, clienteId } = req.body || {};
    if (agent !== undefined && !aiAgents.isValidAgent(agent)) {
      return res.status(400).json({ error: 'agent inválido' });
    }
    const conv = await store.createConversation(uid(req), { title, agent, clienteId });
    res.status(201).json({ conversation: conv });
  } catch (err) { next(err); }
});

// GET /ai/conversations/:id  → conversa + mensagens
router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await store.getConversation(req.params.id, { userId: uid(req), role: role(req) });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    const messages = await store.getMessages(req.params.id);
    res.json({ conversation: conv, messages });
  } catch (err) { next(err); }
});

// PATCH /ai/conversations/:id  { title?, agent?, archived? }
router.patch('/conversations/:id', async (req, res, next) => {
  try {
    if (req.body?.agent !== undefined && !aiAgents.isValidAgent(req.body.agent)) {
      return res.status(400).json({ error: 'agent inválido' });
    }
    const updated = await store.updateConversation(
      req.params.id,
      { userId: uid(req), role: role(req) },
      req.body || {}
    );
    if (!updated) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json({ conversation: updated });
  } catch (err) { next(err); }
});

// DELETE /ai/conversations/:id
router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const ok = await store.deleteConversation(req.params.id, { userId: uid(req), role: role(req) });
    if (!ok) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Mensagens (persistência avulsa; o streaming grava via helper) ───────────

// POST /ai/conversations/:id/messages  { role, content, blocks? }
router.post('/conversations/:id/messages', async (req, res, next) => {
  try {
    const conv = await store.getConversation(req.params.id, { userId: uid(req), role: role(req) });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    const { role: msgRole, content, blocks } = req.body || {};
    if (!['user', 'assistant', 'system', 'tool'].includes(msgRole)) {
      return res.status(400).json({ error: 'role inválido' });
    }
    const msg = await store.addMessage(req.params.id, { role: msgRole, content, blocks });
    if (msgRole === 'user') {
      await store.maybeAutoTitle(req.params.id, content);
      await profiler.recordUserMessage(uid(req), content);
    }
    res.status(201).json({ message: msg });
  } catch (err) { next(err); }
});

// ─── Perfil (nível de conhecimento — override manual opcional) ───────────────

// GET /ai/profile  → nível efetivo (não expõe sinais brutos por padrão)
router.get('/profile', async (req, res, next) => {
  try {
    const level = await profiler.getEffectiveLevel(uid(req));
    const profile = await profiler.loadProfile(uid(req));
    res.json({ skillLevel: level, override: profile?.skillLevel || 'auto' });
  } catch (err) { next(err); }
});

// PATCH /ai/profile  { skillLevel }
router.patch('/profile', async (req, res, next) => {
  try {
    const { skillLevel } = req.body || {};
    const level = await profiler.setSkillLevel(uid(req), skillLevel);
    res.json({ skillLevel: level });
  } catch (err) { next(err); }
});

// ─── Uploads (Fase 5): anexos do chat com análise inteligente ────────────────

const KNOWN_TMP_ROOTS = [AI_UPLOAD_TMP];
const isSafeTmp = (p) => {
  if (!p) return false;
  const resolved = path.resolve(p);
  return KNOWN_TMP_ROOTS.some((root) => resolved.startsWith(path.resolve(root) + path.sep));
};
const sanitizeName = (name) => path.basename(String(name || 'arquivo')).replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'arquivo';

// POST /ai/uploads  (multipart: file, conversationId?) → cria upload + análise async
router.post('/uploads', aiUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'arquivo é obrigatório (campo "file")' });
    const filename = sanitizeName(req.file.originalname);
    const mime = req.file.mimetype;
    const kind = classifyKind(filename, mime);
    const conversationId = req.body?.conversationId || null;
    // Intenção declarada (5.1). Default 'auto'. Só aceita intenções ativas.
    let intent = req.body?.intent || 'auto';
    if (!isValidIntent(intent) || !isActiveIntent(intent)) intent = 'auto';

    // Se a conversa for informada, valida propriedade (defesa em profundidade).
    if (conversationId) {
      const conv = await store.getConversation(conversationId, { userId: uid(req), role: role(req) });
      if (!conv) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(404).json({ error: 'Conversa não encontrada' }); }
    }

    const rec = await uploadStore.createUpload({
      userId: uid(req), conversationId, filename, mime,
      sizeBytes: req.file.size, kind, intent, tmpPath: req.file.path,
    });

    // Análise assíncrona (não bloqueia a resposta).
    (async () => {
      try {
        await uploadStore.setStatus(rec.id, 'analyzing');
        const { analysis } = await analyze({ tmpPath: req.file.path, filename, mime, intent });
        const act = analysis?.suggestion?.action;
        const status = (act === 'ask_destination' || act === 'describe' || act === 'index_kb') ? 'awaiting_user' : 'done';
        await uploadStore.setStatus(rec.id, status, { analysis });
      } catch (err) {
        await uploadStore.setStatus(rec.id, 'error', { error: err.message });
      }
    })();

    res.status(201).json({ uploadId: rec.id, kind, intent, filename, status: 'analyzing' });
  } catch (err) { next(err); }
});

// GET /ai/uploads/:id  → status + análise (poll)
router.get('/uploads/:id', async (req, res, next) => {
  try {
    const u = await uploadStore.getUpload(req.params.id, { userId: uid(req), role: role(req) });
    if (!u) return res.status(404).json({ error: 'Upload não encontrado' });
    // Não expõe caminho absoluto do tmp.
    const { tmpPath, ...safe } = u;
    res.json({ upload: safe });
  } catch (err) { next(err); }
});

// GET /ai/storages  → ambientes de storage configurados (para o usuário escolher destino)
router.get('/storages', async (req, res, next) => {
  try {
    const view = storageEnvManager.getEnvironmentView(role(req));
    const envs = (view.environments || []).map((e) => ({ id: e.id, name: e.name, provider: e.provider, enabled: e.enabled !== false }));
    // sempre inclui o destino local
    res.json({ storages: [{ id: 'local', name: 'Pasta local (projetos)', provider: 'local', enabled: true }, ...envs.filter((e) => e.id !== 'local')] });
  } catch (err) { next(err); }
});

// POST /ai/uploads/:id/decision  { action, target? }
// action: 'save_local' | 'save_storage' | 'publish_system' | 'discard'
router.post('/uploads/:id/decision', async (req, res, next) => {
  try {
    const u = await uploadStore.getUpload(req.params.id, { userId: uid(req), role: role(req) });
    if (!u) return res.status(404).json({ error: 'Upload não encontrado' });
    const { action, target } = req.body || {};

    if (!isSafeTmp(u.tmpPath) || !fs.existsSync(u.tmpPath)) {
      return res.status(410).json({ error: 'Arquivo temporário indisponível (expirou). Reenvie.' });
    }

    if (action === 'discard') {
      try { fs.unlinkSync(u.tmpPath); } catch {}
      const rec = await uploadStore.setStatus(u.id, 'done', { decision: { action } });
      return res.json({ upload: rec });
    }

    if (action === 'index_kb') {
      // Indexa o conteúdo na base PRIVADA do dono (collection por cliente/usuário).
      // Privacidade: nada vai para a collection compartilhada a partir do chat.
      let clienteId = null;
      if (u.conversationId) {
        const conv = await store.getConversation(u.conversationId, { userId: uid(req), role: role(req) });
        clienteId = conv?.clienteId || null;
      }
      const collection = privateCollectionFor({ clienteId, userId: uid(req) });
      const text = extractTextForIndex({ tmpPath: u.tmpPath, filename: u.filename, mime: u.mime });

      if (!text || text.trim().length < 20) {
        // Sem texto extraível (ex.: zip/imagem): guarda para ingestão futura, sem indexar vazio.
        const baseDir = process.env.CLOUDPAINEL_PROJECTS_DIR || path.join(os.homedir(), 'projects');
        const sub = (u.intent === 'training') ? 'kb-training' : 'kb-docs';
        const destDir = path.join(baseDir, sub);
        fs.mkdirSync(destDir, { recursive: true });
        const dest = path.join(destDir, `${Date.now()}-${u.filename}`);
        fs.copyFileSync(u.tmpPath, dest);
        try { fs.unlinkSync(u.tmpPath); } catch {}
        const rec = await uploadStore.setStatus(u.id, 'done', { decision: { action, indexed: false }, storagePath: dest });
        return res.json({ upload: rec, savedTo: dest, note: 'Não consegui extrair texto para indexar (arquivo binário/compactado). Guardei para ingestão posterior.' });
      }

      const meta = {
        owner: uid(req), clienteId: clienteId || null, private: true,
        source: 'chat-upload', intent: u.intent, filename: u.filename,
        training: u.intent === 'training', type: 'document',
      };
      const result = await indexPrivate({ text, collection, metadata: meta });
      try { fs.unlinkSync(u.tmpPath); } catch {}
      const rec = await uploadStore.setStatus(u.id, 'done', {
        decision: { action, indexed: true, collection, chunks: result.chunks || 0 },
      });
      return res.json({
        upload: rec, collection, chunks: result.chunks || 0,
        note: `Indexado na sua base privada (${collection}, ${result.chunks || 0} trechos). Só você/este cliente terá acesso.`,
      });
    }

    if (action === 'describe') {
      // Apenas registra que a inspeção foi concluída (sem mover o arquivo).
      const rec = await uploadStore.setStatus(u.id, 'done', { decision: { action } });
      return res.json({ upload: rec });
    }

    if (action === 'save_local') {
      const baseDir = process.env.CLOUDPAINEL_PROJECTS_DIR || path.join(os.homedir(), 'projects');
      const destDir = path.join(baseDir, 'chat-uploads');
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, `${Date.now()}-${u.filename}`);
      fs.copyFileSync(u.tmpPath, dest);
      try { fs.unlinkSync(u.tmpPath); } catch {}
      const rec = await uploadStore.setStatus(u.id, 'done', { decision: { action }, storagePath: dest });
      return res.json({ upload: rec, savedTo: dest });
    }

    if (action === 'publish_system') {
      // Publicar sistema é ação de ESCRITA → só admin, e não executamos aqui:
      // devolvemos uma diretiva para o frontend conduzir o fluxo de publicação
      // existente (wizard Docker), reutilizando a confirmação humana de lá.
      if (role(req) !== 'admin') return res.status(403).json({ error: 'Publicar sistema requer perfil admin.' });
      const rec = await uploadStore.setStatus(u.id, 'awaiting_user', { decision: { action, target } });
      return res.json({
        upload: rec,
        directive: { type: 'publish_system', uploadId: u.id, detection: u.analysis?.detection || null },
        note: 'Encaminhe para o fluxo de publicação (Docker) para confirmar e criar o serviço.',
      });
    }

    if (action === 'save_storage') {
      // Provider concreto (s3/etc.) ainda depende do conector do storage escolhido.
      // Mantemos contrato pronto; hoje só 'local' é operacional de ponta a ponta.
      if (!target || target === 'local') {
        return res.status(400).json({ error: 'Para storage remoto informe target válido; use save_local para a pasta local.' });
      }
      return res.status(501).json({ error: `Storage "${target}" ainda não tem conector ativo. Use "Salvar na pasta local" por enquanto.` });
    }

    return res.status(400).json({ error: 'action inválida' });
  } catch (err) { next(err); }
});

// ─── Wizard de publicação guiado (Fase 5.3) ──────────────────────────────────

// POST /ai/publish/start { uploadId }
router.post('/publish/start', async (req, res, next) => {
  try {
    if (role(req) !== 'admin') return res.status(403).json({ error: 'Publicar sistema requer perfil admin.' });
    const { uploadId } = req.body || {};
    const u = await uploadStore.getUpload(uploadId, { userId: uid(req), role: role(req) });
    if (!u) return res.status(404).json({ error: 'Upload não encontrado' });
    if (!u.tmpPath || !fs.existsSync(u.tmpPath)) return res.status(410).json({ error: 'Arquivo temporário expirou. Reenvie o pacote.' });

    const inspection = await wizard.inspectProject({ tmpPath: u.tmpPath, filename: u.filename });
    if (!inspection.publishable) {
      return res.status(422).json({ error: 'Não identifiquei um sistema publicável neste pacote.', inspection });
    }
    const started = wizard.start({ uploadId, inspection });
    res.json(started);
  } catch (err) { next(err); }
});

// POST /ai/publish/answer { wizardId, value }
router.post('/publish/answer', async (req, res, next) => {
  try {
    if (role(req) !== 'admin') return res.status(403).json({ error: 'Requer perfil admin.' });
    const { wizardId, value } = req.body || {};
    const token = req.headers.authorization?.replace('Bearer ', '');
    const out = await wizard.answer({ wizardId, value, token });
    if (out.error && !out.step) return res.status(400).json(out);
    res.json(out);
  } catch (err) { next(err); }
});

// POST /ai/publish/generate-secret → gera um secret forte (para JWT_SECRET etc.)
router.post('/publish/generate-secret', (req, res) => {
  if (role(req) !== 'admin') return res.status(403).json({ error: 'Requer perfil admin.' });
  res.json({ value: wizard.generateSecret() });
});

// POST /ai/publish/confirm { wizardId } → cria o serviço (admin) reusando o fluxo Docker
router.post('/publish/confirm', async (req, res, next) => {
  try {
    if (role(req) !== 'admin') return res.status(403).json({ error: 'Publicar sistema requer perfil admin.' });
    const { wizardId } = req.body || {};
    const w = wizard.get(wizardId);
    if (!w) return res.status(410).json({ error: 'Wizard expirado. Reinicie a publicação.' });

    const token = req.headers.authorization?.replace('Bearer ', '');
    const steps = [];

    // baseDir dos projetos Docker (para o volume de publicação, igual à UI).
    let baseDir = '';
    try {
      const bdRes = await fetch(`${LOCAL_BASE()}/docker/services`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      if (bdRes.ok) { const bd = await bdRes.json(); baseDir = bd.baseDir || ''; }
    } catch { /* segue sem baseDir; backend aplica default */ }
    const servicePayload = wizard.buildServicePayload(w, baseDir);

    // Localiza o arquivo do upload (código do projeto) p/ o deploy.
    const up = await uploadStore.getUpload(w.uploadId, { userId: uid(req), role: role(req) });
    const hasArchive = up && up.tmpPath && fs.existsSync(up.tmpPath);

    // ── 1) Cria o serviço (template + envs) ──
    const createRes = await fetch(`${LOCAL_BASE()}/docker/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(servicePayload),
      signal: AbortSignal.timeout(120000),
    });
    const createText = await createRes.text();
    let created; try { created = JSON.parse(createText); } catch { created = { raw: createText }; }
    if (!createRes.ok) {
      return res.status(createRes.status).json({ error: created.message || created.error || 'Falha ao criar serviço', progress: created.progress || null });
    }
    const service = created.service || created;
    const serviceId = service.id;
    const servicePort = service.hostPort;
    steps.push({ step: 'create_service', ok: true, serviceId, port: servicePort });

    // ── 2) Faz deploy do CÓDIGO do zip para dentro do serviço ──
    if (hasArchive && serviceId) {
      try {
        await deployProjectArchive({ serviceId, tmpPath: up.tmpPath, filename: up.filename, token });
        // Normaliza permissões da pasta publicada (evita 403 do nginx com arquivos 600).
        try {
          const svcRes = await fetch(`${LOCAL_BASE()}/docker/services`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
          if (svcRes.ok) {
            const sd = await svcRes.json();
            const list = Array.isArray(sd) ? sd : (sd.services || []);
            const svc = list.find((x) => x.id === serviceId);
            const vol = (svc?.volumes || []).find((v) => v.hostPath);
            if (vol?.hostPath && fs.existsSync(vol.hostPath)) makeReadableRecursive(vol.hostPath);
          }
        } catch { /* best-effort */ }
        steps.push({ step: 'deploy_code', ok: true });
        try { fs.unlinkSync(up.tmpPath); } catch {}
      } catch (err) {
        steps.push({ step: 'deploy_code', ok: false, error: err.message });
      }
    } else {
      steps.push({ step: 'deploy_code', ok: false, error: 'Arquivo do projeto indisponível (expirou). Serviço criado a partir do template — reenvie o código pelo painel do serviço.' });
    }

    // ── 3) Cria o vhost do Nginx para o domínio (se informado) ──
    const domain = w.answers?.domain;
    if (domain && servicePort) {
      try {
        await createProxyVhost({ domain, port: servicePort, token });
        steps.push({ step: 'nginx_vhost', ok: true, domain });
      } catch (err) {
        steps.push({ step: 'nginx_vhost', ok: false, error: err.message });
      }
    }

    // Marca o upload como concluído.
    try { await uploadStore.setStatus(w.uploadId, 'done', { decision: { action: 'publish_system', serviceId, steps } }); } catch { /* noop */ }

    const allOk = steps.every((s) => s.ok);
    res.json({ ok: allOk, service: sanitizeServiceOut(service), steps, summary: wizard.summarize(w) });
  } catch (err) { next(err); }
});

// Remove campos sensíveis do serviço antes de devolver ao cliente.
function sanitizeServiceOut(s) {
  if (!s || typeof s !== 'object') return s;
  const { envVars, credentials, ...rest } = s;
  return { ...rest, name: s.name, id: s.id, hostPort: s.hostPort, url: s.url };
}

module.exports = router;
