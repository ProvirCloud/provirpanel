#!/usr/bin/env bash
set -euo pipefail

echo "Parando e removendo containers pgAdmin..."
docker ps -a | grep pgadmin | awk '{print $1}' | xargs -r docker rm -f

echo "Removendo diretórios pgAdmin antigos..."
sudo find /home/ubuntu/provir/provirpanel/backend/data/projects/docker -name "*pgadmin*" -type d -exec rm -rf {} + 2>/dev/null || true

echo "Pronto! Agora crie um novo container pgAdmin pelo painel."
