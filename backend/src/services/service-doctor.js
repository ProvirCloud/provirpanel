'use strict';

/**
 * Service Doctor — resolução completa da configuração de UM serviço/container.
 *
 * Objetivo: "entrar no container" e deixá-lo rodando e bem configurado. Faz uma
 * passada de diagnóstico + correção determinística sobre a CONFIGURAÇÃO do
 * serviço no painel (portas, comando, healthcheck, bind), aplicando os ajustes
 * seguros automaticamente e reportando o que ainda depende de ação humana
 * (ex.: aplicação que escuta em localhost dentro do container → correção de
 * código, não de config).
 *
 * NÃO é um chat: é uma ação objetiva que streama passos. Reaproveita:
 *  - inspect_service_config (contexto profundo: config + imagem + logs + source)
 *  - detectHealthcheckFailure / detectBuildErrorType (heurísticas determinísticas)
 *  - diagnoseDeploy (diagnóstico LLM estruturado, quando há erro de deploy)
 *  - update_service (aplica a config real via PUT /docker/services/:id)
 *
 * Toda a segurança de role é feita na camada da rota (admin-gated) e revalidada
 * por canRoleUseWriteTool antes de aplicar.
 */

const { runTool, runWriteTool, canRoleUseWriteTool } = require('./zeus-agent-tools');
const { detectHealthcheckFailure, detectBuildErrorType } = require('./ai-fix-workflow');
const { diagnoseDeploy } = require('./deploy-ai');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de extração / heurística
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrai a primeira porta "exposta" da imagem Docker (ex.: "3000/tcp" → 3000).
 */
