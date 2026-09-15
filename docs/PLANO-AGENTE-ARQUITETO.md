# Plano & Especificação — Agente Arquiteto (Zeus Build)

> Documento de proposta. Nada foi implementado ainda. Objetivo: alinhar arquitetura,
> escopo, custo e fluxo antes de codificar. Este é o mesmo tipo de artefato que o
> próprio agente deverá produzir para o usuário final.

## 1. Visão

Um agente que transforma um pedido do usuário em **software entregue e testável**,
passando obrigatoriamente por:

1. **Descoberta** (analista comercial/estratégico) — entender o que o usuário quer.
2. **Estudo do existente** (quando houver) — clonar git, ler código, perguntar ao dev,
   pedir acesso ao banco, descobrir onde está hospedado, analisar boas práticas,
   performance, segurança e vulnerabilidades.
3. **Arquitetura & custo** (arquiteto de software + nuvem) — desenhar a solução,
   estimar custo, apontar riscos.
4. **Plano + Especificação + Wireframe** — plano granular, spec, e um mockup (imagem)
   gerado via Bedrock, apresentados ao usuário para **aprovação**.
5. **Execução** (só após aprovação) — o agente dev recebe o plano "mastigado" e codifica
   seguindo Clean Architecture, reaproveitando o máximo.
6. **Provisionamento** — cria uma **stack dev no painel** com **link no domínio** para o
   usuário testar.

O usuário conversa **sempre** com o Arquiteto / Gerente de Projeto / Planejador.
Esses papéis conversam com o **agente Dev** montando o prompt. O Dev "não pensa muito":
segue o plano.

## 2. Decisões confirmadas com o usuário

| # | Decisão |
|---|---------|
| 1 | Vive em **ambos**: feature no painel (web) **e** CLI. |
| 2 | Entrega **os dois**: código de aplicação **e** provisiona stack dev no painel com link no domínio. |
| 3 | "Software existente" pode ser um sistema já lançado, trazido via **git**; estudar código, perguntar ao dev, ver o banco, descobrir hospedagem. |
| 4 | Wireframe/mockup via **Bedrock** (imagem simples só p/ aprovar/alterar; usuário pode mandar exemplo). |
| 5 | **Multi-tenant**: vários usuários por painel e o painel instalado em vários clientes. |
| 6 | **Bedrock** nesta v1 (agentes já existem lá; pode criar outros). Orçamento **on-demand até ~US$100/mês**. |

## 3. Reaproveitamento (o que JÁ existe — não reconstruir)

### No Gateway Zeus (`/opt/zeus-ai/gateway`)
- `services/planner.js` — **`generatePlan()`** e **`breakIntoMicroTasks()`** já usam Bedrock
  e produzem plano granular + micro-tasks atômicas com dependências. **Base pronta.**
- `services/task-executor.js` — executor sequencial com acúmulo de contexto e streaming SSE.
  ⚠️ Hoje chama **Ollama**; precisa de um caminho Bedrock (ver §6).
- `services/bedrock.js` — `invokeModelSync` + Converse API (tool-use).
- `services/intent-classifier.js` — classificação de intenção.
- `routes/vanguard-rag.js` — **RAG isolado por tenant** (padrão de isolamento a seguir).
- `routes/chat.js` — RAG chat + geração de imagem via ComfyUI (mudaremos p/ Bedrock no mockup).
- `services/git-indexer.js`, `openapi-indexer.js`, `storage-indexer.js` — indexação p/ estudo do existente.
- Auth por `x-api-key`, rate-limit, helmet, swagger.

### No Painel (`/opt/provirpanel/backend`)
- `services/ai-agents.js` — **personas já existem**: `arquiteto_software`, `arquiteto_nuvem`,
  `comercial`, `gerente_negocios`, `planejador`, `gerente_projeto`, `desenvolvedor`.
- `services/zeus-agent-tools.js` — catálogo de **tools tool-use** (read-only) + `WRITE_TOOL_*`
  com permissão por role; catálogo de `SERVICE_TEMPLATES` (nginx, node, next, postgres, etc.).
