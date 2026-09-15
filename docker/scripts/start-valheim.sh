#!/usr/bin/env bash
# Run by supervisord: update the game, install mods, then start Valheim with the panel settings.
set -uo pipefail

DATA="${HW_DATA_DIR:-/data}"
SERVER="$DATA/server"
export LOG="$DATA/logs/valheim.log"

# Timestamped lines, same shape as `journalctl -o short-iso`, so the panel parses both modes alike.
log() {
  perl -MPOSIX -ne 'BEGIN { $| = 1; open(OUT, ">>", $ENV{LOG}) or die; select((select(OUT), $| = 1)[0]) }
    my $line = strftime("%Y-%m-%dT%H:%M:%S+00:00", gmtime) . " hearthwatch valheim: " . $_;
    print OUT $line; print $line;'
}

if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 52428800 ]; then mv "$LOG" "$LOG.1"; fi

# The panel shows "updating" while this marker exists.
touch /tmp/hearthwatch-updating
echo "[hearthwatch] Server starting: updating Valheim with SteamCMD" | log
for attempt in 1 2 3; do
  "$DATA/steamcmd/steamcmd.sh" +force_install_dir "$SERVER" +login anonymous +app_update 896660 +quit 2>&1 | log
  [ -x "$SERVER/valheim_server.x86_64" ] && break
  echo "[hearthwatch] SteamCMD attempt $attempt failed, retrying" | log
  sleep 10
done
/opt/hearthwatch/scripts/install-mods.sh 2>&1 | log
rm -f /tmp/hearthwatch-updating

if [ ! -x "$SERVER/valheim_server.x86_64" ]; then
  echo "[hearthwatch] Valheim is not installed, giving up" | log
  exit 1
fi

# valheim.env is written by the panel: KEY=value lines, values may contain spaces.
while IFS='=' read -r key value; do
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && export "$key=$value"
done <"$DATA/valheim.env"

cd "$SERVER"
export SteamAppId=892970
export LD_LIBRARY_PATH="./linux64:${LD_LIBRARY_PATH:-}"
if [ "${MODS_ENABLED:-1}" = "1" ]; then
  export DOORSTOP_ENABLED=1
  export DOORSTOP_TARGET_ASSEMBLY=./BepInEx/core/BepInEx.Preloader.dll
  export LD_LIBRARY_PATH="./doorstop_libs:$LD_LIBRARY_PATH"
  export LD_PRELOAD="libdoorstop_x64.so:${LD_PRELOAD:-}"
fi

args=(-nographics -batchmode
  -name "$SERVER_NAME" -port "${SERVER_PORT:-2456}" -world "$WORLD_NAME"
  -password "$SERVER_PASSWORD" -public "${SERVER_PUBLIC:-0}"
  -savedir "$DATA/data"
  -saveinterval "${SAVE_INTERVAL:-1200}" -backups "${BACKUPS:-4}"
  -backupshort "${BACKUP_SHORT:-7200}" -backuplong "${BACKUP_LONG:-43200}")
[ "${SERVER_CROSSPLAY:-0}" = "1" ] && args+=(-crossplay)
[ -n "${WORLD_PRESET:-}" ] && args+=(-preset "$WORLD_PRESET")
for m in ${WORLD_MODIFIERS:-}; do args+=(-modifier "${m%%:*}" "${m#*:}"); done
for k in ${WORLD_KEYS:-}; do args+=(-setkey "$k"); done

./valheim_server.x86_64 "${args[@]}" > >(log) 2>&1 &
pid=$!
# Forward stop requests as SIGINT so Valheim saves the world before exiting.
trap 'kill -INT "$pid" 2>/dev/null' INT TERM
wait "$pid"
status=$?
while kill -0 "$pid" 2>/dev/null; do
  wait "$pid"
  status=$?
done
echo "[hearthwatch] Server stopped (exit code $status)" | log
exit "$status"
