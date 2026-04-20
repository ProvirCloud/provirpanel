# INFRA-AI-TRAINING.md
# Documentação de Treinamento — Agente de AI para Infraestrutura

Este documento serve como fonte de conhecimento para treinar o agente de AI
que automatizará a criação de infraestruturas de clientes no ProvirPanel.

---

## 1. Conceitos Fundamentais

### 1.1 Stack (Ambiente)

Uma **Stack** é um ambiente completo de infraestrutura de um cliente.
Agrupa múltiplos serviços Docker com:
- Rede interna compartilhada (isolada por stack)
- Ciclo de vida unificado (start/stop juntos)
- Dependências declaradas entre serviços
- Variáveis de ambiente gerenciadas

**Campos de uma Stack:**
```json
{
  "id": "UUID",
  "name": "Nome descritivo (ex: API Loja XYZ - Produção)",
  "description": "Descrição do propósito",
  "client": "Nome do cliente",
  "environment": "production | staging | development | custom",
  "network": "Nome da rede Docker (auto-gerado: provir-{id[:8]})",
  "status": "running | partial | stopped | draft",
  "blueprintId": "ID do blueprint de origem (se aplicável)",
  "services": []
}
```

### 1.2 Serviço

Cada **Serviço** dentro de uma stack é um container Docker com papel definido.

**Papéis de serviços (roles):**

| Role | Descrição | Exemplos |
|------|-----------|---------|
| `entry-point` | Ponto de entrada público (proxy reverso) | Nginx, Traefik, HAProxy, Caddy |
| `runtime` | Aplicação principal (código do cliente) | Node.js, Python, PHP, Java, Go |
| `database` | Banco de dados relacional ou NoSQL | PostgreSQL, MySQL, MongoDB, Redis (como DB) |
| `cache` | Cache em memória de alta velocidade | Redis, Memcached |
| `queue` | Fila de mensagens e workers assíncronos | RabbitMQ, Kafka, Celery Worker |
| `monitor` | Monitoramento e métricas | Prometheus, Grafana, Jaeger |
| `storage` | Armazenamento de objetos compatível S3 | MinIO, SeaweedFS |

**Layout automático do canvas:**
Os serviços são posicionados automaticamente em camadas:
1. Topo → `entry-point`
2. Meio → `runtime`, `queue`
3. Base → `database`, `cache`, `storage`, `monitor`

### 1.3 Blueprint

Um **Blueprint** é uma stack pré-configurada que pode ser instanciada para clientes.
Define serviços, configurações padrão, dependências e posições no canvas.

**Blueprints disponíveis:**
- `mern-stack` — MongoDB + Express/Node.js + Nginx
- `laravel-mysql-redis` — PHP Laravel + MySQL + Redis + Worker
- `nextjs-postgres-redis` — Next.js + PostgreSQL + Redis
- `django-postgres-celery` — Django + PostgreSQL + Celery + Redis
- `wordpress-mysql` — WordPress + MySQL + Nginx
- `spring-postgres` — Spring Boot + PostgreSQL + Nginx
- `microservices-starter` — API Gateway + 2x Node.js + PostgreSQL + Redis

---

## 2. Padrões de Infraestrutura

### 2.1 Stack Web Simples (1 runtime)
```
Nginx (entry-point)
  └── App (runtime) → [PostgreSQL | MySQL] (database)
                   → [Redis] (cache) [opcional]
```
**Quando usar:** Sites institucionais, APIs simples, MVPs

### 2.2 Stack Web com Filas (1 runtime + workers)
```
Nginx (entry-point)
  └── App (runtime) → [DB] (database)
  └── Worker (queue) → Redis (cache/queue)
                     → [DB] (database)
```
**Quando usar:** E-commerce, plataformas com envio de e-mail, processamento assíncrono

### 2.3 Microsserviços (múltiplos runtimes)
```
Nginx/Traefik (entry-point)
  ├── Auth Service (runtime)  → [DB] (database) → Redis (cache)
  └── API Service (runtime)   → [DB] (database) → Redis (cache)
                              → Auth Service (dependência)
```
**Quando usar:** Plataformas grandes, times com múltiplos serviços independentes

---

## 3. Regras de Decisão para o Agente de AI

### 3.1 Qual imagem usar por linguagem?