- `routes/docker.js` — cria serviços/containers, upload de projeto, build, `.env`, working dir.
- `routes/ci-cd.js` — git clone/pull, build, restart, rollback, indexação via gateway.
- `routes/zeus.js` — ponte painel→gateway (converse, imagens, service-doctor).
- Domínios/Cloudflare + Nginx manager — para gerar o **link no domínio** da stack dev.

## 4. Arquitetura proposta

### 4.1 Camadas (Clean Architecture)
```
domain/          entidades: Project, Discovery, Plan, Spec, Wireframe, BuildRun, Task
                 regras puras, sem I/O
application/     casos de uso (orquestração dos agentes): RunDiscovery, StudyExisting,
                 ProduceArchitecture, GeneratePlanAndSpec, GenerateWireframe,
                 ApprovePlan, ExecuteBuild, ProvisionDevStack
infrastructure/  adapters: BedrockLLM, GitStudyAdapter, DbInspectAdapter, QdrantRag,
                 PanelProvisionAdapter (docker/nginx/cloudflare), WireframeAdapter
interface/       entrada: rotas HTTP do painel + comandos do CLI + SSE de progresso
```

### 4.2 Pipeline de agentes (state machine)
```
[DISCOVERY] ──> [STUDY_EXISTING?] ──> [ARCHITECTURE+COST] ──> [PLAN+SPEC+WIREFRAME]
     ↑ (perguntas ao usuário)              │                          │
     └──────────────────────────────── (loop de refinamento) ────────┘
                                                                       │
                                                          [APPROVAL GATE] (usuário)
                                                                       │ aceito
                                                                       ▼
                                          [DECOMPOSE → MICRO-TASKS] (planner.js)
                                                                       │
                                                                       ▼
                                     [DEV EXECUTOR] (Bedrock, segue prompt "mastigado")
                                                                       │
                                                                       ▼
                                    [PROVISION DEV STACK + LINK NO DOMÍNIO]
```

Agentes (personas Bedrock, reusando `ai-agents.js` + novos system prompts):
- **Arquiteto / Gerente de Projeto / Planejador** — conversam com o usuário (front-of-house).
- **Analista Comercial** — descoberta de requisitos e valor.
- **Arquiteto de Nuvem/Segurança** — custo, infra, vulnerabilidades.
- **Dev Executor** — recebe micro-task autocontida e produz código; não decide escopo.
- **Revisor** (opcional v1.1) — valida saída do Dev antes de aplicar.

### 4.3 Persistência (multi-tenant)
- Toda entidade carrega `tenantId` + `userId` (regra não-negociável, espelha o padrão
  do `vanguard-rag.js`: filtro montado **no servidor**, defesa em profundidade).
- Tabelas novas (PostgreSQL, via Prisma que o painel já usa):
  `agent_projects`, `agent_discoveries`, `agent_plans`, `agent_specs`,
  `agent_wireframes`, `agent_build_runs`, `agent_tasks`.
- RAG por tenant no Qdrant (collection isolada, filtro por `tenantId`).

## 5. Estudo do software existente (quando trazido via git)
1. `git-indexer` clona e indexa (RAG por tenant).
2. Detecção de stack (linguagem, framework, gerenciador de pacotes).
3. **Análise de vulnerabilidades**: `npm audit` / `pip-audit` / equivalente + checagem de
   dependências suspeitas (typosquatting) e segredos commitados.
4. **Boas práticas & performance**: heurísticas + LLM (aponta N+1, ausência de índices,
   falta de validação de entrada, etc.).
5. **Perguntas ao dev** (geradas pelo agente): onde está hospedado? qual banco? credenciais
   de leitura? variáveis de ambiente? escala atual?
6. **Inspeção de banco** (read-only, com credenciais fornecidas pelo usuário): schema,
   tamanho, índices — via `database-connections.js` que já existe.

