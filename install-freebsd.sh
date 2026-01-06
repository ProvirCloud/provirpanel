#!/usr/bin/env sh
set -e

# CloudPainel installer (FreeBSD)
# Usage: fetch -o - https://example.com/install-freebsd.sh | sh

REPO_URL="https://github.com/your-org/cloudpainel.git"
INSTALL_DIR="/usr/local/cloudpainel"
ADMIN_USER="admin"
ADMIN_PASS="admin123"
PANEL_PORT="3000"
FRONTEND_PORT="4173"

log() {
  printf "\n[cloudpainel] %s\n" "$1"
}

install_packages() {
  log "Installing packages with pkg"
  pkg update -f
  pkg install -y git curl wget node18 npm postgresql15-server pm2
}

start_postgres() {
  log "Initializing PostgreSQL"
  sysrc postgresql_enable="YES"
  service postgresql initdb || true
  service postgresql start
}

clone_repo() {
  log "Cloning repository"
  if [ ! -d "${INSTALL_DIR}" ]; then
    git clone "${REPO_URL}" "${INSTALL_DIR}"
  else
    log "Repository already exists, pulling latest"
    git -C "${INSTALL_DIR}" pull
  fi
}

setup_database() {
  log "Configuring PostgreSQL database"
  su -m postgres -c "createdb cloudpainel" || true
  psql "postgres://postgres@/cloudpainel" -f "${INSTALL_DIR}/backend/src/config/schema.sql"
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
  local jwt_secret
  jwt_secret=$(openssl rand -hex 32)
  cat <<ENV > "${INSTALL_DIR}/backend/.env"
PORT=${PANEL_PORT}
DATABASE_URL=postgres://postgres@/cloudpainel
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
  pm2 start backend/src/server.js --name cloudpainel-backend
  cd "${INSTALL_DIR}/frontend"
  pm2 start npm --name cloudpainel-frontend -- run preview -- --host 0.0.0.0 --port ${FRONTEND_PORT}
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
  install_packages
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
