'use strict';

const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { diagnoseDeploy } = require('./deploy-ai');

const aiFixJobs = new Map();

function execAsync(command, cwd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${error.message}\n${stderr || ''}`));
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function createAiFixJob(serviceId) {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    serviceId,
    status: 'running',
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
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

async function runAiFixWorkflow({ service, deployment, logs, error, projectDir }) {
  const job = createAiFixJob(service.id);

  setImmediate(async () => {
    try {
      // 1. Diagnose
      pushStep(job, { phase: 'diagnose', status: 'running', message: 'Zeus AI analisando erro, configuração e código-fonte...' });

      const diagnosis = await diagnoseDeploy({ service, deployment, logs, error, projectDir });
      pushStep(job, {
        phase: 'diagnose',
        status: 'done',
        message: diagnosis.diagnosis || 'Análise concluída',
        data: { rootCause: diagnosis.rootCause, confidence: diagnosis.confidence, fixable: diagnosis.fixable }
      });

      if (!diagnosis.fixable || !diagnosis.actions?.length) {
        pushStep(job, {
          phase: 'result',
          status: 'skipped',
          message: diagnosis.explanation || 'A IA determinou que este erro não pode ser corrigido automaticamente. Requer intervenção manual.'
        });
        finishJob(job, 'completed', { fixable: false, diagnosis });
        return;
      }

      pushStep(job, {
        phase: 'plan',
        status: 'done',
        message: diagnosis.explanation || `${diagnosis.actions.length} correção(ões) planejada(s)`,
        data: { actions: diagnosis.actions.map(a => ({ type: a.type, description: a.description })) }
      });

      // 2. Create branch
      const branchName = `fix/ai-${Date.now()}`;
      pushStep(job, { phase: 'branch', status: 'running', message: `Criando branch ${branchName}...` });

      const hasGit = fs.existsSync(path.join(projectDir, '.git'));
      if (!hasGit) {
        await execAsync('git init && git add -A && git commit -m "initial state" --allow-empty', projectDir);
      }

      let originalBranch = 'main';
      try {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', projectDir);
        originalBranch = stdout.trim() || 'main';
      } catch (e) { /* default */ }

      // Ensure clean state
      await execAsync('git add -A && git stash --include-untracked', projectDir).catch(() => {});
      await execAsync(`git checkout -b ${branchName}`, projectDir);
      await execAsync('git stash pop', projectDir).catch(() => {});

      pushStep(job, { phase: 'branch', status: 'done', message: `Branch ${branchName} criada a partir de ${originalBranch}` });

      // 3. Apply fixes
      pushStep(job, { phase: 'fix', status: 'running', message: 'Aplicando correções...' });
      const applied = [];

      for (const action of diagnosis.actions) {
        try {
          switch (action.type) {
            case 'fix_command': {
              if (!action.command) break;
              const { stdout } = await execAsync(action.command, projectDir, 60000);
              applied.push({ ...action, success: true, output: stdout.slice(0, 500) });
              break;
            }
            case 'fix_file': {
              if (!action.file || !action.content) break;
              const filePath = path.resolve(projectDir, action.file);
              if (!filePath.startsWith(projectDir)) break;
              fs.mkdirSync(path.dirname(filePath), { recursive: true });
              fs.writeFileSync(filePath, action.content);
              applied.push({ ...action, success: true });
              break;
            }
            case 'fix_config': {
              if (!action.file || !action.content) break;
              const cfgPath = path.resolve(projectDir, action.file);
              if (!cfgPath.startsWith(projectDir)) break;
              fs.writeFileSync(cfgPath, action.content);
              applied.push({ ...action, success: true });
              break;
            }
            case 'fix_env': {
              // Env changes are reported but applied at service level by caller
              applied.push({ ...action, success: true, note: 'env queued for service update' });
              break;
            }
            default:
              applied.push({ ...action, success: false, note: 'tipo não suportado' });
          }
        } catch (actionErr) {
          applied.push({ ...action, success: false, error: actionErr.message.slice(0, 300) });
        }
      }

      const successCount = applied.filter(a => a.success).length;
      pushStep(job, {
        phase: 'fix',
        status: successCount > 0 ? 'done' : 'failed',
        message: `${successCount}/${diagnosis.actions.length} correções aplicadas com sucesso`,
        data: { applied: applied.map(a => ({ type: a.type, description: a.description, success: a.success, error: a.error })) }
      });

      if (successCount === 0) {
        await execAsync(`git checkout ${originalBranch}`, projectDir).catch(() => {});
        await execAsync(`git branch -D ${branchName}`, projectDir).catch(() => {});
        pushStep(job, { phase: 'discard', status: 'done', message: 'Nenhuma correção aplicada. Branch descartada.' });
        finishJob(job, 'failed', { fixable: true, diagnosis, applied, testPassed: false });
        return;
      }

      // 4. Test build
      pushStep(job, { phase: 'test', status: 'running', message: 'Testando build na branch de correção...' });

      let testPassed = false;
      let testOutput = '';
      try {
        const buildCmd = detectBuildCommand(projectDir, service);
        pushStep(job, { phase: 'test', status: 'running', message: `Executando: ${buildCmd}` });
        const { stdout, stderr } = await execAsync(buildCmd, projectDir, 180000);
        testOutput = (stdout + '\n' + stderr).slice(-2000);
        testPassed = true;
        pushStep(job, { phase: 'test', status: 'done', message: '✓ Build passou com sucesso!' });
      } catch (buildErr) {
        testOutput = buildErr.message.slice(-2000);
        pushStep(job, { phase: 'test', status: 'failed', message: `✗ Build falhou: ${buildErr.message.slice(0, 300)}` });
      }

      // 5. Merge or discard
      if (testPassed) {
        pushStep(job, { phase: 'merge', status: 'running', message: `Merge ${branchName} → ${originalBranch}...` });
        await execAsync('git add -A && git commit -m "fix: Zeus AI auto-fix" --allow-empty', projectDir);
        await execAsync(`git checkout ${originalBranch}`, projectDir);
        await execAsync(`git merge ${branchName} --no-edit`, projectDir);
        await execAsync(`git branch -d ${branchName}`, projectDir);
        pushStep(job, { phase: 'merge', status: 'done', message: `✓ Merge concluído. Código corrigido em ${originalBranch}.` });

        // Collect env changes for caller
        const envChanges = applied.filter(a => a.type === 'fix_env' && a.success);
        finishJob(job, 'success', { fixable: true, diagnosis, applied, testPassed: true, branch: branchName, envChanges });
      } else {
        pushStep(job, { phase: 'discard', status: 'running', message: 'Build falhou. Revertendo alterações...' });
        await execAsync(`git checkout ${originalBranch}`, projectDir).catch(() => {});
        await execAsync(`git branch -D ${branchName}`, projectDir).catch(() => {});
        pushStep(job, { phase: 'discard', status: 'done', message: 'Branch descartada. A correção automática não resolveu o problema.' });
        finishJob(job, 'failed', { fixable: true, diagnosis, applied, testPassed: false, testOutput, branch: branchName });
      }
    } catch (err) {
      pushStep(job, { phase: 'error', status: 'failed', message: `Erro inesperado: ${err.message}` });
      finishJob(job, 'error', { error: err.message });
    }
  });

  return job;
}

function detectBuildCommand(projectDir, service) {
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts?.build) return 'npm install --legacy-peer-deps && npm run build';
      if (pkg.scripts?.compile) return 'npm install --legacy-peer-deps && npm run compile';
      if (pkg.scripts?.tsc) return 'npm install --legacy-peer-deps && npm run tsc';
    } catch (e) { /* ignore */ }
    return 'npm install --legacy-peer-deps';
  }
  if (fs.existsSync(path.join(projectDir, 'pom.xml'))) return 'mvn compile -q';
  if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) return 'cargo check';
  if (fs.existsSync(path.join(projectDir, 'go.mod'))) return 'go build ./...';
  return 'echo "no build system detected"';
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
