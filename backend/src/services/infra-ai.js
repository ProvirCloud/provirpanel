'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { zeusChat, gatherServiceContext } = require('./deploy-ai');

// ─── Context Gathering ───────────────────────────────────────────────────────

function getContainerInspect(containerName) {
  try {
    const raw = execSync(`docker inspect ${containerName} 2>/dev/null`, { encoding: 'utf8', timeout: 8000 });
    const parsed = JSON.parse(raw);
    if (!parsed[0]) return null;
    const c = parsed[0];
    return {
      status: c.State?.Status,
      running: c.State?.Running,
      cmd: c.Config?.Cmd,
      entrypoint: c.Config?.Entrypoint,
      env: c.Config?.Env,
      exposedPorts: Object.keys(c.Config?.ExposedPorts || {}),
      image: c.Config?.Image,
      workingDir: c.Config?.WorkingDir,
      mounts: (c.Mounts || []).map(m => ({ source: m.Source, destination: m.Destination, rw: m.RW })),
      networkMode: c.HostConfig?.NetworkMode,
      restartPolicy: c.HostConfig?.RestartPolicy,
      created: c.Created,
      startedAt: c.State?.StartedAt
    };
  } catch { return null; }
}

function getContainerLogs(containerName, lines = 30) {
  try {
    return execSync(`docker logs --tail ${lines} ${containerName} 2>&1`, { encoding: 'utf8', timeout: 5000 });
  } catch { return ''; }
}

function getNginxConfigForService(service) {
  const possibleNames = [
    service.externalUrl,
    service.url,
    service.name
  ].filter(Boolean);

  const searchDirs = ['/etc/nginx/sites-available', '/etc/nginx/sites-enabled', '/etc/nginx/conf.d'];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        // Match by port or service name in proxy_pass or upstream
        if (content.includes(`:${service.hostPort}`) || content.includes(`server_name`) && possibleNames.some(n => content.includes(n.replace(/https?:\/\//, '')))) {
          return { file: path.join(dir, file), content };
        }
      }
    } catch { /* skip */ }
  }
  return null;
}

function getProjectFiles(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return {};
  const result = {};
  const important = ['package.json', 'tsconfig.json', 'Dockerfile', '.env.example', '.env', 'docker-compose.yml', 'ecosystem.config.js', 'Procfile', 'nest-cli.json', 'next.config.js', 'vite.config.ts', 'vite.config.js'];
  for (const name of important) {
    const fp = path.join(projectDir, name);
    if (fs.existsSync(fp)) {
      try { result[name] = fs.readFileSync(fp, 'utf8').slice(0, 4000); } catch { /* skip */ }
    }
  }
  return result;
}

function getActiveProjectDir(service) {
  const deployments = Array.isArray(service.deployments) ? service.deployments : [];
  const active = deployments.find(d => d.status === 'active') || deployments.find(d => d.id === service.activeDeploymentId);
  if (active?.projectDir) return active.projectDir;
  const vol = (service.volumes || [])[0];
  return vol?.hostPath || null;
}

/**
 * Collects EVERYTHING about a service: container state, nginx, code, env, etc.
 */
function collectFullContext(service) {
  const containerName = service.containerName || service.name;
  const projectDir = getActiveProjectDir(service);
  const container = getContainerInspect(containerName);
  const logs = getContainerLogs(containerName, 20);
  const nginx = getNginxConfigForService(service);
  const files = getProjectFiles(projectDir);

  return {
    service: {
      id: service.id,
      name: service.name,
      image: service.image,
      command: service.command,
      hostPort: service.hostPort,
      containerPort: service.containerPort,
      healthcheck: service.healthcheck,
      envVars: (service.envVars || []).map(e => ({ key: e.key, hasValue: !!e.value })),
      networkName: service.networkName,
      templateId: service.templateId,
      url: service.url,
      externalUrl: service.externalUrl,
      activeDeploymentId: service.activeDeploymentId,
      delivery: service.delivery ? { deployMode: service.delivery.deployMode, repository: service.delivery.repository, branch: service.delivery.branch } : null
    },
    container,
    // HIGHLIGHT: This is the REAL command running in Docker - the source of truth
    realDockerCommand: container?.cmd || null,
    realDockerEntrypoint: container?.entrypoint || null,
    recentLogs: logs,
    nginx,
    projectDir,
    projectFiles: files
  };
}