> Segurança: acesso ao banco e ao git é **opt-in** e read-only por padrão. Segredos nunca
> são ecoados de volta. Ações destrutivas exigem confirmação explícita.

## 6. Ajuste crítico: executor Bedrock (não Ollama)
O `task-executor.js` atual usa Ollama (saturado em CPU — ver `/opt/zeus-ai/HANDOFF.md`).
Para a v1 com Bedrock:
- Adicionar `executeTasksBedrock()` que usa `bedrock.invokeModelSync` com os
  `SYSTEM_PROMPTS` por tipo (codigo/config/comando/analise), mantendo o mesmo contrato
  (acúmulo de contexto + eventos SSE `task_start`/`token`/`task_complete`/`all_complete`).
- Selecionar modelo por complexidade: um modelo "coder" forte p/ `codigo|analise`, um
  modelo mais barato p/ `config|comando` — chave do controle de custo.

## 7. Controle de custo (alvo ~US$100/mês, on-demand)
- **Roteamento de modelo por tarefa** (reusar ideia do `zeus-router.js`): descoberta/plano
  em modelo médio; código em modelo forte; chit-chat/labels em modelo barato.
- **Cache de descoberta/estudo** por projeto (não reprocessar git a cada turno).
- **Orçamento por tenant/projeto**: limite mensal configurável + medição de tokens por run
  (tabela `agent_build_runs` guarda tokens/custo estimado).
- **Wireframe barato**: modelo de imagem simples, 1 geração + edições sob demanda.
- **AWS Budgets/alarme** no valor-alvo para não estourar.

## 8. Entregáveis por fase (proposta de implementação)

### Fase 0 — Fundação (sem UI)
- Schema Prisma multi-tenant + migração.
- `executeTasksBedrock()` no gateway + testes (`node --test`).
- Contrato de API do agente (rotas + SSE) documentado.

### Fase 1 — Pipeline núcleo (painel)
- Casos de uso Discovery → Architecture → Plan+Spec (reusa `planner.js`).
- Approval gate + persistência.
- Estudo do existente (git-index + audit).

### Fase 2 — Execução & provisionamento
- Dev Executor Bedrock aplicando arquivos (Clean Architecture, reuso).
- Provisão de stack dev (docker + nginx + domínio) com link.

### Fase 3 — Wireframe + CLI
- Geração de wireframe Bedrock + fluxo de alteração/exemplo.
- CLI espelhando o pipeline (mesma API).

### Fase 4 — Revisor, custos, hardening
- Agente revisor, medição de custo por run, budgets, auditoria.

## 9. Riscos
- Ollama saturado/GPU quebrada — mitigado indo direto ao Bedrock na v1.
- Custo de código real no Bedrock pode subir rápido — mitigado por roteamento + budget + cache.
- Provisionamento automático toca infra real (docker/nginx/dns) — gate de aprovação + ações reversíveis.
- Isolamento multi-tenant é crítico — seguir padrão `vanguard-rag.js` (filtro no servidor).

## 10. Decisões finais (fechadas com o usuário — 2026-09-14)

| Tema | Decisão |
|------|---------|
| Nome / rota | **Zeus Builder**, montado no gateway em **`/api/build`**. |
| Persistência | **Prisma + migrate** (mesmo ORM do painel). |
| Local do código | **Pipeline no gateway** (`/opt/zeus-ai/gateway`) + **UI/provisionamento no painel** + **CLI**. |
| CLI | CLI standalone (`zeus builder`) usável fora do painel **e** instalável pelo painel no terminal. Fala a MESMA API `/api/build`. |
| Sessão | Toda interação salva sessão; o plano é atualizado a cada passo (retomável). |

### 10.2 Acesso ao Claude (arquitetura) — verificado ao vivo (2026-09-14)
Decisão do usuário: **Claude na arquitetura.** Usuário assinou no Marketplace o **Claude Sonnet 5**
(`prod-4ezhkeia6k2cs`, agreement `agmt-1hi629a8emalxdikz4sew83ac`, 14:50 UTC).

