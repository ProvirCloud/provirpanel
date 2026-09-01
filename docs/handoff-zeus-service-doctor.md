# Provir Panel — Zeus AI / Service Doctor — Estado (2026-09-01)

## Contexto do projeto
- Repo: `/opt/provirpanel` (backend Node/Express + Socket.io + frontend React/Vite)
- Backend do painel roda na porta **3001** (backend/.env: `PORT=3001`)
- Gateway Zeus (LLM) é **serviço externo remoto**: `ZEUS_GATEWAY_URL=https://zeusai.zeusengine.com.br` (NÃO está neste repo; só proxy do LLM/Bedrock/Ollama)
- Rotas zeus montadas em `/zeus` e `/api/zeus` (server.js linhas 103-104), com `authMiddleware`
- Auth: JWT com `JWT_SECRET` no backend/.env; roles `admin`/`dev`/`viewer`. Login default `admin/admin123` NÃO funciona (senha alterada). Para teste local forjei token admin com `jwt.sign` usando o `JWT_SECRET` do .env.

## Container de teste nesta instância
- Container Docker `test` (node:20), publicado `127.0.0.1:8000->3000/tcp`
- App Express escuta em port 3000, bind `0.0.0.0` (`app.listen(port)` sem host), expõe rota `/health` (responde 200 dentro e fora)
- Docker HEALTHCHECK = NONE (nenhum healthcheck no container)
- serviceId gerenciado pelo painel: `8b7fcd91-368e-4747-a02a-752ca5226424`
- healthcheck do serviço no painel: `enabled:false`, `target:'/'`, intervals padrão

## Arquitetura relevante
- `/zeus/agent` (chat SSE): loop tool-use. Se o modelo chama write tool → backend intercepta e emite `action_proposal` (card de confirmação); NÃO executa. Execução só via `/zeus/agent/confirm` (revalida role).
- `/zeus/service/:id/resolve` (SSE): ação dedicada NÃO-chat. `service-doctor.runResolve`: inspeciona → `planFixes` determinístico → `diagnoseDeploy` LLM se deploy falho → aplica via `update_service` (admin) → resumo markdown. Não-admin recebe dryRun forçado.
- `service-doctor.js` exporta `{ runResolve, planFixes }`.
- `inspect_service_config` (zeus-agent-tools.js) retorna: service(config+liveStatus+healthStatus+stats), recentLogs, image(exposedPorts,cmd,...), deployment, fileTree, configFiles, sourceSample.
- `update_service` → PUT `/docker/services/:id`; healthcheck normalizado por `normalizeHealthcheckConfig` em docker.js (campos: enabled, target, intervalSeconds, timeoutSeconds, retries, startPeriodSeconds, containerEnabled). `parseBooleanOption` aceita string "true".

## TRABALHO CONCLUÍDO E VERIFICADO (esta sessão)

### Item 1: chat mandava JSON em vez de chamar a tool (CORRIGIDO + verificado E2E)
Raiz: modelo escrevia JSON como texto em vez de emitir toolUse. Causas: prompt dizia "proponha via update_service" (convida a descrever) e schema `updates` era object opaco.

Mudanças:
- `backend/src/routes/zeus.js`: `AGENT_SYSTEM_PROMPT` ganhou regra imperativa (DEVE chamar a ferramenta; escrever JSON/YAML ou "vá em settings e cole" = ERRO). Sessão privada do container trocou "proponha" por instrução imperativa de CHAMAR `update_service` com exemplo de healthcheck.
- `backend/src/services/zeus-agent-tools.js`: schema de `update_service` enriquecido com contrato de campos (hostPort, containerPort, image, command, envVars, healthcheck{enabled,target,intervalSeconds,...}).

Verificação E2E: POST `/zeus/agent` com serviceId do `test` + "Configure o healthcheck apontando para /health" → retornou `action_proposal` com tool `update_service` e `updates.healthcheck.target=/health`. NÃO mais JSON em texto. (Modelo mandou `enabled:"true"` string, mas `parseBooleanOption` normaliza — inofensivo.)