// ─── AI Functions ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é a Zeus AI. Você RESOLVE problemas de deploy. Nunca dá dicas.

## REGRA ABSOLUTA:
- O campo "container.cmd" do Docker inspect é a VERDADE ABSOLUTA do que o container roda.
- NUNCA invente comandos. Se o container roda "node cluster.js", o command é "node cluster.js".
- NUNCA mude o command para algo que você não viu funcionando no container real.
- NUNCA substitua package.json, package-lock.json, yarn.lock.

## Como o ProvirPanel funciona:
- Serviço = container Docker (imagem + command + porta + volumes + envs)
- Deploy: source code → nova pasta → container candidato → healthcheck → promove ou rollback
- O command do serviço roda DENTRO do container após o código ser montado como volume
- Se o projeto precisa de npm install, o command deve incluir "npm install && ..."
- Se NÃO precisa de build (sem TypeScript, sem compilação), NÃO inclua build no command

## Quando analisar um serviço:
1. OLHE o container.cmd (Docker inspect) - esse é o comando que FUNCIONA
2. OLHE o package.json scripts - veja quais scripts EXISTEM
3. SÓ sugira mudanças se algo está CLARAMENTE errado
4. Se o deploy falhou com "command not found" ou "script missing", corrija para o que EXISTE

## Regras:
- Retorne JSON válido quando solicitado
- Seja direto: diagnóstico + fix concreto
- Se não sabe o que fazer, diga "não sei" em vez de inventar`;

/**
 * Pre-deploy validation: checks if the service is correctly configured to deploy.
 * Also analyzes last failed deployment to proactively suggest fixes.
 */
async function validatePreDeploy(service) {
  const ctx = collectFullContext(service);

  // Check last failed deployment for build errors
  const deployments = Array.isArray(service.deployments) ? service.deployments : [];
  const lastFailed = deployments.filter(d => d.status === 'failed').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  let lastFailedInfo = '';
  if (lastFailed) {
    const log = (lastFailed.deployLog || lastFailed.progressLog || []).slice(-15);
    const logText = log.map(e => typeof e === 'object' ? e.message : String(e)).join('\n');
    lastFailedInfo = `\n## Último Deploy FALHO\nErro: ${lastFailed.error || 'desconhecido'}\nLogs:\n${logText}`;
  }

  // Check if tsconfig has skipLibCheck (proactive check)
  let tsconfigInfo = '';
  if (ctx.projectFiles?.['tsconfig.json']) {
    try {
      const tsconfig = JSON.parse(ctx.projectFiles['tsconfig.json']);
      if (!tsconfig.compilerOptions?.skipLibCheck) {
        tsconfigInfo = '\n⚠️ tsconfig.json NÃO tem skipLibCheck: true. Isso pode causar erros de tipo em dependências.';
      }
    } catch { /* invalid json */ }
  }

  const prompt = `${SYSTEM_PROMPT}

## Tarefa: Validação Pré-Deploy
Analise este serviço e diga se está pronto para receber um deploy. Identifique problemas que causariam falha.
${lastFailedInfo}
${tsconfigInfo}

## Contexto Completo
${JSON.stringify(ctx, null, 2).slice(0, 12000)}

## Responda com JSON:
{
  "ready": true/false,
  "issues": [
    { "severity": "critical|warning|info", "message": "descrição", "fix": { "type": "command|env|healthcheck|nginx|tsconfig", "action": "o que fazer" } }
  ],
  "autoFixes": [
    { "type": "command|env|healthcheck|tsconfig", "field": "campo a alterar", "oldValue": "valor atual", "newValue": "valor correto", "reason": "motivo", "file": "arquivo (se tsconfig)", "content": "conteúdo completo do arquivo (se tsconfig)" }
  ],
  "summary": "resumo em 1 frase"
}

IMPORTANTE:
- Se o container ativo está rodando com um command diferente do configurado no serviço, NÃO bloqueie o deploy. Em vez disso, adicione um autoFix do tipo "command" com o valor correto (o que está rodando no container). Isso é uma correção automática, NÃO um bloqueio.
- Se o último deploy falhou com erros de TypeScript e o tsconfig NÃO tem skipLibCheck, adicione um autoFix do tipo "tsconfig" com o conteúdo corrigido.
- Se o command precisa de "npm run build" mas o build falha, sugira trocar por "npx tsc --skipLibCheck" no autoFix de command.
- Priorize fixes que resolvam o problema do último deploy falho.
- Só marque "ready": false se houver problemas que NÃO podem ser resolvidos por autoFix (ex: porta em uso por outro serviço, imagem inexistente).`;

  const answer = await zeusChat(prompt);
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* parse failed */ }
  return { ready: false, issues: [{ severity: 'critical', message: 'AI não conseguiu analisar', fix: null }], autoFixes: [], summary: answer.slice(0, 200) };
}

