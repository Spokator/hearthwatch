#!/usr/bin/env bash
# Installe la voix des habitants (facultatif) : synthèse Piper et transcription Whisper, en local, sans GPU.
# À lancer sur le serveur, en root :
#   sudo bash install-voice.sh                     # français
#   LANGS="fr en" VOICE_MODEL=base sudo bash install-voice.sh
#
# Tout est déposé dans /opt/valheim-voice (modifiable par VOICE_DIR) et servi sur 127.0.0.1:4032, joignable
# seulement par le panel. Compter environ 1,5 Go de disque et 700 Mo de mémoire quand la transcription tourne.
set -euo pipefail

DIR=${VOICE_DIR:-/opt/valheim-voice}
PORT=${VOICE_PORT:-4032}
MODEL=${VOICE_MODEL:-small}         # tiny, base, small, medium : plus grand = plus juste et plus lent
THREADS=${VOICE_THREADS:-3}
LANGS=${LANGS:-fr}
USER_NAME=${VOICE_USER:-valheim}
PIPER_URL=https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
HF=https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0
HERE=$(cd "$(dirname "$0")" && pwd)

# Voix par langue : la dernière de chaque liste est multi-locuteurs (une voix différente par habitant).
FR_VOICES="fr/fr_FR/siwis/medium/fr_FR-siwis-medium fr/fr_FR/tom/medium/fr_FR-tom-medium fr/fr_FR/upmc/medium/fr_FR-upmc-medium fr/fr_FR/gilles/low/fr_FR-gilles-low fr/fr_FR/mls/medium/fr_FR-mls-medium"
EN_VOICES="en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium en/en_US/ryan/medium/en_US-ryan-medium en/en_GB/alan/medium/en_GB-alan-medium en/en_US/libritts_r/medium/en_US-libritts_r-medium"

[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl est nécessaire." >&2; exit 1; }
python3 -c "import ensurepip" 2>/dev/null || { echo "Installation de python3-venv…"; apt-get update -qq && apt-get install -y -qq python3-venv; }

mkdir -p "$DIR"/{voices,models,tmp}

if [ ! -x "$DIR/piper/piper" ]; then
  echo "== Piper (synthèse vocale)"
  curl -sSL "$PIPER_URL" | tar -xz -C "$DIR"
fi

echo "== Voix"
for lang in $LANGS; do
  list=$FR_VOICES
  [ "$lang" = en ] && list=$EN_VOICES
  for voice in $list; do
    name=$(basename "$voice")
    [ -f "$DIR/voices/$name.onnx" ] && continue
    echo "   $name"
    curl -sSL -o "$DIR/voices/$name.onnx" "$HF/$voice.onnx"
    curl -sSL -o "$DIR/voices/$name.onnx.json" "$HF/$voice.onnx.json"
  done
done

echo "== Transcription (faster-whisper, modèle $MODEL)"
[ -x "$DIR/venv/bin/python" ] || python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" -q install --upgrade pip
"$DIR/venv/bin/pip" -q install faster-whisper
"$DIR/venv/bin/python" - "$MODEL" "$DIR" <<'PY'
import sys
from faster_whisper import WhisperModel
WhisperModel(sys.argv[1], device="cpu", compute_type="int8", download_root=sys.argv[2] + "/models")
print("   modèle prêt")
PY

install -m 644 "$HERE/voice/server.py" "$DIR/server.py"
[ -f "$DIR/voice.key" ] || { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DIR/voice.key"; chmod 600 "$DIR/voice.key"; }

# Genre et hauteur de chaque locuteur des voix multiples : chaque habitant aura une voix qui lui va.
if [ ! -f "$DIR/speakers.json" ]; then
  echo "== Classement des locuteurs (quelques minutes, une seule fois)"
  "$DIR/venv/bin/python" "$DIR/server.py" --dir "$DIR" --survey 2>/dev/null || echo "   (ignoré)"
fi

id -u "$USER_NAME" >/dev/null 2>&1 || USER_NAME=root
chown -R "$USER_NAME":"$USER_NAME" "$DIR"

cat > /etc/systemd/system/valheim-voice.service <<EOF
[Unit]
Description=Voix des habitants (Piper + Whisper) pour le panel Valheim
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=$DIR/venv/bin/python $DIR/server.py --dir $DIR --port $PORT --model $MODEL --threads $THREADS
Restart=always
RestartSec=5
MemoryMax=2G
CPUWeight=30
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=$DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now valheim-voice
sleep 2
systemctl is-active valheim-voice

KEY=$(cat "$DIR/voice.key")
echo
echo "Fait. Ajoute ces deux lignes à /opt/valheim/panel.env puis redémarre le panel :"
echo "  VOICE_URL=http://127.0.0.1:$PORT"
echo "  VOICE_KEY=$KEY"
