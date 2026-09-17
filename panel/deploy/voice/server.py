#!/usr/bin/env python3
"""Service vocal de Hearthwatch : synthèse Piper et transcription Whisper, en local.

Le panel ne peut pas héberger ces modèles lui-même (son service systemd est limité en mémoire et redémarre
souvent) : ce petit serveur écoute sur 127.0.0.1 et n'est joignable que par le panel, avec une clé partagée.

    python3 server.py --dir /opt/valheim-voice --port 4032
    python3 server.py --dir /opt/valheim-voice --survey    # classe les voix multi-locuteurs par hauteur

Routes :
    GET  /health                -> voix disponibles, état de la transcription
    POST /tts    {voice, speaker, length, noise, noiseW, text, format}   -> audio/mpeg (ou audio/wav)
    POST /stt?lang=fr  (corps : audio webm/ogg/wav/mp4)          -> {"text": "..."}
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MAX_TEXT = 600
MAX_AUDIO = 4 * 1024 * 1024
IDLE_UNLOAD = 600  # le modèle de transcription est déchargé après dix minutes sans demande

state = {"dir": None, "key": "", "model_name": "small", "threads": 3, "model": None, "used": 0}
stt_lock = threading.Lock()
tts_lock = threading.Semaphore(2)


# ---------- Piper ----------

def piper_binary():
    return Path(state["dir"]) / "piper" / "piper"


def voices():
    out = []
    folder = Path(state["dir"]) / "voices"
    for config in sorted(folder.glob("*.onnx.json")):
        model = config.with_suffix("")  # retire .json
        if not model.exists():
            continue
        try:
            data = json.loads(config.read_text(encoding="utf-8"))
        except ValueError:
            continue
        out.append(
            {
                "name": model.stem,
                "lang": (data.get("language") or {}).get("code", "")[:2] or model.stem[:2],
                "speakers": int(data.get("num_speakers") or 1),
                "sampleRate": (data.get("audio") or {}).get("sample_rate", 22050),
            }
        )
    return out


def synthesize(text, voice, speaker=0, length=1.0, noise=0.667, noise_w=0.8):
    model = Path(state["dir"]) / "voices" / f"{voice}.onnx"
    if not model.exists():
        raise FileNotFoundError(f"voix inconnue : {voice}")
    output = Path(state["dir"]) / "tmp" / f"tts-{os.getpid()}-{threading.get_ident()}.wav"
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(piper_binary()),
        "--model", str(model),
        "--output_file", str(output),
        "--length_scale", f"{max(0.5, min(2.0, float(length))):.3f}",
        "--noise_scale", f"{max(0.1, min(1.5, float(noise))):.3f}",
        "--noise_w", f"{max(0.1, min(1.5, float(noise_w))):.3f}",
        "--sentence_silence", "0.25",
    ]
    if speaker:
        command += ["--speaker", str(int(speaker))]
    with tts_lock:
        subprocess.run(
            command,
            input=text.encode("utf-8"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=120,
            cwd=str(Path(state["dir"]) / "piper"),
        )
    data = output.read_bytes()
    output.unlink(missing_ok=True)
    return data


def to_mp3(wav_bytes):
    """Compresse la parole en MP3 : vingt fois plus léger que le WAV, lisible sur tous les téléphones."""
    import io

    import av

    source = av.open(io.BytesIO(wav_bytes))
    buffer = io.BytesIO()
    output = av.open(buffer, mode="w", format="mp3")
    stream = output.add_stream("libmp3lame", rate=22050)
    stream.bit_rate = 32000
    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=22050)
    for frame in source.decode(audio=0):
        for resampled in resampler.resample(frame):
            resampled.pts = None
            for packet in stream.encode(resampled):
                output.mux(packet)
    for packet in stream.encode(None):
        output.mux(packet)
    output.close()
    return buffer.getvalue()


# ---------- Hauteur de voix (pour répartir les locuteurs d'une voix multiple) ----------

def median_pitch(wav_bytes_path):
    """Fréquence fondamentale médiane, par autocorrélation. Sert à savoir si une voix sonne grave ou aiguë."""
    import numpy as np

    with wave.open(str(wav_bytes_path), "rb") as handle:
        rate = handle.getframerate()
        frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float32)
    if frames.size < rate // 2:
        return None
    window = int(rate * 0.04)
    step = int(rate * 0.02)
    low, high = int(rate / 350), int(rate / 70)  # 70 à 350 Hz : voix humaine
    pitches = []
    for start in range(0, frames.size - window, step):
        chunk = frames[start : start + window]
        energy = float(np.sqrt(np.mean(chunk**2)))
        if energy < 500:  # silence
            continue
        chunk = chunk - chunk.mean()
        correlation = np.correlate(chunk, chunk, mode="full")[window - 1 :]
        segment = correlation[low:high]
        if segment.size == 0 or correlation[0] <= 0:
            continue
        lag = int(np.argmax(segment)) + low
        if correlation[lag] / correlation[0] < 0.3:
            continue
        pitches.append(rate / lag)
    if len(pitches) < 5:
        return None
    return float(np.median(pitches))


def survey(sentence="Bonjour voyageur, je suis un habitant de cette cité et je te souhaite la bienvenue."):
    """Écrit speakers.json : pour chaque voix multi-locuteurs, la hauteur et le genre estimé de chaque locuteur."""
    result = {}
    for voice in voices():
        if voice["speakers"] <= 1:
            continue
        entries = []
        for speaker in range(voice["speakers"]):
            path = Path(state["dir"]) / "tmp" / "survey.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                path.write_bytes(synthesize(sentence, voice["name"], speaker=speaker, length=1.0))
                pitch = median_pitch(path)
            except Exception:
                pitch = None
            if pitch:
                entries.append({"speaker": speaker, "pitch": round(pitch, 1), "gender": "f" if pitch >= 165 else "m"})
            print(f"  {voice['name']} #{speaker}: {pitch and round(pitch)} Hz", file=sys.stderr)
        result[voice["name"]] = entries
    (Path(state["dir"]) / "speakers.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    return result


# ---------- Whisper ----------

def load_model():
    from faster_whisper import WhisperModel

    if state["model"] is None:
        state["model"] = WhisperModel(
            state["model_name"],
            device="cpu",
            compute_type="int8",
            cpu_threads=state["threads"],
            download_root=str(Path(state["dir"]) / "models"),
        )
    state["used"] = time.time()
    return state["model"]


def unload_loop():
    while True:
        time.sleep(60)
        if state["model"] is not None and time.time() - state["used"] > IDLE_UNLOAD and not stt_lock.locked():
            state["model"] = None


def transcribe(audio, lang="fr"):
    path = Path(state["dir"]) / "tmp" / f"stt-{os.getpid()}-{threading.get_ident()}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    try:
        with stt_lock:
            model = load_model()
            segments, _ = model.transcribe(
                str(path),
                language=lang if lang in ("fr", "en") else None,
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            state["used"] = time.time()
        return text
    finally:
        path.unlink(missing_ok=True)


# ---------- Serveur ----------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "HearthwatchVoice"

    def log_message(self, *_args):  # pas de journal d'accès : le panel journalise déjà
        pass

    def deny(self, code, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        if not state["key"]:
            return True
        if self.headers.get("x-voice-key") == state["key"]:
            return True
        self.deny(403, "clé invalide")
        return False

    def send_bytes(self, data, content_type):
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.authorized():
            return
        if urlparse(self.path).path != "/health":
            return self.deny(404, "route inconnue")
        speakers_file = Path(state["dir"]) / "speakers.json"
        speakers = json.loads(speakers_file.read_text(encoding="utf-8")) if speakers_file.exists() else {}
        body = {
            "ok": True,
            "tts": piper_binary().exists(),
            "voices": voices(),
            "speakers": speakers,
            "stt": True,
            "model": state["model_name"],
            "loaded": state["model"] is not None,
        }
        self.send_bytes(json.dumps(body).encode("utf-8"), "application/json")

    def do_POST(self):
        if not self.authorized():
            return
        url = urlparse(self.path)
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_AUDIO:
            return self.deny(413, "corps vide ou trop gros")
        body = self.rfile.read(length)
        try:
            if url.path == "/tts":
                payload = json.loads(body)
                text = str(payload.get("text") or "").strip()[:MAX_TEXT]
                if not text:
                    return self.deny(400, "texte vide")
                audio = synthesize(
                    text,
                    str(payload.get("voice") or ""),
                    speaker=int(payload.get("speaker") or 0),
                    length=float(payload.get("length") or 1.0),
                    noise=float(payload.get("noise") or 0.667),
                    noise_w=float(payload.get("noiseW") or 0.8),
                )
                if str(payload.get("format") or "mp3") == "mp3":
                    try:
                        return self.send_bytes(to_mp3(audio), "audio/mpeg")
                    except Exception:
                        pass  # sans encodeur, on renvoie le WAV
                return self.send_bytes(audio, "audio/wav")
            if url.path == "/stt":
                lang = (parse_qs(url.query).get("lang") or ["fr"])[0]
                return self.send_bytes(json.dumps({"text": transcribe(body, lang)}).encode("utf-8"), "application/json")
        except FileNotFoundError as error:
            return self.deny(404, str(error))
        except subprocess.TimeoutExpired:
            return self.deny(504, "synthèse trop longue")
        except Exception as error:  # noqa: BLE001 - le panel doit toujours recevoir une réponse
            return self.deny(500, f"{type(error).__name__}: {error}")
        return self.deny(404, "route inconnue")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default=os.environ.get("VOICE_DIR", "/opt/valheim-voice"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOICE_PORT", "4032")))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--model", default=os.environ.get("VOICE_MODEL", "small"))
    parser.add_argument("--threads", type=int, default=int(os.environ.get("VOICE_THREADS", "3")))
    parser.add_argument("--survey", action="store_true", help="classe les locuteurs des voix multiples puis quitte")
    args = parser.parse_args()
    state["dir"] = args.dir
    state["model_name"] = args.model
    state["threads"] = args.threads
    key_file = Path(args.dir) / "voice.key"
    state["key"] = key_file.read_text(encoding="utf-8").strip() if key_file.exists() else ""
    if args.survey:
        survey()
        return
    threading.Thread(target=unload_loop, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[voice] {args.host}:{args.port} — {len(voices())} voix, transcription {args.model}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
