#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$SCRIPT_DIR}"

PURGE_DATA=0
REMOVE_INSTALL_DIR=0
REMOVE_SYSTEM_CONFIG=0
ASSUME_YES=0

log() {
  printf "\n[uninstall] %s\n" "$1"
}

warn() {
  printf "\n[uninstall][warn] %s\n" "$1"
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Options:
  --purge-data            Remove DB/volumes/project data (destructive)
  --remove-system-config  Remove nginx and pm2 system config (requires root)
  --remove-install-dir    Remove project directory after uninstall
  -y, --yes               Do not ask for confirmation
  -h, --help              Show this help
USAGE
}

confirm_or_exit() {
  local message="$1"
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    return 0
  fi
  read -r -p "$message [y/N]: " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
  fi
}

is_root() {
  [[ "${EUID}" -eq 0 ]]
}

stop_dev_ports() {
  local ports=(3000 3001 5173 5174)
  for port in "${ports[@]}"; do
    if command -v lsof >/dev/null 2>&1; then
      local pids
      pids=$(lsof -ti tcp:"$port" || true)
      if [[ -n "$pids" ]]; then
        log "Stopping process(es) on port $port"
        kill $pids 2>/dev/null || true
      fi
    fi
  done
}

stop_docker_stack() {
  if command -v docker >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
    log "Stopping docker-compose stack"
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" down --remove-orphans || true
    if [[ "$PURGE_DATA" -eq 1 ]]; then
      docker compose -f "$SCRIPT_DIR/docker-compose.yml" down --remove-orphans -v || true
    fi
  fi
}

stop_pm2_processes() {
  if command -v pm2 >/dev/null 2>&1; then
    log "Stopping PM2 process provirpanel-backend"
    pm2 delete provirpanel-backend >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
  fi

  if id provirpanel >/dev/null 2>&1; then
    su - provirpanel -c "pm2 delete provirpanel-backend >/dev/null 2>&1 || true; pm2 save >/dev/null 2>&1 || true" || true
  fi
}

remove_system_config() {
  if [[ "$REMOVE_SYSTEM_CONFIG" -ne 1 ]]; then
    return 0
  fi

  if ! is_root; then
    warn "--remove-system-config requires root. Skipping system config cleanup."
    return 0
  fi

  log "Removing nginx and pm2 system config"
  rm -f /etc/nginx/sites-enabled/provirpanel || true
  rm -f /etc/nginx/sites-available/provirpanel || true
  rm -rf /var/www/panel || true

  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop pm2-provirpanel 2>/dev/null || true
    systemctl disable pm2-provirpanel 2>/dev/null || true
    systemctl reload nginx 2>/dev/null || true
  fi
}

purge_database() {
  if [[ "$PURGE_DATA" -ne 1 ]]; then
    return 0
  fi

  if ! is_root; then
    warn "--purge-data for PostgreSQL requires root. Skipping DB purge."
    return 0
  fi

  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found. Skipping DB purge."
    return 0
  fi

  log "Dropping PostgreSQL DB and role (provirpanel)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL' || true
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'provirpanel';
DROP DATABASE IF EXISTS provirpanel;
DROP ROLE IF EXISTS provirpanel;
SQL
}

remove_local_artifacts() {
  log "Removing local build artifacts"
  rm -rf "$SCRIPT_DIR/node_modules" || true
  rm -rf "$SCRIPT_DIR/frontend/node_modules" || true
  rm -rf "$SCRIPT_DIR/frontend/dist" || true
  rm -rf "$SCRIPT_DIR/backend/node_modules" || true

  if [[ "$PURGE_DATA" -eq 1 ]]; then
    log "Removing local project data"
    rm -rf "$SCRIPT_DIR/projects" || true
    rm -rf "$SCRIPT_DIR/backend/data" || true
  fi
}

remove_install_directory() {
  if [[ "$REMOVE_INSTALL_DIR" -eq 1 ]]; then
    if [[ "$INSTALL_DIR" == "/" || "$INSTALL_DIR" == "" ]]; then
      warn "Refusing to remove invalid INSTALL_DIR: '$INSTALL_DIR'"
      return 0
    fi
    log "Removing install directory: $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --purge-data)
        PURGE_DATA=1
        ;;
      --remove-system-config)
        REMOVE_SYSTEM_CONFIG=1
        ;;
      --remove-install-dir)
        REMOVE_INSTALL_DIR=1
        ;;
      -y|--yes)
        ASSUME_YES=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 1
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"

  confirm_or_exit "This will uninstall Provir Panel components from this machine. Continue?"

  stop_dev_ports
  stop_docker_stack
  stop_pm2_processes
  remove_system_config
  purge_database
  remove_local_artifacts
  remove_install_directory

  log "Uninstall finished"
}

main "$@"