| Linguagem/Framework | Imagem | Tag recomendada |
|--------------------|--------|-----------------|
| Node.js (Express, Fastify) | `node` | `20-alpine` |
| Node.js (NestJS) | `node` | `20-alpine` |
| Next.js (built) | `node` | `20-alpine` |
| PHP (Laravel, WordPress) | `php` | `8.3-fpm-alpine` |
| Python (Django, FastAPI) | `python` | `3.12-slim` |
| Python (Flask) | `python` | `3.12-slim` |
| Java (Spring Boot) | `eclipse-temurin` | `21-jre-alpine` |
| Go | `golang` | `1.22-alpine` |
| Ruby (Rails) | `ruby` | `3.3-slim` |
| Rust | `rust` | `1.76-slim` |

### 3.2 Qual banco de dados usar?

| Tipo de dado | Banco recomendado | Tag |
|--------------|-------------------|-----|
| Relacional com joins complexos | `postgres` | `16-alpine` |
| Alta performance com schema flexível | `mysql` | `8.0` |
| Documentos JSON | `mongo` | `7` |
| Cache simples | `redis` | `7-alpine` |
| Full-text search | `elasticsearch` | `8.12.0` |
| Time-series | `influxdb` | `2.7-alpine` |

### 3.3 Padrão de variáveis de ambiente por serviço

**Node.js/Express:**
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@postgres:5432/db  [secret]
REDIS_URL=redis://redis:6379
JWT_SECRET=[secret]
```

**Laravel/PHP:**
```
APP_ENV=production
APP_DEBUG=false
APP_KEY=[secret]
DB_HOST=mysql
DB_DATABASE=laravel
DB_USERNAME=laravel
DB_PASSWORD=[secret]
REDIS_HOST=redis
CACHE_DRIVER=redis
QUEUE_CONNECTION=redis
```

**Django/Python:**
```
DJANGO_SETTINGS_MODULE=config.settings.production
DATABASE_URL=postgresql://user:pass@postgres:5432/db  [secret]
REDIS_URL=redis://redis:6379/0
SECRET_KEY=[secret]
ALLOWED_HOSTS=localhost,dominio.com
```

**PostgreSQL:**
```
POSTGRES_DB=nome_do_banco
POSTGRES_USER=nome_usuario
POSTGRES_PASSWORD=[secret]
```

**MySQL:**
```
MYSQL_DATABASE=nome_do_banco
MYSQL_USER=nome_usuario
MYSQL_PASSWORD=[secret]
MYSQL_ROOT_PASSWORD=[secret]
```

**Redis:**
Normalmente sem variáveis de ambiente em setup básico.
Para autenticação: `REDIS_PASSWORD=[secret]`

### 3.4 Regras de porta

| Serviço | Porta padrão | Observação |
|---------|-------------|------------|
| Nginx/proxy | 80, 443 | Sempre expõe publicamente |
| Node.js app | 3000 | Não expor se atrás de Nginx |
| PHP-FPM | 9000 | Nunca expor externamente |
| FastAPI/uvicorn | 8000 | Não expor se atrás de Nginx |
| Spring Boot | 8080 | Não expor se atrás de Nginx |
| PostgreSQL | 5432 | Nunca expor em produção |
| MySQL | 3306 | Nunca expor em produção |
| MongoDB | 27017 | Nunca expor em produção |
| Redis | 6379 | Nunca expor em produção |

**Regra geral:** Apenas `entry-point` expõe portas 80/443. Demais serviços
comunicam via rede interna da stack (nome do serviço como hostname).

### 3.5 Regras de volume (persistência)

**Sempre usar volume para:**
- `database` → dados do banco (ex: `/var/lib/postgresql/data`)
- `cache` com persistência → Redis com AOF (ex: `/data`)
- `storage` → objetos MinIO

**Usar bind mount para:**
- Código da aplicação em desenvolvimento (`./app:/app`)
- Configs do Nginx (`./nginx.conf:/etc/nginx/conf.d/default.conf`)
- Assets estáticos (`./dist:/usr/share/nginx/html`)

**Nunca persistir:**
- Logs (usar solução centralizada)
- Cache temporário (sem volume)
- Sessões (usar Redis)

---

## 4. Formato de Dados de Treinamento (JSONL)

Cada ação de infraestrutura é registrada em:
`backend/data/training/infra-actions.jsonl`

### 4.1 Exemplos de entradas de treinamento

**Criação de stack a partir de blueprint:**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "action": "stack.create",
  "user": "admin",
  "stackId": "uuid-da-stack",
  "stackName": "API Loja XYZ",
  "stackEnvironment": "production",
  "client": "Loja XYZ",
  "input": {
    "name": "API Loja XYZ",
    "client": "Loja XYZ",
    "environment": "production",
    "blueprintId": "laravel-mysql-redis",
    "serviceCount": 5
  },
  "output": {
    "stackId": "uuid-da-stack",
    "network": "provir-abc12345"
  },
  "success": true,
  "duration_ms": 42
}
```

