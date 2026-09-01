'use strict';

/**
 * AI Publish Wizard (Fase 5.3)
 *
 * Conduz um usuário (mesmo leigo) na publicação de um sistema enviado por upload,
 * passo a passo, em linguagem simples:
 *  - inspeciona o pacote (tipo, porta provável, envs necessárias);
 *  - gera "steps" (perguntas) com DICA de onde achar cada valor/secret;
 *  - checa conflito de domínio no Nginx e sugere alternativas;
 *  - monta o payload de criação de serviço.
 *
 * O estado do wizard é mantido em memória (Map) por wizardId, com TTL. É simples
 * e suficiente; se cair o backend, o usuário reinicia o wizard (idempotente).
 */

const { spawn } = require('child_process');
const crypto = require('crypto');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

// ── estado em memória (TTL 1h) ──
const WIZARDS = new Map();
const TTL_MS = 60 * 60 * 1000;
const gc = () => { const now = Date.now(); for (const [k, v] of WIZARDS) if (now - v.updatedAt > TTL_MS) WIZARDS.delete(k); };

function run(cmd, args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let out = ''; let done = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch {} resolve(''); } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(''); } });
    child.on('close', () => { if (!done) { done = true; clearTimeout(t); resolve(out); } });
  });
}

async function listArchiveNames(tmpPath, filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.zip') || lower.endsWith('.jar')) {
    const o = await run('unzip', ['-Z1', tmpPath]); return o.split('\n').filter(Boolean);
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) { const o = await run('tar', ['-tzf', tmpPath]); return o.split('\n').filter(Boolean); }
  if (lower.endsWith('.tar')) { const o = await run('tar', ['-tf', tmpPath]); return o.split('\n').filter(Boolean); }
  return [];
}

// Lê um arquivo específico de dentro do zip/tar (para package.json / .env.example).
async function readEntry(tmpPath, filename, entry) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.zip') || lower.endsWith('.jar')) return run('unzip', ['-p', tmpPath, entry]);
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return run('tar', ['-xzOf', tmpPath, entry]);
  if (lower.endsWith('.tar')) return run('tar', ['-xOf', tmpPath, entry]);
  return '';
}

function stripRoot(name) { return name.replace(/^[^/]+\//, ''); }

// Detecta tipo e sinais do projeto a partir dos nomes + package.json/.env.
async function inspectProject({ tmpPath, filename }) {
  const names = await listArchiveNames(tmpPath, filename);
  const rel = names.map(stripRoot);
  const has = (re) => names.concat(rel).some((n) => re.test(n.toLowerCase()));

  const hasNext = has(/(^|\/)next\.config\.(js|mjs|ts)$/);
  const hasPkg = has(/(^|\/)package\.json$/);
  const hasIndexHtml = has(/(^|\/)index\.html$/);
  const hasDockerfile = has(/(^|\/)dockerfile$/);

  let type = 'unknown'; let templateId = 'custom-image'; let label = 'Projeto'; let defaultPort = 3000;
  if (hasNext) { type = 'next'; templateId = 'nextjs-app'; label = 'Aplicação Next.js'; defaultPort = 3000; }
  else if (hasPkg) { type = 'node'; templateId = 'node-app'; label = 'Projeto Node.js'; defaultPort = 3000; }
  else if (hasIndexHtml) { type = 'static'; templateId = 'nginx-static'; label = 'Site estático'; defaultPort = 80; }
  else if (hasDockerfile) { type = 'docker'; templateId = 'custom-image'; label = 'Projeto com Docker'; defaultPort = 8080; }

  // Descobre envs necessárias: procura .env.example e referências process.env.X
  const envKeys = new Set();
  const findName = (reArr) => names.find((n) => reArr.some((re) => re.test(stripRoot(n).toLowerCase())));
  const envExample = findName([/(^|\/)\.env\.example$/, /(^|\/)\.env\.sample$/]);
  if (envExample) {
    const content = await readEntry(tmpPath, filename, envExample);
    content.split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/); if (m) envKeys.add(m[1]); });
  }
  // package.json → nome sugerido e scripts
  let suggestedName = (filename || 'app').replace(/\.(zip|tar\.gz|tgz|tar|jar)$/i, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 40);
  const pkgEntry = findName([/(^|\/)package\.json$/]);
  if (pkgEntry) {
    try {
      const pkg = JSON.parse(await readEntry(tmpPath, filename, pkgEntry));
      if (pkg.name) suggestedName = String(pkg.name).replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 40);
    } catch { /* ignore */ }
  }

  return {
    type, templateId, label, defaultPort,
    fileCount: names.length,
    envKeys: [...envKeys],
    suggestedName: suggestedName || 'app',
    publishable: type !== 'unknown',
  };
}

