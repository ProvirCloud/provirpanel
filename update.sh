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

install_certbot() {
  log "Verificando Certbot"
  if command -v certbot >/dev/null 2>&1; then
    log "Certbot ja instalado"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y certbot python3-certbot-nginx || apt-get install -y certbot || true
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot python3-certbot-nginx || dnf install -y certbot || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y certbot python3-certbot-nginx || yum install -y certbot || true
  elif command -v zypper >/dev/null 2>&1; then
    zypper refresh
    zypper install -y certbot python3-certbot-nginx || zypper install -y certbot || true
  fi

  if command -v certbot >/dev/null 2>&1; then
    log "Certbot instalado com sucesso"
  else
    log "Aviso: nao foi possivel instalar o Certbot automaticamente"
  fi
}

configure_sudoers() {
  log "Configurando sudoers para nginx"
  cat <<'SUDOERS' > /etc/sudoers.d/provirpanel-nginx
# Allow provirpanel to manage nginx without password
provirpanel ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /usr/bin/nginx, /bin/systemctl reload nginx, /bin/systemctl restart nginx, /bin/systemctl stop nginx, /bin/systemctl start nginx, /usr/sbin/service nginx *, /bin/rm, /bin/cp, /bin/ln, /bin/mv*
SUDOERS
  chmod 440 /etc/sudoers.d/provirpanel-nginx
}

configure_nginx_permissions() {
  log "Configurando permissoes do Nginx para o backend"

  # O backend (provirpanel) precisa escrever configs diretamente
  if [[ -d /etc/nginx/sites-available ]]; then
    chown -R root:provirpanel /etc/nginx/sites-available
    chmod -R 775 /etc/nginx/sites-available
  fi
  if [[ -d /etc/nginx/sites-enabled ]]; then
    chown -R root:provirpanel /etc/nginx/sites-enabled
    chmod -R 775 /etc/nginx/sites-enabled
  fi
  if [[ -d /etc/nginx/conf.d ]]; then
    chown -R root:provirpanel /etc/nginx/conf.d
    chmod -R 775 /etc/nginx/conf.d
  fi

  # Diretório de backups
  mkdir -p /etc/nginx/provirpanel-backups
  chown provirpanel:provirpanel /etc/nginx/provirpanel-backups
  chmod 755 /etc/nginx/provirpanel-backups

  # SSL storage
  mkdir -p /etc/nginx/ssl
  chown root:provirpanel /etc/nginx/ssl
  chmod 775 /etc/nginx/ssl
}

test_and_reload_nginx() {
  log "Testando configuracao do Nginx"
  if nginx -t 2>&1; then
    log "Nginx config OK, recarregando"
    nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true
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
  apt-get update -y
  apt-get install -y unzip tar build-essential python3
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y unzip tar gcc gcc-c++ make python3
elif command -v yum >/dev/null 2>&1; then
  yum install -y unzip tar gcc gcc-c++ make python3
elif command -v zypper >/dev/null 2>&1; then
  zypper refresh
  zypper install -y unzip tar gcc gcc-c++ make python3
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
cp -r frontend/dist/* /var/www/panel/
chown -R www-data:www-data /var/www/panel
chmod -R 755 /var/www/panel

# Permissões do nginx (sempre atualiza)
configure_sudoers
configure_nginx_permissions

# Seed blueprints se não existir
seed_blueprints

# Corrigir ownership do projeto
chown -R provirpanel:provirpanel "${INSTALL_DIR}"

# Testar e recarregar Nginx

# Garantir client_max_body_size no nginx do painel
PANEL_NGINX="/etc/nginx/sites-available/provirpanel"
if [ -f "$PANEL_NGINX" ]; then
  if grep -q "client_max_body_size" "$PANEL_NGINX"; then
    sed -i 's/client_max_body_size.*/client_max_body_size 500m;/' "$PANEL_NGINX"
  else
    sed -i '/server_name/a\    client_max_body_size 500m;' "$PANEL_NGINX"
  fi
  log "client_max_body_size 500m configurado no nginx do painel"
fi

# Tambem garantir no nginx.conf global
if [ -f /etc/nginx/nginx.conf ] && ! grep -q "client_max_body_size" /etc/nginx/nginx.conf; then
  sed -i '/http {/a\    client_max_body_size 500m;' /etc/nginx/nginx.conf
  log "client_max_body_size 500m adicionado ao nginx.conf global"
fi

test_and_reload_nginx

log "Reiniciando backend"
pm2 delete provirpanel-backend 2>/dev/null || true
cd "${INSTALL_DIR}" && pm2 start backend/src/server.js --name provirpanel-backend --env production
pm2 save

# Garantir que PM2 inicie no boot
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root 2>/dev/null || true
pm2 startup systemd 2>/dev/null || true
pm2 save
systemctl enable pm2-root 2>/dev/null || systemctl enable pm2 2>/dev/null || true
systemctl start pm2-root 2>/dev/null || systemctl start pm2 2>/dev/null || true

log "Atualização concluída com sucesso"
log "Painel: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')/admin/"
