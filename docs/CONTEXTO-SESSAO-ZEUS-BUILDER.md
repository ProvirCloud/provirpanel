# CONTEXTO DE SESSÃO — Zeus Builder (retomar aqui se a sessão cair)

> Última atualização: 2026-09-15 ~01:08 UTC. Este arquivo é o ponto de retomada.
> Leia junto com `docs/PLANO-AGENTE-ARQUITETO.md` (spec completa).

## Objetivo
Construir o **Zeus Builder**: agente que faz Descoberta → Estudo do existente →
Arquitetura+Custo → Plano+Spec+Wireframe → **Aprovação** → Execução Dev (Clean Arch, reuso) →
Provisão de stack dev no painel com **link no domínio**. Multi-tenant. Painel + CLI.

## ⏩ RETOMAR AQUI — Sessão 2026-09-15 (gerenciamento pós-build)

### Contexto do problema (feedback do usuário)
1. Depois do build, o gerenciamento do serviço estava ruim: mudar só a porta ou
   ajustar código disparava REBUILD COMPLETO via LLM (decompose + dev-task por task),
   levando ~20 min. Para HTML/site é absurdo — "é só rodar o play".
2. A **publicação do serviço nunca deu certo** (sempre 502).

### O QUE JÁ FOI FEITO NESTA SESSÃO (implementado + verificado)
**Play rápido + chat de ajuste incremental** (separar do rebuild completo):
- Gateway `/opt/zeus-ai/gateway/src/routes/build.js`: novo endpoint `POST /api/build/edit`
  (edição CIRÚRGICA — recebe instrução + arquivos atuais, retorna SÓ os arquivos alterados,
  sem decompose). System prompt `EDIT_SYSTEM`. VERIFICADO E2E com Qwen coder real: editou só
  o `<h1>`, retornou só index.html, US$0.0005, em segundos.
- Painel `backend/src/services/zeus-builder.js`:
  - `editCode(user, sessionId, instrucao, {onEvent})` — lê workspace (collectWorkspaceFiles),
    chama gateway `/edit`, aplica diffs (writeWorkspaceFile/safeJoin), loga evento, registra
    custo num agentBuildRun leve. SEM rebuild.
  - `runProject(user, sessionId, {token})` — PLAY: se `metadata.serviceId` existe → restart via
    `/api/docker/services/:id/restart`; senão cria serviço UMA vez montando o WORKSPACE COMO
    VOLUME (static→nginx:alpine em /usr/share/nginx/html; node→node-app em /app), persiste
    serviceId. SEM LLM.
  - helpers: `collectWorkspaceFiles`, `detectRunKind`. Exports adicionados.
- Painel `backend/src/routes/build.js`: `POST /build/sessions/:id/run` (Play) e
  `POST /build/sessions/:id/edit` (SSE). `/rerun` antigo mantido (rebuild completo).
  VERIFICADO: run/edit/rerun retornam 401 sem JWT (registradas).
- Frontend `frontend/src/components/ProjectWorkspace.jsx`: botão **Play** (verde, rápido),
  **Ajustar** (chat lateral roxo via SSE `/edit`, recarrega árvore+abas), **Reconstruir tudo**
  (cinza discreto = /rerun antigo). Link "abrir" quando há runLink. VERIFICADO: `npm run build` OK.
- Gateway e backend reiniciados (gateway com `env -u PORT pm2 restart zeus-gateway --update-env`).

### DIAGNÓSTICO DA PUBLICAÇÃO (por que nunca deu certo)
- `publishWithDomain()` gera vhost via NginxManager e faz `proxy_pass 127.0.0.1:<porta>`, MAS a
  porta vem de detecção no CÓDIGO e o app nunca estava realmente no ar (`provisionDevStack` era
  "validado por wiring", nunca rodou volume de verdade) → **502 garantido**.