/**
 * Smart Blueprint: analyzes the running container and generates the correct CI/CD config
 */
async function generateSmartBlueprint(service) {
  const ctx = collectFullContext(service);

  const prompt = `${SYSTEM_PROMPT}

## Tarefa: Gerar Blueprint Inteligente para CI/CD
Analise como este serviço REALMENTE funciona (container ativo, nginx, código) e gere o blueprint correto.

## Contexto Completo
${JSON.stringify(ctx, null, 2).slice(0, 12000)}

## O workflow do CI/CD faz:
1. Checkout do código no GitHub
2. Empacota os arquivos necessários num .tgz
3. Envia para o ProvirPanel via API
4. ProvirPanel extrai, cria container candidato, faz healthcheck, promove

## Responda com JSON:
{
  "blueprint": {
    "buildType": "node-service|node-site|java-jar",
    "needsBuildInCI": false,
    "installCommand": "npm ci",
    "buildCommand": "",
    "startCommand": "comando completo que o container deve executar",
    "artifactPath": ".",
    "containerPort": 3000,
    "packageManager": "npm|yarn|pnpm",
    "nodeServiceMode": "service|sites",
    "healthcheck": { "enabled": true, "target": "/health", "intervalSeconds": 10, "timeoutSeconds": 5, "retries": 6, "startPeriodSeconds": 5 }
  },
  "serviceUpdates": {
    "command": "comando correto se precisa mudar (null se ok)",
    "containerPort": null,
    "healthcheck": null
  },
  "explanation": "explicação clara do que foi configurado e por quê",
  "warnings": ["avisos importantes para o usuário"]
}

REGRAS:
- Se o container ativo usa "npm install && npm run build && npm run prod", o startCommand e o command do serviço DEVEM ser iguais
- needsBuildInCI=false para node-service (o container faz o build)
- artifactPath="." para enviar source completo
- O healthcheck deve bater com as rotas reais da aplicação`;

  const answer = await zeusChat(prompt);
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* parse failed */ }
  return null;
}

/**
 * Full infrastructure analysis with recommendations
 */
async function analyzeInfrastructure(service) {
  const ctx = collectFullContext(service);

  const prompt = `${SYSTEM_PROMPT}

## Tarefa: Análise Completa de Infraestrutura
Analise TUDO sobre este serviço e dê recomendações de melhoria.

## Contexto Completo
${JSON.stringify(ctx, null, 2).slice(0, 12000)}

## Responda com JSON:
{
  "status": "healthy|degraded|misconfigured|critical",
  "score": 0-100,
  "findings": [
    { "category": "security|performance|reliability|configuration", "severity": "critical|high|medium|low", "title": "título curto", "description": "descrição", "recommendation": "o que fazer" }
  ],
  "quickFixes": [
    { "type": "command|env|healthcheck|nginx", "description": "o que faz", "field": "campo", "value": "novo valor" }
  ],
  "summary": "resumo geral da saúde do serviço"
}`;

  const answer = await zeusChat(prompt);
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* parse failed */ }
  return { status: 'unknown', score: 0, findings: [], quickFixes: [], summary: answer.slice(0, 300) };
}

