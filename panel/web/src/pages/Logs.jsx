import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Pause, Play, Search } from 'lucide-react';
import { api, locale } from '../api.js';
import { useT } from '../i18n.jsx';
import { PageHeader } from '../status.jsx';
import { Badge, Button, Card, Input, Toggle, cx } from '../ui.jsx';

const MAX_LINES = 4000;

// Messages techniques de Unity sans intérêt pour l'admin.
const NOISE =
  /^\(Filename:|The shader |image effect|HDR Render Texture|AmplifyOcclusion|Fallback handler could not load|UnloadTime|Unloading \d+ unused|^\[Physics::Module\]|Input System module state|^\s+at |not supported on this platform|^\s*$|Update state \(0x|^\[S_API|Setting breakpad|SteamInternal_SetMinidumpSteamID|Caching Steam ID|Downloading update \(|Installing update\.\.\./i;

function parseLine(raw) {
  const m = raw.match(/^(\S+) \S+ ([^:[]+)(?:\[\d+\])?: (.*)$/);
  if (!m) return { raw, time: null, source: '', text: raw };
  return { raw, time: m[1], source: m[2], text: m[3].replace(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}: /, '') };
}

function tone(line) {
  const text = line.text;
  if (/error|exception|failed|fatal/i.test(text)) return 'text-blood-400';
  if (/warn/i.test(text)) return 'text-ember-400';
  if (/Got character|join code|Game server connected|registered|Started valheim|Login success|\[hearthwatch\] Server starting/i.test(text)) return 'text-moss-400';
  if (/^\[(Info|Message|Warning|Error|Debug)\s*:|^\[hearthwatch\]/.test(text)) return 'text-frost-400';
  if (line.source === 'systemd') return 'text-ink-400 italic';
  return 'text-ink-300';
}

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString(locale()) : '');

export default function Logs() {
  const t = useT();
  const [lines, setLines] = useState([]);
  const [filter, setFilter] = useState('');
  const [hideNoise, setHideNoise] = useState(true);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const pausedRef = useRef(false);
  const pending = useRef([]);
  const box = useRef(null);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && pending.current.length) {
      const flushed = pending.current;
      pending.current = [];
      setLines((prev) => [...prev, ...flushed].slice(-MAX_LINES));
    }
  }, [paused]);

  useEffect(() => {
    let active = true;
    api('/logs')
      .then((r) => active && setLines((prev) => [...r.lines.map(parseLine), ...prev].slice(-MAX_LINES)))
      .catch(() => {});
    const source = new EventSource('/api/logs/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (ev) => {
      const line = parseLine(JSON.parse(ev.data));
      if (pausedRef.current) pending.current.push(line);
      else setLines((prev) => [...prev, line].slice(-MAX_LINES));
    };
    return () => {
      active = false;
      source.close();
    };
  }, []);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return lines.filter((l) => (!hideNoise || !NOISE.test(l.text)) && (!f || l.raw.toLowerCase().includes(f)));
  }, [lines, filter, hideNoise]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible, follow]);

  const onScroll = () => {
    const el = box.current;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  return (
    <>
      <PageHeader
        title={t('Journaux')}
        description={t('Sortie du serveur Valheim en direct (jeu, mods, mises à jour).')}
        actions={<Badge tone={connected ? 'green' : 'red'}>{t(connected ? 'Direct' : 'Déconnecté')}</Badge>}
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-ink-800 px-4 py-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Filtrer (ex : join code, error, nom d'un joueur)…")} className="pl-9" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Toggle checked={hideNoise} onChange={setHideNoise} label={t('Masquer le bruit')} />
            <Button size="sm" icon={paused ? Play : Pause} onClick={() => setPaused((p) => !p)}>
              {paused ? (pending.current.length ? t('Reprendre ({n})', { n: pending.current.length }) : t('Reprendre')) : t('Pause')}
            </Button>
          </div>
        </div>
        <div className="relative">
          <div ref={box} onScroll={onScroll} className="h-[calc(100vh-17rem)] min-h-96 overflow-auto bg-ink-950/70 px-4 py-3 font-mono text-xs leading-relaxed">
            {visible.map((l, i) => (
              <div key={i} className="flex gap-3 whitespace-pre-wrap break-words hover:bg-ink-900">
                <span className="shrink-0 select-none tabular-nums text-ink-600">{timeOf(l.time)}</span>
                <span className={cx('min-w-0', tone(l))}>{l.text}</span>
              </div>
            ))}
            {!visible.length && <div className="py-10 text-center text-ink-500">{t('Aucune ligne à afficher.')}</div>}
          </div>
          {!follow && (
            <Button
              size="sm"
              variant="primary"
              icon={ArrowDown}
              className="absolute bottom-4 right-6 shadow-lg"
              onClick={() => {
                setFollow(true);
                box.current.scrollTop = box.current.scrollHeight;
              }}
            >
              {t('Suivre')}
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}
