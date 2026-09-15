#!/usr/bin/env bash
# Hearthwatch installer
#   curl -fsSL https://raw.githubusercontent.com/Spokator/hearthwatch/main/install.sh | bash
# Non-interactive: HW_YES=1 SERVER_NAME=... SERVER_PASSWORD=... bash install.sh
set -euo pipefail

REPO_RAW="${HW_REPO_RAW:-https://raw.githubusercontent.com/Spokator/hearthwatch/main}"
DIR="${HEARTHWATCH_DIR:-$HOME/hearthwatch}"
YES="${HW_YES:-0}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[36m›\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# Read from the terminal even when the script is piped into bash.
ask() {
  local prompt="$1" default="${2:-}" answer=""
  if [ "$YES" = "1" ] || [ ! -r /dev/tty ]; then
    printf '%s' "$default"
    return
  fi
  if [ -n "$default" ]; then printf '%s [%s]: ' "$prompt" "$default" >/dev/tty; else printf '%s: ' "$prompt" >/dev/tty; fi
  read -r answer </dev/tty || true
  printf '%s' "${answer:-$default}"
}

yes_no() {
  local answer
  answer=$(ask "$1 (y/n)" "$2")
  [[ "$answer" =~ ^[YyOo] ]]
}

# ---------- Language ----------
LANG_CHOICE="${HW_LANGUAGE:-$(ask 'Language / Langue (en/fr)' 'en')}"
[ "$LANG_CHOICE" = "fr" ] || LANG_CHOICE="en"
t() {
  if [ "$LANG_CHOICE" = "fr" ]; then printf '%s' "$2"; else printf '%s' "$1"; fi
}

bold "Hearthwatch — $(t 'Valheim server + web panel + live map' 'serveur Valheim + panel web + carte en direct')"

# ---------- Requirements ----------
[ "$(uname -s)" = "Linux" ] || die "$(t 'Linux is required.' 'Linux est requis.')"
command -v curl >/dev/null || die "$(t 'curl is required.' 'curl est requis.')"

if ! command -v docker >/dev/null; then
  warn "$(t 'Docker is not installed.' 'Docker n’est pas installé.')"
  if yes_no "$(t 'Install Docker now with the official script (get.docker.com)?' 'Installer Docker maintenant avec le script officiel (get.docker.com) ?')" "n"; then
    curl -fsSL https://get.docker.com | sh
  else
    die "$(t 'Install Docker, then run this script again: https://docs.docker.com/engine/install/' 'Installe Docker puis relance ce script : https://docs.docker.com/engine/install/')"
  fi
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null || [ -r /dev/tty ]; then DOCKER=(sudo docker); fi
  "${DOCKER[@]}" info >/dev/null 2>&1 || die "$(t 'Cannot talk to Docker (is the daemon running?).' 'Impossible de contacter Docker (le service tourne-t-il ?).')"
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || die "$(t 'Docker Compose v2 is required (docker compose).' 'Docker Compose v2 est requis (docker compose).')"

# ---------- Settings ----------
mkdir -p "$DIR"
cd "$DIR"

if [ -f .env ]; then
  info "$(t "Existing installation found in $DIR: keeping its .env" "Installation existante trouvée dans $DIR : son .env est conservé")"
else
  SERVER_NAME="${SERVER_NAME:-$(ask "$(t 'Server name' 'Nom du serveur')" 'My Valheim Server')}"
  while :; do
    SERVER_PASSWORD="${SERVER_PASSWORD:-$(ask "$(t 'Server password (5+ characters, empty = generate)' 'Mot de passe du serveur (5 caractères min., vide = généré)')" '')}"
    if [ -z "$SERVER_PASSWORD" ]; then SERVER_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 10 || true); fi
    if [ "${#SERVER_PASSWORD}" -lt 5 ]; then
      warn "$(t 'Too short.' 'Trop court.')"; SERVER_PASSWORD=""; [ "$YES" = "1" ] && die "SERVER_PASSWORD"; continue
    fi
    if [[ "${SERVER_NAME,,}" == *"${SERVER_PASSWORD,,}"* ]]; then
      warn "$(t 'The password must not appear in the server name.' 'Le mot de passe ne doit pas apparaître dans le nom du serveur.')"; SERVER_PASSWORD=""; [ "$YES" = "1" ] && die "SERVER_PASSWORD"; continue
    fi
    break
  done
  WORLD_NAME="${WORLD_NAME:-$(ask "$(t 'World name' 'Nom du monde')" 'Dedicated')}"
  SERVER_CROSSPLAY=0; yes_no "$(t 'Enable crossplay (PlayStation, Xbox, Switch, Game Pass)?' 'Activer le crossplay (PlayStation, Xbox, Switch, Game Pass) ?')" "y" && SERVER_CROSSPLAY=1
  SERVER_PUBLIC=0; yes_no "$(t 'List the server in the in-game browser?' 'Afficher le serveur dans la liste du jeu ?')" "n" && SERVER_PUBLIC=1
  SERVERSIDE_QOL=0; yes_no "$(t 'Install ServersideQoL mods (server-side, console friendly)?' 'Installer les mods ServersideQoL (côté serveur, compatibles console) ?')" "y" && SERVERSIDE_QOL=1

  DETECTED_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  PUBLIC_ADDRESS="${PUBLIC_ADDRESS:-$(ask "$(t 'Public address shown to players (IP or domain)' 'Adresse publique affichée aux joueurs (IP ou domaine)')" "$DETECTED_IP")}"
  DOMAIN="${DOMAIN:-$(ask "$(t 'Domain for HTTPS on the panel (optional, must point to this machine)' 'Domaine pour le HTTPS du panel (optionnel, doit pointer vers cette machine)')" '')}"
  PANEL_PORT="${PANEL_PORT:-8080}"
  PANEL_BIND=0.0.0.0
  [ -n "$DOMAIN" ] && PANEL_BIND=127.0.0.1
  TZ_DEFAULT=$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo Etc/UTC)

  umask 077
  cat >.env <<EOF
