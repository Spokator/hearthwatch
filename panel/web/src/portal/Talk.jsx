// Conversation avec un habitant depuis le portail : texte, dictée au micro et voix de l'habitant.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Mic, Send, Square, Volume2, VolumeX } from 'lucide-react';
import { useT } from '../i18n.jsx';
import { audioUrl, portalApi } from './api.js';
import { Rune, cx } from './ui.jsx';

const MOOD_TONE = {
  joie: 'text-ember-300',
  fierte: 'text-ember-300',
  gratitude: 'text-moss-400',
  tristesse: 'text-frost-400',
  peur: 'text-frost-400',
  colere: 'text-blood-400',
  degout: 'text-blood-400',
};

export default function Talk({ npcKey, onBack, voice, onHero }) {
  const t = useT();
  const [npc, setNpc] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [speak, setSpeak] = useState(() => localStorage.getItem('hearthwatch.portal.voice') !== 'off');
  const bottom = useRef(null);
  const player = useRef(null);

  useEffect(() => {
    let alive = true;
    portalApi(`/npcs/${npcKey}`)
      .then((data) => {
        if (!alive) return;
        setNpc(data);
        setMessages(data.history.map((h, i) => ({ id: `h${i}`, from: h.role, text: h.text })));
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [npcKey]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);

  useEffect(() => {
    localStorage.setItem('hearthwatch.portal.voice', speak ? 'on' : 'off');
    if (!speak && player.current) player.current.pause();
  }, [speak]);

  // Les répliques sont lues l'une après l'autre : la voix est fabriquée à la première écoute puis gardée.
  const play = useCallback(
    async (hashes) => {
      if (!speak || !hashes.length || !player.current) return;
      for (const hash of hashes) {
        try {
          player.current.src = audioUrl(hash);
          await player.current.play();
          await new Promise((resolve) => {
            player.current.onended = resolve;
            player.current.onerror = resolve;
          });
        } catch {
          return; // le navigateur refuse la lecture automatique : on s'arrête là
        }
      }
    },
    [speak],
  );

  const send = async (value) => {
    const message = (value ?? text).trim();
    if (!message || busy) return;
    setText('');
    setError(null);
    setMessages((m) => [...m, { id: `p${Date.now()}`, from: 'player', text: message }]);
    setBusy(true);
    try {
      const result = await portalApi(`/npcs/${npcKey}/talk`, { method: 'POST', body: { text: message } });
      setMessages((m) => [...m, ...result.lines.map((line, i) => ({ id: `n${Date.now()}-${i}`, from: 'npc', text: line.text }))]);
      setNpc((n) => (n ? { ...n, mood: result.mood, affinity: result.affinity } : n));
      if (result.hero) onHero?.(result.hero);
      play(result.lines.map((l) => l.audio).filter(Boolean));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !npc) return <p className="p-6 text-center text-blood-400">{error}</p>;
  if (!npc) return <p className="p-6 text-center text-ink-500">{t('Chargement…')}</p>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-ember-700/30 bg-ink-900/80 px-4 py-3 backdrop-blur">
        <button onClick={onBack} className="rounded-full p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100" aria-label={t('Retour')}>
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-serif text-lg text-ink-100">{npc.name}</h2>
          <p className="truncate text-xs text-ink-500">
            {npc.title} · <span className={cx(MOOD_TONE[npc.mood?.emotion] || 'text-ink-400')}>{npc.mood?.label}</span>
            {npc.affinity ? ` · ${npc.affinity}` : ''}
          </p>
        </div>
        <button
          onClick={() => setSpeak((v) => !v)}
          className={cx('rounded-full p-2', speak && voice?.speech ? 'text-ember-400' : 'text-ink-500', 'hover:bg-ink-800')}
          title={voice?.speech ? t('Voix des habitants') : t('Voix non installée sur ce serveur')}
          disabled={!voice?.speech}
        >
          {speak && voice?.speech ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="rounded-lg border border-ink-800 bg-ink-900/60 p-3 text-sm text-ink-400">
          <p className="text-ink-300">{npc.story}</p>
          <p className="mt-1 text-xs">
            {t('En ce moment')} : {npc.doing} — {npc.place}. {npc.knows?.length ? `${t('Il sait de toi')} : ${npc.knows.join(' ; ')}.` : ''}
          </p>
          {npc.offers?.length ? (
            <ul className="mt-2 space-y-1 text-xs text-ember-300">
              {npc.offers.map((o) => (
                <li key={o.index}>
                  [{o.index}] {o.title} — {o.detail} ({o.coins} {t('pièces')})
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {messages.map((m) => (
          <div key={m.id} className={cx('flex', m.from === 'player' ? 'justify-end' : 'justify-start')}>
            <p
              className={cx(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm',
                m.from === 'player' ? 'rounded-br-sm bg-ember-600/20 text-ink-100' : 'rounded-bl-sm border border-ink-800 bg-ink-900 text-ink-200',
              )}
            >
              {m.text}
            </p>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Loader2 className="size-4 animate-spin" /> {npc.name.split(' ')[0]} {t('réfléchit…')}
          </div>
        )}
        {error && <p className="text-center text-sm text-blood-400">{error}</p>}
        <div ref={bottom} />
      </div>

      <Composer text={text} setText={setText} onSend={send} busy={busy} voice={voice} />
      <audio ref={player} hidden />
    </div>
  );
}

// Barre de saisie : écriture ou dictée (transcription sur le serveur, sinon reconnaissance du navigateur).
function Composer({ text, setText, onSend, busy, voice }) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const recorder = useRef(null);
  const recognition = useRef(null);
  const browserSpeech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const canTalk = voice?.listen || browserSpeech;

  const stop = () => {
    recorder.current?.state === 'recording' && recorder.current.stop();
    recognition.current?.stop();
    setRecording(false);
  };

  const start = async () => {
    if (recording) return stop();
    // Le serveur transcrit mieux (Whisper) ; sinon on se rabat sur le navigateur.
    if (voice?.listen) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
        const chunks = [];
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorder.current = rec;
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop());
          setRecording(false);
          if (!chunks.length) return;
          setWorking(true);
          try {
            const blob = new Blob(chunks, { type: mime || 'audio/webm' });
            const { text: heard } = await portalApi('/listen', { method: 'POST', body: blob, raw: blob.type || 'application/octet-stream' });
            if (heard) setText((current) => (current ? `${current} ${heard}` : heard));
          } catch {
            // silence : le joueur peut toujours écrire
          } finally {
            setWorking(false);
          }
        };
        rec.start();
        setRecording(true);
        setTimeout(() => rec.state === 'recording' && rec.stop(), 20000);
      } catch {
        setRecording(false);
      }
      return;
    }
    const Recognition = browserSpeech;
    if (!Recognition) return;
    const listener = new Recognition();
    listener.lang = document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR';
    listener.interimResults = false;
    listener.onresult = (event) => setText((current) => `${current ? `${current} ` : ''}${event.results[0][0].transcript}`);
    listener.onend = () => setRecording(false);
    recognition.current = listener;
    listener.start();
    setRecording(true);
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-ember-700/30 bg-ink-900/80 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      {canTalk && (
        <button
          type="button"
          onClick={start}
          className={cx('rounded-full p-2.5', recording ? 'animate-pulse bg-blood-500/20 text-blood-400' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100')}
          title={recording ? t('Arrêter') : t('Parler')}
        >
          {working ? <Loader2 className="size-5 animate-spin" /> : recording ? <Square className="size-5" /> : <Mic className="size-5" />}
        </button>
      )}
      <textarea
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={t('Dis quelque chose…')}
        className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-ink-700 bg-ink-950 px-3.5 py-2.5 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-ember-600"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="rounded-full bg-ember-600 p-2.5 text-ink-950 disabled:opacity-40"
        aria-label={t('Envoyer')}
      >
        <Send className="size-5" />
      </button>
    </form>
  );
}
