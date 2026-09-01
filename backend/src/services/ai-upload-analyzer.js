'use strict';

/**
 * AI Upload Analyzer (Fase 5)
 *
 * Analisa um arquivo recebido no chat e produz um objeto `analysis`:
 *   { summary, detection, suggestion, files? }
 * onde:
 *   - detection: o que o arquivo parece ser (ex.: sistema Next, estático, PDF de contrato).
 *   - suggestion: { action, reason } — ação recomendada:
 *       publish_system | save_storage | ask_destination | describe
 *
 * NUNCA extrai/executa conteúdo: para zip/tar apenas LISTA (unzip -l / tar -tf).
 * É defensivo e best-effort: falhas viram suggestion=ask_destination.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://localhost:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';

// Intenções suportadas (5.1). 'auto' = detectar pelo conteúdo.
const INTENTS = ['auto', 'create_service', 'documentation', 'training', 'analyze_logs', 'inspect', 'store', 'publish_site'];
const ACTIVE_INTENTS = new Set(['auto', 'create_service', 'documentation', 'training', 'analyze_logs', 'inspect', 'store']);
function isValidIntent(i) { return typeof i === 'string' && INTENTS.includes(i); }
function isActiveIntent(i) { return ACTIVE_INTENTS.has(i); }

// ── util: roda comando capturando stdout (sem shell, args em array) ──
function run(cmd, args, { timeoutMs = 15000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch {} resolve({ code: -1, out, err: 'timeout' }); } }, timeoutMs);
    child.stdout.on('data', (d) => { if (out.length < maxBuffer) out += d.toString(); });
    child.stderr.on('data', (d) => { if (err.length < maxBuffer) err += d.toString(); });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, out, err: e.message }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out, err }); } });
  });
}

function classifyKind(filename, mime) {
  const lower = (filename || '').toLowerCase();
  if (/\.(zip|tar|tar\.gz|tgz|jar)$/.test(lower)) return 'zip';
  if (lower.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower) || (mime || '').startsWith('image/')) return 'image';
  if (/\.(txt|md|json|ya?ml|csv|log|xml|env|sql|js|ts|jsx|tsx|py|sh|conf|ini)$/.test(lower) || (mime || '').startsWith('text/')) return 'text';
  return 'other';
}

// ── zip/tar: lista conteúdo e detecta sinais de "sistema publicável" ──
async function listArchive(tmpPath, filename) {
  const lower = (filename || '').toLowerCase();
  let names = [];
  if (lower.endsWith('.zip') || lower.endsWith('.jar')) {
    const r = await run('unzip', ['-Z1', tmpPath]);
    if (r.code === 0) names = r.out.split('\n').filter(Boolean);
    else { const r2 = await run('unzip', ['-l', tmpPath]); names = r2.out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter(Boolean); }
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const r = await run('tar', ['-tzf', tmpPath]); names = r.out.split('\n').filter(Boolean);
  } else if (lower.endsWith('.tar')) {
    const r = await run('tar', ['-tf', tmpPath]); names = r.out.split('\n').filter(Boolean);
  }
  return names;
}

function detectSystem(names) {
  // normaliza: ignora prefixo de pasta raiz única
  const base = names.map((n) => n.replace(/^[^/]+\//, '')); // remove 1º nível
  const all = new Set([...names, ...base].map((n) => n.toLowerCase()));
  const has = (re) => [...all].some((n) => re.test(n));

  const hasPkg = has(/(^|\/)package\.json$/);
  const hasNext = has(/(^|\/)next\.config\.(js|mjs|ts)$/) || has(/(^|\/)\.next\//);
  const hasIndexHtml = has(/(^|\/)index\.html$/);
  const hasDockerfile = has(/(^|\/)dockerfile$/);
  const hasCompose = has(/(^|\/)docker-compose\.ya?ml$/);
  const hasWordpress = has(/(^|\/)wp-config\.php$/) || has(/(^|\/)wp-content\//);

  if (hasNext) return { type: 'next', publishable: true, label: 'Aplicação Next.js' };
  if (hasPkg) return { type: 'node', publishable: true, label: 'Projeto Node.js' };
  if (hasDockerfile || hasCompose) return { type: 'docker', publishable: true, label: 'Projeto com Docker' };
  if (hasWordpress) return { type: 'wordpress', publishable: true, label: 'Site WordPress' };
  if (hasIndexHtml) return { type: 'static', publishable: true, label: 'Site estático (index.html)' };
  return { type: 'unknown', publishable: false, label: 'Conteúdo genérico' };
}

// ── pdf: extração leve de texto (sem lib). Procura blocos de texto entre BT..ET. ──
function extractPdfTextLight(buf) {
  try {
    const s = buf.toString('latin1');
    const chunks = [];
    // Captura strings entre parênteses dentro de operadores de texto Tj/TJ.
    const re = /\(((?:\\.|[^()\\])*)\)\s*T[jJ]/g;
    let m; let n = 0;
    while ((m = re.exec(s)) && n < 4000) {
      const t = m[1].replace(/\\(?![\\()])/g, '').replace(/\\([\\()])/g, '$1');
      if (t.trim()) { chunks.push(t); n++; }
    }
    return chunks.join(' ').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

async function summarizeText(text, hint) {
  const clipped = text.slice(0, 8000);
  try {
    const res = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Resuma em português, em 1-3 frases, o conteúdo a seguir e diga que tipo de documento parece ser. Seja factual.' },
          { role: 'user', content: `${hint ? `[${hint}]\n` : ''}${clipped}` },
        ],
        options: { large: false },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data.content || data.message?.content || data.text || '').trim();
  } catch { return ''; }
}

function readTextSafe(tmpPath, max = 200000) {
  try { return fs.readFileSync(tmpPath, 'utf8').slice(0, max); } catch { return ''; }
}

// Análise de logs: conta níveis, extrai amostras de erro, resume.
async function analyzeLogsText(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const errRe = /\b(error|erro|exception|fatal|panic|traceback|failed|falhou)\b/i;
  const warnRe = /\b(warn|warning|aviso)\b/i;
  const errors = lines.filter((l) => errRe.test(l));
  const warns = lines.filter((l) => warnRe.test(l));
  const samples = errors.slice(0, 8);
  let summary = `Log com ${lines.length} linhas: ${errors.length} erro(s), ${warns.length} aviso(s).`;
  const llm = await summarizeText(
    `${summary}\nAmostras de erro:\n${samples.join('\n')}`,
    'LOG — diga a provável causa raiz e uma recomendação curta'
  );
  if (llm) summary = llm;
  return {
    summary,
    detection: { type: 'logs', publishable: false, lines: lines.length, errors: errors.length, warnings: warns.length },
    files: samples,
    suggestion: errors.length
      ? { action: 'describe', reason: `Encontrei ${errors.length} erro(s). Veja as amostras; quer que eu detalhe alguma ou salve o log?` }
      : { action: 'describe', reason: 'Não encontrei erros evidentes. Quer que eu salve o log ou procure algo específico?' },
  };
}

/**
 * Analisa o upload e retorna { kind, analysis }.
 * `intent` (5.1) guia a análise; 'auto' cai na detecção por conteúdo.
 */
