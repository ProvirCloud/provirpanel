#!/usr/bin/env bash
set -euo pipefail

# CloudPainel installer (macOS Intel/Apple Silicon)
# Usage: curl -fsSL https://example.com/install-macos.sh | bash

REPO_URL="https://github.com/your-org/provirpanel.git"
INSTALL_DIR="${HOME}/provirpanel"
NODE_MAJOR="18"
ADMIN_USER="admin"
ADMIN_PASS="admin123"
PANEL_PORT="3000"
FRONTEND_PORT="4173"

log() {
  printf "\n[cloudpainel] %s\n" "$1"
}

install_brew() {
  if ! command -v brew >/dev/null 2>&1; then
    log "Installing Homebrew"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
}

install_packages() {
  log "Installing dependencies via Homebrew"
  brew update
  brew install git curl wget openssl@3
  brew install node@${NODE_MAJOR} postgresql@15
  brew install pm2 || npm install -g pm2
}

install_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker Desktop"
    brew install --cask docker
    log "Open Docker Desktop once to finish setup."
  fi
}

start_postgres() {
  log "Starting PostgreSQL"
  brew services start postgresql@15
}

clone_repo() {
  log "Cloning repository"
  if [[ ! -d "${INSTALL_DIR}" ]]; then
    git clone "${REPO_URL}" "${INSTALL_DIR}"
  else
    log "Repository already exists, pulling latest"
    git -C "${INSTALL_DIR}" pull
  fi
}

setup_database() {
  log "Configuring PostgreSQL database"
  createdb provirpanel || true
  psql "postgres://$(whoami)@/provirpanel" -f "${INSTALL_DIR}/backend/src/config/schema.sql"
}

install_dependencies() {
  log "Installing backend dependencies"
  cd "${INSTALL_DIR}"
  npm install

  log "Installing frontend dependencies"
  cd "${INSTALL_DIR}/frontend"
  npm install
}

build_frontend() {
  log "Building frontend"
  cd "${INSTALL_DIR}/frontend"
  npm run build
}

configure_env() {
  log "Configuring backend environment"
  local env_file="${INSTALL_DIR}/backend/.env"
  local jwt_secret
  jwt_secret=$(openssl rand -hex 32)

  cat <<ENV > "${env_file}"
PORT=${PANEL_PORT}
DATABASE_URL=postgres://$(whoami)@/provirpanel
DATABASE_SSL=false
DATABASE_SOCKET_PATH=/tmp
CORS_ORIGIN=*
JWT_SECRET=${jwt_secret}
JWT_EXPIRES_IN=1d
DEFAULT_ADMIN_USER=${ADMIN_USER}
DEFAULT_ADMIN_PASS=${ADMIN_PASS}
ENV
}

configure_pm2() {
  log "Starting services with PM2"
  cd "${INSTALL_DIR}"
  pm2 start backend/src/server.js --name provirpanel-backend
  cd "${INSTALL_DIR}/frontend"
  pm2 start npm --name provirpanel-frontend -- run preview -- --host 0.0.0.0 --port ${FRONTEND_PORT}
  pm2 save
}

print_summary() {
  log "Installation complete"
  echo "Panel URL: http://localhost:${FRONTEND_PORT}"
  echo "API URL:   http://localhost:${PANEL_PORT}"
  echo "Admin user: ${ADMIN_USER}"
  echo "Admin pass: ${ADMIN_PASS}"
}

main() {
  install_brew
  install_packages
  install_docker
  start_postgres
  clone_repo
  setup_database
  install_dependencies
  build_frontend
  configure_env
  configure_pm2
  print_summary
}

main "$@"
