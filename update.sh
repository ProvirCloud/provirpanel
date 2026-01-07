#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(pwd)/provirpanel"

log() {
  printf "\n[update] %s\n" "$1"
}

log "Atualizando ProvirPanel"

# Verificar se o diretório existe
if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "Erro: Diretório ${INSTALL_DIR} não encontrado"
  exit 1
fi

cd "${INSTALL_DIR}"

# Atualizar código
log "Baixando atualizações"
git config --global --add safe.directory "${INSTALL_DIR}"
git fetch origin
git reset --hard origin/main

# Instalar dependências backend
log "Atualizando dependências backend"
npm install

# Instalar dependências frontend
log "Atualizando dependências frontend"
cd frontend && npm install && cd ..

# Build frontend
log "Compilando frontend"
cd frontend && npm run build && cd ..

# Copiar arquivos para nginx
log "Atualizando arquivos estáticos"
sudo cp -r frontend/dist/* /var/www/panel/
sudo chown -R www-data:www-data /var/www/panel
sudo chmod -R 755 /var/www/panel

# Reiniciar backend
log "Reiniciando backend"
pm2 restart provirpanel-backend
pm2 save

log "Atualização concluída"