Status verificado via `bedrock get-foundation-model-availability --model-id anthropic.claude-sonnet-5`:
- `authorizationStatus: AUTHORIZED` ✅
- `entitlementAvailability: AVAILABLE` ✅
- `regionAvailability: AVAILABLE` ✅
- `agreementAvailability.status: **PENDING**` ⏳ ← acordo do Marketplace ainda propagando.

Invocação `converse` com `us.anthropic.claude-sonnet-5` / `global.anthropic.claude-sonnet-5` ainda
retorna `AccessDeniedException: not available for this account` — **transitório**, resolve quando o
agreement sair de PENDING (minutos após aceite). Profiles JÁ listados como ACTIVE:
`us.anthropic.claude-sonnet-5`, `global.anthropic.claude-sonnet-5` (e Sonnet 4.6, 4.5, 4).

**Modelo de arquitetura (env `ARCH_MODEL`):**
- Preferido: `us.anthropic.claude-sonnet-5` (usar assim que agreement=AVAILABLE).
- Fallback imediato p/ dev: `us.anthropic.claude-3-sonnet-20240229-v1:0` (profile ATIVO, funciona hoje).

### 10.2.1 Decisão de modelo (2026-09-14, reverificado 15:06 UTC)
Usuário: **"vamos com o Sonnet aprovado por enquanto"** → v1 SEM pirâmide multi-modelo.
Um único modelo Claude Sonnet cobre os papéis (arquitetura/plano/spec/dev), simplificando a v1;
refinamento de custo (mover volume p/ modelos baratos) fica p/ Fase 4.

Estado verificado ao vivo (`bedrock-runtime converse`):
- Sonnet 5, 4.6, 4.5, 4 → **AccessDeniedException** (nenhum liberado ainda; Sonnet 5 em propagação).
- **Claude 3 Sonnet** `us.anthropic.claude-3-sonnet-20240229-v1:0` → **funciona hoje** (ponte).

**Config final:** `ARCH_MODEL` = `us.anthropic.claude-sonnet-5` (preferido) com **fallback automático**
p/ `us.anthropic.claude-3-sonnet-20240229-v1:0`. O código detecta AccessDenied e cai no fallback;
quando o Sonnet 5 propagar, passa a usá-lo sem mudança de código. (Llama 4 disponível e testado —
reservado p/ otimização de custo futura, não usado na v1.)

### 10.1 Modelos Bedrock (verificado via aws-cli — `bedrock list-foundation-models`, us-east-1)
Roteamento por tarefa para caber em ~US$100/mês on-demand. Todos ACTIVE na conta.

| Papel | Modelo | inferenceType | Uso |
|-------|--------|---------------|-----|
| **Coder (forte)** | `qwen.qwen3-coder-next` | ON_DEMAND | Geração/edição de código (Dev Executor). |
| Coder alt. | `mistral.devstral-2-123b` | ON_DEMAND | Alternativa p/ código complexo. |
| **Raciocínio/arquitetura** | `anthropic.claude-sonnet-4-6` | INFERENCE_PROFILE | Arquiteto/Plano/Spec (precisa de inference profile). |
| **Barato (config/labels/roteamento)** | `amazon.nova-2-lite-v1:0` | INFERENCE_PROFILE | Tasks simples, classificação, títulos. |
| Barato alt. ON_DEMAND | `openai.gpt-oss-20b-1:0` | ON_DEMAND | Se quiser evitar inference profile. |
| **Wireframe (multimodal, entende imagem de exemplo)** | `amazon.nova-2-lite-v1:0` ou `amazon.nova-pro-v1:0` | — | Aceita IMAGE de entrada p/ o usuário mandar exemplo. |

