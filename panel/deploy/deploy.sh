#!/usr/bin/env bash
# Native (systemd) installs only: build the panel and deploy it to a server over SSH.
#   HOST=user@server bash panel/deploy/deploy.sh
#   Extra ssh options: SSH_OPTS="-i ~/.ssh/my_key"
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${HOST:?Usage: HOST=user@server bash panel/deploy/deploy.sh}
read -ra EXTRA_SSH_OPTS <<<"${SSH_OPTS:-}"
SSH=(ssh "${EXTRA_SSH_OPTS[@]}" -o BatchMode=yes "$HOST")

npm run build

tar -czf - dist server package.json package-lock.json deploy | "${SSH[@]}" 'set -e
  cd /tmp
  sudo mkdir -p /opt/valheim-panel
  sudo rm -rf /opt/valheim-panel/dist /opt/valheim-panel/server
  sudo tar -xzf - -C /opt/valheim-panel --no-same-owner
  sudo chown -R root:root /opt/valheim-panel
  cd /opt/valheim-panel && sudo npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
  sudo systemctl restart valheim-panel
  sleep 2
  systemctl is-active valheim-panel'
