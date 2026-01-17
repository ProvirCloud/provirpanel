#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(pwd)/provirpanel"

log() {
  printf "\n[update] %s\n" "$1"
}

ensure_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  if [[ -f "${file}" ]] && ! grep -q "^${key}=" "${file}"; then
    echo "${key}=${value}" >> "${file}"
  fi
}

log "Atualizando ProvirPanel"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "Erro: Diretório ${INSTALL_DIR} não encontrado"
  exit 1
fi

cd "${INSTALL_DIR}"

log "Verificando variaveis do Nginx no .env"
ENV_FILE="backend/.env"
if [[ -f "${ENV_FILE}" ]]; then
  ensure_env_var "${ENV_FILE}" "NGINX_CONFIG_PATH" "/etc/nginx"
  ensure_env_var "${ENV_FILE}" "NGINX_SITES_AVAILABLE" "/etc/nginx/sites-available"
  ensure_env_var "${ENV_FILE}" "NGINX_SITES_ENABLED" "/etc/nginx/sites-enabled"
  ensure_env_var "${ENV_FILE}" "NGINX_CONF_D" "/etc/nginx/conf.d"
  ensure_env_var "${ENV_FILE}" "NGINX_MAIN_CONFIG" "/etc/nginx/nginx.conf"
  ensure_env_var "${ENV_FILE}" "NGINX_ACCESS_LOG" "/var/log/nginx/access.log"
  ensure_env_var "${ENV_FILE}" "NGINX_ERROR_LOG" "/var/log/nginx/error.log"
  ensure_env_var "${ENV_FILE}" "NGINX_SSL_STORAGE" "/etc/nginx/ssl"
  ensure_env_var "${ENV_FILE}" "NGINX_BACKUP_DIR" "/etc/nginx/provirpanel-backups"
  ensure_env_var "${ENV_FILE}" "LETSENCRYPT_EMAIL" ""
else
  log "Aviso: backend/.env nao encontrado, pulando configuracao do Nginx"
fi

log "Baixando atualizações"
git config --global --add safe.directory "${INSTALL_DIR}"
git fetch origin
git reset --hard origin/main

log "Atualizando dependências backend"
npm install

# Verificar se Prisma precisa ser configurado
if [[ -f "backend/prisma/schema.prisma" ]]; then
  # Carregar variáveis de ambiente do backend
  if [[ -f "backend/.env" ]]; then
    log "Carregando variáveis de ambiente"
    set -a
    source backend/.env
    set +a
  fi

  log "Gerando Prisma Client"
  npx prisma generate --schema backend/prisma/schema.prisma

  log "Sincronizando schema do banco de dados"
  npx prisma db push --schema backend/prisma/schema.prisma --skip-generate --accept-data-loss 2>/dev/null || {
    log "Aviso: prisma db push falhou (pode ser normal na primeira execução)"
  }
fi

log "Atualizando dependências frontend"
cd frontend && npm install && cd ..

log "Compilando frontend"
cd frontend && npm run build && cd ..

log "Atualizando arquivos estáticos"
sudo cp -r frontend/dist/* /var/www/panel/
sudo chown -R www-data:www-data /var/www/panel
sudo chmod -R 755 /var/www/panel

log "Reiniciando backend"
pm2 delete provirpanel-backend 2>/dev/null || true
pm2 start backend/src/server.js --name provirpanel-backend
pm2 save

log "Atualização concluída"