async function analyze({ tmpPath, filename, mime, intent }) {
  const kind = classifyKind(filename, mime);

  // ── Intenção declarada (5.1) tem precedência sobre a detecção automática ──
  const wanted = isValidIntent(intent) ? intent : 'auto';

  if (wanted === 'analyze_logs') {
    const text = readTextSafe(tmpPath);
    if (!text) return { kind, analysis: { summary: 'Não consegui ler o arquivo como texto de log.', detection: { type: 'logs', publishable: false }, suggestion: { action: 'ask_destination', reason: 'Arquivo não parece texto. Quer salvar assim mesmo?' } } };
    return { kind, analysis: { ...(await analyzeLogsText(text)), intent: wanted } };
  }

  if (wanted === 'create_service') {
    if (kind !== 'zip') {
      return { kind, analysis: { intent: wanted, summary: 'Para criar um serviço, envie um pacote (.zip/.tar) com o sistema.', detection: { type: kind, publishable: false }, suggestion: { action: 'ask_destination', reason: 'Este arquivo não é um pacote de sistema. Quer apenas guardá-lo?' } } };
    }
    const names = await listArchive(tmpPath, filename);
    const detection = detectSystem(names);
    if (detection.publishable) {
      return { kind, analysis: { intent: wanted, summary: `${detection.label} detectado (${names.length} arquivos). Pronto para publicar.`, detection, files: names.slice(0, 30), suggestion: { action: 'publish_system', reason: `Confirmo a publicação como serviço?` } } };
    }
    return { kind, analysis: { intent: wanted, summary: `Pacote com ${names.length} arquivos, mas não identifiquei um sistema publicável.`, detection, files: names.slice(0, 30), suggestion: { action: 'ask_destination', reason: 'Não parece um sistema. Quer guardar o arquivo ou revisar o conteúdo?' } } };
  }

  if (wanted === 'documentation' || wanted === 'training') {
    let text = '';
    if (kind === 'text') text = readTextSafe(tmpPath, 20000);
    else if (kind === 'pdf') { try { text = extractPdfTextLight(fs.readFileSync(tmpPath)); } catch {} }
    const summary = (text && await summarizeText(text, wanted === 'training' ? 'material de treino' : 'documentação')) ||
      `Arquivo recebido para ${wanted === 'training' ? 'treinamento' : 'documentação'}.`;
    return { kind, analysis: {
      intent: wanted, summary,
      detection: { type: kind, publishable: false, training: wanted === 'training' },
      suggestion: { action: 'index_kb', reason: `Posso preparar para indexar no conhecimento (${wanted === 'training' ? 'treino do agente' : 'documentação'}), ou salvar na pasta local.` },
    } };
  }

  if (wanted === 'inspect') {
    if (kind === 'zip') {
      const names = await listArchive(tmpPath, filename);
      const detection = detectSystem(names);
      return { kind, analysis: { intent: wanted, summary: `${detection.label} (${names.length} arquivos).`, detection, files: names.slice(0, 30), suggestion: { action: 'describe', reason: 'Inspeção do pacote concluída. Quer que eu detalhe algo, publique ou guarde?' } } };
    }
    let text = kind === 'pdf' ? (() => { try { return extractPdfTextLight(fs.readFileSync(tmpPath)); } catch { return ''; } })() : readTextSafe(tmpPath, 12000);
    const summary = (text && await summarizeText(text, 'inspeção: o que é, riscos, observações')) || 'Arquivo inspecionado.';
    return { kind, analysis: { intent: wanted, summary, detection: { type: kind, publishable: false }, suggestion: { action: 'describe', reason: 'Inspeção concluída. Quer guardar o arquivo?' } } };
  }

  if (wanted === 'store') {
    return { kind, analysis: { intent: wanted, summary: `Arquivo pronto para guardar (${kind}).`, detection: { type: kind, publishable: false }, suggestion: { action: 'ask_destination', reason: 'Onde deseja salvar: pasta local ou um storage configurado?' } } };
  }

  // ── 'auto' e 'publish_site' (em breve) caem na detecção por conteúdo ──
  if (kind === 'zip') {
    const names = await listArchive(tmpPath, filename);
    if (!names.length) {
      return { kind, analysis: { summary: 'Arquivo compactado, mas não foi possível listar o conteúdo.', detection: { type: 'unknown', publishable: false }, suggestion: { action: 'ask_destination', reason: 'Não consegui inspecionar o pacote.' } } };
    }
    const detection = detectSystem(names);
    const preview = names.slice(0, 30);
    if (detection.publishable) {
      return { kind, analysis: {
        summary: `${detection.label} detectado (${names.length} arquivos).`,
        detection, files: preview,
        suggestion: { action: 'publish_system', reason: `Parece um ${detection.label}. Posso iniciar a publicação como serviço.` },
      } };
    }
    return { kind, analysis: {
      summary: `Pacote com ${names.length} arquivos, sem sinais claros de sistema publicável.`,
      detection, files: preview,
      suggestion: { action: 'ask_destination', reason: 'Não identifiquei um sistema publicável. Onde deseja salvar?' },
    } };
  }

  if (kind === 'pdf') {
    let text = '';
    try { text = extractPdfTextLight(fs.readFileSync(tmpPath)); } catch {}
    if (text && text.length > 40) {
      const summary = await summarizeText(text, 'PDF') || `PDF com ~${text.length} caracteres de texto.`;
      return { kind, analysis: {
        summary,
        detection: { type: 'pdf', publishable: false, chars: text.length },
        suggestion: { action: 'ask_destination', reason: 'Li o PDF. Se não houver uma ação clara no seu pedido, me diga se salvo num storage configurado ou na pasta local.' },
      } };
    }
    return { kind, analysis: {
      summary: 'PDF recebido, mas não consegui extrair texto legível (pode ser digitalizado/imagem).',
      detection: { type: 'pdf', publishable: false, chars: (text || '').length },
      suggestion: { action: 'ask_destination', reason: 'Não entendi o conteúdo. Salvo num storage configurado ou na pasta local?' },
    } };
  }

  if (kind === 'image') {
    let info = '';
    const r = await run('file', ['-b', tmpPath]);
    if (r.code === 0) info = r.out.trim();
    return { kind, analysis: {
      summary: `Imagem recebida${info ? ` (${info.slice(0, 80)})` : ''}.`,
      detection: { type: 'image', publishable: false, info },
      suggestion: { action: 'ask_destination', reason: 'Onde deseja guardar a imagem: storage configurado ou pasta local?' },
    } };
  }

  if (kind === 'text') {
    let text = '';
    try { text = fs.readFileSync(tmpPath, 'utf8').slice(0, 12000); } catch {}
    const summary = (text && await summarizeText(text, path.extname(filename || ''))) || 'Arquivo de texto recebido.';
    return { kind, analysis: {
      summary,
      detection: { type: 'text', publishable: false },
      suggestion: { action: 'ask_destination', reason: 'Posso salvar num storage configurado ou na pasta local — qual prefere?' },
    } };
  }

  return { kind: 'other', analysis: {
    summary: 'Arquivo recebido.',
    detection: { type: 'other', publishable: false },
    suggestion: { action: 'ask_destination', reason: 'Não reconheci o tipo. Salvo num storage configurado ou na pasta local?' },
  } };
}

/**
 * Extrai texto de um arquivo para indexação (pdf leve / texto / lista de zip).
 * Retorna string (possivelmente vazia).
 */
function extractTextForIndex({ tmpPath, filename, mime }) {
  const kind = classifyKind(filename, mime);
  if (kind === 'text') return readTextSafe(tmpPath, 200000);
  if (kind === 'pdf') { try { return extractPdfTextLight(fs.readFileSync(tmpPath)); } catch { return ''; } }
  return '';
}

module.exports = { analyze, classifyKind, INTENTS, isValidIntent, isActiveIntent, extractTextForIndex };
