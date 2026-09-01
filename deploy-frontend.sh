#!/usr/bin/env bash
#
# deploy-frontend.sh — build + publish do frontend do ProvirPanel.
#
# CONTEXTO: `npm run build` sozinho NÃO publica. O Nginx (vhost
# ai.zeusengine.com.br, caminho /admin/) serve de /var/www/panel — o build
# precisa ser COPIADO para lá (é o que o update.sh faz na linha ~298).
# Este script automatiza build → copy → chown para evitar o passo manual.
#
# Uso:
#   ./deploy-frontend.sh            # build + deploy
#   SKIP_BUILD=1 ./deploy-frontend.sh   # só publica o dist/ atual (sem rebuildar)
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
DIST_DIR="${FRONTEND_DIR}/dist"
WEB_ROOT="${WEB_ROOT:-/var/www/panel}"
WEB_OWNER="${WEB_OWNER:-www-data:www-data}"

echo "[deploy-frontend] frontend: ${FRONTEND_DIR}"
echo "[deploy-frontend] web root: ${WEB_ROOT}"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "[deploy-frontend] building..."
  ( cd "${FRONTEND_DIR}" && npm run build )
else
  echo "[deploy-frontend] SKIP_BUILD=1 → usando dist/ existente"
fi

if [ ! -f "${DIST_DIR}/index.html" ]; then
  echo "[deploy-frontend] ERRO: ${DIST_DIR}/index.html não existe. Build falhou?" >&2
  exit 1
fi

# Precisa de sudo se o diretório for de outro dono (www-data).
SUDO=""
if [ ! -w "${WEB_ROOT}" ]; then SUDO="sudo"; fi

echo "[deploy-frontend] publicando em ${WEB_ROOT}..."
${SUDO} mkdir -p "${WEB_ROOT}"
${SUDO} rm -rf "${WEB_ROOT:?}/"*
${SUDO} cp -r "${DIST_DIR}/"* "${WEB_ROOT}/"
${SUDO} chown -R "${WEB_OWNER}" "${WEB_ROOT}" 2>/dev/null || true

BUNDLE="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "${WEB_ROOT}/index.html" | head -1 || true)"
echo "[deploy-frontend] OK. Bundle publicado: ${BUNDLE}"
echo "[deploy-frontend] Recarregue com cache limpo (Ctrl+Shift+R)."
