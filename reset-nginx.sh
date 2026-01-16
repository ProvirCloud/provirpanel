#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_PORT="${PANEL_PORT:-3000}"
ADMIN_PATH="${ADMIN_PATH:-/admin/}"
FRONTEND_DIST="${FRONTEND_DIST:-${ROOT_DIR}/frontend/dist}"

timestamp() {
  date +"%Y%m%d%H%M%S"
}

log() {
  printf "\n[reset-nginx] %s\n" "$1"
}

if [[ ! -d "${FRONTEND_DIST}" ]]; then
  log "Frontend dist not found at ${FRONTEND_DIST}. Run frontend build first."
  exit 1
fi

OS_ID=""
OS_LIKE=""
if [[ -f /etc/os-release ]]; then
  OS_ID=$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
  OS_LIKE=$(grep -E '^ID_LIKE=' /etc/os-release | cut -d= -f2 | tr -d '"' || true)
fi

PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"

NGINX_DIR=""
SITE_DIR=""
ENABLED_DIR=""
CONF_TARGET=""
WEB_ROOT=""

if [[ "${PLATFORM}" == "darwin" ]]; then
  if [[ -d "/opt/homebrew/etc/nginx" ]]; then
    NGINX_DIR="/opt/homebrew/etc/nginx"
    WEB_ROOT="/opt/homebrew/var/www/provirpanel"
  else
    NGINX_DIR="/usr/local/etc/nginx"
    WEB_ROOT="/usr/local/var/www/provirpanel"
  fi
  if [[ -d "${NGINX_DIR}/servers" ]]; then
    CONF_TARGET="${NGINX_DIR}/servers/provirpanel.conf"
  else
    mkdir -p "${NGINX_DIR}/conf.d"
    CONF_TARGET="${NGINX_DIR}/conf.d/provirpanel.conf"
  fi
else
  NGINX_DIR="/etc/nginx"
  SITE_DIR="${NGINX_DIR}/sites-available"
  ENABLED_DIR="${NGINX_DIR}/sites-enabled"
  WEB_ROOT="/var/www/panel"
  mkdir -p "${SITE_DIR}" "${ENABLED_DIR}"
  CONF_TARGET="${SITE_DIR}/provirpanel"
fi

log "Using nginx directory: ${NGINX_DIR}"
log "Writing config to: ${CONF_TARGET}"
log "Web root: ${WEB_ROOT}"

mkdir -p "${WEB_ROOT}"
cp -r "${FRONTEND_DIST}/"* "${WEB_ROOT}/"
chmod -R 755 "${WEB_ROOT}"

if [[ -f "${CONF_TARGET}" ]]; then
  cp "${CONF_TARGET}" "${CONF_TARGET}.bak.$(timestamp)"
fi

cat <<NGINX > "${CONF_TARGET}"
server {
    listen 80;
    server_name _;

    # API Backend
    location /api/ {
        proxy_pass http://localhost:${PANEL_PORT}/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Socket.io
    location /socket.io/ {
        proxy_pass http://localhost:${PANEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Admin Panel - serve static files
    location ${ADMIN_PATH} {
        alias ${WEB_ROOT}/;
        try_files \$uri \$uri/ ${ADMIN_PATH}index.html;
        index index.html;
    }

    # Admin Panel assets
    location ${ADMIN_PATH}assets/ {
        alias ${WEB_ROOT}/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Default redirect to admin
    location = / {
        return 301 ${ADMIN_PATH};
    }
}
NGINX

if [[ -n "${ENABLED_DIR}" ]]; then
  rm -f "${ENABLED_DIR}/default" || true
  ln -sf "${CONF_TARGET}" "${ENABLED_DIR}/provirpanel"
fi

if command -v nginx >/dev/null 2>&1; then
  nginx -t
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload nginx || systemctl restart nginx
  else
    nginx -s reload
  fi
else
  log "Nginx not found in PATH. Please install and reload manually."
fi

log "Nginx reconfigured to default panel setup."
