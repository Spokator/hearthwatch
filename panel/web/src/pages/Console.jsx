import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, SquareTerminal, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader } from '../status.jsx';
import { Button, Card, cx } from '../ui.jsx';

const QUICK = ['players', 'serverStats', 'time', 'globalKeys', 'currentEvent', 'eventsList', 'adminlist', 'banlist', 'save', 'list'];

export default function Console() {
  const t = useT();
  const [entries, setEntries] = useState([]);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState([]);
  const [cursor, setCursor] = useState(-1);
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [entries]);

  const exec = async (value) => {
    const cmd = value.trim();
    if (!cmd || busy) return;
    setBusy(true);
    setCommand('');
    setCursor(-1);
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
    try {
      const r = await api('/console', { method: 'POST', body: { command: cmd } });
      setEntries((e) => [...e, { cmd, output: r.output || t('(aucune réponse)'), ok: true }]);
    } catch (err) {
      setEntries((e) => [...e, { cmd, output: err.message, ok: false }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const next = Math.min(cursor + 1, history.length - 1);
      setCursor(next);
      setCommand(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = cursor - 1;
      setCursor(Math.max(next, -1));
      setCommand(next >= 0 ? history[next] : '');
    }
  };

  return (
    <>
      <PageHeader title={t('Console')} description={t('Commandes RCON envoyées directement au serveur. Tape « list » pour voir toutes les commandes disponibles.')} />
      <OfflineNotice />
      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => exec(q)}
            disabled={busy}
            className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 font-mono text-xs text-ink-300 transition hover:border-ember-500/50 hover:text-ember-300 disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
      <Card
        title={t('Terminal RCON')}
        icon={SquareTerminal}
        padded={false}
        actions={
          entries.length > 0 && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setEntries([])}>
              {t('Effacer')}
            </Button>
          )
        }
      >
        <div className="h-[calc(100vh-22rem)] min-h-80 overflow-auto bg-ink-950/70 px-4 py-3 font-mono text-xs leading-relaxed" onClick={() => input.current?.focus()}>
          {!entries.length && <div className="text-ink-600">{t("Les réponses du serveur s'afficheront ici. ↑ / ↓ pour l'historique.")}</div>}
          {entries.map((e, i) => (
            <div key={i} className="mb-3">
              <div className="text-ember-400">› {e.cmd}</div>
              <pre className={cx('whitespace-pre-wrap break-words', e.ok ? 'text-ink-200' : 'text-blood-400')}>{e.output}</pre>
            </div>
          ))}
          <div ref={end} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            exec(command);
          }}
          className="flex items-center gap-2 border-t border-ink-800 px-4 py-3"
        >
          <span className="font-mono text-ember-400">›</span>
          <input
            ref={input}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            spellCheck={false}
            placeholder={t('ex : give Ragnar Coins -count 100')}
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink-100 outline-none placeholder:text-ink-600"
          />
          <Button type="submit" size="sm" variant="primary" icon={CornerDownLeft} loading={busy} disabled={!command.trim()}>
            {t('Envoyer')}
          </Button>
        </form>
      </Card>
    </>
  );
}
