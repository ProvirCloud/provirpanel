#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(pwd)/provirpanel"

log() {
  printf "\n[update] %s\n" "$1"
}

run_as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  if [[ -f "${file}" ]] && ! grep -q "^${key}=" "${file}"; then
    echo "${key}=${value}" >> "${file}"
  fi
}

install_certbot() {
  log "Verificando Certbot"
  if command -v certbot >/dev/null 2>&1; then
    log "Certbot ja instalado"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    run_as_root apt-get update -y
    run_as_root apt-get install -y certbot python3-certbot-nginx || run_as_root apt-get install -y certbot || true
  elif command -v dnf >/dev/null 2>&1; then
    run_as_root dnf install -y certbot python3-certbot-nginx || run_as_root dnf install -y certbot || true
  elif command -v yum >/dev/null 2>&1; then
    run_as_root yum install -y certbot python3-certbot-nginx || run_as_root yum install -y certbot || true
  elif command -v zypper >/dev/null 2>&1; then
    run_as_root zypper refresh
    run_as_root zypper install -y certbot python3-certbot-nginx || run_as_root zypper install -y certbot || true
  fi

  if command -v certbot >/dev/null 2>&1; then
    log "Certbot instalado com sucesso"
  else
    log "Aviso: nao foi possivel instalar o Certbot automaticamente"
  fi
}

configure_sudoers() {
  log "Configurando sudoers para nginx"
  cat <<'SUDOERS' | run_as_root tee /etc/sudoers.d/provirpanel-nginx > /dev/null
# Allow provirpanel to manage nginx without password
provirpanel ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /usr/bin/nginx, /bin/systemctl reload nginx, /bin/systemctl restart nginx, /bin/systemctl stop nginx, /bin/systemctl start nginx, /usr/sbin/service nginx *
SUDOERS
  run_as_root chmod 440 /etc/sudoers.d/provirpanel-nginx
}

test_and_reload_nginx() {
  log "Testando configuracao do Nginx"
  if run_as_root nginx -t 2>&1; then
    log "Nginx config OK, recarregando"
    run_as_root nginx -s reload 2>/dev/null || run_as_root systemctl reload nginx 2>/dev/null || true
  else
    log "AVISO: Nginx config invalida, reload ignorado"
  fi
}

seed_blueprints() {
  local data_dir="${INSTALL_DIR}/backend/data"
  local seed_file="${INSTALL_DIR}/backend/src/data/blueprints-seed.json"
  local target_file="${data_dir}/blueprints.json"

  if [[ ! -f "${target_file}" ]] && [[ -f "${seed_file}" ]]; then
    log "Criando blueprints.json a partir do seed"
    mkdir -p "${data_dir}"
    cp "${seed_file}" "${target_file}"
  fi
}

# ─── Main ──────────────────────────────────────────────────────────────────────

log "Atualizando ProvirPanel"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "Erro: Diretório ${INSTALL_DIR} não encontrado"
  exit 1
fi

cd "${INSTALL_DIR}"

log "Verificando dependencias de extracao"
if command -v apt-get >/dev/null 2>&1; then
  run_as_root apt-get update -y
  run_as_root apt-get install -y unzip tar
elif command -v dnf >/dev/null 2>&1; then
  run_as_root dnf install -y unzip tar
elif command -v yum >/dev/null 2>&1; then
  run_as_root yum install -y unzip tar
elif command -v zypper >/dev/null 2>&1; then
  run_as_root zypper refresh
  run_as_root zypper install -y unzip tar
fi

install_certbot

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
  ensure_env_var "${ENV_FILE}" "PROVIR_SES_REGION" ""
  ensure_env_var "${ENV_FILE}" "PROVIR_SES_ACCESS_KEY_ID" ""
  ensure_env_var "${ENV_FILE}" "PROVIR_SES_SECRET_ACCESS_KEY" ""
  ensure_env_var "${ENV_FILE}" "PROVIR_SES_FROM_NAME" ""
  ensure_env_var "${ENV_FILE}" "PROVIR_SES_FROM_EMAIL" ""
  ensure_env_var "${ENV_FILE}" "PROVIR_SES_REPLY_TO" ""
  ensure_env_var "${ENV_FILE}" "REPUTATION_CHECK_URL" ""
  ensure_env_var "${ENV_FILE}" "REPUTATION_CHECK_TOKEN" ""
  ensure_env_var "${ENV_FILE}" "REPUTATION_PROVIDER" ""
  ensure_env_var "${ENV_FILE}" "GOOGLE_SAFE_BROWSING_API_KEY" ""
  ensure_env_var "${ENV_FILE}" "GOOGLE_SITE_VERIFICATION_FILE" "google4ce1fbbc8da57702.html"
  ensure_env_var "${ENV_FILE}" "GOOGLE_SITE_VERIFICATION_ROOT" "/var/www/panel"
  ensure_env_var "${ENV_FILE}" "AUTH_COOKIE_NAME" "provirpanel_token"
  ensure_env_var "${ENV_FILE}" "AUTH_COOKIE_SECURE" "auto"
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
run_as_root cp -r frontend/dist/* /var/www/panel/
run_as_root chown -R www-data:www-data /var/www/panel
run_as_root chmod -R 755 /var/www/panel

# Garantir sudoers para nginx (sempre atualiza para pegar novas permissões)
configure_sudoers

# Garantir permissões de escrita no diretório de configs do nginx
log "Verificando permissoes de escrita no Nginx"
if [[ -d /etc/nginx/sites-available ]]; then
  run_as_root chown -R root:provirpanel /etc/nginx/sites-available 2>/dev/null || true
  run_as_root chmod -R 775 /etc/nginx/sites-available 2>/dev/null || true
fi
if [[ -d /etc/nginx/sites-enabled ]]; then
  run_as_root chown -R root:provirpanel /etc/nginx/sites-enabled 2>/dev/null || true
  run_as_root chmod -R 775 /etc/nginx/sites-enabled 2>/dev/null || true
fi
if [[ -d /etc/nginx/conf.d ]]; then
  run_as_root chown -R root:provirpanel /etc/nginx/conf.d 2>/dev/null || true
  run_as_root chmod -R 775 /etc/nginx/conf.d 2>/dev/null || true
fi

# Criar diretório de backups do nginx
run_as_root mkdir -p /etc/nginx/provirpanel-backups
run_as_root chown provirpanel:provirpanel /etc/nginx/provirpanel-backups 2>/dev/null || true

# Seed blueprints se não existir
seed_blueprints

# Corrigir ownership do projeto
chown -R provirpanel:provirpanel "${INSTALL_DIR}" 2>/dev/null || true

# Testar e recarregar Nginx
test_and_reload_nginx

log "Reiniciando backend"
pm2 delete provirpanel-backend 2>/dev/null || true
pm2 start backend/src/server.js --name provirpanel-backend
pm2 save

log "Atualização concluída com sucesso"
log "Painel: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')/admin/"