- Permissão NÃO é o problema: sudoers do `ubuntu` permite NOPASSWD nginx, systemctl reload nginx,
  cp, rm, ln, mkdir, chmod, chown. `sudo -n nginx -t` funciona. `/etc/letsencrypt/live` NÃO é
  legível pelo node (por isso findCertDir lê certs a partir de vhosts existentes).

### DECISÃO DO USUÁRIO (próximo passo — NÃO começado ainda)
> "Criar uma stack/docker do painel e ficar integrado com o Builder, assim o Nginx fica padrão
> igual os outros sistemas."

**Plano aprovado (abordagem B): o Builder cria uma STACK do painel via API REST e usa a
integração Nginx padrão.** Em vez de publish caseiro:
1. Builder cria/atualiza uma **Stack** (`/api/stacks`) com 1 serviço, montando o workspace como
   volume (static→nginx:alpine; node→node-app), com `domainMode` (subdomain|path) + subdomain/pathPrefix.
2. Dá **start da stack** (`POST /api/stacks/:id/start`, SSE) → sobe container E chama
   `nginxIntegration.applyForStack(stack)` (Nginx padrão, mesmo dos outros sistemas).
3. Proxy aponta para a **porta real do container** (do serviço da stack) → acaba o 502.
4. DNS Cloudflare continua opcional (CloudflareManager quando zona gerenciada).
5. Builder guarda `stackId` na metadata do projeto → Play/rebuild/publish operam sobre a stack.

Motivo de (B) vs (A=usar StackManager direto): mantém o padrão que o Builder já usa (chamar API
interna com JWT do usuário), respeita roles, não duplica lógica de start/Nginx.

### PADRÃO DE STACK JÁ MAPEADO (para montar o payload)
- `backend/src/services/NginxStackIntegration.js`: `applyForStack(stack)` → para cada serviço com
  `domainMode!='none'`: subdomain→`provir-<sub>.conf` (server_name `<sub>.*`); path→location no
  `provir-stack-<id8>.conf`. Porta = `svc.exposedPort || svc.ports[0].host || .container || 3000`.
  host = `127.0.0.1` se `bindLocalOnly!==false`. Faz `nginx -t` + reload (sudo -n).
- `backend/src/routes/stacks.js`: `POST /api/stacks` (criar), `POST /:id/services` (add serviço),
  `POST /:id/start` (SSE: startStack + applyForStack no sucesso). StackManager em services/StackManager.js.
- Serviço da stack: `{ id, name, role, image, tag, ports:[{host,container}], volumes:[{host,container}],
  env:[{key,value,secret}], command, domainMode, subdomain|pathPrefix, bindLocalOnly }`.

### PRÓXIMO PASSO CONCRETO (ao retomar)
1. Ler `StackManager.createStack`/`addService`/`startStack` e o handler `POST /api/stacks` +
   `POST /:id/services` para o schema EXATO do payload.
2. Implementar em `zeus-builder.js`: `deployStack(user, sessionId, {token, mode, domain, subdomain})`
   que cria stack + serviço (workspace como volume + domainMode) e dá start via API REST c/ JWT.
   Guardar `stackId`/`serviceId` na metadata. Fazer Play/publish usarem a stack.
3. Ligar na UI (BuilderPanel/ProjectWorkspace): Publicar = criar/startar stack.
4. Verificar: build front, sintaxe back, smoke test criando uma stack real e conferindo o vhost
   gerado + resposta HTTP (curl 127.0.0.1:porta) — validar que NÃO dá 502.

### Arquivos tocados nesta sessão
- `/opt/zeus-ai/gateway/src/routes/build.js` (endpoint /edit)
- `/opt/provirpanel/backend/src/services/zeus-builder.js` (editCode, runProject, helpers, exports)
- `/opt/provirpanel/backend/src/routes/build.js` (rotas /run e /edit)
- `/opt/provirpanel/frontend/src/components/ProjectWorkspace.jsx` (Play, Ajustar, Reconstruir tudo)

---