### Item 2: service-doctor não propunha habilitar healthcheck ausente (IMPLEMENTADO + testado)
Antes só corrigia healthcheck em caso de FALHA (`detectHealthcheckFailure`). Container saudável sem healthcheck configurado não recebia proposta.

Mudanças em `backend/src/services/service-doctor.js`:
- novo helper `detectHealthEndpoint(insp)`: acha rota /health no sourceSample (regex `.get/.use/.all` com "health") e em URLs nos logs. Prefere caminho mais curto.
- novo helper `hcEnabled(hc)`.
- nova regra em `planFixes` (seção 3b): se healthcheck NÃO habilitado, sem `updates.healthcheck` prévio, sem localhost-bind, e há porta interna → propõe habilitar com target detectado (ou "/" fallback). Adiciona fix `field:'healthcheck'`.
- Teste: `backend/src/services/service-doctor.test.js` (NOVO, 7 casos, node:test). Todos passam. Suíte completa backend 11/11 (roda com: `node --test src/services/*.test.js` no dir backend).

## Arquivos alterados nesta sessão
- `backend/src/routes/zeus.js` (prompt)
- `backend/src/services/zeus-agent-tools.js` (schema update_service)
- `backend/src/services/service-doctor.js` (detectHealthEndpoint, hcEnabled, regra 3b)
- `backend/src/services/service-doctor.test.js` (NOVO)

## SESSÃO 2 (2026-09-01, continuação) — falhas de resolução de serviço (CORRIGIDO + verificado E2E)

Sintoma reportado: agente falhava com "Serviço test não encontrado" em inspect_service_config, respostas inconsistentes (ora dizia que tinha /health, ora erro).

Raiz 1: o agente chamava as tools com o NOME do serviço ("test") em vez do UUID. Todas as tools casavam só por `s.id === serviceId`.
Raiz 2: parsing de logs em inspect_service_config esperava array/string, mas a rota /docker/services/:id/logs retorna `{ text: "...timestamps..." }` → recentLogs vinha VAZIO → IA perdia o contexto dos logs (porta, health hint).

Correções em backend/src/services/zeus-agent-tools.js:
- novo helper `resolveServiceRef(ref)`: resolve por id OU nome (case-insensitive) via DockerManager, retorna {id,name,service}.
- inspect_service_config: usa resolveServiceRef; passa a usar o `realId` resolvido nas sub-chamadas REST (details e logs).
- get_service_metrics: resolve id/nome antes da chamada.
- snapshotService: casa por id ou nome.
- runWriteTool: normaliza input.serviceId (nome->id) antes de executar qualquer write impl, e preenche serviceName.
- parsing de logs: trata shape { text }, string e array; remove timestamps RFC3339 do início das linhas; filtra linhas vazias.

Verificação E2E (backend na 3001, token admin forjado com JWT_SECRET do .env):
- runTool('inspect_service_config',{serviceId:'test'}) por NOME -> resolve id 8b7fcd91-..., liveStatus running, logsLen 516 com "running on port 3000".
- POST /zeus/agent "liste os arquivos deste serviço" -> tool_call inspect_service_config -> tool_result SEM erro -> lista index.js, package.json etc. (query que antes falhava).
- Suíte 11/11 passando; módulos carregam OK.

NOTA de teste: ao testar tools via `node -e` fora do server, é preciso EXPORT do token (ex.: `export TK=...`) — passar `TK=... node -e` como sufixo NÃO propaga ao processo filho e gera falso "Invalid token". BASE_URL das tools usa http://localhost:${PORT}; garantir PORT=3001 no ambiente do teste.

## SESSÃO 3 (2026-09-01, continuação) — DESCOBERTA CRÍTICA DE DEPLOY + fixes de UI/roteamento

