'use strict';

const fs = require('fs');
const path = require('path');

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://177.104.174.71:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.sh', '.sql']);
const CONFIG_FILES = ['package.json', 'tsconfig.json', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.env.example', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'nest-cli.json', 'webpack.config.js', 'README.md', 'Makefile'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '__pycache__', '.turbo', '.nuxt']);
const MAX_FILE_SIZE = 30000;
const MAX_TOTAL_CHARS = 200000;
const MAX_INLINE_CHARS = 12000; // For direct chat without RAG

const indexedServices = new Map(); // serviceId -> { timestamp, fileCount }
const indexingInProgress = new Set(); // serviceIds currently being indexed

const INDEX_STATE_FILE = path.join(__dirname, '../../data/ai-index-state.json');

function loadIndexState() {
  try {
    if (fs.existsSync(INDEX_STATE_FILE)) return JSON.parse(fs.readFileSync(INDEX_STATE_FILE, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function saveIndexState(state) {
  try {
    const dir = path.dirname(INDEX_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(INDEX_STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

function collectProjectFiles(projectDir) {
  const files = [];
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const isConfig = CONFIG_FILES.includes(entry.name);
        if (SOURCE_EXTENSIONS.has(ext) || isConfig) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size < MAX_FILE_SIZE) {
              files.push({ rel: path.relative(projectDir, fullPath), fullPath, size: stat.size, isConfig });
            }
          } catch { /* skip */ }
        }
      }
    }
  };
  walk(projectDir);
  files.sort((a, b) => (b.isConfig - a.isConfig) || (a.size - b.size));
  return files;
}

function isIndexed(serviceId, projectDir) {
  const cached = indexedServices.get(serviceId);
  if (cached && (Date.now() - cached.timestamp) < 60 * 60 * 1000) return true;

  const state = loadIndexState();
  const entry = state[serviceId];
  if (entry && entry.projectDir === projectDir && entry.fileCount > 0) {
    indexedServices.set(serviceId, { timestamp: Date.now(), fileCount: entry.fileCount });
    return true;
  }
  return false;
}

async function indexProjectCode(serviceId, projectDir, { force = false } = {}) {
  if (!force && isIndexed(serviceId, projectDir)) {
    return { alreadyIndexed: true, fileCount: indexedServices.get(serviceId)?.fileCount || 0 };
  }

  // Check if files changed since last index
  if (!force) {
    const state = loadIndexState();
    const entry = state[serviceId];
    if (entry && entry.projectDir === projectDir) {
      const lastIndexed = new Date(entry.indexedAt).getTime();
      const files = collectProjectFiles(projectDir);
      const anyModified = files.some(f => {
        try { return fs.statSync(f.fullPath).mtimeMs > lastIndexed; } catch { return false; }
      });
      if (!anyModified) {
        indexedServices.set(serviceId, { timestamp: Date.now(), fileCount: entry.fileCount });
        return { alreadyIndexed: true, fileCount: entry.fileCount };
      }
    }
  }

  const files = collectProjectFiles(projectDir);
  if (!files.length) return { alreadyIndexed: false, fileCount: 0 };

  const collection = `project_${serviceId.split('-')[0]}`;
  const documents = [];
  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    try {
      let content = fs.readFileSync(file.fullPath, 'utf8');
      if (content.length + totalChars > MAX_TOTAL_CHARS) {
        content = content.slice(0, MAX_TOTAL_CHARS - totalChars);
      }
      documents.push({
        text: `// Arquivo: ${file.rel}\n${content}`,
        metadata: { source: `code:${file.rel}`, file: file.rel, type: file.isConfig ? 'config' : 'source', serviceId }
      });
      totalChars += content.length;
    } catch { /* skip */ }
  }

  if (!documents.length) return { alreadyIndexed: false, fileCount: 0 };

  const tree = files.map(f => f.rel).join('\n');
  documents.unshift({
    text: `Estrutura de arquivos do projeto:\n${tree}`,
    metadata: { source: 'file-tree', file: 'TREE', type: 'structure', serviceId }
  });

  // Delete old index
  try {
    await fetch(`${ZEUS_GATEWAY_URL}/api/index`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({ filter: { must: [{ key: 'serviceId', match: { value: serviceId } }] }, collection })
    });
  } catch { /* ignore */ }

  // Batch index
  const res = await fetch(`${ZEUS_GATEWAY_URL}/api/index/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({ documents, collection, chunkSize: 800, overlap: 100 })
  });

  if (!res.ok) throw new Error(`Indexação falhou: ${await res.text()}`);

  const result = await res.json();
  indexedServices.set(serviceId, { timestamp: Date.now(), fileCount: files.length });

  const state = loadIndexState();
  state[serviceId] = { projectDir, fileCount: files.length, chunks: result.chunks, indexedAt: new Date().toISOString() };
  saveIndexState(state);

  return { alreadyIndexed: false, fileCount: files.length, chunks: result.chunks };
}

/**
 * Start indexing in background (non-blocking). Returns immediately.
 */
function startBackgroundIndex(serviceId, projectDir) {
  if (indexingInProgress.has(serviceId)) return;
  indexingInProgress.add(serviceId);
  indexProjectCode(serviceId, projectDir, { force: true })
    .then(r => console.log(`[AI Index] Background indexed ${serviceId}: ${r.fileCount} files`))
    .catch(e => console.error(`[AI Index] Background index failed ${serviceId}:`, e.message))
    .finally(() => indexingInProgress.delete(serviceId));
}

/**
 * Read source code inline (for direct chat without RAG - fast path)
 */
function readInlineSource(projectDir) {
  const files = collectProjectFiles(projectDir);
  const parts = [];
  let total = 0;
  for (const file of files) {
    if (total >= MAX_INLINE_CHARS) break;
    try {
      let content = fs.readFileSync(file.fullPath, 'utf8');
      const remaining = MAX_INLINE_CHARS - total;
      if (content.length > remaining) content = content.slice(0, remaining) + '\n// ...truncated';
      parts.push(`--- ${file.rel} ---\n${content}`);
      total += content.length;
    } catch { /* skip */ }
  }
  return parts.join('\n\n');
}

const SYSTEM_PROMPT = `Você é um engenheiro sênior que acabou de ler TODO o código-fonte deste projeto. Responda como uma pessoa real que conhece o sistema profundamente.

REGRAS:
- Responda de forma natural, como um colega explicando o código
- Seja específico: cite nomes de arquivos, funções, variáveis, rotas
- Se perguntarem "o que esse sistema faz", dê uma visão geral clara e depois detalhe os componentes
- Se perguntarem sobre uma parte específica, vá direto ao ponto com exemplos do código
- NUNCA diga "não tenho acesso ao código" — você TEM o código no contexto
- NUNCA dê respostas genéricas tipo "é um sistema Node.js" — explique O QUE ele faz de verdade
- Use português brasileiro, informal mas técnico
- Se o contexto não tiver informação suficiente pra responder, diga exatamente o que falta`;

async function chatAboutProject(serviceId, message, history = [], projectDir = null, { gitCollection, serviceContext } = {}) {
  const collection = `project_${serviceId.split('-')[0]}`;
  const hasIndex = isIndexed(serviceId, projectDir);

  // If indexed → use RAG (fast, context from Qdrant)
  if (hasIndex || gitCollection) {
    const queryCollection = gitCollection || collection;
    const systemCtx = serviceContext ? `Contexto do serviço:\n${serviceContext}\n\n` : '';
    const res = await fetch(`${ZEUS_GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({
        message: systemCtx + message,
        collection: queryCollection,
        history: history.slice(-10),
        options: { large: true, topK: 12, num_ctx: 16384 }
      })
    });
    if (res.ok) {
      const data = await res.json();
      return { answer: data.answer, sources: data.sources, model: data.model, indexed: true };
    }
  }

  // Not indexed or RAG failed → direct chat with inline source code
  // Also start background indexing for next time
  if (projectDir && fs.existsSync(projectDir)) {
    startBackgroundIndex(serviceId, projectDir);
  }

  const sourceCode = projectDir ? readInlineSource(projectDir) : '';
  const systemCtx = serviceContext ? `Contexto do serviço:\n${serviceContext}\n\n` : '';
  const userContent = sourceCode
    ? `${systemCtx}Código-fonte do projeto:\n\n${sourceCode}\n\n---\n\nPergunta: ${message}`
    : `${systemCtx}Pergunta: ${message}`;

  const res = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-10),
        { role: 'user', content: userContent }
      ],
      options: { large: true, num_ctx: 16384 }
    })
  });

  if (!res.ok) throw new Error(`Chat falhou: ${await res.text()}`);
  const data = await res.json();
  return { answer: data.answer, sources: [], model: data.model, indexed: false, indexing: indexingInProgress.has(serviceId) };
}

