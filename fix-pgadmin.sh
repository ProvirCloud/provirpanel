#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PGADMIN_DIR="${ROOT_DIR}/backend/data/projects/docker/pgadmin"

echo "Parando e removendo containers pgAdmin..."
docker ps -a | grep pgadmin | awk '{print $1}' | xargs -r docker rm -f

if [ -d "${PGADMIN_DIR}" ]; then
  echo "Ajustando permissões do volume pgAdmin em ${PGADMIN_DIR}..."
  chmod -R u+rwX,go+rwX "${PGADMIN_DIR}" || true
  if command -v docker >/dev/null 2>&1; then
    docker run --rm -v "${PGADMIN_DIR}:/var/lib/pgadmin" alpine:3.20 sh -c \
      'chown -R 5050:5050 /var/lib/pgadmin && chmod -R 777 /var/lib/pgadmin' \
      >/dev/null 2>&1 || true
  fi
fi

echo "Pronto! Agora recrie o container pgAdmin pelo painel."
