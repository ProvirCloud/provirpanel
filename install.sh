#!/usr/bin/env bash
set -euo pipefail

# CloudPainel one-liner installer (Linux only)
# Usage: curl -fsSL https://example.com/install.sh | bash

REPO_URL="https://github.com/your-org/provirpanel.git"
INSTALL_DIR="/home/provirpanel/provirpanel"
NODE_MAJOR="18"
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
    apt-get install -y curl wget git ca-certificates gnupg lsb-release openssl
  elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
    dnf install -y curl wget git ca-certificates gnupg2 openssl
  elif [[ "${PKG_MANAGER}" == "yum" ]]; then
    yum install -y curl wget git ca-certificates gnupg2 openssl
  elif [[ "${PKG_MANAGER}" == "zypper" ]]; then
    zypper refresh
    zypper install -y curl wget git ca-certificates gpg2 openssl
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
      zypper install -y nodejs || zypper install -y nodejs18
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
    sudo -u provirpanel git clone "${REPO_URL}" "${INSTALL_DIR}"
  else
    log "Repository already exists, pulling latest"
    sudo -u provirpanel git -C "${INSTALL_DIR}" pull
  fi
}

setup_database() {
  log "Configuring PostgreSQL database"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'provirpanel') THEN
    CREATE ROLE provirpanel LOGIN PASSWORD 'provirpanel';
  END IF;
END$$;
CREATE DATABASE provirpanel OWNER provirpanel;
SQL

  sudo -u provirpanel psql "postgres://provirpanel:provirpanel@localhost:5432/provirpanel" \
    -f "${INSTALL_DIR}/backend/src/config/schema.sql"
}

install_dependencies() {
  log "Installing backend dependencies"
  sudo -u provirpanel bash -lc "cd ${INSTALL_DIR} && npm install"

  log "Installing frontend dependencies"
  sudo -u provirpanel bash -lc "cd ${INSTALL_DIR}/frontend && npm install"
}

build_frontend() {
  log "Building frontend"
  sudo -u provirpanel bash -lc "cd ${INSTALL_DIR}/frontend && npm run build"
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
ENV

  chown provirpanel:provirpanel "${env_file}"
}

generate_ssl() {
  log "Generating self-signed SSL"
  local ssl_dir="/home/provirpanel/ssl"
  mkdir -p "${ssl_dir}"
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "${ssl_dir}/cloudpainel.key" \
    -out "${ssl_dir}/cloudpainel.crt" \
    -subj "/CN=cloudpainel.local"
  chown -R provirpanel:provirpanel "${ssl_dir}"
}

configure_pm2() {
  log "Configuring PM2 processes"
  sudo -u provirpanel bash -lc "cd ${INSTALL_DIR} && pm2 start backend/src/server.js --name provirpanel-backend"
  sudo -u provirpanel bash -lc "cd ${INSTALL_DIR}/frontend && pm2 start npm --name provirpanel-frontend -- run preview -- --host 0.0.0.0 --port ${FRONTEND_PORT}"
  sudo -u provirpanel pm2 save

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
  echo "Panel URL: http://${ip_addr}:${FRONTEND_PORT}"
  echo "API URL:   http://${ip_addr}:${PANEL_PORT}"
  echo "Admin user: ${ADMIN_USER}"
  echo "Admin pass: ${ADMIN_PASS}"
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
  generate_ssl
  configure_pm2
  create_admin_user
  print_summary
}

main "$@"
