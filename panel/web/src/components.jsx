import { useEffect, useMemo, useState } from 'react';
import { Gift, History, Info, KeyRound, LogIn, LogOut, Play, Search, Skull, Square, Wifi } from 'lucide-react';
import { api, formatDate } from './api.js';
import { useT } from './i18n.jsx';
import { Badge, Button, Empty, Field, Input, Modal, Select, cx, useAction } from './ui.jsx';

// ---------- Données du jeu ----------

let prefabsPromise = null;
export function usePrefabs() {
  const [data, setData] = useState(null);
  useEffect(() => {
    prefabsPromise ||= api('/prefabs').catch((err) => {
      prefabsPromise = null;
      throw err;
    });
    prefabsPromise.then(setData).catch(() => {});
  }, []);
  return data;
}

export function usePrefabLabels() {
  const prefabs = usePrefabs();
  return useMemo(() => {
    const map = new Map();
    if (prefabs) for (const list of [prefabs.items, prefabs.creatures, prefabs.containers]) for (const x of list) if (x.label) map.set(x.name, x.label);
    return map;
  }, [prefabs]);
}

export const formatPos = (p) => (p ? p.map((n) => Math.round(n)).join(' · ') : '—');

// ---------- Petits composants ----------

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-ink-800 bg-ink-900/80 p-1">
      {tabs.map(([key, label, Icon]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cx(
            'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition',
            value === key ? 'bg-ink-700 text-ink-100 shadow' : 'text-ink-400 hover:text-ink-200',
          )}
        >
          {Icon && <Icon className="size-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}

export function PlatformBadge({ platform }) {
  const tone = platform === 'Steam' ? 'blue' : platform === 'PlayStation' ? 'ember' : 'neutral';
  return <Badge tone={tone}>{platform}</Badge>;
}

const EVENTS = {
  join: [LogIn, 'text-moss-400', '{name} est entré dans le monde'],
  death: [Skull, 'text-blood-400', '{name} est mort'],
  leave: [LogOut, 'text-ink-400', 'Déconnexion ({id})'],
  connect: [Wifi, 'text-frost-400', 'Connexion entrante ({id})'],
  badpass: [KeyRound, 'text-ember-400', 'Mauvais mot de passe ({id})'],
  start: [Play, 'text-moss-400', 'Serveur démarré'],
  stop: [Square, 'text-ink-400', 'Serveur arrêté'],
};

export function HistoryList({ events, limit = 50 }) {
  const t = useT();
  if (!events?.length) return <Empty icon={History} title={t('Aucune activité récente')} />;
  return (
    <ul className="space-y-2.5">
      {events.slice(0, limit).map((e, i) => {
        const [Icon, tone, text] = EVENTS[e.type] || [Info, 'text-ink-400', e.type];
        return (
          <li key={`${e.time}-${i}`} className="flex items-center gap-3 text-sm">
            <Icon className={cx('size-4 shrink-0', tone)} />
            <span className="min-w-0 flex-1 truncate text-ink-200">{t(text, e)}</span>
            <time className="shrink-0 text-xs tabular-nums text-ink-500">{formatDate(e.time)}</time>
          </li>
        );
      })}
    </ul>
  );
}

// Liste filtrable d'objets / créatures, avec saisie libre du nom exact.
export function PrefabPicker({ list, value, onChange, placeholder, height = 'h-64', showCategory, autoFocus }) {
  const t = useT();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (!list) return [];
    const s = q.trim().toLowerCase();
    const found = s ? list.filter((x) => x.name.toLowerCase().includes(s) || x.label?.toLowerCase().includes(s)) : list;
    return found.slice(0, 200);
  }, [list, q]);
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || t('Rechercher…')} className="pl-9" autoFocus={autoFocus} />
      </div>
      <div className={cx('mt-2 overflow-y-auto rounded-lg border border-ink-800 bg-ink-950/60', height)}>
        {!list && <div className="p-4 text-sm text-ink-500">{t('Chargement…')}</div>}
        {results.map((x) => (
          <button
            key={x.name}
            type="button"
            onClick={() => onChange(x.name)}
            className={cx(
              'flex w-full items-center justify-between gap-3 border-b border-ink-800/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-ink-800',
              value === x.name && 'bg-ember-500/10',
            )}
          >
            <span className="min-w-0">
              <span className={cx('block truncate', value === x.name ? 'text-ember-300' : 'text-ink-100')}>{x.label || x.name}</span>
              <span className="block truncate font-mono text-[11px] text-ink-500">{x.name}</span>
            </span>
            {showCategory && x.category && <Badge className="shrink-0">{t(x.category)}</Badge>}
          </button>
        ))}
        {list && !results.length && <div className="p-4 text-sm text-ink-500">{t('Aucun résultat : saisis le nom exact ci-dessous.')}</div>}
      </div>
      <Input className="mt-2 font-mono text-xs" value={value || ''} onChange={(e) => onChange(e.target.value.trim())} placeholder={t('Nom exact du prefab (ex : SwordIron)')} />
    </div>
  );
}