/**
 * Deep project analysis: detects infrastructure dependencies (Redis, Postgres, etc),
 * checks configuration, and suggests services to create for the project to run correctly.
 */
async function analyzeProjectDependencies(service, allServices) {
  const ctx = collectFullContext(service);
  const existingServices = (allServices || []).map(s => ({
    id: s.id, name: s.name, image: s.image, hostPort: s.hostPort,
    containerPort: s.containerPort, networkName: s.networkName,
    envVars: (s.envVars || []).map(e => ({ key: e.key, hasValue: !!e.value }))
  }));

  const prompt = `${SYSTEM_PROMPT}

## Tarefa: Análise Profunda + Ações Executáveis
Você é responsável por fazer este projeto RODAR. Não dê dicas. Retorne AÇÕES CONCRETAS que o sistema vai executar automaticamente.

Analise o código-fonte, package.json, docker-compose.yml, .env.example e identifique TUDO que precisa ser feito.

## Contexto do Projeto
${JSON.stringify(ctx, null, 2).slice(0, 10000)}

## Serviços já existentes no painel
${JSON.stringify(existingServices, null, 2).slice(0, 4000)}

## Responda com JSON:
{
  "projectType": "node|java|python|go|php|static",
  "summary": "resumo do que o projeto faz (1-2 frases)",
  "canRun": true/false,
  "actions": [
    {
      "type": "create_service|update_env|update_command|update_healthcheck|fix_config|connect_network",
      "priority": 1,
      "title": "título curto da ação",
      "description": "o que vai ser feito",
      "autoApply": true/false,
      "config": {
        // Para create_service:
        "serviceName": "nome-do-servico",
        "image": "redis:7-alpine",
        "containerPort": 6379,
        "networkName": "mesma-rede-do-projeto",
        "envVars": [{"key": "REDIS_PASSWORD", "value": "secret"}],
        // Para update_env (no serviço principal):
        "key": "REDIS_URL",
        "value": "redis://nome-do-servico:6379",
        // Para update_command:
        "command": "novo comando",
        // Para update_healthcheck:
        "target": "/health",
        "intervalSeconds": 10,
        // Para fix_config (push to GitHub):
        "file": "tsconfig.json",
        "content": "conteúdo completo"
      }
    }
  ]
}

## REGRAS CRÍTICAS:
- NUNCA diga "certifique-se", "considere", "verifique". Você RESOLVE.
- Se o projeto precisa de Redis/Postgres/MongoDB: retorne action "create_service" com a config completa.
- Se uma env está errada ou faltando: retorne action "update_env" com o valor correto.
- Se o command está errado: retorne action "update_command".
- Se o healthcheck aponta pra rota que não existe: retorne action "update_healthcheck" com target correto (ex: "/" ou "/api" ou desabilite).
- Se o tsconfig precisa de skipLibCheck: retorne action "fix_config".
- "autoApply": true = o sistema aplica sem perguntar. Use para fixes simples (env, command, healthcheck).
- "autoApply": false = o sistema pergunta ao usuário antes. Use para criação de serviços novos.
- Ordene por priority (1 = mais urgente).
- O objetivo é que o projeto RODE. Nada de sugestões vagas.`;

  const answer = await zeusChat(prompt);
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* parse failed */ }
  return { projectType: 'unknown', summary: answer.slice(0, 300), canRun: false, actions: [] };
}

/**
 * Apply auto-fixes suggested by the AI to the service
 */