## Decisões fechadas com o usuário
- Vive em **ambos**: feature no painel + **CLI** (`zeus builder`), CLI instalável pelo painel.
- Entrega código **e** provisiona stack dev com link no domínio.
- Estuda software existente trazido via git (código, banco, hospedagem, vulnerabilidades).
- Wireframe via Bedrock (simples, p/ aprovar/alterar; aceita exemplo do usuário).
- **Multi-tenant** (vários usuários por painel; painel instalado em vários clientes).
- **Prisma + migrate** para persistência. Rota **`/api/build`**, nome **Zeus Builder**.
- Pipeline no **gateway** (`/opt/zeus-ai/gateway`) + UI/provisão no **painel** (`/opt/provirpanel`).
- Sessão persistida + plano atualizável (retomável) — TUDO em PostgreSQL (stateless p/ multi-instância).

## Modelo LLM (v1) — ATUALIZADO 2026-09-14 ~20:14 UTC
- **SONNET ABANDONADO.** A conta NÃO consegue habilitar o entitlement do Claude Sonnet 5
  (AccessDenied permanente — decisão do usuário: "esquece essa desgraça"). NENHUM Claude é usado.
- **Config final (só modelos que funcionam HOJE, verificado ao vivo via `converse`):**
  - `ARCH_MODEL` / `MID_MODEL` / `CHEAP_MODEL` = `amazon.nova-pro-v1:0` (raciocínio + **multimodal**,
    aceita imagem na descoberta).
  - `CODER_MODEL` = `qwen.qwen3-coder-next` (geração de código; ON_DEMAND).
  - Fallbacks: arch/mid/cheap → `us.meta.llama4-maverick-17b-instruct-v1:0` (texto);
    coder → `amazon.nova-pro-v1:0`. (Fallback SEMPRE ≠ preferido, senão a degradação é no-op.)
- Setado em DOIS lugares: `/opt/zeus-ai/gateway/.env` (ARCH_MODEL etc.) **e** defaults hardcoded
  em `gateway/src/services/model-router.js` (para nunca mais cair em Sonnet mesmo sem env).
- ⚠️ Llama 4 NÃO processa imagem (`Unable to process provided image`) — por isso o preferido
  multimodal é Nova Pro; Llama 4 só cobre fallback de TEXTO.
- Reiniciar o gateway SEMPRE com `env -u PORT pm2 restart zeus-gateway --update-env` (herdar PORT=3001
  do painel quebra com EADDRINUSE).
- VERIFICADO E2E pós-troca: `/api/build/dev-task` → Qwen gerou hello.js (US$0.000273);
  `/api/build/architecture` → Nova Pro respondeu; 0 novos erros de Sonnet nos logs após flush.
  Suíte do gateway 22/22 (testes de model-router e task-executor atualizados p/ Nova Pro→Llama 4).
- Alvo de custo: ~US$100/mês on-demand.

## Infra verificada
- Gateway Zeus: `/opt/zeus-ai/gateway`, PM2 `zeus-gateway`, porta 3002, Node/Express.
  - Reusar: `services/planner.js` (generatePlan + breakIntoMicroTasks, JÁ usa Bedrock),
    `services/task-executor.js` (executor sequencial+SSE, HOJE usa Ollama → precisa versão Bedrock),
    `services/bedrock.js` (invokeModelSync/Converse; hoje modelo único via env → generalizar),
    `routes/vanguard-rag.js` (padrão de isolamento multi-tenant a seguir).
  - ⚠️ Gateway NÃO é multi-instância hoje: estado em `data/*.json` (fs.writeFileSync) e
    `jobs = new Map()` em rotas. Builder nasce STATELESS (estado no Postgres) p/ escalar.
- Painel: `/opt/provirpanel/backend`, personas em `services/ai-agents.js` (arquiteto_software,
  arquiteto_nuvem, comercial, gerente_negocios, planejador, gerente_projeto, desenvolvedor),
  tools em `services/zeus-agent-tools.js`, docker/ci-cd/cloudflare p/ provisão.
