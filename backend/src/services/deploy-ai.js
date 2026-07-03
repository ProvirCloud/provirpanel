'use strict';

const fs = require('fs');
const path = require('path');

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://177.104.174.71:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs']);
const CONFIG_FILES = ['package.json', 'tsconfig.json', 'Dockerfile', '.env.example', 'docker-compose.yml', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'nest-cli.json', '.eslintrc.json', 'webpack.config.js'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '__pycache__']);
const MAX_SOURCE_CHARS = 12000;

async function zeusChat(message) {
  const res = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      options: { large: true, num_ctx: 16384 }
    })
  });
  if (!res.ok) throw new Error(`Zeus AI respondeu com status ${res.status}`);
  const data = await res.json();
  return data.answer || data.response || '';
}

function collectSourceFiles(projectDir) {
  const files = [];
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(projectDir, fullPath);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            files.push({ rel, fullPath, size: stat.size });
          } catch (e) { /* skip */ }
        }
      }
    }
  };
  walk(projectDir);
  // Sort: smaller files first (more likely to be config/models), then by path
  files.sort((a, b) => a.size - b.size);
  return files;
}

function readSourceCode(projectDir) {
  const sourceFiles = collectSourceFiles(projectDir);
  const result = [];
  let totalChars = 0;

  for (const file of sourceFiles) {
    if (totalChars >= MAX_SOURCE_CHARS) break;
    try {
      let content = fs.readFileSync(file.fullPath, 'utf8');
      const remaining = MAX_SOURCE_CHARS - totalChars;
      if (content.length > remaining) {
        content = content.slice(0, remaining) + '\n// ... truncated';
      }
      result.push({ file: file.rel, content });
      totalChars += content.length;
    } catch (e) { /* skip */ }
  }

  return result;
}

function gatherServiceContext(service, projectDir) {
  const ctx = {
    name: service.name,
    image: service.image,
    templateId: service.templateId,
    command: service.command,
    hostPort: service.hostPort,
    containerPort: service.containerPort,
    nodeServiceMode: service.nodeServiceMode,
    healthcheck: service.healthcheck,
    envVars: (service.envVars || []).map(e => ({ key: e.key, value: e.secret ? '***' : e.value })),
    networkName: service.networkName,
    volumes: service.volumes
  };

  if (!projectDir || !fs.existsSync(projectDir)) return ctx;

  // File tree
  ctx.fileTree = [];
  try {
    const walk = (dir, depth = 0) => {
      if (depth > 3 || ctx.fileTree.length > 100) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const rel = path.relative(projectDir, path.join(dir, entry.name));
        if (entry.isDirectory()) {
          ctx.fileTree.push(rel + '/');
          walk(path.join(dir, entry.name), depth + 1);
        } else {
          ctx.fileTree.push(rel);
        }
      }
    };
    walk(projectDir);
  } catch (e) { /* ignore */ }

  // Config files
  ctx.configFiles = {};
  for (const name of CONFIG_FILES) {
    const fp = path.join(projectDir, name);
    if (fs.existsSync(fp)) {
      try { ctx.configFiles[name] = fs.readFileSync(fp, 'utf8').slice(0, 4000); } catch (e) { /* ignore */ }
    }
  }

  // ALL source code
  ctx.sourceCode = readSourceCode(projectDir);

  return ctx;
}

async function diagnoseDeploy({ service, deployment, logs, error, projectDir }) {
  const ctx = gatherServiceContext(service, projectDir);

  const sourceSection = (ctx.sourceCode || [])
    .map(f => `--- ${f.file} ---\n${f.content}`)
    .join('\n\n');

  const prompt = `Você é um engenheiro DevOps sênior especialista em Node.js/TypeScript. Analise este deploy que falhou.

## Serviço
Nome: ${ctx.name}
Imagem: ${ctx.image}
Comando: ${ctx.command || 'padrão da imagem'}
Porta: ${ctx.containerPort}
Healthcheck: ${JSON.stringify(ctx.healthcheck)}
ENV: ${JSON.stringify(ctx.envVars)}

## Arquivos do projeto
${ctx.fileTree?.join(', ') || 'não disponível'}

## Configurações
${Object.entries(ctx.configFiles || {}).map(([name, content]) => `--- ${name} ---\n${content}`).join('\n\n')}

## Código-fonte completo
${sourceSection || 'não disponível'}

## Erro do Deploy
${error || 'desconhecido'}

## Logs
${(logs || '').slice(-3000)}

## Instruções
Analise TODO o código-fonte acima. Entenda o que o projeto faz, identifique a causa raiz do erro.
Responda SOMENTE com JSON válido:
{
  "diagnosis": "explicação clara do problema",
  "rootCause": "causa raiz técnica",
  "fixable": true ou false,
  "confidence": 0.0 a 1.0,
  "actions": [
    {
      "type": "fix_command" | "fix_file" | "fix_env" | "fix_config",
      "description": "o que faz",
      "file": "caminho relativo",
      "command": "comando (se fix_command)",
      "content": "conteúdo completo do arquivo corrigido (se fix_file/fix_config)",
      "key": "env var name (se fix_env)",
      "value": "env var value (se fix_env)"
    }
  ],
  "explanation": "explicação simples para o usuário"
}`;

  const answer = await zeusChat(prompt);
  try {
    const jsonMatch = answer.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) { /* parse failed */ }
  return { diagnosis: answer.slice(0, 800), fixable: false, confidence: 0, actions: [] };
}

async function analyzeProject({ service, projectDir }) {
  const ctx = gatherServiceContext(service, projectDir);

  const sourceSection = (ctx.sourceCode || [])
    .map(f => `--- ${f.file} ---\n${f.content}`)
    .join('\n\n');

  const prompt = `Você é um engenheiro DevOps sênior. Analise este projeto completo.

## Serviço
Nome: ${ctx.name} | Imagem: ${ctx.image} | Porta: ${ctx.containerPort}
Comando: ${ctx.command || 'padrão'}
ENV: ${JSON.stringify(ctx.envVars)}

## Estrutura
${ctx.fileTree?.join(', ') || 'não disponível'}

## Configurações
${Object.entries(ctx.configFiles || {}).map(([name, content]) => `--- ${name} ---\n${content}`).join('\n\n')}

## Código-fonte
${sourceSection || 'não disponível'}

## Instruções
Leia todo o código. Entenda o que o projeto faz, suas dependências, rotas, models, etc.
Responda SOMENTE com JSON:
{
  "summary": "o que este projeto faz (2-3 frases)",
  "diagnosis": "avaliação da saúde e qualidade",
  "risks": ["risco1", "risco2"],
  "suggestions": ["sugestão1"],
  "misconfigurations": ["problema encontrado"],
  "confidence": 0.0 a 1.0
}`;

  const answer = await zeusChat(prompt);
  try {
    const jsonMatch = answer.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) { /* ignore */ }
  return { summary: '', diagnosis: answer.slice(0, 800), risks: [], suggestions: [], misconfigurations: [], confidence: 0 };
}

module.exports = { diagnoseDeploy, analyzeProject, zeusChat, gatherServiceContext };
