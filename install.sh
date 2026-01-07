#!/usr/bin/env bash
set -euo pipefail

# CloudPainel one-liner installer (Linux only)
# Usage: curl -fsSL https://example.com/install.sh | bash

REPO_URL="https://github.com/ProvirCloud/provirpanel.git"
INSTALL_DIR="$(pwd)/provirpanel"
NODE_MAJOR="22"
ADMIN_USER="admin"
ADMIN_PASS="admin123"
PANEL_PORT="3000"
FRONTEND_PORT="4173"
DISTRO_ID=""
VERSION_ID=""
PKG_MANAGER=""
FAMILY=""

log() {
  printf "\n[cloudpainel] %s\n" "$1"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This installer must be run as root." >&2
    exit 1
  fi
}

detect_distro() {
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    DISTRO_ID="${ID}"
    VERSION_ID="${VERSION_ID:-}"
    case "${ID}" in
      ubuntu|debian)
        FAMILY="debian"
        PKG_MANAGER="apt"
        ;;
      rhel|centos|rocky|almalinux|ol|amzn)
        FAMILY="rhel"
        if command -v dnf >/dev/null 2>&1; then
          PKG_MANAGER="dnf"
        else
          PKG_MANAGER="yum"
        fi
        ;;
      sles|opensuse-leap|opensuse-tumbleweed)
        FAMILY="suse"
        PKG_MANAGER="zypper"
        ;;
      *)
        echo "Unsupported distro: ${ID}" >&2
        exit 1
        ;;
    esac
  else
    echo "Cannot detect distro. /etc/os-release not found." >&2
    exit 1
  fi
}

install_packages() {
  log "Installing base packages"
  if [[ "${PKG_MANAGER}" == "apt" ]]; then
    apt-get update -y
    apt-get install -y curl wget git ca-certificates gnupg lsb-release openssl nginx
  elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
    dnf install -y curl wget git ca-certificates gnupg2 openssl nginx
  elif [[ "${PKG_MANAGER}" == "yum" ]]; then
    yum install -y curl wget git ca-certificates gnupg2 openssl nginx
  elif [[ "${PKG_MANAGER}" == "zypper" ]]; then
    zypper refresh
    zypper install -y curl wget git ca-certificates gpg2 openssl nginx
  fi
}

install_node() {
  log "Installing Node.js ${NODE_MAJOR}.x"
  if ! command -v node >/dev/null 2>&1; then
    if [[ "${FAMILY}" == "debian" ]]; then
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      apt-get install -y nodejs
    elif [[ "${FAMILY}" == "rhel" ]]; then
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      if [[ "${PKG_MANAGER}" == "dnf" ]]; then
        dnf install -y nodejs
      else
        yum install -y nodejs
      fi
    elif [[ "${FAMILY}" == "suse" ]]; then
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - || true
      zypper install -y nodejs || zypper install -y nodejs22
    fi
  fi
}

install_docker() {
  log "Installing Docker"
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
  fi
}

install_postgres() {
  log "Installing PostgreSQL"
  if ! command -v psql >/dev/null 2>&1; then
    if [[ "${FAMILY}" == "debian" ]]; then
      apt-get install -y postgresql postgresql-contrib
    elif [[ "${FAMILY}" == "rhel" ]]; then
      if [[ "${PKG_MANAGER}" == "dnf" ]]; then
        dnf install -y postgresql-server postgresql-contrib
      else
        yum install -y postgresql-server postgresql-contrib
      fi
      postgresql-setup --initdb || true
    elif [[ "${FAMILY}" == "suse" ]]; then
      zypper install -y postgresql-server
      su - postgres -c "initdb --locale en_US.UTF-8 -D /var/lib/pgsql/data" || true
    fi
    systemctl enable postgresql || true
    systemctl start postgresql || true
  fi
}

install_pm2() {
  log "Installing pm2"
  npm install -g pm2
}

create_user() {
  log "Creating user provirpanel"
  if ! id provirpanel >/dev/null 2>&1; then
    useradd -m -s /bin/bash provirpanel
  fi
  usermod -aG docker provirpanel || true
}

clone_repo() {
  log "Cloning repository"
  if [[ ! -d "${INSTALL_DIR}" ]]; then
    git clone "${REPO_URL}" "${INSTALL_DIR}" || {
      log "Failed to clone repository. Make sure it's public or configure credentials."
      exit 1
    }
    chown -R provirpanel:provirpanel "${INSTALL_DIR}"
  else
    log "Repository found, checking for updates"
    cd "${INSTALL_DIR}"
    git config --global --add safe.directory "${INSTALL_DIR}"
    git fetch origin
    if ! git diff --quiet HEAD origin/main; then
      log "Updates found, pulling latest changes"
      git reset --hard origin/main
      chown -R provirpanel:provirpanel "${INSTALL_DIR}"
    else
      log "Repository is up to date"
    fi
  fi
}

setup_database() {
  log "Configuring PostgreSQL database"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $BODY$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'provirpanel') THEN
    CREATE ROLE provirpanel LOGIN PASSWORD 'provirpanel';
  END IF;
