// « Autour de toi » : le téléphone suit le joueur dans la cité et propose de parler à qui se tient devant lui.
import { useEffect, useState } from 'react';
import { MapPin, MessageSquare, Search, Signal, SignalZero } from 'lucide-react';
import { useT } from '../i18n.jsx';
import { portalApi } from './api.js';
import { Card, Tag, cx } from './ui.jsx';

export default function Around({ onTalk }) {
  const t = useT();
  const [live, setLive] = useState(null);
  const [npcs, setNpcs] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = () => portalApi('/live').then(setLive).catch(() => {});
    load();
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    portalApi('/npcs')
      .then((data) => setNpcs(data.npcs))
      .catch(() => setNpcs([]));
  }, []);

  const term = search.trim().toLowerCase();
  const directory = (npcs || []).filter(
    (npc) => !term || [npc.name, npc.title, npc.place, npc.factionLabel].some((v) => String(v).toLowerCase().includes(term)),
  );

  return (
    <>
      <Card
        title={live?.online ? t('Tu es en jeu') : t('Tu n’es pas en jeu')}
        right={live?.online ? <Signal className="size-4 text-moss-400" /> : <SignalZero className="size-4 text-ink-600" />}
      >
        {live?.online ? (
          <>
            <p className="flex items-center gap-2 text-sm text-ink-300">
              <MapPin className="size-4 text-ember-500" />
              {live.place || live.position?.biome || t('quelque part dans le monde')}
            </p>
            {live.jail && <Tag tone="blood">{t('tu purges une peine')}</Tag>}
            {!live.jail && live.wanted && <Tag tone="blood">{t('recherché')} · {live.bounty} {t('pièces')}</Tag>}
          </>
        ) : (
          <p className="text-sm text-ink-500">
            {t('Connecte-toi au serveur : ce portail suivra alors tes pas et te proposera les habitants devant toi.')}
          </p>
        )}
        {live?.event && (
          <p className="mt-3 rounded-lg border border-ember-700/40 bg-ember-700/10 p-2 text-xs text-ember-300">
            {live.event.title} — {live.event.text}
          </p>
        )}
      </Card>

      {live?.online && (
        <Card title={t('À portée de voix')} right={live.nearby.length ? `${live.nearby.length}` : ''}>
          {live.nearby.length === 0 ? (
            <p className="text-sm text-ink-500">{t('Personne autour de toi. Rapproche-toi d’un habitant.')}</p>
          ) : (
            <ul className="space-y-2">
              {live.nearby.map((npc) => (
                <li key={npc.key}>
                  <button
                    onClick={() => onTalk(npc.key)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                      npc.distance <= 8 ? 'border-ember-700/60 bg-ember-700/10' : 'border-ink-800 bg-ink-900/70 hover:border-ember-700/40',
                    )}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-ember-700/40 bg-ink-950 font-serif text-ember-400">
                      {npc.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-serif text-ink-100">{npc.name}</span>
                        <span className="shrink-0 text-xs text-ink-500">{npc.distance} m</span>
                        {npc.offers > 0 && <Tag tone="ember">{t('travail')}</Tag>}
                      </span>
                      <span className="block truncate text-xs text-ink-500">{npc.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-400">
                        {npc.mood} · {npc.doing}
                      </span>
                    </span>
                    <MessageSquare className="size-4 shrink-0 text-ember-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <label className="flex items-center gap-2 rounded-xl border border-ink-800 bg-ink-900/70 px-3 py-2">
        <Search className="size-4 text-ink-600" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('Tous les habitants : un nom, un métier, un lieu…')}
          className="w-full bg-transparent text-sm text-ink-100 outline-none placeholder:text-ink-600"
        />
      </label>

      <ul className="grid gap-2 sm:grid-cols-2">
        {directory.map((npc) => (
          <li key={npc.key}>
            <button
              onClick={() => onTalk(npc.key)}
              className="flex w-full items-start gap-3 rounded-xl border border-ink-800 bg-ink-900/70 p-3 text-left transition hover:border-ember-700/50"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-ink-700 bg-ink-950 font-serif text-ink-400">
                {npc.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-ink-100">{npc.name}</span>
                <span className="block truncate text-xs text-ink-500">{npc.title}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-400">
                  {npc.mood?.label} · {npc.place}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