- Identidade AWS: IAM user `zeus-ai-storage`, conta `680191162788`, região us-east-1.

## Estado do Prisma (IMPORTANTE)
- Schema: `/opt/provirpanel/backend/prisma/schema.prisma` (Prisma 5.22).
- Scripts na RAIZ `/opt/provirpanel/package.json`: `prisma:generate`, `prisma:migrate`
  (migrate deploy), `prisma:push` (db push).
- Banco `provirpanel` @ localhost:5432, schema `public`, DATABASE_URL presente em `backend/.env`.
- **`prisma migrate status`: NÃO há pasta `migrations/`; banco NÃO é gerenciado por Migrate**
  (foi criado via `db push`). → Rodar `migrate dev` do zero exigiria baseline do schema existente.
- Convenções do schema: snake_case via `@map`, uuid via `@default(dbgenerated("gen_random_uuid()"))`,
  multi-tenant já usa `clienteId String? @map("cliente_id")` (null = painel local).

## PONTO ATUAL / próximo passo
- **UI (frontend) CONCLUÍDA e verificada** (2026-09-14 ~18:36 UTC):
  - `frontend/src/components/BuilderPanel.jsx` — painel do pipeline: novo projeto (new/existing+git),
    lista de projetos clicável (retoma sessão), descoberta (textarea), estudar repositório (existing),
    gerar arquitetura+plano, wireframe (render SVG inline + pedir alteração), aprovar, executar build,
    provisionar stack, revisar código, custo do mês, histórico de eventos. Usa api.js (/api, JWT).
    Estilo segue convenções (zeus-panel, var(--color-*), Tailwind).
  - Rota `/builder` em App.jsx (ModulePage) + item "Zeus Builder" (ícone Hammer) na seção
    Inteligência do Sidebar.tsx.
  - Backend: +rota GET /build/projects/:id/session (latestSessionForProject) p/ a lista abrir a sessão.
    Corrigido export executeBuild (tinha sido removido por engano). Total agora 15 endpoints no painel.
  - VERIFICAÇÃO: `npm run build` do frontend OK (✓ built, sem erros novos — só warnings pré-existentes
    de xterm/chunk size); backend reiniciado online; nova rota exige auth (401 sem token).
- **STATUS: v1 completa (6 fases) + UI.** Pendências não-bloqueantes: admin criar AWS Budget;
  rotacionar GITHUB_TOKEN; Sonnet 5 PENDING (fallback Llama 4); spin-up real de container na provisão.

## PONTO ANTERIOR (Fase 4)
  - Custo por run: bedrock.js `invokeModelSyncWithUsage` (retorna usage de tokens); gateway
    `services/cost.js` (preço/1k por família de modelo + estimateCost) com testes (32/32 no gateway);
    /dev-task retorna usage+costUsd; executeBuild acumula tokensIn/Out/costUsd no AgentBuildRun e por task.
  - Budget guard (app): assertWithinBudget() bloqueia build se tenant estourou ZEUS_TENANT_BUDGET_USD
    (default 100) no mês; costReport() relatório mês+runs. VERIFICADO: build real custou US$0.0018,
    restante US$99.9982.
  - Revisor: gateway /api/build/review (papel arch, JSON aprovado/nota/problemas); painel reviewBuild()
    lê arquivos do último run e submete. VERIFICADO real: nota 6, 4 problemas apontados.
  - Estudo do existente: gateway /api/build/study (clone raso read-only + análise stack/seguranca/
    performance/vulnerabilidades/perguntas). FIX: GIT_TERMINAL_PROMPT=0 + injeta GITHUB_TOKEN p/ github.
    painel studyExisting() grava em project.metadata. VERIFICADO real com ProvirCloud/provirpanel:
    detectou JS/Express/npm/PostgreSQL, 6 seguranca, 3 performance, 5 perguntas ao dev.
  - Painel routes/build.js: 14 endpoints (+review +study +GET cost).
  - AWS Budgets: BLOQUEADO por permissão — IAM zeus-ai-storage não tem budgets:ViewBudget/ModifyBudget
    (verificado: AccessDenied em describe e create). Documentado em docs/AWS-BUDGET-ZEUS-BUILDER.md
    com política IAM + comando create-budget + notifications prontos p/ um admin executar.
    Mitigação: budget guard em app já ativo (rede de segurança no nível da conta fica pro admin).
  - ⚠️ SEGURANÇA: durante debug do /study, um GITHUB_TOKEN (ghp_...) apareceu numa mensagem de erro
    do git clone. Recomendo ROTACIONAR esse token do GitHub por precaução.
  - Hardening multi-tenant: mantido o padrão de escopo no servidor (scopeWhere userId+clienteId) em
    TODAS as queries; eventos append-only servem de auditoria (agent_session_events com tokens).
