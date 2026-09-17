// Portail des Élus : le site des joueurs. On y entre avec un code obtenu en jeu (!portail), puis on suit sa
// feuille de personnage, la vie de la cité, et l'on parle aux habitants — par écrit ou à la voix.
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Castle, Crown as CrownIcon, Loader2, LogOut, MessageSquare, ScrollText, Search, Shield, Users } from 'lucide-react';
import { LanguageSwitcher, useT } from '../i18n.jsx';
import { portalApi } from './api.js';
import { Bar, Card, Rune, Tag, cx } from './ui.jsx';
import Crown from './Crown.jsx';
import Guide from './Guide.jsx';
import Talk from './Talk.jsx';

const TABS = [
  { key: 'hero', label: 'Mon héros', icon: Shield },
  { key: 'city', label: 'La cité', icon: Castle },
  { key: 'crown', label: 'Couronne', icon: CrownIcon },
  { key: 'npcs', label: 'Habitants', icon: Users },
  { key: 'guide', label: 'Guide', icon: BookOpen },
];

export default function Portal() {
  const t = useT();
  const [state, setState] = useState({ loading: true, hero: null, voice: null });
  const [tab, setTab] = useState('hero');
  const [talking, setTalking] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await portalApi('/me');
      setState({ loading: false, hero: data.hero, voice: data.voice });
    } catch {
      setState({ loading: false, hero: null, voice: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const logout = async () => {
    await portalApi('/logout', { method: 'POST' }).catch(() => {});
    setState({ loading: false, hero: null, voice: null });
    setTalking(null);
  };

  if (state.loading) {
    return (
      <div className="grid h-full place-items-center text-ink-500">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  if (!state.hero) return <Gate onIn={load} />;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {talking ? (
        <Talk
          npcKey={talking}
          voice={state.voice}
          onBack={() => setTalking(null)}
          onHero={(hero) => setState((s) => ({ ...s, hero }))}
        />
      ) : (
        <>
          <header className="flex items-center gap-3 px-4 pt-5">
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-xl text-ink-100">Spokaheim</h1>
              <p className="truncate text-xs text-ink-500">
                {state.hero.name} · {state.hero.title}
              </p>
            </div>
            <LanguageSwitcher />
            <button onClick={logout} className="rounded-full p-2 text-ink-500 hover:bg-ink-800 hover:text-ink-200" aria-label={t('Se déconnecter')}>
              <LogOut className="size-4" />
            </button>
          </header>
          <Rune className="mt-3 px-4" />
          <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {tab === 'hero' && <Hero hero={state.hero} onReload={load} />}
            {tab === 'city' && <City />}
            {tab === 'npcs' && <Npcs onTalk={setTalking} />}
            {tab === 'crown' && <Crown />}
            {tab === 'guide' && <Guide />}
          </main>
          <nav className="flex border-t border-ember-700/30 bg-ink-900/80 pb-[env(safe-area-inset-bottom)] backdrop-blur">
            {TABS.map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={cx('flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.7rem]', tab === item.key ? 'text-ember-400' : 'text-ink-500 hover:text-ink-300')}
              >
                <item.icon className="size-5" />
                {t(item.label)}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

// ---------- Entrée ----------

function Gate({ onIn }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await portalApi('/login', { method: 'POST', body: { code } });
      onIn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center px-5">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 text-center">
        <div>
          <p className="font-serif text-sm uppercase tracking-[0.3em] text-ember-500">{t('Portail des Élus')}</p>
          <h1 className="mt-1 font-serif text-3xl text-ink-100">Spokaheim</h1>
        </div>
        <Rune />
        <p className="text-sm leading-relaxed text-ink-400">
          {t('Connecte-toi au serveur, tape')} <code className="rounded bg-ink-800 px-1.5 py-0.5 text-ember-300">!portail</code>{' '}
          {t('dans le chat du jeu, puis recopie ici le code qui apparaît.')}
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          placeholder="ABC123"
          autoFocus
          inputMode="text"
          autoCapitalize="characters"
          className="w-full rounded-xl border border-ink-700 bg-ink-950 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-ink-100 outline-none focus:border-ember-600"
        />
        {error && <p className="text-sm text-blood-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.length < 4}
          className="w-full rounded-xl bg-ember-600 py-3 font-medium text-ink-950 disabled:opacity-40"
        >
          {busy ? t('Ouverture…') : t('Entrer')}
        </button>
      </form>
    </div>
  );
}

// ---------- Feuille de personnage ----------

function Hero({ hero, onReload }) {
  const t = useT();
  const [houseError, setHouseError] = useState(null);
  const onClaimHouse = () =>
    portalApi('/house', { method: 'POST' })
      .then(() => onReload())
      .catch((e) => setHouseError(e.message));
  return (
    <>
      <Card
        title={hero.title}
        right={
          <span className={hero.online ? 'text-moss-400' : 'text-ink-600'}>{hero.online ? t('en jeu') : t('hors ligne')}</span>
        }
      >
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-ink-300">
            {hero.renown} {t('renommée')}
          </span>
          {hero.next && (
            <span className="text-xs text-ink-500">
              {t('encore {n} avant', { n: hero.next.missing })} {hero.next.label}
            </span>
          )}
        </div>
        <Bar value={hero.renown} max={hero.next?.at || hero.renown || 1} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {hero.reputation.map((r) => (
            <Tag key={r.key} tone={r.value >= 0 ? 'moss' : 'blood'}>
              {r.label} {r.value >= 0 ? '+' : ''}
              {r.value}
            </Tag>
          ))}
          {hero.wanted && <Tag tone="blood">{t('recherché par la garde')}</Tag>}
          {hero.crown?.emperor && <Tag tone="ember">{t('Empereur')}</Tag>}
          {hero.crown?.honour && <Tag tone="ember">{hero.crown.honour}</Tag>}
          {hero.crown?.office && <Tag tone="moss">{hero.crown.office.title}</Tag>}
          {hero.crown?.oath && <Tag>{t('serment prêté')}</Tag>}
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            [t('Travaux'), hero.done],
            [t('Paroles'), hero.stats.talks],
            [t('Bêtes'), hero.stats.kills],
            [t('Pièces'), hero.coinsEarned],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-ink-950/60 py-2">
              <dd className="font-serif text-lg text-ink-100">{value ?? 0}</dd>
              <dt className="text-[0.65rem] uppercase tracking-wide text-ink-600">{label}</dt>
            </div>
          ))}
        </dl>
        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/60 p-2 text-xs">
          {hero.house ? (
            <span className="text-ink-300">
              {t('Ta maison dans les murs')} — {t('tape !maison en jeu pour la retrouver sur la carte.')}
            </span>
          ) : hero.renown >= (hero.houseAt || 150) ? (
            <button onClick={onClaimHouse} className="text-ember-300 hover:text-ember-200">
              {t('Réclamer ta maison dans la cité')}
            </button>
          ) : (
            <span className="text-ink-500">
              {t('Une maison t’attend dans les murs à {n} de renommée.', { n: hero.houseAt || 150 })}
            </span>
          )}
        </div>
        {hero.pending.length > 0 && (
          <p className="mt-3 rounded-lg border border-ember-700/40 bg-ember-700/10 p-2 text-xs text-ember-300">
            {t('En attente de ta prochaine connexion')} : {hero.pending.map((p) => p.name).join(', ')}
          </p>
        )}
      </Card>

      {houseError && <p className="text-center text-sm text-blood-400">{houseError}</p>}

      <Card title={t('La saga')} right={`${hero.saga.done.length}/${hero.saga.total}`}>
        {hero.saga.chapter ? (
          <>
            <p className="font-serif text-ink-100">{hero.saga.chapter.title}</p>
            <p className="mt-1 text-sm text-ink-400">{hero.saga.chapter.step}</p>
            {hero.saga.chapter.count > 1 && (
              <p className="mt-2 text-xs text-ink-500">
                {hero.saga.chapter.progress}/{hero.saga.chapter.count}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-500">{t('Aucun chapitre en cours. Parle aux habitants pour ouvrir la suite.')}</p>
        )}
        {hero.saga.done.length > 0 && <p className="mt-2 text-xs text-ink-600">{hero.saga.done.join(' · ')}</p>}
      </Card>

      {hero.feats?.length > 0 && (
        <Card title={t('Tes hauts faits')}>
          <ul className="space-y-1.5 text-sm text-ink-300">
            {hero.feats.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-xs text-ink-600">{f.day != null ? `J${f.day}` : ''}</span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('Travaux en cours')} right={<button onClick={onReload} className="hover:text-ink-300">{t('Rafraîchir')}</button>}>
        {hero.quests.length === 0 ? (
          <p className="text-sm text-ink-500">{t('Rien pour l’instant. Demande du travail aux artisans de la cité.')}</p>
        ) : (
          <ul className="space-y-3">
            {hero.quests.map((q) => (
              <li key={q.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-ink-200">{q.title}</span>
                  <span className="shrink-0 text-xs text-ember-400">{q.coins} {t('pièces')}</span>
                </div>
                <p className="text-xs text-ink-500">
                  {q.giver}
                  {q.state === 'ready' ? ` — ${t('à rendre')}` : ''}
                </p>
                <ul className="mt-1 space-y-1">
                  {q.objectives.map((o, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-ink-400">
                      <span className="w-28 shrink-0 truncate">{o.label}</span>
                      <Bar value={o.done} max={o.count} tone={o.done >= o.count ? 'moss' : 'ember'} />
                      <span className="w-10 shrink-0 text-right">
                        {o.done}/{o.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ---------- Vie de la cité ----------

function City() {
  const t = useT();
  const [city, setCity] = useState(null);

  useEffect(() => {
    portalApi('/city').then(setCity).catch(() => {});
    const id = setInterval(() => document.visibilityState === 'visible' && portalApi('/city').then(setCity).catch(() => {}), 30000);
    return () => clearInterval(id);
  }, []);

  if (!city) return <p className="text-center text-sm text-ink-500">{t('Chargement…')}</p>;
  const calendar = city.clock?.calendar || {};
  return (
    <>
      <Card title={city.clock ? `${t('Jour')} ${city.clock.day} — ${city.clock.label}` : t('Le monde dort')} right={`${city.online} ${t('en jeu')}`}>
        <div className="flex flex-wrap gap-1.5">
          {calendar.holy && <Tag tone="ember">{t('jour sacré')}</Tag>}
          {calendar.market && <Tag tone="ember">{t('jour du marché')}</Tag>}
          {calendar.festival && <Tag tone="ember">{t('fête de l’hydromel')}</Tag>}
          <Tag>{t('Réprouvés vaincus')} : {city.bosses.length}</Tag>
          {city.bosses.map((b) => (
            <Tag key={b} tone="moss">
              {b}
            </Tag>
          ))}
        </div>
      </Card>

      {city.event && (
        <Card title={city.event.title} right={t('en cours')}>
          <p className="text-sm text-ink-200">{city.event.text}</p>
          {city.event.progress && (
            <>
              <p className="mt-2 text-xs text-ink-500">
                {city.event.progress.done}/{city.event.progress.total} {t('bêtes abattues')}
              </p>
              <Bar value={city.event.progress.done} max={city.event.progress.total} tone="blood" />
            </>
          )}
        </Card>
      )}

      {city.project && (
        <Card title={t('Grand chantier')} right={`${city.project.percent} %`}>
          <p className="font-serif text-ink-100">{city.project.title}</p>
          <p className="mt-1 text-sm text-ink-400">{city.project.story}</p>
          <Bar value={city.project.percent} max={100} tone="moss" />
          <ul className="mt-2 space-y-1 text-xs text-ink-400">
            {city.project.parts.map((part) => (
              <li key={part.item} className="flex justify-between gap-2">
                <span>{part.name}</span>
                <span className={part.done >= part.need ? 'text-moss-400' : ''}>
                  {part.done}/{part.need}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ember-600">{t('À déposer dans le coffre du chantier, à l’atelier des bâtisseurs.')}</p>
          <p className="mt-1 text-xs text-ink-500">{city.project.effect}</p>
        </Card>
      )}

      <Card title={t('Nouvelles de la cité')}>
        <ul className="space-y-2 text-sm text-ink-300">
          {city.news.length === 0 && <li className="text-ink-500">{t('Rien à signaler.')}</li>}
          {city.news.map((n, i) => (
            <li key={i} className="flex gap-2">
              <ScrollText className="mt-0.5 size-3.5 shrink-0 text-ember-600" />
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      {city.chronicle && (
        <Card title={t('La chronique')}>
          <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-ink-300">{city.chronicle}</p>
        </Card>
      )}

      <Card title={t('Les plus renommés')}>
        <ol className="space-y-1.5 text-sm">
          {city.leaders.map((p, i) => (
            <li key={p.name} className="flex items-baseline gap-2">
              <span className="w-5 text-right font-serif text-ink-600">{i + 1}</span>
              <span className="flex-1 truncate text-ink-200">{p.name}</span>
              <span className="text-xs text-ink-500">{p.title}</span>
              <span className="w-12 text-right text-ember-400">{p.renown}</span>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

// ---------- Habitants ----------

function Npcs({ onTalk }) {
  const t = useT();
  const [npcs, setNpcs] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    portalApi('/npcs')
      .then((data) => setNpcs(data.npcs))
      .catch(() => setNpcs([]));
  }, []);

  if (!npcs) return <p className="text-center text-sm text-ink-500">{t('Chargement…')}</p>;
  const term = search.trim().toLowerCase();
  const shown = term
    ? npcs.filter((n) => [n.name, n.title, n.place, n.factionLabel].some((v) => String(v).toLowerCase().includes(term)))
    : npcs;

  return (
    <>
      <label className="flex items-center gap-2 rounded-xl border border-ink-800 bg-ink-900/70 px-3 py-2">
        <Search className="size-4 text-ink-600" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('Chercher un habitant, un métier, un lieu…')}
          className="w-full bg-transparent text-sm text-ink-100 outline-none placeholder:text-ink-600"
        />
      </label>
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((npc) => (
          <li key={npc.key}>
            <button
              onClick={() => onTalk(npc.key)}
              className="flex w-full items-start gap-3 rounded-xl border border-ink-800 bg-ink-900/70 p-3 text-left transition hover:border-ember-700/50 hover:bg-ink-850"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-ember-700/40 bg-ink-950 font-serif text-ember-400">
                {npc.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-serif text-ink-100">{npc.name}</span>
                  {npc.offers > 0 && <Tag tone="ember">{t('travail')}</Tag>}
                  {npc.shop && <Tag>{t('boutique')}</Tag>}
                </span>
                <span className="block truncate text-xs text-ink-500">{npc.title}</span>
                <span className="mt-1 block truncate text-xs text-ink-400">
                  {npc.mood?.label} · {npc.doing} · {npc.place}
                </span>
                {npc.affinity && <span className="block truncate text-[0.7rem] text-ember-600">{t('envers toi')} : {npc.affinity}</span>}
              </span>
              <MessageSquare className="size-4 shrink-0 text-ink-700" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
