#!/usr/bin/env bash
# Hearthwatch container entrypoint: first-run setup, then hand over to supervisord.
set -euo pipefail

DATA="${HW_DATA_DIR:-/data}"
APP=/opt/hearthwatch

mkdir -p "$DATA"/{server,data,backups,logs,steamcmd}

random() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-16}" || true; }

# Game settings are seeded once from the environment, then owned by the panel.
if [ ! -f "$DATA/valheim.env" ]; then
  password="${SERVER_PASSWORD:-}"
  [ "${#password}" -ge 5 ] || password="$(random 10)"
  umask 077
  cat >"$DATA/valheim.env" <<EOF
SERVER_NAME=${SERVER_NAME:-My Valheim Server}
SERVER_PASSWORD=$password
WORLD_NAME=${WORLD_NAME:-Dedicated}
SERVER_PORT=2456
SERVER_PUBLIC=${SERVER_PUBLIC:-0}
SERVER_CROSSPLAY=${SERVER_CROSSPLAY:-1}
MODS_ENABLED=1
SAVE_INTERVAL=1200
BACKUPS=4
BACKUP_SHORT=7200
BACKUP_LONG=43200
WORLD_PRESET=
WORLD_MODIFIERS=
WORLD_KEYS=
EOF
  umask 022
  echo "[hearthwatch] Game settings created. Server password: $password"
fi

# Shared secret between the panel and the RCON plugin (RCON only listens locally).
touch "$DATA/panel.env"
chmod 600 "$DATA/panel.env"
if ! grep -q '^RCON_PASSWORD=' "$DATA/panel.env"; then
  printf 'RCON_PORT=2458\nRCON_PASSWORD=%s\n' "$(random 32)" >>"$DATA/panel.env"
fi

if [ ! -x "$DATA/steamcmd/steamcmd.sh" ]; then
  echo "[hearthwatch] Downloading SteamCMD..."
  curl -fsSL --retry 5 https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz -C "$DATA/steamcmd"
fi

exec supervisord -c "$APP/supervisord.conf"