SERVER_NAME=$SERVER_NAME
SERVER_PASSWORD=$SERVER_PASSWORD
WORLD_NAME=$WORLD_NAME
SERVER_PUBLIC=$SERVER_PUBLIC
SERVER_CROSSPLAY=$SERVER_CROSSPLAY
SERVERSIDE_QOL=$SERVERSIDE_QOL
PANEL_PORT=$PANEL_PORT
PANEL_BIND=$PANEL_BIND
PUBLIC_ADDRESS=$PUBLIC_ADDRESS
HW_LANGUAGE=$LANG_CHOICE
DOMAIN=$DOMAIN
TZ=${TZ:-$TZ_DEFAULT}
BACKUP_HOUR=4
RESTART_HOUR=5
EOF
  umask 022
fi

info "$(t 'Downloading docker-compose.yml' 'Téléchargement de docker-compose.yml')"
curl -fsSL "$REPO_RAW/docker-compose.yml" -o docker-compose.yml

# shellcheck disable=SC1091
set -a; . ./.env; set +a
PROFILE=()
[ -n "${DOMAIN:-}" ] && PROFILE=(--profile https)

# ---------- Firewall ----------
if command -v ufw >/dev/null && sudo -n ufw status 2>/dev/null | grep -q "Status: active"; then
  if yes_no "$(t 'UFW is active: open the Valheim ports (2456-2457/udp) and the panel?' 'UFW est actif : ouvrir les ports Valheim (2456-2457/udp) et le panel ?')" "y"; then
    sudo ufw allow 2456:2457/udp comment "Valheim"
    if [ -n "${DOMAIN:-}" ]; then sudo ufw allow 80/tcp; sudo ufw allow 443/tcp; else sudo ufw allow "${PANEL_PORT:-8080}/tcp" comment "Hearthwatch"; fi
  fi
fi

# ---------- Start ----------
info "$(t 'Pulling the image and starting Hearthwatch' 'Téléchargement de l’image et démarrage de Hearthwatch')"
"${DOCKER[@]}" compose "${PROFILE[@]}" pull
"${DOCKER[@]}" compose "${PROFILE[@]}" up -d

info "$(t 'Waiting for the panel to start…' 'Attente du démarrage du panel…')"
ADMIN_PASSWORD=""
GAME_PASSWORD=""
for _ in $(seq 1 60); do
  LOGS=$("${DOCKER[@]}" compose logs hearthwatch 2>/dev/null || true)
  ADMIN_PASSWORD=$(grep -oP '\[hearthwatch\]\s+password: \K\S+' <<<"$LOGS" | tail -1 || true)
  GAME_PASSWORD=$(grep -oP 'Server password: \K\S+' <<<"$LOGS" | tail -1 || true)
  [ -n "$ADMIN_PASSWORD" ] && break
  grep -q "Server listening" <<<"$LOGS" && break
  sleep 2
done

if [ -n "${DOMAIN:-}" ]; then PANEL_URL="https://$DOMAIN"; else PANEL_URL="http://${PUBLIC_ADDRESS:-localhost}:${PANEL_PORT:-8080}"; fi

echo
bold "$(t 'Hearthwatch is running!' 'Hearthwatch est lancé !')"
echo "  $(t 'Panel' 'Panel')            : $PANEL_URL"
if [ -n "$ADMIN_PASSWORD" ]; then
  echo "  $(t 'Panel login' 'Connexion panel') : admin / $ADMIN_PASSWORD  ($(t 'you will choose your own password' 'tu choisiras ton propre mot de passe'))"
else
  echo "  $(t 'Panel login' 'Connexion panel') : $(t 'unchanged (existing installation)' 'inchangée (installation existante)')"
fi
echo "  $(t 'Game address' 'Adresse du jeu')   : ${PUBLIC_ADDRESS:-<ip>}:2456"
[ -n "$GAME_PASSWORD" ] && echo "  $(t 'Server password' 'Mot de passe jeu') : $GAME_PASSWORD"
echo
warn "$(t 'The first start downloads Valheim (~2 GB): the server needs a few minutes before players can join.' 'Le premier démarrage télécharge Valheim (~2 Go) : il faut quelques minutes avant que les joueurs puissent rejoindre.')"
echo "  $(t 'Logs' 'Journaux')      : cd $DIR && ${DOCKER[*]} compose logs -f"
echo "  $(t 'Update' 'Mise à jour') : cd $DIR && ${DOCKER[*]} compose ${PROFILE[*]} pull && ${DOCKER[*]} compose ${PROFILE[*]} up -d"
echo "  $(t 'Stop' 'Arrêt')      : cd $DIR && ${DOCKER[*]} compose down"
