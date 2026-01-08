#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(pwd)/provirpanel"

log() {
  printf "\n[update] %s\n" "$1"
}

log "Atualizando ProvirPanel"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "Erro: Diretório ${INSTALL_DIR} não encontrado"
  exit 1
fi

cd "${INSTALL_DIR}"

log "Baixando atualizações"
git config --global --add safe.directory "${INSTALL_DIR}"
git fetch origin
git reset --hard origin/main

log "Atualizando dependências backend"
npm install

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