END$BODY$;
SQL

  # Criar banco se não existir
  sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname = 'provirpanel'" | grep -q 1 || \
    sudo -u postgres createdb -O provirpanel provirpanel

  # Executar schema como root e depois conectar como provirpanel
  if [[ -f "${INSTALL_DIR}/backend/src/config/schema.sql" ]]; then
    sudo -u postgres psql provirpanel < "${INSTALL_DIR}/backend/src/config/schema.sql"
  else
    log "Warning: schema.sql not found, skipping database schema setup"
  fi
}

install_dependencies() {
  log "Installing backend dependencies"
  # Corrigir permissões do diretório pai
  chown -R provirpanel:provirpanel "$(dirname "${INSTALL_DIR}")"
  chown -R provirpanel:provirpanel "${INSTALL_DIR}"
  chmod -R 755 "${INSTALL_DIR}"
  
  # Instalar como root no diretório do projeto
  cd "${INSTALL_DIR}" && npm install
  chown -R provirpanel:provirpanel "${INSTALL_DIR}"

  log "Installing frontend dependencies"
  cd "${INSTALL_DIR}/frontend" && npm install
  chown -R provirpanel:provirpanel "${INSTALL_DIR}"
}

build_frontend() {
  log "Building frontend"
  # Garantir permissões completas antes do build
  chmod -R 755 "${INSTALL_DIR}"
  chown -R root:root "${INSTALL_DIR}"
  
  # Executar build como root
  cd "${INSTALL_DIR}/frontend" && npm run build
  chown -R provirpanel:provirpanel "${INSTALL_DIR}"
}

configure_env() {
  log "Configuring backend environment"
  local env_file="${INSTALL_DIR}/backend/.env"
  local jwt_secret
  jwt_secret=$(openssl rand -hex 32)

  cat <<ENV > "${env_file}"
PORT=${PANEL_PORT}
DATABASE_URL=postgres://provirpanel:provirpanel@localhost:5432/provirpanel
DATABASE_SSL=false
CORS_ORIGIN=*
JWT_SECRET=${jwt_secret}
JWT_EXPIRES_IN=1d
CLOUDPAINEL_PROJECTS_DIR=${INSTALL_DIR}/projects
DEFAULT_ADMIN_USER=${ADMIN_USER}
DEFAULT_ADMIN_PASS=${ADMIN_PASS}
TERMINAL_OS_USER=provirpanel
ENV

  chown provirpanel:provirpanel "${env_file}"
  mkdir -p "${INSTALL_DIR}/projects"
  chown -R provirpanel:provirpanel "${INSTALL_DIR}/projects"
}

configure_nginx() {
  log "Configuring Nginx"
  
  # Remover site padrão primeiro
  rm -f /etc/nginx/sites-enabled/default
  
  # Criar diretório para arquivos estáticos
  mkdir -p /var/www/panel
  
  # Copiar arquivos do frontend para www-data
  cp -r "${INSTALL_DIR}/frontend/dist/"* /var/www/panel/
  chown -R www-data:www-data /var/www/panel
  chmod -R 755 /var/www/panel
  
  cat <<NGINX > /etc/nginx/sites-available/provirpanel
server {
    listen 80 default_server;
    listen [::]:80 default_server;
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
    
    # Admin Panel - servir arquivos estáticos
    location /admin/ {
        alias /var/www/panel/;
        try_files \$uri \$uri/ @fallback;
        index index.html;
    }
    
    location @fallback {
        rewrite ^.*$ /admin/index.html last;
    }
    
    # Admin Panel assets
    location /admin/assets/ {
        alias /var/www/panel/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Default redirect to admin
    location = / {
        return 301 /admin/;
    }
}
NGINX

  # Enable site
  ln -sf /etc/nginx/sites-available/provirpanel /etc/nginx/sites-enabled/
  
  # Test and reload nginx
  nginx -t && systemctl reload nginx
  systemctl enable nginx
}

configure_pm2() {
  log "Configuring PM2 processes"
  # Parar processo existente se houver
  pm2 delete provirpanel-backend 2>/dev/null || true
  
  # Aguardar banco estar pronto
  sleep 3
  
  # Executar PM2 com as variáveis de ambiente
  cd "${INSTALL_DIR}" && pm2 start backend/src/server.js --name provirpanel-backend --env production
  pm2 save

  log "Enabling PM2 startup service"
  pm2 startup systemd -u provirpanel --hp /home/provirpanel
  systemctl enable pm2-provirpanel
  systemctl start pm2-provirpanel
}

create_admin_user() {
  log "Creating default admin user"
  sleep 2
  curl -fsSL -X POST "http://localhost:${PANEL_PORT}/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
    || true
}

print_summary() {
  local ip_addr
  ip_addr=$(hostname -I | awk '{print $1}')
  log "Installation complete"
  echo "Panel URL: http://${ip_addr}/admin"
  echo "API URL:   http://${ip_addr}/api"
  echo "Admin user: ${ADMIN_USER}"
  echo "Admin pass: ${ADMIN_PASS}"
  echo "Install dir: ${INSTALL_DIR}"
}

main() {
  require_root
  detect_distro
  install_packages
  install_node
  install_docker
  install_postgres
  install_pm2
  create_user
  clone_repo
  setup_database
  install_dependencies
  build_frontend
  configure_env
  configure_nginx
  configure_pm2
  create_admin_user
  print_summary
}

main "$@"