**Configuração de serviço de banco:**
```json
{
  "timestamp": "2024-01-15T10:31:00Z",
  "action": "service.update",
  "user": "admin",
  "stackId": "uuid-da-stack",
  "stackName": "API Loja XYZ",
  "stackEnvironment": "production",
  "client": "Loja XYZ",
  "serviceId": "uuid-do-mysql",
  "serviceName": "mysql",
  "serviceRole": "database",
  "input": {
    "image": "mysql",
    "tag": "8.0",
    "env": [
      { "key": "MYSQL_DATABASE", "value": "loja_xyz", "secret": false },
      { "key": "MYSQL_USER", "value": "loja_user", "secret": false },
      { "key": "MYSQL_PASSWORD", "value": "[SECRET]", "secret": true }
    ],
    "volumes": [{ "host": "mysql-data", "container": "/var/lib/mysql" }]
  },
  "success": true
}
```

**Exportação de compose:**
```json
{
  "timestamp": "2024-01-15T11:00:00Z",
  "action": "compose.export",
  "user": "admin",
  "stackId": "uuid-da-stack",
  "stackName": "API Loja XYZ",
  "stackEnvironment": "production",
  "output": { "format": "docker-compose.yml" },
  "success": true
}
```

---

## 5. Guia para o Agente de AI

### 5.1 Como interpretar um pedido de cliente

**Input do cliente (linguagem natural):**
> "Preciso de uma API Node.js com banco PostgreSQL e cache Redis para um e-commerce"

**Processo de decisão:**
1. Identificar linguagem/framework → Node.js → imagem: `node:20-alpine`, role: `runtime`
2. Identificar banco → PostgreSQL → imagem: `postgres:16-alpine`, role: `database`
3. Identificar cache → Redis → imagem: `redis:7-alpine`, role: `cache`
4. Necessita proxy? → Sim (produção) → Nginx → imagem: `nginx:1.25-alpine`, role: `entry-point`
5. E-commerce → processamento de pedidos → considerar queue worker
6. Blueprint mais próximo → `nextjs-postgres-redis` ou criar customizado
7. Definir dependências → nginx → runtime → postgres, redis

**Output esperado (ação do agente):**
```json
{
  "action": "stack.create",
  "payload": {
    "name": "E-commerce API",
    "client": "Cliente",
    "environment": "production",
    "services": [
      { "name": "nginx", "role": "entry-point", "image": "nginx", "tag": "1.25-alpine",
        "ports": [{"host": 80, "container": 80}], "dependencies": ["api"] },
      { "name": "api", "role": "runtime", "image": "node", "tag": "20-alpine",
        "ports": [{"host": 3000, "container": 3000}],
        "env": [
          {"key": "NODE_ENV", "value": "production", "secret": false},
          {"key": "DATABASE_URL", "value": "postgresql://...", "secret": true},
          {"key": "REDIS_URL", "value": "redis://redis:6379", "secret": false}
        ],
        "dependencies": ["postgres", "redis"] },
      { "name": "postgres", "role": "database", "image": "postgres", "tag": "16-alpine",
        "volumes": [{"host": "pg-data", "container": "/var/lib/postgresql/data"}],
        "env": [{"key": "POSTGRES_DB", "value": "ecommerce", "secret": false}],
        "dependencies": [] },
      { "name": "redis", "role": "cache", "image": "redis", "tag": "7-alpine",
        "dependencies": [] }
    ]
  }
}
```

### 5.2 Perguntas que o agente deve fazer antes de criar

