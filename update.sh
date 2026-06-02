#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(pwd)/provirpanel"
REPO_URL="git@github.com:ProvirCloud/provirpanel.git"

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

read_env_var() {
  local file="$1"
  local key="$2"
  local line
  if [[ ! -f "${file}" ]]; then
    return
  fi
  line="$(grep -E "^${key}=" "${file}" | tail -n 1 || true)"
  if [[ -n "${line}" ]]; then
    printf "%s" "${line#*=}" | sed 's/^"//;s/"$//;s/^'\''//;s/'\''$//'
  fi
}

configure_sites_runtime() {
  local env_file="$1"
  local projects_dir
  local sites_dir

  if [[ ! -f "${env_file}" ]]; then
    log "Aviso: backend/.env nao encontrado, pulando configuracao de Sites"
    return
  fi

  log "Configurando variaveis de Sites e WordPress"
  ensure_env_var "${env_file}" "SITES_DOCKER_NETWORK" "provirpanel"
  ensure_env_var "${env_file}" "SITES_DOCKER_NETWORK_PREFIX" "provirpanel-site"
  ensure_env_var "${env_file}" "SITES_PORT_START" "8100"
  ensure_env_var "${env_file}" "WORDPRESS_IMAGE" "wordpress:latest"
  ensure_env_var "${env_file}" "WORDPRESS_DB_IMAGE" "mariadb:11"
  ensure_env_var "${env_file}" "WORDPRESS_DB_FALLBACK_IMAGES" "mysql:8,mariadb:10.11"
  ensure_env_var "${env_file}" "DOCKER_PULL_RETRIES" "5"

  projects_dir="$(read_env_var "${env_file}" "CLOUDPAINEL_PROJECTS_DIR")"
  sites_dir="$(read_env_var "${env_file}" "SITES_BASE_DIR")"
  if [[ -z "${sites_dir}" ]]; then
    sites_dir="${projects_dir:-${INSTALL_DIR}/projects}/sites"
  fi

  mkdir -p "${sites_dir}" "${INSTALL_DIR}/backend/data"
  chown -R provirpanel:provirpanel "${sites_dir}" "${INSTALL_DIR}/backend/data" 2>/dev/null || true
  chmod -R 775 "${sites_dir}" 2>/dev/null || true
}

configure_github_ssh() {
  log "Configurando acesso Git SSH ao GitHub"
  mkdir -p "${HOME}/.ssh"
  chmod 700 "${HOME}/.ssh"
  touch "${HOME}/.ssh/known_hosts"
  chmod 600 "${HOME}/.ssh/known_hosts"

  if ! ssh-keygen -F github.com -f "${HOME}/.ssh/known_hosts" >/dev/null 2>&1; then
    ssh-keyscan github.com >> "${HOME}/.ssh/known_hosts" 2>/dev/null || true
  fi

  export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o StrictHostKeyChecking=accept-new}"
}

configure_git_origin() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Erro: ${INSTALL_DIR} nao e um repositorio Git"
    exit 1
  fi

  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "${REPO_URL}"
  else
    git remote add origin "${REPO_URL}"
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
  apt-get install -y unzip tar build-essential python3 openssh-client
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y unzip tar gcc gcc-c++ make python3 openssh-clients
elif command -v yum >/dev/null 2>&1; then
  yum install -y unzip tar gcc gcc-c++ make python3 openssh-clients
elif command -v zypper >/dev/null 2>&1; then
  zypper refresh
  zypper install -y unzip tar gcc gcc-c++ make python3 openssh
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
  configure_sites_runtime "${ENV_FILE}"
else
  log "Aviso: backend/.env nao encontrado, pulando configuracao do Nginx"
fi

log "Baixando atualizações"
git config --global --add safe.directory "${INSTALL_DIR}"
configure_github_ssh
configure_git_origin
git fetch origin || {
  echo "Erro: falha ao acessar ${REPO_URL}. Configure uma chave SSH/deploy key autorizada no GitHub para este servidor."
  exit 1
}
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
    sed -i 's/client_max_body_size.*/client_max_body_size 800m;/' "$PANEL_NGINX"
  else
    sed -i '/server_name/a\    client_max_body_size 800m;' "$PANEL_NGINX"
  fi
  need_admin_redirect=0
  need_root_assets=0
  if ! grep -q "location = /admin" "$PANEL_NGINX"; then
    need_admin_redirect=1
  fi
  if ! grep -q "location /assets/" "$PANEL_NGINX"; then
    need_root_assets=1
  fi
  if (( need_admin_redirect || need_root_assets )); then
    tmp_nginx="$(mktemp)"
    awk -v add_admin="$need_admin_redirect" -v add_assets="$need_root_assets" '
      add_admin == "1" && /location \/admin\// && inserted_admin == 0 {
        print "    location = /admin {"
        print "        return 301 /admin/;"
        print "    }"
        print ""
        inserted_admin=1
      }
      add_assets == "1" && /location \/admin\/assets\// && inserted_assets == 0 {
        print "    # Assets na raiz para permitir publicar o painel em subdominio sem /admin"
        print "    location /assets/ {"
        print "        alias /var/www/panel/assets/;"
        print "        expires 1y;"
        print "        add_header Cache-Control \"public, immutable\";"
        print "    }"
        print ""
        inserted_assets=1
      }
      { print }
    ' "$PANEL_NGINX" > "$tmp_nginx"
    cat "$tmp_nginx" > "$PANEL_NGINX"
    rm -f "$tmp_nginx"
  fi
  log "client_max_body_size 800m configurado no nginx do painel"
fi

# Tambem garantir no nginx.conf global
if [ -f /etc/nginx/nginx.conf ] && ! grep -q "client_max_body_size" /etc/nginx/nginx.conf; then
  sed -i '/http {/a\    client_max_body_size 800m;' /etc/nginx/nginx.conf
  log "client_max_body_size 800m adicionado ao nginx.conf global"
fi

test_and_reload_nginx

log "Reiniciando backend para carregar Sites e WordPress"
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