function invalidateIndex(serviceId) {
  indexedServices.delete(serviceId);
  const state = loadIndexState();
  delete state[serviceId];
  saveIndexState(state);
}

function autoIndexAfterDeploy(serviceId, projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return;
  invalidateIndex(serviceId);
  startBackgroundIndex(serviceId, projectDir);
}

async function chatAboutProjectStream(serviceId, message, history = [], projectDir = null, onEvent, { gitCollection, serviceContext } = {}) {
  const collection = `project_${serviceId.split('-')[0]}`;
  const hasIndex = isIndexed(serviceId, projectDir);

  let streamUrl, streamBody;
  const systemCtx = serviceContext ? `Contexto do serviço:\n${serviceContext}\n\n` : '';

  if (hasIndex || gitCollection) {
    const queryCollection = gitCollection || collection;
    // Use RAG stream
    streamUrl = `${ZEUS_GATEWAY_URL}/api/chat/stream`;
    streamBody = {
      message: systemCtx + message,
      collection: queryCollection,
      history: history.slice(-10),
      options: { large: true, topK: 12, num_ctx: 16384 }
    };
  } else {
    // Direct stream with inline source
    if (projectDir && fs.existsSync(projectDir)) {
      startBackgroundIndex(serviceId, projectDir);
    }
    const sourceCode = projectDir ? readInlineSource(projectDir) : '';
    const userContent = sourceCode
      ? `${systemCtx}Código-fonte do projeto:\n\n${sourceCode}\n\n---\n\nPergunta: ${message}`
      : `${systemCtx}Pergunta: ${message}`;

    streamUrl = `${ZEUS_GATEWAY_URL}/api/chat/direct/stream`;
    streamBody = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-10),
        { role: 'user', content: userContent }
      ],
      options: { large: true, num_ctx: 16384 }
    };
  }

  const res = await fetch(streamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify(streamBody)
  });

  if (!res.ok) {
    const err = await res.text();
    onEvent({ type: 'error', error: err });
    return;
  }

  onEvent({ type: 'start', indexed: hasIndex });

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      try {
        const parsed = JSON.parse(data);
        await onEvent(parsed);
      } catch { /* skip */ }
    }
  }

  if (buffer.startsWith('data: ')) {
    try { await onEvent(JSON.parse(buffer.slice(6))); } catch { /* skip */ }
  }
}

module.exports = { indexProjectCode, chatAboutProject, chatAboutProjectStream, invalidateIndex, autoIndexAfterDeploy, isIndexed, startBackgroundIndex };