// Dica de onde achar cada secret comum (explicação para leigos).
const ENV_HINTS = {
  DATABASE_URL: 'String de conexão do banco (ex.: postgres://user:senha@host:5432/db). Se usa o painel, veja em "Databases".',
  DB_HOST: 'Endereço do servidor de banco (ex.: localhost ou o host do provedor).',
  DB_PASSWORD: 'Senha do usuário do banco. Está no seu provedor de banco ou em "Databases".',
  JWT_SECRET: 'Uma frase secreta longa e aleatória (usada para assinar tokens). Podemos gerar uma para você.',
  API_KEY: 'Chave de API do serviço externo que o projeto usa. Veja no painel do provedor da API.',
  STRIPE_SECRET_KEY: 'Chave secreta do Stripe (dashboard.stripe.com → Developers → API keys).',
  OPENAI_API_KEY: 'Chave da OpenAI (platform.openai.com → API keys).',
  SMTP_PASSWORD: 'Senha do servidor de e-mail (no seu provedor de e-mail).',
  NODE_ENV: 'Ambiente de execução. Para publicação use "production".',
  PORT: 'Porta interna que a aplicação escuta. Normalmente já vem detectada.',
};
const isSecret = (k) => /(SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL)/i.test(k);
const hintFor = (k) => ENV_HINTS[k] || (isSecret(k) ? 'Valor sensível fornecido pelo provedor do serviço. Cole aqui; não será exibido.' : 'Valor de configuração usado pelo projeto.');