function imageExposedPort(image) {
  const ports = Array.isArray(image?.exposedPorts) ? image.exposedPorts : [];
  for (const p of ports) {
    const n = Number(String(p).split('/')[0]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Tenta descobrir em qual porta a aplicação disse que está escutando, a partir
 * dos logs recentes (ex.: "Listening on port 8080", "server started :3001").
 */
function detectListeningPort(logs) {
  if (!logs) return null;
  const m = String(logs).match(
    /(?:listening|listen|server\s+(?:running|started)|running\s+(?:on|at))[^\n]{0,60}?(?:port\s*[:=]?\s*|:)(\d{2,5})/i
  );
  return m ? Number(m[1]) : null;
}

/**
 * Detecta bind em localhost/127.0.0.1 nos logs (precisa de fix de código).
 */
function detectsLocalhostBind(logs) {
  if (!logs) return false;
  return /(?:listening|listen|bound|running)[^\n]{0,40}(127\.0\.0\.1|localhost)|(127\.0\.0\.1|localhost)[^\n]{0,40}(?:listening|listen)/i.test(
    String(logs)
  );
}

/**
 * Tenta descobrir uma rota HTTP de health exposta pela aplicação, olhando o
 * código-fonte (ex.: `app.get('/health', ...)`, `router.get("/healthz")`) e,
 * como reforço, os logs (ex.: "Health check: http://localhost:3000/health").
 * Retorna o caminho (ex.: "/health") ou null.
 */
function detectHealthEndpoint(insp) {
  const candidates = [];
  const push = (p) => {
    if (!p) return;
    const clean = String(p).trim();
    if (clean.startsWith('/') && clean.length <= 64) candidates.push(clean);
  };

  // 1) Código-fonte: procura registros de rota cujo caminho tenha "health".
  const sources = Array.isArray(insp?.sourceSample) ? insp.sourceSample : [];
  const routeRe = /\.(?:get|use|all)\s*\(\s*['"`](\/[^'"`]*health[^'"`]*)['"`]/gi;
  for (const f of sources) {
    const content = String(f?.content || '');
    let m;
    while ((m = routeRe.exec(content))) push(m[1]);
  }

  // 2) Logs: URLs de health impressas pela app.
  const logs = String(insp?.recentLogs || '');
  const logRe = /https?:\/\/[^\s/]+(\/[^\s'"]*health[^\s'"]*)/gi;
  let lm;
  while ((lm = logRe.exec(logs))) push(lm[1]);

  if (!candidates.length) return null;
  // Prefere caminhos "puros" de health (ex.: /health, /healthz) sobre variações.
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0];
}

const hcEnabled = (hc) => !!(hc && hc.enabled === true);

const isRunning = (status) => /running/i.test(String(status || ''));
const isUnhealthy = (status, health) =>
  /unhealthy/i.test(String(status || '')) || /unhealthy/i.test(String(health || ''));

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo: monta a lista de correções de CONFIG a partir da inspeção
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analisa o resultado do inspect e produz:
 *  - fixes:   ajustes de CONFIG aplicáveis automaticamente (chaves do PUT)
 *  - pending: problemas que exigem ação humana (código/deploy) — só reportados
 *  - findings: observações neutras para o resumo
 *
 * @returns {{updates: Object, fixes: Array, pending: Array, findings: Array}}
 */
function planFixes(insp) {
  const s = insp.service || {};
  const image = insp.image || {};
  const logs = insp.recentLogs || '';
  const updates = {};
  const fixes = [];
  const pending = [];
  const findings = [];

  const liveStatus = s.liveStatus || s.status || '';
  const health = s.healthStatus || '';

  // ── 1) Porta do container ────────────────────────────────────────────────
  // Prioriza a porta que a app disse escutar (logs); senão a porta exposta pela
  // imagem. Se divergir da config, alinha.
  const listeningPort = detectListeningPort(logs);
  const exposed = imageExposedPort(image);
  const desiredContainerPort = listeningPort || exposed || null;
  const currentContainerPort = Number(s.containerPort) || null;

  if (desiredContainerPort && desiredContainerPort !== currentContainerPort) {
    updates.containerPort = desiredContainerPort;
    fixes.push({
      field: 'containerPort',
      from: currentContainerPort,
      to: desiredContainerPort,
      reason: listeningPort
        ? `A aplicação informou nos logs que escuta na porta ${listeningPort}, mas a config apontava ${currentContainerPort ?? '—'}.`
        : `A imagem Docker expõe a porta ${exposed}, mas a config apontava ${currentContainerPort ?? '—'}.`,
    });
  } else if (!currentContainerPort && !desiredContainerPort) {
    findings.push('Não foi possível determinar a porta interna do container (sem porta exposta na imagem nem log de "listening"). Verifique manualmente.');
  }

  // ── 2) Porta do host ─────────────────────────────────────────────────────
  const currentHostPort = Number(s.hostPort) || null;
  if (!currentHostPort && (desiredContainerPort || currentContainerPort)) {
    const proposed = desiredContainerPort || currentContainerPort;
    updates.hostPort = proposed;
    fixes.push({
      field: 'hostPort',
      from: null,
      to: proposed,
      reason: `Nenhuma porta de host publicada; o serviço ficaria inacessível de fora. Publicando ${proposed}→${proposed}.`,
    });
  }

  // ── 3) Healthcheck ─────────────────────────────────────────────────────────
  const hc = s.healthcheck || {};
  const hcTarget = String(hc.target || '/').trim() || '/';

  // Falha determinística de healthcheck a partir dos logs/erro.
  const healthFailure = detectHealthcheckFailure('', logs, s);
  if (healthFailure && healthFailure.fix) {
    if (healthFailure.fix.type === 'healthcheck' && hcTarget !== healthFailure.fix.target) {
      updates.healthcheck = { ...hc, enabled: true, target: healthFailure.fix.target };
      fixes.push({
        field: 'healthcheck.target',
        from: hcTarget,
        to: healthFailure.fix.target,
        reason: healthFailure.fix.reason || healthFailure.message,
      });
    } else if (healthFailure.fix.type === 'containerPort' && Number(healthFailure.fix.port) !== currentContainerPort && !updates.containerPort) {
      updates.containerPort = Number(healthFailure.fix.port);
      fixes.push({
        field: 'containerPort',
        from: currentContainerPort,
        to: Number(healthFailure.fix.port),
        reason: healthFailure.fix.reason || healthFailure.message,
      });
    }
  } else if (healthFailure && !healthFailure.fix) {
    // Falha de healthcheck sem correção de config (ex.: bind localhost, refused).
    pending.push({
      issue: healthFailure.type,
      detail: healthFailure.message,
    });
  }

  // ── 3b) Healthcheck AUSENTE (não habilitado) porém a app expõe /health ────
  // Caso comum: container saudável, com endpoint de health disponível, mas sem
  // healthcheck configurado (Docker HEALTHCHECK = NONE). Se não há bind em
  // localhost (que exigiria fix de código antes), propomos habilitar o
  // healthcheck apontando para a rota detectada (ou "/" como fallback seguro).
  // Só propomos se ainda não mexemos no healthcheck acima e conseguimos
  // determinar uma porta interna para o check funcionar.
  if (!hcEnabled(hc) && !updates.healthcheck && !detectsLocalhostBind(logs)) {
    const portForCheck = desiredContainerPort || currentContainerPort;
    if (portForCheck) {
      const healthPath = detectHealthEndpoint(insp) || '/';
      updates.healthcheck = { ...hc, enabled: true, target: healthPath };
      fixes.push({
        field: 'healthcheck',
        from: 'desabilitado',
        to: `habilitado (target ${healthPath})`,
        reason: detectHealthEndpoint(insp)
          ? `A aplicação expõe a rota de health "${healthPath}", mas nenhum healthcheck estava configurado. Habilitando o monitoramento para detectar quedas automaticamente.`
          : `Nenhum healthcheck estava configurado. Habilitando com "/" para monitorar a disponibilidade do serviço (ajuste o caminho se a app usar uma rota específica).`,
      });
    }
  }

  // ── 4) Bind em localhost (precisa de fix de código) ──────────────────────
  if (detectsLocalhostBind(logs)) {
    pending.push({
      issue: 'localhost-bind',
      detail:
        'A aplicação parece escutar em 127.0.0.1/localhost dentro do container — nesse modo o healthcheck e o acesso externo falham. É preciso ajustar o código para escutar em 0.0.0.0. Posso ajudar a corrigir o código pelo chat.',
    });
  }

  // ── 5) Status geral ──────────────────────────────────────────────────────
  if (isUnhealthy(liveStatus, health)) {
    findings.push('O container está marcado como unhealthy — os ajustes de porta/healthcheck acima devem resolver; se persistir, veja as pendências.');
  } else if (!isRunning(liveStatus)) {
    findings.push(`O container não está rodando (status: ${liveStatus || 'desconhecido'}). Após aplicar os ajustes, reinicie/redeploy para subir.`);
  }

  return { updates, fixes, pending, findings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestrador principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa a resolução completa da config de um serviço, streamando passos.
 *
 * @param {Object} args
 * @param {string} args.serviceId
 * @param {string} args.token   JWT do usuário (para as tools respeitarem permissão)
 * @param {Object} args.user    { role }
 * @param {boolean} [args.dryRun=false]  se true, só diagnostica (não aplica)
 * @param {(step: Object) => void} onStep  callback para cada passo (SSE)
 * @returns {Promise<Object>} resumo final
 */
async function runResolve({ serviceId, token, user, dryRun = false }, onStep = () => {}) {
  const role = user?.role || 'viewer';
  const emit = (step) => { try { onStep(step); } catch { /* best-effort */ } };

  if (!serviceId) throw new Error('serviceId é obrigatório');

  // ── 1) Inspeção profunda ───────────────────────────────────────────────────
  emit({ phase: 'inspect', status: 'running', message: 'Inspecionando a configuração, imagem, logs e código do container...' });
  let insp;
  try {
    insp = await runTool('inspect_service_config', { serviceId }, token);
  } catch (err) {
    emit({ phase: 'inspect', status: 'failed', message: `Falha ao inspecionar o serviço: ${err.message}` });
    throw err;
  }
  const svc = insp.service || {};
  const serviceName = svc.name || serviceId;
  emit({
    phase: 'inspect',
    status: 'done',
    message: `Container "${serviceName}" inspecionado. Status: ${svc.liveStatus || svc.status || 'desconhecido'}.`,
    data: {
      name: serviceName,
      status: svc.liveStatus || svc.status || null,
      hostPort: svc.hostPort ?? null,
      containerPort: svc.containerPort ?? null,
    },
  });

  // ── 2) Diagnóstico determinístico ──────────────────────────────────────────
  emit({ phase: 'diagnose', status: 'running', message: 'Diagnosticando problemas de configuração...' });
  const plan = planFixes(insp);

  // Diagnóstico LLM do último deploy que falhou (se houver) — enriquece o
  // resumo e pode revelar problemas de código. Best-effort: não bloqueia.
  const deployment = insp.deployment || {};
  if (deployment.status === 'failed' || deployment.error) {
    emit({ phase: 'diagnose', status: 'running', message: 'Analisando o último deploy que falhou com a IA...' });
    try {
      const projectDir = deployment.projectDir || null;
      const diag = await diagnoseDeploy({
        service: svc,
        logs: insp.recentLogs || '',
        error: deployment.error || '',
        projectDir,
      });
      if (diag && diag.diagnosis) {
        plan.findings.push(`Diagnóstico do deploy: ${diag.diagnosis}`);
      }
      // Ações de código sugeridas pela IA viram pendências (não aplicadas aqui,
      // pois mexem no projeto/repo — pertencem ao fluxo de ai-fix/deploy).
      const codeActions = Array.isArray(diag?.actions)
        ? diag.actions.filter((a) => ['fix_file', 'fix_config', 'fix_command'].includes(a.type))
        : [];
      for (const a of codeActions.slice(0, 5)) {
        plan.pending.push({ issue: a.type, detail: a.description || a.file || 'ajuste de código sugerido' });
      }
    } catch (e) {
      plan.findings.push(`(Não foi possível concluir o diagnóstico de deploy via IA: ${e.message})`);
    }
  }

  const fixCount = plan.fixes.length;
  emit({
    phase: 'diagnose',
    status: 'done',
    message: fixCount
      ? `Diagnóstico concluído: ${fixCount} ajuste(s) de configuração identificado(s).`
      : 'Diagnóstico concluído: nenhuma correção de configuração necessária.',
    data: { fixes: plan.fixes, pending: plan.pending, findings: plan.findings },
  });

  // ── 3) Aplicação dos fixes de config ───────────────────────────────────────
  let applied = false;
  let rollback = null;

  if (fixCount && !dryRun) {
    // Revalida permissão para update_service (defesa em profundidade).
    if (!canRoleUseWriteTool(role, 'update_service')) {
      emit({
        phase: 'apply',
        status: 'skipped',
        message: `As correções foram identificadas, mas seu perfil (${role}) não pode aplicar alterações de configuração (requer admin). Peça a um administrador.`,
      });
    } else {
      emit({
        phase: 'apply',
        status: 'running',
        message: `Aplicando ${fixCount} ajuste(s): ${plan.fixes.map((f) => f.field).join(', ')}...`,
      });
      try {
        const { result, rollback: rb } = await runWriteTool(
          'update_service',
          { serviceId, updates: { ...plan.updates, apply: true } },
          token
        );
        applied = true;
        rollback = rb || null;
        emit({
          phase: 'apply',
          status: 'done',
          message: `✓ Configuração aplicada com sucesso em "${serviceName}". O serviço foi recriado com os novos parâmetros.`,
          data: { result, rollback: rb },
        });
      } catch (err) {
        emit({
          phase: 'apply',
          status: 'failed',
          message: `Falha ao aplicar a configuração: ${err.message}`,
        });
      }
    }
  } else if (fixCount && dryRun) {
    emit({ phase: 'apply', status: 'skipped', message: 'Modo somente-diagnóstico: nenhuma alteração foi aplicada.' });
  }

  // ── 4) Resumo final ─────────────────────────────────────────────────────────
  emit({
    phase: 'summary',
    status: 'done',
    message: buildSummaryMarkdown({ serviceName, plan, applied, dryRun, role }),
    data: {
      applied,
      rollback,
      fixes: plan.fixes,
      pending: plan.pending,
      findings: plan.findings,
    },
  });

  return { serviceName, applied, rollback, ...plan };
}

/**
 * Monta um resumo em markdown para exibir no chat.
 */
function buildSummaryMarkdown({ serviceName, plan, applied, dryRun, role }) {
  const lines = [];
  lines.push(`### Resolução da configuração — ${serviceName}`);

  if (plan.fixes.length) {
    lines.push(applied ? '\n**Ajustes aplicados:**' : '\n**Ajustes identificados:**');
    for (const f of plan.fixes) {
      const from = f.from === null || f.from === undefined ? '—' : `\`${JSON.stringify(f.from)}\``;
      const to = `\`${JSON.stringify(f.to)}\``;
      lines.push(`- **${f.field}**: ${from} → ${to}\n  - ${f.reason}`);
    }
    if (!applied && !dryRun) {
      lines.push(
        role === 'admin'
          ? '\n> ⚠️ Os ajustes foram identificados mas não puderam ser aplicados (veja o erro acima).'
          : `\n> 🔒 Seu perfil (**${role}**) não pode aplicar alterações; peça a um administrador.`
      );
    }
  } else {
    lines.push('\nNenhum ajuste de configuração foi necessário — a config básica (portas/healthcheck) está coerente.');
  }

  if (plan.pending.length) {
    lines.push('\n**Pendências que exigem ação (código/deploy):**');
    for (const p of plan.pending) {
      lines.push(`- ${p.detail}`);
    }
  }

  if (plan.findings.length) {
    lines.push('\n**Observações:**');
    for (const o of plan.findings) lines.push(`- ${o}`);
  }

  if (applied) {
    lines.push('\n_Se algo não subir corretamente, você pode reverter pela versão anterior no histórico de deploys._');
  }

  return lines.join('\n');
}

module.exports = { runResolve, planFixes };
