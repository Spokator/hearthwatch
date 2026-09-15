#!/usr/bin/env bash
# Installs the pinned server-side mods from Thunderstore and the Hearthwatch bridge plugin.
set -euo pipefail

DATA="${HW_DATA_DIR:-/data}"
APP=/opt/hearthwatch
SERVER="$DATA/server"
BEPINEX="$SERVER/BepInEx"
STATE="$SERVER/.hearthwatch/mods"
# Thunderstore rejects requests without a browser-like user agent.
UA="Mozilla/5.0 (compatible; Hearthwatch; +https://github.com/Spokator/hearthwatch)"

mkdir -p "$STATE" "$BEPINEX/plugins" "$BEPINEX/patchers" "$BEPINEX/config"

wanted() {
  case "$1" in
    core) return 0 ;;
    qol) [ "${SERVERSIDE_QOL:-1}" = "1" ] ;;
    *) return 1 ;;
  esac
}

while read -r pkg; do
  id=$(jq -r .id <<<"$pkg")
  version=$(jq -r .version <<<"$pkg")
  type=$(jq -r '.type // "plugin"' <<<"$pkg")
  group=$(jq -r '.group // "core"' <<<"$pkg")
  marker="$STATE/$id"

  if ! wanted "$group"; then
    if [ -f "$marker" ]; then
      echo "[hearthwatch] Removing $id"
      rm -rf "$BEPINEX/plugins/$id" "$BEPINEX/patchers/$id" "$marker"
    fi
    continue
  fi
  [ "$(cat "$marker" 2>/dev/null || true)" = "$version" ] && continue

  echo "[hearthwatch] Installing $id $version"
  tmp=$(mktemp -d)
  curl -fsSL --retry 5 --retry-all-errors -A "$UA" -o "$tmp/pkg.zip" "https://thunderstore.io/package/download/${id%%-*}/${id#*-}/$version/"
  unzip -q "$tmp/pkg.zip" -d "$tmp/x"

  if [ "$type" = "bepinexpack" ]; then
    src="$tmp/x/BepInExPack_Valheim"
    rm -f "$src/winhttp.dll" "$src/start_game_bepinex.sh" "$src/start_server_bepinex.sh" "$src"/doorstop_libs/*.dylib
    cp -a "$src/." "$SERVER/"
  else
    rm -rf "$BEPINEX/plugins/$id" "$BEPINEX/patchers/$id"
    mkdir -p "$BEPINEX/plugins/$id"
    [ -d "$tmp/x/plugins" ] && cp -a "$tmp/x/plugins/." "$BEPINEX/plugins/$id/"
    if [ -d "$tmp/x/patchers" ]; then
      mkdir -p "$BEPINEX/patchers/$id"
      cp -a "$tmp/x/patchers/." "$BEPINEX/patchers/$id/"
    fi
    find "$tmp/x" -maxdepth 1 \( -name '*.dll' -o -name '*.deps.json' \) -exec cp {} "$BEPINEX/plugins/$id/" \;
  fi

  echo "$version" >"$marker"
  rm -rf "$tmp"
done < <(jq -c '.packages[]' "$APP/mods.json")

# Hearthwatch bridge plugin: always refreshed from the image.
mkdir -p "$BEPINEX/plugins/Hearthwatch"
cp "$APP/plugin/HearthwatchBridge.dll" "$BEPINEX/plugins/Hearthwatch/"

# RCON listens on localhost only and shares its password with the panel.
rcon_password=$(grep '^RCON_PASSWORD=' "$DATA/panel.env" | cut -d= -f2-)
rcon_cfg="$BEPINEX/config/org.tristan.rcon.cfg"
if [ -f "$rcon_cfg" ]; then
  sed -i "s|^Password = .*|Password = $rcon_password|; s|^Whitelist IP mask = .*|Whitelist IP mask = 127.0.0.1|" "$rcon_cfg"
else
  printf '[1. Rcon]\n\nPort = 2458\n\nPassword = %s\n\nWhitelist IP mask = 127.0.0.1\n' "$rcon_password" >"$rcon_cfg"
fi
chmod 600 "$rcon_cfg"

# ServersideQoL features that change the world or hold player items stay off until enabled from the panel.
if [ "${SERVERSIDE_QOL:-1}" = "1" ]; then
  for feature in AutoPortalHub Backpack; do
    cfg="$BEPINEX/config/ArgusMagnus.ServersideQoL.$feature.cfg"
    [ -f "$cfg" ] || printf '[%s]\n\nEnabled = false\n' "$feature" >"$cfg"
  done
fi
