// Portail des Élus : le site des joueurs. On y entre avec un code obtenu en jeu (!portail), puis on suit sa
// feuille de personnage, la vie de la cité, et l'on parle aux habitants — par écrit ou à la voix.
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Castle, Coins, Crown as CrownIcon, Hammer, Loader2, LogOut, MessageSquare, Radar, ScrollText, Shield, Swords } from 'lucide-react';
import { LanguageSwitcher, useT } from '../i18n.jsx';
import { portalApi } from './api.js';
import { Bar, Card, Rune, Tag, cx } from './ui.jsx';
import Around from './Around.jsx';
import Crown from './Crown.jsx';
import Guide from './Guide.jsx';
import Talk from './Talk.jsx';

const TABS = [
  { key: 'around', label: 'Autour', icon: Radar },
  { key: 'hero', label: 'Mon héros', icon: Shield },
  { key: 'city', label: 'La cité', icon: Castle },
  { key: 'crown', label: 'Couronne', icon: CrownIcon },
  { key: 'guide', label: 'Guide', icon: BookOpen },
];

export default function Portal() {
  const t = useT();
  const [state, setState] = useState({ loading: true, hero: null, voice: null });
  const [tab, setTab] = useState('around');
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
            {tab === 'around' && <Around onTalk={setTalking} />}
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

  const crown = hero.crown || {};
  const stats = [
    [t('Travaux'), hero.done, Hammer],
    [t('Paroles'), hero.stats.talks, MessageSquare],
    [t('Bêtes'), hero.stats.kills, Swords],
    [t('Pièces'), hero.coinsEarned, Coins],
  ];

  return (
    <>
      {/* Le blason : qui tu es pour Spokaheim. */}
      <section className="rounded-xl border border-ink-800 bg-gradient-to-b from-ink-800/40 to-ink-900/70 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-full border border-ember-700/50 bg-ink-950 font-serif text-2xl text-ember-400">
            {hero.name.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-serif text-xl text-ink-100">{hero.name}</h2>
            <p className="text-sm text-ember-300">{crown.honour || hero.title}</p>
            <p className="text-xs text-ink-500">
              {crown.honour ? `${hero.title} · ` : ''}
              {hero.online ? t('en jeu') : t('hors ligne')}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-baseline justify-between text-sm">
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
          {crown.emperor && <Tag tone="ember">{t('Empereur')}</Tag>}
          {crown.office && <Tag tone="moss">{crown.office.title}</Tag>}
          {crown.oath && <Tag>{t('serment prêté')}</Tag>}
          {hero.reputation.map((r) => (
            <Tag key={r.key} tone={r.value >= 0 ? 'moss' : 'blood'}>
              {r.label} {r.value >= 0 ? '+' : ''}
              {r.value}
            </Tag>
          ))}
          {hero.wanted && <Tag tone="blood">{t('recherché par la garde')}</Tag>}
        </div>

        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          {stats.map(([label, value, Icon]) => (
            <div key={label} className="rounded-lg bg-ink-950/60 py-2">
              <Icon className="mx-auto mb-0.5 size-3.5 text-ink-600" />
              <dd className="font-serif text-lg text-ink-100">{value ?? 0}</dd>
              <dt className="text-[0.62rem] uppercase tracking-wide text-ink-600">{label}</dt>
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
            <span className="text-ink-500">{t('Une maison t’attend dans les murs à {n} de renommée.', { n: hero.houseAt || 150 })}</span>
          )}
        </div>

        {hero.pending.length > 0 && (
          <p className="mt-2 rounded-lg border border-ember-700/40 bg-ember-700/10 p-2 text-xs text-ember-300">
            {t('En attente de ta prochaine connexion')} : {hero.pending.map((p) => p.name).join(', ')}
          </p>
        )}
      </section>

      {houseError && <p className="text-center text-sm text-blood-400">{houseError}</p>}

      <Card title={t('La saga')} right={`${hero.saga.done.length}/${hero.saga.total}`}>
        {hero.saga.chapter ? (
          <>
            <p className="font-serif text-ink-100">{hero.saga.chapter.title}</p>
            <p className="mt-1 text-sm text-ink-400">{hero.saga.chapter.step}</p>
            {hero.saga.chapter.count > 1 && (
              <>
                <p className="mt-2 text-xs text-ink-500">
                  {hero.saga.chapter.progress}/{hero.saga.chapter.count}
                </p>
                <Bar value={hero.saga.chapter.progress} max={hero.saga.chapter.count} />
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-500">{t('Aucun chapitre en cours. Parle aux habitants pour ouvrir la suite.')}</p>
        )}
        {hero.saga.done.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-ink-600">
            {hero.saga.done.map((chapter) => (
              <li key={chapter} className="flex items-center gap-2">
                <span className="text-moss-500">✓</span> {chapter}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('Travaux en cours')} right={<button onClick={onReload} className="hover:text-ink-300">{t('Rafraîchir')}</button>}>
        {hero.quests.length === 0 ? (
          <p className="text-sm text-ink-500">{t('Rien pour l’instant. Demande du travail aux artisans de la cité.')}</p>
        ) : (
          <ul className="space-y-3">
            {hero.quests.map((quest) => (
              <li key={quest.id} className={cx('rounded-xl border p-3', quest.state === 'ready' ? 'border-moss-500/40 bg-moss-500/5' : 'border-ink-800 bg-ink-950/40')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-ink-100">{quest.title}</span>
                  <span className="shrink-0 text-xs text-ember-400">
                    {quest.coins} {t('pièces')}
                  </span>
                </div>
                <p className="text-xs text-ink-500">
                  {quest.giver}
                  {quest.state === 'ready' ? ` — ${t('à rendre')}` : ''}
                </p>
                <ul className="mt-2 space-y-1">
                  {quest.objectives.map((objective, index) => (
                    <li key={index} className="flex items-center gap-2 text-xs text-ink-400">
                      <span className="w-28 shrink-0 truncate">{objective.label}</span>
                      <Bar value={objective.done} max={objective.count} tone={objective.done >= objective.count ? 'moss' : 'ember'} />
                      <span className="w-10 shrink-0 text-right">
                        {objective.done}/{objective.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {hero.feats?.length > 0 && (
        <Card title={t('Tes hauts faits')}>
          <ul className="space-y-2 text-sm text-ink-300">
            {hero.feats.map((feat, index) => (
              <li key={index} className="flex gap-2 border-l border-ink-800 pl-3">
                <span className="shrink-0 text-xs text-ink-600">{feat.day != null ? `J${feat.day}` : ''}</span>
                <span>{feat.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
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