function applyAutoFixes(service, fixes, dockerManager) {
  if (!fixes || !fixes.length) return { applied: [], service };
  const applied = [];
  let updated = { ...service };

  // Get real Docker command as safety reference
  const containerInspect = getContainerInspect(service.containerName || service.name);
  const realCmd = containerInspect?.cmd ? (Array.isArray(containerInspect.cmd) ? containerInspect.cmd.join(' ') : containerInspect.cmd) : null;

  for (const fix of fixes) {
    try {
      if (fix.type === 'command' && fix.newValue) {
        // SAFETY: reject obviously wrong commands (generic AI inventions)
        const suspicious = ['npm run build && npm run prod', 'npm run build && npm start', 'tsc &&'];
        if (suspicious.some(s => fix.newValue.includes(s)) && realCmd && !realCmd.includes('build')) {
          applied.push({ ...fix, success: false, error: `Rejeitado: container real roda "${realCmd}", n\u00e3o precisa de build` });
          continue;
        }
        updated.command = fix.newValue;
        applied.push({ ...fix, success: true });
      } else if (fix.type === 'env' && fix.field && fix.newValue !== undefined) {
        const envVars = [...(updated.envVars || [])];
        const existing = envVars.findIndex(e => e.key === fix.field);
        if (existing >= 0) envVars[existing] = { ...envVars[existing], value: fix.newValue };
        else envVars.push({ key: fix.field, value: fix.newValue, secret: false });
        updated.envVars = envVars;
        applied.push({ ...fix, success: true });
      } else if (fix.type === 'healthcheck' && fix.newValue) {
        updated.healthcheck = typeof fix.newValue === 'string' ? JSON.parse(fix.newValue) : fix.newValue;
        applied.push({ ...fix, success: true });
      } else if (fix.type === 'containerPort' && fix.newValue) {
        updated.containerPort = Number(fix.newValue);
        applied.push({ ...fix, success: true });
      } else if (fix.type === 'tsconfig' && fix.newValue) {
        // Push tsconfig fix to GitHub repo
        applied.push({ ...fix, success: true, requiresGitPush: true });
      }
    } catch (e) {
      applied.push({ ...fix, success: false, error: e.message });
    }
  }

  if (applied.some(a => a.success && !a.requiresGitPush)) {
    updated.updatedAt = new Date().toISOString();
    dockerManager.saveService(updated);
  }

  return { applied, service: updated };
}

/**
 * Push config fixes to GitHub repository (tsconfig.json, etc)
 */
async function pushConfigFixToGitHub(service, fixes) {
  const GitHubDeliveryManager = require('./GitHubDeliveryManager');
  const ghManager = new GitHubDeliveryManager();
  const delivery = service.delivery;
  if (!delivery?.connectionId || !delivery?.repository) return { pushed: 0 };

  const connection = ghManager.getConnection(delivery.connectionId);
  const [owner, repo] = delivery.repository.split('/');
  const branch = delivery.branch || 'main';
  let pushed = 0;

  for (const fix of fixes) {
    if (!fix.requiresGitPush || !fix.file || !fix.content) continue;
    const filePath = delivery.projectPath && delivery.projectPath !== '.' ? `${delivery.projectPath}/${fix.file}` : fix.file;

    let sha = null;
    try {
      const existing = await ghManager.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`);
      sha = existing.data?.sha;
    } catch { /* file may not exist */ }

    await ghManager.githubRequest(connection, 'PUT', `/repos/${owner}/${repo}/contents/${filePath}`, {
      data: {
        message: `fix(auto): ${fix.reason || fix.file} [Zeus AI]`,
        content: Buffer.from(fix.content).toString('base64'),
        branch,
        ...(sha ? { sha } : {})
      }
    });
    pushed++;
  }
  return { pushed };
}

module.exports = {
  collectFullContext,
  validatePreDeploy,
  generateSmartBlueprint,
  analyzeInfrastructure,
  analyzeProjectDependencies,
  applyAutoFixes,
  pushConfigFixToGitHub,
  getContainerInspect,
  getNginxConfigForService,
  getActiveProjectDir
};
