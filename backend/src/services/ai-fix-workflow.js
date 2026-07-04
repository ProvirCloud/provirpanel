'use strict';

const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { diagnoseDeploy, zeusChat } = require('./deploy-ai');

const aiFixJobs = new Map();

function execAsync(command, cwd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout || '';
        error.stderr = stderr || '';
        return reject(error);
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function createAiFixJob(serviceId) {
  const jobId = crypto.randomUUID();
  const job = { id: jobId, serviceId, status: 'running', steps: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  aiFixJobs.set(jobId, job);
  return job;
}

function pushStep(job, step) {
  job.steps.push({ ...step, timestamp: new Date().toISOString() });
  job.updatedAt = new Date().toISOString();
  aiFixJobs.set(job.id, job);
}

function finishJob(job, status, result = null) {
  job.status = status;
  job.result = result;
  job.updatedAt = new Date().toISOString();
  job.finishedAt = new Date().toISOString();
  aiFixJobs.set(job.id, job);
}

// ─── Layer 1: Command Fix ────────────────────────────────────────────────────
// Detects build errors and adjusts the container command to work around them

function detectBuildErrorType(error, logs) {
  const combined = `${error || ''}\n${logs || ''}`.toLowerCase();

  // Runtime errors from broken compiled code
  if (combined.includes('referenceerror:') || combined.includes('is not defined') && combined.includes('dist/')) {
    return 'runtime-broken-code';
  }
  if (combined.includes('error ts') || (combined.includes('tsc') && combined.includes('error'))) {
    if (combined.includes('error ts2') || combined.includes('error ts7') || combined.includes('error ts4') || combined.includes('error ts18')) {
      return 'typescript-type-errors';
    }
    if (combined.includes('cannot find module') || combined.includes('error ts2307')) {
      return 'typescript-missing-module';
    }
    return 'typescript-errors';
  }
  if (combined.includes('enoent') && combined.includes('package.json')) {
    return 'missing-package-json';
  }
  if (combined.includes('npm err') || combined.includes('npm error')) {
    if (combined.includes('enospc')) return 'disk-full';
    if (combined.includes('network') || combined.includes('econnrefused') || combined.includes('etimeout')) return 'network-error';
    if (combined.includes('enoent') || combined.includes('cannot cd into') || combined.includes('tar_entry_error')) return 'npm-lockfile-corrupt';
    return 'npm-error';
  }
  if (combined.includes('permission denied') || combined.includes('eacces')) {
    return 'permission-error';
  }
  if (combined.includes('out of memory') || combined.includes('heap')) {
    return 'memory-error';
  }
  if (combined.includes('econnrefused') && combined.includes('healthcheck')) {
    // App didn't start - could be missing env, broken code, or wrong port
    return 'app-not-starting';
  }
  return 'unknown';
}

function generateCommandFix(errorType, currentCommand) {
  const cmd = typeof currentCommand === 'string' ? currentCommand : (Array.isArray(currentCommand) && currentCommand[0] === 'sh' ? currentCommand.slice(2).join(' ') : String(currentCommand || ''));

  switch (errorType) {
    case 'typescript-type-errors':
    case 'typescript-errors': {
      if (cmd.includes('npm run build')) {
        const fixed = cmd.replace(/npm run build/, '(npx tsc --skipLibCheck || true)');
        return { command: fixed, description: 'Build com skipLibCheck e tolerância a erros de tipo' };
      }
      if (cmd.includes('npx tsc') && !cmd.includes('|| true')) {
        const fixed = cmd.replace(/(npx tsc[^&|]*)/, '($1 || true)');
        return { command: fixed, description: 'Adicionado tolerância a erros no tsc' };
      }
      if (cmd.includes('tsc') && !cmd.includes('|| true')) {
        const fixed = cmd.replace(/(\btsc[^&|]*)/, '($1 || true)');
        return { command: fixed, description: 'Adicionado tolerância a erros no tsc' };
      }
      return null;
    }
    case 'runtime-broken-code':
    case 'app-not-starting': {
      // Code compiles but crashes at runtime - source code is broken
      // Cannot fix with command changes alone
      return null;
    }
    case 'npm-lockfile-corrupt': {
      // package-lock.json is corrupted or incompatible with current npm version
      // Fix: delete lock file and reinstall
      if (cmd.includes('npm install') || cmd.includes('npm ci')) {
        const fixed = cmd.replace(/npm (install|ci)/, 'rm -f package-lock.json && npm install');
        return { command: fixed, description: 'Removido package-lock.json corrompido antes do install' };
      }
      // Prepend rm if no explicit install (auto-detected)
      return { command: `rm -f package-lock.json && ${cmd}`, description: 'Removido package-lock.json corrompido' };
    }
    case 'npm-error': {
      // Generic npm error - try with --force
      if (cmd.includes('npm install') && !cmd.includes('--force')) {
        const fixed = cmd.replace(/npm install/, 'npm install --force');
        return { command: fixed, description: 'Adicionado --force ao npm install' };
      }
      if (cmd.includes('npm ci')) {
        const fixed = cmd.replace(/npm ci/, 'npm install --force');
        return { command: fixed, description: 'Trocado npm ci por npm install --force' };
      }
      return null;
    }
    case 'typescript-missing-module': {
      if (cmd.includes('npm run build') && !cmd.includes('npm install')) {
        const fixed = `npm install && ${cmd.replace('npm run build', '(npx tsc --skipLibCheck || true)')}`;
        return { command: fixed, description: 'Adicionado npm install e skipLibCheck' };
      }
      if (cmd.includes('npm run build')) {
        const fixed = cmd.replace('npm run build', '(npx tsc --skipLibCheck || true)');
        return { command: fixed, description: 'Build com skipLibCheck para módulos faltantes' };
      }
      return null;
    }
    case 'memory-error': {
      if (!cmd.includes('NODE_OPTIONS')) {
        const fixed = `NODE_OPTIONS=--max-old-space-size=2048 ${cmd}`;
        return { command: fixed, description: 'Aumentado limite de memória do Node.js para 2GB' };
      }
      return null;
    }
    default:
      return null;
  }
}

// ─── Layer 2: Repo Fix ───────────────────────────────────────────────────────
// If command fix isn't enough, commit fixes to the repository

async function generateRepoFixes(errorType, error, logs, projectDir, service) {
  const fixes = [];

  if (errorType === 'typescript-type-errors' || errorType === 'typescript-errors' || errorType === 'typescript-missing-module') {
    const tsconfigPath = path.join(projectDir, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      try {
        const raw = fs.readFileSync(tsconfigPath, 'utf8');
        const tsconfig = JSON.parse(raw);
        const compilerOptions = tsconfig.compilerOptions || {};
        if (!compilerOptions.skipLibCheck) {
          compilerOptions.skipLibCheck = true;
          tsconfig.compilerOptions = compilerOptions;
          fixes.push({
            type: 'fix_config',
            file: 'tsconfig.json',
            content: JSON.stringify(tsconfig, null, 2) + '\n',
            description: 'Adicionado skipLibCheck: true no tsconfig.json'
          });
        }
      } catch { /* invalid tsconfig */ }
    }
  }

  // For runtime-broken-code or app-not-starting: try to restore destroyed files
  if (errorType === 'runtime-broken-code' || errorType === 'app-not-starting') {
    const restored = tryRestoreDestroyedFiles(service, projectDir, error, logs);
    if (restored.length) fixes.push(...restored);
  }

  // For npm-lockfile-corrupt: delete the lock file from repo so a fresh one is generated
  if (errorType === 'npm-lockfile-corrupt') {
    const lockPath = path.join(projectDir, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      // Generate a fresh lock by reading package.json and creating minimal lock
      // Actually, just delete it from the repo - npm install will regenerate
      fixes.push({
        type: 'delete_file',
        file: 'package-lock.json',
        description: 'Removido package-lock.json corrompido/incompatível do repositório'
      });
    }
  }

  if (!fixes.length) {
    const aiResult = await askAiForRepoFixes(error, logs, projectDir, service);
    if (aiResult?.length) return aiResult;
  }

  return fixes;
}

/**
 * Detect and restore files that were destroyed (replaced with placeholder content).
 * Compares broken files with working files from the active deployment.
 */
function tryRestoreDestroyedFiles(service, projectDir, error, logs) {
  const fixes = [];
  const deployments = Array.isArray(service.deployments) ? service.deployments : [];
  const activeDeploy = deployments.find(d => d.status === 'active');
  if (!activeDeploy?.projectDir || !fs.existsSync(activeDeploy.projectDir)) return fixes;

  // Parse error to find which files are broken
  const combined = `${error || ''}\n${logs || ''}`;
  const fileMatches = combined.match(/\/usr\/src\/app\/(\S+\.(?:ts|js))/g) || [];
  let brokenFiles = [...new Set(fileMatches.map(f => f.replace('/usr/src/app/', '')))];

  // Also check the .ts source for any .js in dist/
  const extraSources = [];
  for (const f of brokenFiles) {
    if (f.startsWith('dist/') && f.endsWith('.js')) {
      const tsEquiv = f.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      extraSources.push(tsEquiv);
    }
  }
  brokenFiles = [...new Set([...brokenFiles, ...extraSources])];

  // Also scan ALL source files proactively for destroyed content
  const srcDir = path.join(projectDir, 'src');
  if (fs.existsSync(srcDir)) {
    const scanDir = (dir, depth = 0) => {
      if (depth > 4) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { scanDir(full, depth + 1); continue; }
          if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue;
          const rel = path.relative(projectDir, full);
          try {
            const content = fs.readFileSync(full, 'utf8');
            if (content.includes('// ... existing content') && content.length < 500) {
              if (!brokenFiles.includes(rel)) brokenFiles.push(rel);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    };
    scanDir(srcDir);
  }

  for (const relPath of brokenFiles.slice(0, 10)) {
    const brokenPath = path.join(projectDir, relPath);
    const workingPath = path.join(activeDeploy.projectDir, relPath);
    if (!fs.existsSync(brokenPath) || !fs.existsSync(workingPath)) continue;

    try {
      const brokenContent = fs.readFileSync(brokenPath, 'utf8');
      const workingContent = fs.readFileSync(workingPath, 'utf8');

      // Detect destroyed files: placeholder content, or drastically smaller
      const isDestroyed = (
        brokenContent.includes('// ... existing content') ||
        (brokenContent.length < 200 && workingContent.length > 500) ||
        (brokenContent.split('\n').length < 5 && workingContent.split('\n').length > 20)
      );

      if (isDestroyed) {
        fixes.push({
          type: 'fix_file',
          file: relPath,
          content: workingContent,
          description: `Restaurado ${relPath} (arquivo destruido/placeholder)`
        });
      }
    } catch { /* skip */ }
  }

  return fixes;
}

async function askAiForRepoFixes(error, logs, projectDir, service) {
  // Read relevant files for context
  const filesToRead = ['tsconfig.json', 'package.json'];
  const fileContents = {};
  for (const f of filesToRead) {
    const fp = path.join(projectDir, f);
    if (fs.existsSync(fp)) {
      try { fileContents[f] = fs.readFileSync(fp, 'utf8').slice(0, 3000); } catch { /* skip */ }
    }
  }

  const prompt = `Você é um DevOps sênior. Um deploy falhou com este erro:

## Erro
${(error || '').slice(0, 2000)}

## Logs (últimas linhas)
${(logs || '').slice(-2000)}

## Arquivos do projeto
${Object.entries(fileContents).map(([name, content]) => `--- ${name} ---\n${content}`).join('\n\n')}

## Serviço
Nome: ${service.name}, Imagem: ${service.image}, Command: ${service.command}

## Tarefa
Gere correções MÍNIMAS para resolver o erro. NÃO substitua arquivos inteiros desnecessariamente.
Foque em: tsconfig.json (adicionar skipLibCheck, ajustar strict), package.json (scripts), ou criar/ajustar .env.

Responda SOMENTE com JSON:
{
  "fixes": [
    { "type": "fix_config", "file": "caminho/relativo", "content": "conteúdo COMPLETO do arquivo corrigido", "description": "o que faz" }
  ],
  "explanation": "explicação curta"
}

REGRAS:
- Máximo 2 fixes
- NUNCA mude dependências do package.json
- Se o problema é skipLibCheck, APENAS adicione isso no tsconfig
- Se não sabe como corrigir, retorne fixes: []`;

  try {
    const answer = await zeusChat(prompt);
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed.fixes) ? parsed.fixes : [];
    }
  } catch { /* AI failed */ }
  return [];
}

// ─── Push to GitHub ──────────────────────────────────────────────────────────

async function pushFixesToGitHub(service, fixes) {
  const GitHubDeliveryManager = require('./GitHubDeliveryManager');
  const ghManager = new GitHubDeliveryManager();
  const delivery = service.delivery;
  const connection = ghManager.getConnection(delivery.connectionId);
  const [owner, repo] = delivery.repository.split('/');
  const branch = delivery.branch || 'main';

  const fileActions = fixes.filter(a => a.success !== false && (a.type === 'fix_file' || a.type === 'fix_config') && a.file && a.content);
  const deleteActions = fixes.filter(a => a.success !== false && a.type === 'delete_file' && a.file);
  if (!fileActions.length && !deleteActions.length) return { pushed: 0 };

  let pushed = 0;

  // Create/update files
  for (const action of fileActions) {
    const filePath = delivery.projectPath && delivery.projectPath !== '.'
      ? `${delivery.projectPath}/${action.file}`
      : action.file;

    let sha = null;
    try {
      const existing = await ghManager.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`);
      sha = existing.data?.sha;
    } catch { /* file may not exist */ }

    await ghManager.githubRequest(connection, 'PUT', `/repos/${owner}/${repo}/contents/${filePath}`, {
      data: {
        message: `fix(auto): ${action.description || action.file} [Zeus AI]`,
        content: Buffer.from(action.content).toString('base64'),
        branch,
        ...(sha ? { sha } : {})
      }
    });
    pushed++;
  }

  // Delete files
  for (const action of deleteActions) {
    const filePath = delivery.projectPath && delivery.projectPath !== '.'
      ? `${delivery.projectPath}/${action.file}`
      : action.file;

    try {
      const existing = await ghManager.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`);
      const sha = existing.data?.sha;
      if (sha) {
        await ghManager.githubRequest(connection, 'DELETE', `/repos/${owner}/${repo}/contents/${filePath}`, {
          data: {
            message: `fix(auto): ${action.description || 'remove ' + action.file} [Zeus AI]`,
            sha,
            branch
          }
        });
        pushed++;
      }
    } catch { /* file doesn't exist, skip */ }
  }

  return { pushed };
}

// ─── Apply command fix to service registry ───────────────────────────────────

function applyCommandFix(service, commandFix) {
  const DockerManager = require('./DockerManager');
  const dockerManager = new DockerManager();
  const updated = { ...service, command: commandFix.command, updatedAt: new Date().toISOString() };
  dockerManager.saveService(updated);
  return updated;
}

// ─── Trigger redeploy ────────────────────────────────────────────────────────

async function triggerRedeploy(serviceId, deploymentId) {
  const port = process.env.PORT || 3000;
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'change-me';
  const token = jwt.sign({ id: 'ai-system', role: 'admin' }, secret, { expiresIn: '1m' });

  const res = await fetch(`http://127.0.0.1:${port}/api/docker/services/${serviceId}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ versionId: deploymentId })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Redeploy falhou (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Main Workflow ───────────────────────────────────────────────────────────

async function runAiFixWorkflow({ service, deployment, logs, error, projectDir }) {
  const job = createAiFixJob(service.id);
  const isGitDelivery = service.delivery?.provider === 'github' && service.delivery?.repository;

  setImmediate(async () => {
    try {
      // ═══ STEP 1: Diagnose ═══
      pushStep(job, { phase: 'diagnose', status: 'running', message: 'Zeus AI analisando erro...' });

      const errorType = detectBuildErrorType(error, logs);
      pushStep(job, { phase: 'diagnose', status: 'done', message: `Tipo de erro detectado: ${errorType}`, data: { errorType } });

      // ═══ STEP 2: Layer 1 - Try command fix ═══
      const currentCommand = service.command;
      const commandFix = generateCommandFix(errorType, currentCommand);

      if (commandFix) {
        pushStep(job, { phase: 'command-fix', status: 'running', message: `Tentando fix no command: ${commandFix.description}` });

        // Apply command fix to service
        const updatedService = applyCommandFix(service, commandFix);
        pushStep(job, { phase: 'command-fix', status: 'done', message: `Command atualizado: ${commandFix.command}`, data: { oldCommand: currentCommand, newCommand: commandFix.command } });

        // If git delivery with push mode, the next push will use the new command
        // If manual, trigger redeploy with the failed deployment (same code, new command)
        if (!isGitDelivery && deployment?.id) {
          pushStep(job, { phase: 'redeploy', status: 'running', message: 'Disparando redeploy com novo command...' });
          try {
            await triggerRedeploy(service.id, deployment.id);
            pushStep(job, { phase: 'redeploy', status: 'done', message: '✓ Redeploy disparado com command corrigido' });
            finishJob(job, 'success', { layer: 1, fixType: 'command', commandFix, redeployed: true });
            return;
          } catch (redeployErr) {
            pushStep(job, { phase: 'redeploy', status: 'failed', message: `Redeploy falhou: ${redeployErr.message.slice(0, 200)}` });
          }
        } else if (isGitDelivery) {
          // For git delivery: command fix is saved, but we also need to fix the repo
          // because the workflow will send new code and the container will use the updated command
          pushStep(job, { phase: 'command-fix', status: 'done', message: '✓ Command salvo. Próximo deploy usará o novo command. Tentando fix no repositório também...' });
        }
      } else {
        pushStep(job, { phase: 'command-fix', status: 'skipped', message: 'Nenhum fix de command aplicável para este tipo de erro' });
      }

      // ═══ STEP 3: Layer 2 - Repo fix ═══
      if (!isGitDelivery) {
        // For manual deploys without git, try AI diagnosis for local fixes
        pushStep(job, { phase: 'ai-diagnose', status: 'running', message: 'Consultando Zeus AI para diagnóstico detalhado...' });
        const diagnosis = await diagnoseDeploy({ service, deployment, logs, error, projectDir });
        pushStep(job, { phase: 'ai-diagnose', status: 'done', message: diagnosis.diagnosis || 'Análise concluída', data: { rootCause: diagnosis.rootCause, fixable: diagnosis.fixable } });

        if (diagnosis.fixable && diagnosis.actions?.length) {
          pushStep(job, { phase: 'local-fix', status: 'running', message: `Aplicando ${diagnosis.actions.length} correção(ões) localmente...` });
          const applied = await applyLocalActions(diagnosis.actions, projectDir);
          const successCount = applied.filter(a => a.success).length;
          pushStep(job, { phase: 'local-fix', status: successCount > 0 ? 'done' : 'failed', message: `${successCount}/${diagnosis.actions.length} correções aplicadas` });

          if (successCount > 0 && deployment?.id) {
            try {
              await triggerRedeploy(service.id, deployment.id);
              pushStep(job, { phase: 'redeploy', status: 'done', message: '✓ Redeploy disparado com correções locais' });
              finishJob(job, 'success', { layer: 2, fixType: 'local', applied, redeployed: true });
              return;
            } catch (e) {
              pushStep(job, { phase: 'redeploy', status: 'failed', message: `Redeploy falhou: ${e.message.slice(0, 200)}` });
            }
          }
        }
        finishJob(job, commandFix ? 'success' : 'failed', { layer: commandFix ? 1 : 0, fixType: commandFix ? 'command-only' : 'none', commandFix });
        return;
      }

      // Git delivery: generate repo fixes and push
      pushStep(job, { phase: 'repo-fix', status: 'running', message: 'Gerando correções para o repositório...' });

      const repoFixes = await generateRepoFixes(errorType, error, logs, projectDir, service);

      if (!repoFixes.length) {
        pushStep(job, { phase: 'repo-fix', status: 'skipped', message: 'Nenhuma correção de repositório identificada' });
        // Still success if we applied a command fix
        finishJob(job, commandFix ? 'success' : 'failed', { layer: commandFix ? 1 : 0, fixType: commandFix ? 'command-only' : 'none', commandFix });
        return;
      }

      pushStep(job, { phase: 'repo-fix', status: 'done', message: `${repoFixes.length} correção(ões) gerada(s): ${repoFixes.map(f => f.description).join('; ')}` });

      // Push to GitHub
      pushStep(job, { phase: 'git-push', status: 'running', message: `Enviando correções para ${service.delivery.repository}@${service.delivery.branch}...` });

      try {
        const { pushed } = await pushFixesToGitHub(service, repoFixes);
        if (pushed > 0) {
          pushStep(job, { phase: 'git-push', status: 'done', message: `✓ ${pushed} arquivo(s) commitado(s). CI/CD vai re-deployar automaticamente.` });
          finishJob(job, 'success', { layer: 2, fixType: 'repo', commandFix, repoFixes: repoFixes.map(f => ({ file: f.file, description: f.description })), pushed });
        } else {
          pushStep(job, { phase: 'git-push', status: 'skipped', message: 'Nenhum arquivo para commitar' });
          finishJob(job, commandFix ? 'success' : 'failed', { layer: commandFix ? 1 : 0, fixType: commandFix ? 'command-only' : 'none' });
        }
      } catch (gitErr) {
        pushStep(job, { phase: 'git-push', status: 'failed', message: `Erro ao enviar para GitHub: ${gitErr.message.slice(0, 300)}` });
        // Apply fixes locally as fallback
        pushStep(job, { phase: 'local-fallback', status: 'running', message: 'Aplicando correções localmente como fallback...' });
        const applied = await applyLocalActions(repoFixes, projectDir);
        const successCount = applied.filter(a => a.success).length;
        pushStep(job, { phase: 'local-fallback', status: successCount > 0 ? 'done' : 'failed', message: `${successCount} correções aplicadas localmente. Faça push manualmente.` });
        finishJob(job, commandFix ? 'success' : 'partial', { layer: 2, fixType: 'local-fallback', commandFix, applied, gitError: gitErr.message });
      }

    } catch (err) {
      pushStep(job, { phase: 'error', status: 'failed', message: `Erro inesperado: ${err.message}` });
      finishJob(job, 'error', { error: err.message });
    }
  });

  return job;
}

// ─── Apply local file actions ────────────────────────────────────────────────

async function applyLocalActions(actions, projectDir) {
  const applied = [];
  for (const action of actions) {
    try {
      if ((action.type === 'fix_file' || action.type === 'fix_config') && action.file && action.content) {
        const filePath = path.resolve(projectDir, action.file);
        if (!filePath.startsWith(projectDir)) { applied.push({ ...action, success: false, error: 'path traversal' }); continue; }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, action.content);
        applied.push({ ...action, success: true });
      } else if (action.type === 'fix_command' && action.command) {
        await execAsync(action.command, projectDir, 60000);
        applied.push({ ...action, success: true });
      } else {
        applied.push({ ...action, success: false, error: 'tipo não suportado ou dados faltando' });
      }
    } catch (e) {
      applied.push({ ...action, success: false, error: e.message.slice(0, 200) });
    }
  }
  return applied;
}

function getAiFixJob(jobId) {
  return aiFixJobs.get(jobId) || null;
}

// Cleanup jobs older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of aiFixJobs) {
    if (new Date(job.createdAt).getTime() < cutoff) aiFixJobs.delete(id);
  }
}, 15 * 60 * 1000);

module.exports = { runAiFixWorkflow, getAiFixJob, aiFixJobs };
