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

// Track which services have been indexed (in-memory, resets on restart)
const indexedServices = new Map(); // serviceId -> { timestamp, fileCount }

// Persistent index state file
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
  // Config files first, then by size (smaller = more focused)
  files.sort((a, b) => (b.isConfig - a.isConfig) || (a.size - b.size));
  return files;
}

async function indexProjectCode(serviceId, projectDir, { force = false } = {}) {
  // Check if already indexed in this session (skip re-index unless forced)
  const cached = indexedServices.get(serviceId);
  if (!force && cached && (Date.now() - cached.timestamp) < 60 * 60 * 1000) {
    return { alreadyIndexed: true, fileCount: cached.fileCount };
  }

  // Check persistent state — skip if projectDir hasn't changed
  if (!force) {
    const state = loadIndexState();
    const entry = state[serviceId];
    if (entry && entry.projectDir === projectDir) {
      // Check if any file was modified since last index
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
        metadata: {
          source: `code:${file.rel}`,
          file: file.rel,
          type: file.isConfig ? 'config' : 'source',
          serviceId
        }
      });
      totalChars += content.length;
    } catch { /* skip */ }
  }

  if (!documents.length) return { alreadyIndexed: false, fileCount: 0 };

  // Also add file tree as a document
  const tree = files.map(f => f.rel).join('\n');
  documents.unshift({
    text: `Estrutura de arquivos do projeto:\n${tree}`,
    metadata: { source: 'file-tree', file: 'TREE', type: 'structure', serviceId }
  });

  // Delete old index and re-index
  try {
    await fetch(`${ZEUS_GATEWAY_URL}/api/index`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({
        filter: { must: [{ key: 'serviceId', match: { value: serviceId } }] },
        collection
      })
    });
  } catch { /* collection may not exist yet */ }

  // Batch index
  const res = await fetch(`${ZEUS_GATEWAY_URL}/api/index/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({ documents, collection, chunkSize: 800, overlap: 100 })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Indexação falhou: ${err}`);
  }

  const result = await res.json();
  indexedServices.set(serviceId, { timestamp: Date.now(), fileCount: files.length });

  // Persist index state
  const state = loadIndexState();
  state[serviceId] = { projectDir, fileCount: files.length, chunks: result.chunks, indexedAt: new Date().toISOString() };
  saveIndexState(state);

  return { alreadyIndexed: false, fileCount: files.length, chunks: result.chunks };
}

async function chatAboutProject(serviceId, message, history = []) {
  const collection = `project_${serviceId.split('-')[0]}`;

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

  const res = await fetch(`${ZEUS_GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({
      message,
      collection,
      history: history.slice(-10),
      options: { large: true, topK: 10, num_ctx: 16384 }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat falhou: ${err}`);
  }

  const data = await res.json();

  // Inject system prompt by re-calling with direct if RAG returned poor results
  if (!data.sources?.length || data.sources.every(s => s.score < 0.3)) {
    // Fallback: direct call with system prompt
    const directRes = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.slice(-10),
          { role: 'user', content: message }
        ],
        options: { large: true, num_ctx: 16384 }
      })
    });
    if (directRes.ok) {
      const directData = await directRes.json();
      return { answer: directData.answer, sources: [], model: directData.model, fallback: true };
    }
  }

  return { answer: data.answer, sources: data.sources, model: data.model };
}

function invalidateIndex(serviceId) {
  indexedServices.delete(serviceId);
  const state = loadIndexState();
  delete state[serviceId];
  saveIndexState(state);
}

/**
 * Auto-index after deploy success. Call this from deploy promotion logic.
 * Runs in background (non-blocking).
 */
function autoIndexAfterDeploy(serviceId, projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return;
  invalidateIndex(serviceId);
  indexProjectCode(serviceId, projectDir, { force: true }).then(result => {
    console.log(`[AI Index] Auto-indexed ${serviceId}: ${result.fileCount} files, ${result.chunks || 0} chunks`);
  }).catch(err => {
    console.error(`[AI Index] Auto-index failed for ${serviceId}:`, err.message);
  });
}

module.exports = { indexProjectCode, chatAboutProject, invalidateIndex, autoIndexAfterDeploy };