1. **Linguagem/Framework** → Qual a stack tecnológica do cliente?
2. **Banco de dados** → Relacional ou NoSQL? Qual volume esperado?
3. **Ambiente** → Produção, staging ou desenvolvimento?
4. **Domínio** → Já tem domínio configurado? SSL necessário?
5. **Escala** → Alta concorrência? Precisa de múltiplas instâncias?
6. **Filas** → Envio de e-mail, processamento em background? → Queue worker
7. **Arquivos** → Upload de arquivos grandes? → Storage service (MinIO)
8. **Monitoramento** → Precisa de métricas e dashboards? → Monitor services

### 5.3 Erros comuns a evitar

| Erro | Correto |
|------|---------|
| Expor porta do PostgreSQL diretamente | Deixar na rede interna; só Nginx expõe 80/443 |
| Banco sem volume persistente | Sempre adicionar volume nomeado para dados |
| App sem variável de conexão com DB | Usar nome do container como hostname (ex: `postgres:5432`) |
| Nginx sem dependência do app | Sempre declarar `depends_on` no compose |
| Worker sem dependência do Redis | Worker precisa do Redis e do app |
| Secrets com valores reais no log | Sempre mascarar como `[SECRET]` |

---

## 6. API Reference para o Agente

### Endpoints de Stacks

```
POST   /api/stacks              → Criar stack
GET    /api/stacks              → Listar stacks
GET    /api/stacks/:id          → Detalhar stack
PUT    /api/stacks/:id          → Atualizar metadados
DELETE /api/stacks/:id          → Deletar stack
POST   /api/stacks/:id/clone    → Clonar (prod → staging)
POST   /api/stacks/:id/start    → Iniciar todos (SSE)
POST   /api/stacks/:id/stop     → Parar todos (SSE)
GET    /api/stacks/:id/compose  → Exportar docker-compose.yml
```

### Endpoints de Serviços

```
POST   /api/stacks/:id/services              → Adicionar serviço
PUT    /api/stacks/:id/services/:svcId       → Atualizar configuração
DELETE /api/stacks/:id/services/:svcId       → Remover serviço
POST   /api/stacks/:id/services/:svcId/start → Iniciar serviço (SSE)
POST   /api/stacks/:id/services/:svcId/stop  → Parar serviço
POST   /api/stacks/:id/services/:svcId/restart → Reiniciar
```

### Endpoints de Blueprints e Training

```
GET    /api/stacks/blueprints         → Listar blueprints disponíveis
GET    /api/stacks/training/actions   → Últimas N ações (default: 50)
GET    /api/stacks/training/summary   → Contadores por tipo de ação
```

---

## 7. Dados de Treinamento — Arquivos

| Arquivo | Conteúdo |
|---------|---------|
| `backend/data/training/infra-actions.jsonl` | Log de todas as ações de infra (JSONL) |
| `backend/data/training/action-summary.json` | Contadores e estatísticas de ações |
| `backend/data/stacks.json` | Estado atual de todas as stacks |
| `backend/data/blueprints.json` | Biblioteca de blueprints |

### Pré-processamento para fine-tuning

```python
# Exemplo de script para preparar dados de treinamento
import json

def load_training_data(path='backend/data/training/infra-actions.jsonl'):
    actions = []
    with open(path) as f:
        for line in f:
            action = json.loads(line)
            if action['success']:  # Focar em ações bem-sucedidas
                actions.append(action)
    return actions

def to_conversation(action):
    """Converte uma ação em par (instrução, resposta) para fine-tuning."""
    user_msg = f"Execute ação: {action['action']} para stack {action['stackName'] or 'nova'}"
    assistant_msg = json.dumps(action['input'], indent=2, ensure_ascii=False)
    return {"role_user": user_msg, "role_assistant": assistant_msg}
```

---

## 8. Roadmap: Automação com AI

### Fase 1 (Atual) — Processo Manual com Logging
- Operador cria stacks manualmente
- Cada ação é logada automaticamente
- Acumula dataset de decisões reais

### Fase 2 — Sugestões Assistidas
- AI analisa o pedido do cliente e sugere blueprint
- Operador revisa e confirma
- Feedback positivo/negativo alimenta o modelo

### Fase 3 — Criação Semi-Automática
- AI gera draft completo da stack
- Operador faz ajustes finos
- One-click deploy após aprovação

### Fase 4 — Agente Autônomo
- Cliente descreve necessidades em linguagem natural
- AI cria, configura e implanta a stack completa
- Operador recebe notificação e pode ajustar

---

*Atualizado automaticamente pelo ProvirPanel — Infrastructure Canvas*
*Gerado em: 2024 — Versão 1.0*