- **STATUS: TODAS AS 6 TAREFAS DO PLANO CONCLUÍDAS.** v1 do Zeus Builder completa e verificada
  ponta a ponta com Bedrock/DB reais. Pendências conhecidas (não bloqueiam v1): (a) admin criar o
  AWS Budget; (b) rotacionar GITHUB_TOKEN; (c) Sonnet 5 ainda PENDING (fallback Llama 4 ativo);
  (d) spin-up real de container na provisão (validado por wiring); (e) UI no frontend do painel.

## PONTO ANTERIOR (Fase 3)
  - DESCOBERTA: NÃO há modelo de imagem raster utilizável hoje. Nova Canvas = Legacy/bloqueado
    ("not used in 30 days"); Stability só tem ferramentas de EDIÇÃO (upscale/inpaint/etc., exigem
    imagem de entrada); ComfyUI local = GPU quebrada. DECISÃO do usuário (opção A): wireframe em
    **SVG via Nova Pro** (funciona, editável, versionável, multimodal — aceita imagem de exemplo).
  - Gateway `routes/build.js`: rota `/api/build/wireframe` — Nova Pro (WIREFRAME_MODEL=amazon.nova-pro-v1:0),
    system prompt WIREFRAME_SYSTEM (só SVG, tons de cinza, aplica feedback sobre svgAtual). Aceita
    exemplo {mimeType,data(base64)} como bloco de imagem (bedrock.js normaliza). extractSvg() valida.
  - Painel `zeus-builder.js`: generateWireframe() (versiona em agent_wireframes, grava .svg em
    workspace/.wireframes/, passa svgAtual+feedback p/ alteração), reviewWireframe(approved|rejected).
  - Painel `routes/build.js`: +3 rotas (wireframe, wireframe/review, GET cli/install). Total 11 endpoints.
  - CLI em `/opt/zeus-ai/gateway/cli` (package bin "zeus"): comandos login/projects/new/discover/plan/
    wireframe/approve/run/provision/status. Fala /api/build do PAINEL (JWT), sessão compartilhada com a UI.
    Config em ~/.zeus-builder.json (0600). Instalável pelo painel via GET /build/cli/install
    (installCommand: npm install -g <cliDir>; executável no Terminal do painel).
  - VERIFICAÇÃO: (a) wireframe E2E com Nova Pro REAL gerou SVG válido (<svg>,<rect>,<text>) v1
    persistido em disco, review→approved OK; (b) painel registra 11 rotas; (c) CLI roda (help/login
    gravam config; fix saveConfig cria dir; erro claro sem auth); (d) syntax OK em tudo, gateway online 3002.
- **Próximo passo (Fase 4):** agente revisor (valida saída do dev antes de aplicar); medição de
  custo por run (tokens→cost_usd, já há colunas em agent_build_runs/agent_tasks); AWS Budgets ~US$100/mês;
  hardening multi-tenant + auditoria. Considerar também: estudo do existente (git-index+audit) que foi
  citado no plano mas ainda não implementado como caso de uso.