### ⚠️ CRÍTICO: como publicar o frontend
O Nginx serve o painel de **/var/www/panel/** (vhost, path /admin/ via alias), NÃO de frontend/dist.
`npm run build` sozinho NÃO publica nada — o browser continua com o bundle antigo.
Publicar SEMPRE com: `cd /opt/provirpanel && ./deploy-frontend.sh` (build + copia p/ /var/www/panel + chown www-data).
Ou `SKIP_BUILD=1 ./deploy-frontend.sh` para só publicar o dist atual.
index.html tem Cache-Control no-store no Nginx → reload normal já pega bundle novo (assets têm hash).
Sintoma quando esquece de publicar: backend loga `req.body.serviceId=undefined` e a IA responde sobre o SERVIDOR em vez do container (bundle velho descartava o serviceId no useZeusStream).

### Fixes aplicados nesta sessão (todos já publicados via deploy-frontend.sh)
1. FRONTEND ServiceDetailsPage.jsx (ServiceAiTab):
   - action_proposal agora é tratado no handler SSE (antes era ignorado -> chat "não respondia" ao pedir healthcheck). Adicionado estado pendingAction, handleConfirmAction/handleRejectAction (chamam confirmAction -> /zeus/agent/confirm) e onConfirmAction/onRejectAction no <AiBlocks>.
   - Mensagens do chat ELEVADAS ao componente pai ServiceDetailsPage (aiMessages/setAiMessages passados por props). Antes o ServiceAiTab era desmontado ao trocar de aba (render condicional) e o useState local zerava. Também: o useEffect que limpava em [service.id] agora só limpa quando o id MUDA de fato (via prevServiceIdRef), não a cada montagem.
2. BACKEND zeus.js:
   - get_server_metrics REMOVIDO do toolset quando há serviceId em foco (BROAD_LIST_TOOLS). Perguntas de "saúde/health/uso/status/como ele está" na sessão privada devem ser do CONTAINER.
   - Prompt da sessão privada reforçado: "saúde/health/uso/status" refere-se SEMPRE a ESTE container (usar contexto injetado ou get_service_metrics), nunca o host.

### Verificação E2E (backend na 3001, token forjado)
- COM serviceId -> "O container..." (correto). SEM serviceId -> "A saúde do servidor..." (era o que o usuário via, por causa do bundle velho).
- "configure healthcheck" -> action_proposal update_service healthcheck target /health.
- "liste os arquivos" por nome/id -> inspect ok, lista index.js/package.json.
- Bundle publicado: /var/www/panel/assets/index-zf77zuEG.js (antigo index-y1Zx4YDU.js de 18:57 removido).

### Infra observada
- PM2: provirpanel-backend (id 1), provirpanel-terminal (id 0), zeus-gateway (id 2, roda LOCAL em /opt/zeus-ai/gateway apesar do .env apontar URL remota). watching disabled -> após editar backend: `pm2 restart provirpanel-backend --update-env`.
- DockerManager lê registry de backend/data/docker-services.json (fresh a cada readRegistry), path via __dirname (cwd-independente). PM2 cwd=/opt/provirpanel.

## PRÓXIMOS PASSOS / PENDÊNCIAS
- **Rede de segurança backend (NÃO feita ainda):** se em outros pedidos (portas, envs) o agente AINDA responder config em texto, detectar bloco de config no `finalText` e converter em `action_proposal` (não depender só do prompt). Sugestão pendente de decisão.
- Observar comportamento tool-use em pedidos além de healthcheck (portas, envs) — mudanças de prompt não são 100% determinísticas.
- Testar o fluxo `/zeus/service/:id/resolve` E2E no container `test` (só `planFixes` foi testado unitariamente; `runResolve` completo com aplicação real via update_service ainda não rodado E2E).
- Usuário observou que a IA "ainda está burrinha" — melhorias incrementais de qualidade em aberto.