// Consulta vhosts do Nginx (rota local) usando o JWT do usuário.
async function checkDomainConflict(domain, token) {
  if (!domain) return { conflict: false };
  try {
    const res = await fetch(`${BASE_URL}/nginx/servers`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { conflict: false, checked: false };
    const data = await res.json();
    const servers = Array.isArray(data) ? data : (data.servers || []);
    const domains = new Set();
    servers.forEach((s) => {
      const primary = s.primary_domain || s.primaryDomain;
      if (primary) domains.add(String(primary).toLowerCase());
      const additional = s.additional_domains || s.additionalDomains || s.domains || s.serverNames || [];
      if (Array.isArray(additional)) additional.forEach((d) => domains.add(String(d).toLowerCase()));
      if (s.name) domains.add(String(s.name).toLowerCase());
    });
    const target = String(domain).toLowerCase();
    const conflict = domains.has(target);
    let suggestion = null;
    if (conflict) {
      const [host, ...rest] = target.split('.');
      suggestion = `${host}-app.${rest.join('.')}`;
    }
    return { conflict, checked: true, suggestion };
  } catch { return { conflict: false, checked: false }; }
}

// Monta os steps (perguntas) a partir da inspeção.
function buildSteps(inspection) {
  const steps = [];
  steps.push({ id: 'confirm_type', kind: 'confirm', title: `Detectei: ${inspection.label}`, prompt: `Vou publicar como ${inspection.label} (porta interna ${inspection.defaultPort}). Confirma?`, defaultValue: true });
  steps.push({ id: 'name', kind: 'text', title: 'Nome do serviço', prompt: 'Qual nome para o serviço? (só letras, números e hífen)', defaultValue: inspection.suggestedName });
  steps.push({ id: 'domain', kind: 'text', title: 'Domínio', prompt: 'Qual domínio deseja usar? (ex.: meusite.seudominio.com.br). Deixe em branco se ainda não tiver.', defaultValue: '', checkDomain: true });
  for (const key of inspection.envKeys) {
    steps.push({ id: `env:${key}`, kind: isSecret(key) ? 'secret' : 'text', title: `Configuração: ${key}`, prompt: `Informe o valor de ${key}.`, hint: hintFor(key), envKey: key, canGenerate: /JWT_SECRET|SECRET$/.test(key) });
  }
  steps.push({ id: 'review', kind: 'review', title: 'Revisão', prompt: 'Revise os dados e confirme a publicação.' });
  return steps;
}

// ── API pública do wizard ──
function start({ uploadId, inspection }) {
  gc();
  const id = crypto.randomUUID();
  const steps = buildSteps(inspection);
  WIZARDS.set(id, { id, uploadId, inspection, steps, answers: {}, cursor: 0, updatedAt: Date.now() });
  return { wizardId: id, inspection, step: steps[0], total: steps.length, index: 0 };
}

function get(id) { const w = WIZARDS.get(id); if (w) w.updatedAt = Date.now(); return w; }

async function answer({ wizardId, value, token }) {
  const w = get(wizardId);
  if (!w) return { error: 'Wizard expirado. Reinicie a publicação.' };
  const step = w.steps[w.cursor];
  if (!step) return { error: 'Nenhum passo ativo.' };

  // Validações específicas
  if (step.id === 'name') {
    const v = String(value || '').trim();
    if (!/^[a-z0-9-]{2,40}$/.test(v)) return { error: 'Nome inválido. Use 2-40 caracteres: letras minúsculas, números e hífen.', step, index: w.cursor };
    w.answers.name = v;
  } else if (step.id === 'domain') {
    const v = String(value || '').trim().toLowerCase();
    w.answers.domain = v;
    if (v) {
      const dc = await checkDomainConflict(v, token);
      if (dc.conflict) {
        return { warning: `O domínio "${v}" já está em uso no Nginx.`, suggestion: dc.suggestion, step, index: w.cursor, needsResolve: true };
      }
    }
  } else if (step.id === 'confirm_type') {
    if (value === false) return { error: 'Publicação cancelada pelo usuário.', cancelled: true };
    w.answers.confirmType = true;
  } else if (step.id.startsWith('env:')) {
    w.answers.env = w.answers.env || {};
    w.answers.env[step.envKey] = String(value ?? '');
  }

  w.cursor += 1; w.updatedAt = Date.now();
  const next = w.steps[w.cursor];
  if (!next) return { done: true, summary: summarize(w) };
  if (next.kind === 'review') return { step: next, index: w.cursor, total: w.steps.length, summary: summarize(w) };
  return { step: next, index: w.cursor, total: w.steps.length };
}

function summarize(w) {
  const env = w.answers.env || {};
  return {
    type: w.inspection.label,
    name: w.answers.name || w.inspection.suggestedName,
    domain: w.answers.domain || '(sem domínio)',
    port: w.inspection.defaultPort,
    // secrets mascarados no resumo
    env: Object.keys(env).map((k) => ({ key: k, value: isSecret(k) ? '••••••' : env[k] })),
  };
}

// Caminho do container onde o código é servido/executado, por template.
const CONTAINER_PATHS = {
  'nginx-static': '/usr/share/nginx/html',
  'node-app': '/usr/src/app',
  'nextjs-app': '/usr/src/app',
};
// Porta interna do container por template (igual aos SERVICE_TEMPLATES).
const CONTAINER_PORTS = { 'nginx-static': 80, 'node-app': 3000, 'nextjs-app': 3000 };

// Monta o payload de criação de serviço a partir das respostas.
// Espelha o fluxo da UI (DockerPanel.resolveSubmitVolumes): volume de projeto
// com hostPath EXPLÍCITO `${baseDir}/${name}` + createProject:false. O deploy
// (project-upload) remapeia esse volume primário para a pasta da versão.
function buildServicePayload(w, baseDir) {
  const env = w.answers.env || {};
  const envVars = Object.entries(env).map(([key, value]) => ({ key, value, secret: isSecret(key) }));
  const name = w.answers.name || w.inspection.suggestedName;
  const containerPath = CONTAINER_PATHS[w.inspection.templateId] || '/app';
  const containerPort = CONTAINER_PORTS[w.inspection.templateId] || null;
  const payload = {
    templateId: w.inspection.templateId,
    name,
    hostPort: null, // porta de host resolvida pelo backend de docker
    envVars,
    createProject: false,
    volumeMappings: [{ hostPath: baseDir ? `${baseDir}/${name}` : '', containerPath }],
    domain: w.answers.domain || null,
    __uploadId: w.uploadId,
    __detectedType: w.inspection.type,
  };
  if (containerPort) payload.containerPort = containerPort;
  return payload;
}

function generateSecret() { return crypto.randomBytes(24).toString('base64url'); }

module.exports = { inspectProject, start, get, answer, buildServicePayload, checkDomainConflict, generateSecret, summarize };