export function PlayerSelect({ players, value, onChange }) {
  const t = useT();
  if (!players.length) return <div className="input text-ink-500">{t('Aucun joueur connecté')}</div>;
  return <Select value={value} onChange={(e) => onChange(e.target.value)} options={players.map((p) => ({ value: p.id, label: `${p.name} (${p.platform})` }))} />;
}

// Position : sur un joueur connecté ou coordonnées libres.
export function PositionPicker({ players, value, onChange }) {
  const t = useT();
  useEffect(() => {
    if (value.mode === 'player' && !players.some((p) => p.id === value.player) && players[0]) onChange({ ...value, player: players[0].id });
  }, [players, value, onChange]);
  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-lg border border-ink-800 bg-ink-950 p-1 text-xs">
        {[
          ['player', 'Sur un joueur'],
          ['coords', 'Coordonnées'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...value, mode })}
            className={cx('flex-1 rounded-md px-2 py-1.5', value.mode === mode ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200')}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {value.mode === 'player' ? (
        <PlayerSelect players={players} value={value.player} onChange={(player) => onChange({ ...value, player })} />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {['x', 'y', 'z'].map((k) => (
            <Input key={k} type="number" step="any" placeholder={k.toUpperCase()} value={value[k] ?? ''} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
          ))}
        </div>
      )}
    </div>
  );
}

export const positionBody = (v) => (v.mode === 'player' ? { player: v.player } : { x: v.x, y: v.y, z: v.z });

export function GiveItemModal({ open, onClose, players, player, item: initialItem }) {
  const t = useT();
  const prefabs = usePrefabs();
  const [item, setItem] = useState('');
  const [target, setTarget] = useState('');
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState(1);
  const [run, busy] = useAction();

  useEffect(() => {
    if (!open) return;
    setItem(initialItem || '');
    setTarget(player?.id || players[0]?.id || '');
    setCount(1);
    setQuality(1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const r = await run('give', () => api('/players/action', { method: 'POST', body: { action: 'give', target, item, count, quality } }), t('{count} × {item} donné', { count, item }));
    if (r) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={player ? t('Donner un objet à {name}', { name: player.name }) : t('Donner un objet')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" icon={Gift} loading={busy === 'give'} disabled={!item || !target} onClick={submit}>
            {t('Donner')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_15rem]">
        <PrefabPicker list={prefabs?.items} value={item} onChange={setItem} showCategory autoFocus placeholder={t('Rechercher un objet (nom anglais ou prefab)…')} />
        <div className="space-y-4">
          {!player && (
            <Field label={t('Joueur')}>
              <PlayerSelect players={players} value={target} onChange={setTarget} />
            </Field>
          )}
          <Field label={t('Quantité')}>
            <Input type="number" min={1} max={9999} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
          <Field label={t('Qualité')} hint={t("Niveau d'amélioration : 1 à 4 pour les armes et armures.")}>
            <Input type="number" min={1} max={10} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          </Field>
          <p className="rounded-lg bg-ink-850 px-3 py-2 text-xs text-ink-400">{t('Les objets apparaissent au sol, aux pieds du joueur.')}</p>
        </div>
      </div>
    </Modal>
  );
}