> ⚠️ Nota importante: o `bedrock.js` atual do gateway usa `BEDROCK_MODEL_ID=amazon.nova-pro-v1:0`
> por env único. Precisaremos generalizar p/ **seleção de modelo por chamada** (coder/reasoning/cheap)
> e suportar modelos que exigem **INFERENCE_PROFILE** (Claude/Nova-2/GPT) — que NÃO aceitam invoke
> direto por `modelId`, exigem `inferenceProfileArn`/perfil. Modelos ON_DEMAND (Qwen coder, Devstral,
> gpt-oss) podem ser invocados direto. Isso vira uma task explícita na Fase 0.

### 10.2 Multi-instância do Zeus Gateway — veredito (verificado no código)
**Hoje o gateway NÃO é seguro para escalar horizontalmente (N processos/replicas) sem ajuste**, por 2 motivos encontrados:

1. **Estado em arquivos JSON locais** (`data/panels.json`, `data/hierarchy.json`,
   `data/integration-tokens.json`, sumários de índice). `fs.writeFileSync` sem lock →
   duas instâncias corrompem/competem pelos arquivos. (Ref.: `routes/panels.js`,
   `routes/hierarchy.js`, `services/integration-tokens.js`, indexers.)
2. **Jobs em memória** (`const jobs = new Map()` em `routes/openapi.js`, `routes/storage.js`,
   `routes/git.js`) e `tokenCache` no painel. Um job criado na instância A é invisível na B.

O que JÁ é multi-instância-friendly: Bedrock (stateless), Qdrant (externo), auth por `x-api-key`
(compartilhável), rate-limit (por-instância, aceitável atrás de LB).

**Conclusão / plano de escala do Builder:**
- O **Zeus Builder** será desenhado **stateless desde o início**: TODO estado
  (sessão, plano, tasks, build runs) vai para **PostgreSQL via Prisma**, não em arquivos/memória.
- Assim, o `/api/build` pode rodar em **N instâncias atrás de um LB** sem os problemas acima.
- Jobs longos (execução do build) usam a tabela `agent_build_runs` como fila/estado
  (claim por instância com `UPDATE ... WHERE status='queued'`), não `Map` em memória.
- O estado legado do gateway (panels/hierarchy em JSON) fica fora do caminho do Builder;
  migrá-lo para DB é recomendado depois, mas não bloqueia o Builder.

### 10.3 Sessão persistida & plano atualizável
- `agent_sessions` (por `tenantId`+`userId`+`projectId`): guarda o estado da máquina
  (`stage`), histórico de mensagens, e ponteiro p/ o plano atual.
- A cada passo do pipeline, grava um `agent_session_events` (append-only) + atualiza
  `agent_plans` (versão nova, mantendo histórico). Retomar = ler última sessão + plano.
- Mesmo contrato para painel e CLI (a sessão é do servidor, não do cliente).

### 10.4 CLI (`zeus builder`)
- Pacote Node standalone que consome `/api/build` (auth por integration token, scope próprio).
- Instalável fora do painel (`npm i -g` / binário) e **instalável pelo painel** (botão que roda
  o instalador no terminal do próprio painel, reusando o Terminal/CommandExecutor já existentes).
- Comandos: `zeus login`, `zeus build new`, `zeus build resume <id>`, `zeus build status`,
  `zeus build approve`, `zeus build run`. Streaming via SSE (mesmos eventos do painel).

## 11. Estado da sessão (para retomar de onde parei)
- **Etapa atual:** Especificação fechada; decisões 1–4 confirmadas + análises (modelos,
  multi-instância) concluídas e verificadas.
- **Verificado por evidência:** `bedrock list-foundation-models` (modelos ACTIVE listados);
  leitura de `ecosystem.config.js`, `.env.example`, `middleware/auth.js`; grep de estado
  local (`data/*.json`, `new Map()`) provando o ponto de multi-instância.
- **Próximo passo (Fase 0):** schema Prisma multi-tenant + `prisma migrate`, e
  `executeTasksBedrock()` com roteamento de modelo + suporte a INFERENCE_PROFILE.
- **Pendências que viram task:** generalizar `bedrock.js` p/ seleção de modelo por chamada
  e inference profiles; decidir região/perfil de inferência (Claude/Nova-2 exigem profile).