## PONTO ANTERIOR (Fase 2)
  - Gateway `routes/build.js`: nova rota `/api/build/dev-task` — executa 1 micro-task de código no
    papel `coder` e retorna ARQUIVOS estruturados em JSON (path/acao/conteudo) + comandos + observações.
    System prompt DEV_FILES_SYSTEM impõe Clean Architecture, reuso, sem redesenho, paths seguros.
  - Painel `services/zeus-builder.js`:
    - `executeBuild(user, sessionId)` — exige plano APROVADO; cria AgentBuildRun (fila) e faz CLAIM
      ATÔMICO via updateMany(where status=queued) → lock multi-instância; decompõe plano (gateway
      /decompose), executa cada task (gateway /dev-task), grava arquivos no workspace com validação
      anti path-traversal (writeWorkspaceFile). Persiste AgentTask por task, marca run succeeded/failed.
      Workspace: CLOUDPAINEL_PROJECTS_DIR/zeus-builder/<slug>-<id8>/.
    - `provisionDevStack(user, sessionId, {token,...})` — chama a API interna /api/docker/services
      com o JWT do usuário (mesmo padrão do zeus-agent-tools, respeita roles), REUSA infra Docker/porta/
      Nginx existente; monta link (baseDomain→https://<svc>.<domínio> ou http://localhost:<porta>);
      grava devStackUrl no build run; status do projeto → provisioned.
  - Painel `routes/build.js`: +2 rotas — POST /build/sessions/:id/execute e /provision (dev/admin).
    tokenOf() extrai JWT (Bearer/cookie) p/ a chamada interna de provisão. Total 8 endpoints.
  - VERIFICAÇÃO: (a) executeBuild REAL ponta a ponta gerou 6 arquivos Clean Arch (interface/,
    application/, app.js, package.json), 6/6 confirmados em disco, 11 tasks persistidas, run succeeded
    (após fix do retorno stale 'queued'→finishedRun); (b) LOCK atômico testado: 2 claims concorrentes
    no mesmo run → soma=1 (exclusão mútua OK); (c) painel carrega as 8 rotas.
  - ⚠️ Provisão de container real (spin-up Docker) NÃO executada no teste p/ não deixar artefatos;
    caminho validado por wiring+lógica (reusa endpoint testado /api/docker/services). Testar com
    sessão real de usuário quando integrar a UI.
- **Próximo passo (Fase 3):** wireframe via Bedrock (Nova Pro multimodal — aceita imagem de exemplo)
  com fluxo de alteração; + CLI `zeus builder` espelhando /api/build, instalável pelo painel.

## PONTO ANTERIOR (Fase 1)
  - Arquitetura definida: gateway = cérebro LLM STATELESS; painel = persistência (tem Prisma/DB) +
    orquestração. Gateway NÃO tem Prisma nem DATABASE_URL (confirmado) → persistência fica no painel.
  - Gateway `src/routes/build.js` (montado em `/api/build`, x-api-key): rotas stateless
    `/discovery`, `/architecture`, `/plan`, `/decompose`, `/execute`. Usa model-router (papel arch/mid)
    + planner.js + executeTasksBedrock. System prompts de Discovery e Architecture (JSON estruturado).
  - Painel `src/services/zeus-builder.js`: casos de uso createProject/discover/architectAndPlan/
    approvePlan/resumeSession/listProjects. Persiste em agent_* via Prisma. Escopo multi-tenant
    (userId+clienteId montado no servidor). Planos versionados. Eventos append-only. Persona do
    arquiteto vinda de ai-agents.js.
  - Painel `src/routes/build.js` (montado em `/build` e `/api/build`, authMiddleware JWT): roles
    (viewer=leitura; dev/admin=escrita). Endpoints projects (GET/POST), sessions/:id (GET),
    sessions/:id/discovery|plan|approve (POST).
  - GATEWAY REINICIADO: PM2 estava errored por EADDRINUSE — CAUSA: shell tinha PORT=3001 vazando
    (porta do PAINEL) e --update-env injetou. FIX: `pm2 delete` + `env -u PORT pm2 start ecosystem.config.js`.
    Gateway online 3002, painel 3001. ⚠️ NUNCA reiniciar o gateway com PORT herdado do shell.
  - VERIFICAÇÃO: (a) gateway 27/27 testes; (b) /api/build/plan real devolveu plano com 6 tasks;
    (c) pipeline completo do painel (create→discover→architect+plan→approve→resume) com DB real +
    Bedrock real: 6 passos OK, plano v1 approved, sessão retomável (6 eventos), isolamento multi-tenant
    bloqueou outro user (404). Cleanup por cascade OK.
- **Próximo passo (Fase 2):** Dev Executor aplicando arquivos (Clean Arch, reuso) + provisão de
  stack dev (docker+nginx+cloudflare) com link no domínio. Reusar routes/docker.js e ci-cd.js do painel.

### ⚠️ Nota operacional (gateway PM2)
Reiniciar SEMPRE com `env -u PORT pm2 start ecosystem.config.js` (ou garantir PORT ausente do shell).
O .env do gateway tem PORT=3002; o painel roda em 3001. PORT herdado do shell quebra a porta.

## PONTO ANTERIOR (Fase 0)
  - 8 tabelas `agent_*` criadas via `prisma db push` (25 tabelas totais, existentes intactas).
  - `gateway/src/services/model-router.js` — resolve modelo por PAPEL (arch/coder/mid/cheap) com
    fallback automático em AccessDenied. `ARCH_MODEL`=Sonnet 5 preferido.
  - `SAFE_FALLBACK` = `us.meta.llama4-maverick-17b-instruct-v1:0` (Llama 4 Maverick) — porque
    NENHUM Claude invoca hoje: Sonnet 5/4.x = AccessDenied; Claude 3/3.5 = EOL/ResourceNotFound.
    Verificado ao vivo. Fallback é temporário; Sonnet 5 entra sozinho quando agreement propagar.
  - `gateway/src/services/task-executor.js` — novo `executeTasksBedrock()` (espelha executeTasks
    mas via Bedrock+model-router; papel por tipo: codigo→coder, analise→arch, config/comando→cheap).
  - Testes: `model-router.test.js` + `task-executor.test.js`. Suíte completa do gateway: **27/27 pass**.
  - Smoke test REAL: executeTasksBedrock caiu no Llama 4 e respondeu "4" p/ 2+2. OK ponta a ponta.
- **Próximo passo (Fase 1):** pipeline núcleo Discovery→Architecture→Plan+Spec reusando planner.js,
  com approval gate e persistência de sessão (agent_sessions/events/plans). Rota base `/api/build`.

### Modelos invocáveis HOJE (verificado) — importante p/ Fase 1+
- Funcionam: Nova Pro (`amazon.nova-pro-v1:0`, multimodal), Llama 4 Maverick/Scout, Qwen3 Coder.
- NÃO funcionam: todos os Claude (novos=AccessDenied, antigos=EOL). Sonnet 5 assinado, agreement PENDING.
- Wireframe (Fase 3): usar Nova Pro (multimodal, aceita imagem de exemplo).

## PONTO ANTERIOR (histórico)

## Tarefas (todo_list ativo)
1. (NEXT) Fechar spec/plano — decisões finais [em andamento; falta confirmar db push vs migrate]
2. Fase 0: schema Prisma multi-tenant + aplicar + executor Bedrock
3. Fase 1: pipeline núcleo (Discovery→Architecture→Plan+Spec) + aprovação + sessão
4. Fase 2: execução Dev + provisão de stack dev com link
5. Fase 3: wireframe Bedrock + CLI
6. Fase 4: revisor, custo por run, AWS Budgets, hardening multi-tenant, auditoria
