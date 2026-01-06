# Provir Cloud Panel

Painel de infraestrutura com backend Node.js (Express + Socket.io + PostgreSQL) e frontend React (Vite + Tailwind).  
Inclui autenticação JWT, terminal web, métricas em tempo real, Docker manager, storage com editor Monaco, CI/CD básico e instaladores multiplataforma.

## Visao geral

### Backend (Node.js)
- Express API + Socket.io
- Autenticacao JWT com roles: `admin`, `dev`, `viewer`
- PostgreSQL via `pg`
- Docker via `dockerode`
- Terminal remoto (Socket.io) com controle de permissao
- Metrics collector (CPU/RAM/DISCO/Processos) em tempo real
- Storage manager com upload/download/preview/editor/rename/move
- CI/CD basico com git pull/build/restart e rollback

### Frontend (React + Vite)
- Login/rotas protegidas
- Dashboard com graficos Recharts e socket metrics
- Terminal web com xterm + tabs + autocomplete
- Docker panel com logs e acoes
- File manager estilo VS Code com editor Monaco
- Preview de imagens, PDF e midia (audio/video)

## Estrutura do projeto

```
backend/
  src/
    server.js
    config/
      database.js
      schema.sql
    routes/
      auth.js
      metrics.js
      terminal.js
      docker.js
      storage.js
      ci-cd.js
    services/
      CommandExecutor.js
      MetricsCollector.js
      DockerManager.js
      StorageManager.js
      CICDManager.js
    middleware/
      auth.js
      errorHandler.js
  .env.example

frontend/
  src/
    components/
      Dashboard.jsx
      Terminal.jsx
      DockerPanel.jsx
      FileManager.jsx
      Navbar.jsx
      Sidebar.jsx
    pages/
      LoginPage.jsx
      MainLayout.jsx
    services/
      api.js
      socket.js
    App.jsx
    index.css
  package.json

install.sh
install-macos.sh
install-freebsd.sh
install-windows.ps1
docker-compose.yml
nginx/conf.d/default.conf
```

## Requisitos

### Para desenvolvimento local
- Node.js 18+
- PostgreSQL 12+
- Docker (opcional, para recursos Docker)
- npm

### Para producao (Linux)
- Node.js 18+
- PostgreSQL
- Docker
- PM2
- Nginx (opcional se usar reverse proxy)

## Configuracao do Git

Sugestao de setup:
```
git init
git branch -M main
git remote add origin <URL_DO_REPO>
```

Para instalar a partir do instalador, ajuste `REPO_URL` no script:
```
REPO_URL="https://github.com/seu-org/provirpanel.git"
```

## Variaveis de ambiente (backend)

Copie `backend/.env.example` para `backend/.env` e ajuste:
```
PORT=3000
DATABASE_URL=postgres://user@/cloudpainel
DATABASE_SSL=false
DATABASE_SOCKET_PATH=/tmp
CORS_ORIGIN=*
JWT_SECRET=change-me
JWT_EXPIRES_IN=1d
CLOUDPAINEL_PROJECTS_DIR=/home/provirpanel/projects
DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASS=admin123
TERMINAL_OS_USER=seu_usuario
```

Notas:
- macOS usa socket local do Postgres: `DATABASE_URL=postgres://user@/cloudpainel`
- Linux comum usa TCP: `postgres://user:pass@localhost:5432/cloudpainel`
- `TERMINAL_OS_USER` define o usuario do SO para comandos admin no terminal

## Rodando localmente

Backend:
```
npm install
npm run start
```

Frontend:
```
cd frontend
npm install
npm run dev
```

### URLs
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Criacao do banco

```
psql "$DATABASE_URL" -f backend/src/config/schema.sql
```

## Autenticacao

Endpoints principais:
- `POST /auth/register` (apenas primeiro usuario)
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/change-password`
- `POST /auth/users` (admin)
- `GET /auth/me`

Observacao: o backend cria usuario admin padrao quando o banco estiver vazio.

## Terminal remoto

Socket namespace:
- `/api/terminal`

Eventos:
- `command` -> `{ command }`
- `output` -> stream
- `done` -> `{ code }`
- `error`
- `cwd` -> pasta atual
- `autocomplete` -> sugestoes de arquivos/comandos

## Metrics

Endpoint:
- `GET /api/metrics`

Socket:
- Evento `metrics` emitido a cada 5s

## Docker

Endpoints:
- `GET /docker/containers`
- `GET /docker/images`
- `POST /docker/images/pull`
- `POST /docker/containers/run`
- `POST /docker/containers/:id/stop`
- `POST /docker/containers/:id/restart`
- `DELETE /docker/containers/:id`
- `GET /docker/containers/:id/stats`

Socket:
- `/api/docker/logs` com evento `subscribe`

## Storage

Base de arquivos:
- Definida por `CLOUDPAINEL_PROJECTS_DIR`

Endpoints:
- `GET /storage?path=/...`
- `GET /storage/tree`
- `GET /storage/projects`
- `GET /storage/stats`
- `POST /storage/upload`
- `POST /storage/create`
- `DELETE /storage?path=/...`
- `GET /storage/download`
- `GET /storage/preview` (imagens)
- `GET /storage/pdf`
- `GET /storage/media` (audio/video)
- `GET /storage/file` (texto)
- `PUT /storage/file` (salvar)
- `POST /storage/move` (mover/renomear)

## Editor no FileManager

Usa Monaco (`@monaco-editor/react`) com:
- IntelliSense basico
- Syntax highlighting por extensao
- Suporte para extensoes comuns (js, ts, json, sql, xml, etc.)

## CI/CD

Config:
```
POST /ci-cd/connect
```

Deploy:
```
POST /ci-cd/deploy
POST /ci-cd/webhook
```

O deploy executa:
- git clone/pull
- build script (se definido)
- restart (pm2 ou docker)
- rollback automatico se falhar

## Docker Compose

```
docker-compose up -d
```

Arquivos:
- `docker-compose.yml`
- `nginx/conf.d/default.conf`
- `.env`

## Instaladores

Linux (Debian/Ubuntu, RHEL/CentOS/Amazon Linux, SUSE):
```
./install.sh
```

macOS:
```
./install-macos.sh
```

FreeBSD:
```
./install-freebsd.sh
```

Windows Server:
```
install-windows.ps1
```

## Notas para continuidade

- Ajustar validacao de webhook GitHub/GitLab em CI/CD
- Melhorar permissao por roles no frontend
- Adicionar auditoria de comandos e logs estruturados
- Adicionar teste automatizado (API e UI)
