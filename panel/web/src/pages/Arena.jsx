import { useEffect, useState } from 'react';
import { Castle, Hammer, Play, ScrollText, Settings2, Square, Swords, Trash2, TriangleAlert, Trophy, Users } from 'lucide-react';
import { api, formatDate, useApi } from '../api.js';
import { useCan } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader, useOnlinePlayers } from '../status.jsx';
import { Badge, Button, Card, Empty, Field, Input, Pre, Select, Spinner, cx, useAction, useFeedback } from '../ui.jsx';

const OUTCOME = { victory: ['Victoire', 'green'], wipe: ['Défaite', 'red'], abandon: ['Abandon', 'neutral'] };
const duration = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export default function Arena() {
  const t = useT();
  const { data, reload } = useApi('/arena', { interval: 2000 });
  const state = data?.state;

  return (
    <>
      <PageHeader
        title={t('Arène')}
        description={t("Une arène de combat par vagues, construite dans le monde par le serveur. Tes amis entrent dans le cercle, l'arène s'éveille, et les récompenses tombent au centre.")}
      />
      <OfflineNotice />
      {!data ? (
        <Spinner />
      ) : !state ? (
        <Card>
          <Empty icon={Swords} title={t("Plugin d'arène non détecté")}>
            {t("Le plugin HearthwatchArena n'a encore rien exporté. Il doit être installé sur le serveur, qui doit avoir redémarré depuis.")}
          </Empty>
        </Card>
      ) : (
        <>
          {state.stale && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{t("Le plugin d'arène ne répond plus depuis {n} s : le serveur de jeu est-il en ligne ?", { n: Math.max(0, Math.floor(Date.now() / 1000) - state.time) })}</span>
            </div>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-6">
              <ArenaCard state={state} reload={reload} />
              <FightCard state={state} reload={reload} />
            </div>
            <div className="space-y-6">
              <SettingsCard state={state} reload={reload} />
              <Leaderboard state={state} reload={reload} />
              <Card title={t('Journal du plugin')} icon={ScrollText}>
                <Pre className="max-h-64 text-xs">{(state.log || []).slice().reverse().join('\n') || '—'}</Pre>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function usePlayerChoice() {
  const players = useOnlinePlayers();
  const [player, setPlayer] = useState('');
  useEffect(() => {
    if (!players.some((p) => p.name === player)) setPlayer(players[0]?.name || '');
  }, [players, player]);
  return [players, player, setPlayer];
}

function ArenaCard({ state, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const { confirm, toast } = useFeedback();
  const [players, player, setPlayer] = usePlayerChoice();
  const arena = state.arena;

  const build = async () => {
    const ok = await confirm({
      title: t('Construire l’arène près de {name} ?', { name: player }),
      message: t('Le serveur choisit l’endroit le moins accidenté entre 35 et 90 m du joueur, nivelle et pave le terrain, retire arbres et rochers, puis bâtit le colisée. Compte quelques secondes.'),
      confirmLabel: t('Construire'),
    });
    if (!ok) return;
    const r = await run('build', () => api('/arena/build', { method: 'POST', body: { player } }), t('Arène construite'));
    if (r) {
      toast(r.message);
      reload();
    }
  };

  const demolish = async () => {
    const ok = await confirm({
      title: t('Démolir l’arène ?'),
      message: t('Toutes les pièces construites par le serveur sont retirées. Le combat en cours, s’il y en a un, est interrompu. Le classement est conservé.'),
      confirmLabel: t('Démolir'),
      danger: true,
    });
    if (!ok) return;
    const r = await run('demolish', () => api('/arena/demolish', { method: 'POST' }), t('Arène démolie'));
    if (r) reload();
  };

  return (
    <Card title={t("L'arène")} icon={Castle}>
      {!arena ? (
        <div className="space-y-4">
          <Empty icon={Hammer} title={t('Aucune arène construite')}>
            {t('Construis-la près d’un joueur connecté : le serveur nivelle et pave un cercle de 44 m, puis bâtit muraille, tours à brasero, porte monumentale, lanternes et trône du maître d’arène.')}
          </Empty>
          {can('world.edit') && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label={t('Construire près de')} className="flex-1">
                <Select value={player} onChange={(e) => setPlayer(e.target.value)} options={players.map((p) => ({ value: p.name, label: `${p.name} (${p.platform})` }))} disabled={!players.length} />
              </Field>
              <Button variant="primary" icon={Hammer} loading={busy === 'build'} disabled={!player} onClick={build}>
                {t('Construire l’arène')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">{t('Arène construite')}</Badge>
            <span className="font-mono text-sm text-ink-200">{t('Centre : X {x} · Z {z}', { x: Math.round(arena.x), z: Math.round(arena.z) })}</span>
          </div>
          <p className="text-sm text-ink-400">{t('Rayon {r} m · {n} pièces · construite le {date}', { r: arena.radius, n: arena.pieces.length, date: formatDate(arena.createdAt) })}</p>
          {state.pieces && Object.keys(state.pieces).length > 0 && (
            <p className="text-xs text-ink-500">
              {t('Pièces debout : {list}', { list: Object.entries(state.pieces).map(([name, n]) => `${name} ×${n}`).join(', ') })}
            </p>
          )}
          {state.missingPrefabs?.length > 0 && (
            <p className="text-xs text-ember-300">{t('Prefabs inconnus (mise à jour du jeu ?) : {list}', { list: state.missingPrefabs.join(', ') })}</p>
          )}
          {can('world.edit') && (
            <Button variant="danger" icon={Trash2} loading={busy === 'demolish'} onClick={demolish}>
              {t('Démolir')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function FightCard({ state, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const { confirm, toast } = useFeedback();
  const [players, player, setPlayer] = usePlayerChoice();
  const [tier, setTier] = useState('');
  const match = state.match;
  const tiers = state.tiers || [];
  const tierName = (n) => t(tiers[n - 1] || '?');
  const active = match && ['countdown', 'wave', 'intermission'].includes(match.phase);
  const secondsLeft = Math.ceil(match?.secondsLeft || 0);

  const start = async () => {
    const r = await run('start', () => api('/arena/start', { method: 'POST', body: { player, tier: tier || undefined } }), t('Combat lancé'));
    if (r) {
      toast(r.message);
      reload();
    }
  };

  const stop = async () => {
    const ok = await confirm({
      title: t('Arrêter le combat ?'),
      message: t('Les créatures restantes disparaissent et les récompenses déjà gagnées sont versées à moitié, comme pour un abandon.'),
      confirmLabel: t('Arrêter le combat'),
      danger: true,
    });
    if (!ok) return;
    const r = await run('stop', () => api('/arena/stop', { method: 'POST' }), t('Combat arrêté'));
    if (r) reload();
  };

  const phaseLabel = {
    countdown: t('Compte à rebours'),
    wave: match ? t('Vague {w} / {n}', { w: match.wave, n: match.waves }) : '',
    intermission: t('Entracte'),
    ended: t('Terminé'),
  };

  return (
    <Card
      title={t('Combat d’arène')}
      icon={Swords}
      actions={
        active && can('world.edit') ? (
          <Button size="sm" variant="danger" icon={Square} loading={busy === 'stop'} onClick={stop}>
            {t('Arrêter le combat')}
          </Button>
        ) : null
      }
    >
      {!state.arena ? (
        <p className="text-sm text-ink-500">{t('Aucune arène construite')}</p>
      ) : !match || match.phase === 'idle' ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-ink-200">{t('Aucun combat en cours')}</p>
          <p className="text-ink-500">{t('Entre dans le cercle en jeu : le compte à rebours démarre tout seul.')}</p>
          {match?.cooldown > 0 && <p className="text-ember-300">{t("L'arène se repose encore {n} s", { n: Math.ceil(match.cooldown) })}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={active ? 'ember' : 'neutral'}>{phaseLabel[match.phase]}</Badge>
            {match.tier > 0 && <Badge tone="blue">{t('Palier {n} · {name}', { n: match.tier, name: tierName(match.tier) })}</Badge>}
            {match.phase === 'ended' && match.outcome && <Badge tone={OUTCOME[match.outcome]?.[1]}>{t(OUTCOME[match.outcome]?.[0] || match.outcome)}</Badge>}
          </div>
          <div className="grid gap-2 text-sm text-ink-300 sm:grid-cols-2">
            {match.phase === 'countdown' && <span>{t('Départ dans {n} s', { n: secondsLeft })}</span>}
            {match.phase === 'wave' && <span>{t('{n} créature(s) restante(s)', { n: match.alive })}</span>}
            {match.phase === 'intermission' && <span>{t('Prochaine vague dans {n} s', { n: secondsLeft })}</span>}
            {match.phase === 'ended' && match.cooldown > 0 && <span>{t("L'arène se repose encore {n} s", { n: Math.ceil(match.cooldown) })}</span>}
            {match.elapsed > 0 && <span>{t('Durée : {t}', { t: duration(match.elapsed) })}</span>}
          </div>
          {match.fighters?.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-ink-500">
                <Users className="size-3.5" /> {t('Combattants')}
              </div>
              <ul className="divide-y divide-ink-800 rounded-lg border border-ink-800">
                {match.fighters.map((f) => (
                  <li key={f.name} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className={cx('font-medium', f.left ? 'text-ink-500 line-through' : 'text-ink-100')}>{f.name}</span>
                    <Badge tone={f.left ? 'neutral' : f.dead ? 'red' : 'green'}>{t(f.left ? 'Parti' : f.dead ? 'Mort' : 'En vie')}</Badge>
                    <span className="text-xs text-ink-500">{t('{n} mort(s)', { n: f.deaths })}</span>
                    {f.gearTier > 0 && <span className="text-xs text-ink-500">· {t('Équipement palier {n}', { n: f.gearTier })}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {state.players?.length > 0 && (
        <div className="mt-4 border-t border-ink-800 pt-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-ink-500">{t('Joueurs connectés')}</div>
          <div className="flex flex-wrap gap-2">
            {state.players.map((p) => (
              <Badge key={p.name} tone={p.inside ? 'ember' : 'neutral'}>
                {p.name} · {t(p.inside ? 'Dans l’arène' : 'Dehors')}
                {p.gearTier > 0 ? ` · T${p.gearTier}` : ''}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {state.arena && !active && can('world.edit') && (
        <div className="mt-4 border-t border-ink-800 pt-4">
          <div className="mb-1 text-sm font-medium text-ink-200">{t('Lancer un combat')}</div>
          <p className="mb-3 text-xs text-ink-500">{t('Pour tester sans attendre : le joueur choisi est téléporté au centre et le combat démarre aussitôt.')}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label={t('Joueur')} className="flex-1">
              <Select value={player} onChange={(e) => setPlayer(e.target.value)} options={players.map((p) => ({ value: p.name, label: `${p.name} (${p.platform})` }))} disabled={!players.length} />
            </Field>
            <Field label={t('Palier')} className="sm:w-48">
              <Select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                options={[{ value: '', label: t('Palier automatique') }, ...tiers.map((name, i) => ({ value: String(i + 1), label: `${i + 1} · ${t(name)}` }))]}
              />
            </Field>
            <Button variant="primary" icon={Play} loading={busy === 'start'} disabled={!player} onClick={start}>
              {t('Lancer le combat')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SettingsCard({ state, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const [form, setForm] = useState(null);
  const tiers = state.tiers || [];
  const saved = JSON.stringify(state.settings || {});

  useEffect(() => {
    setForm((f) => (f?.saved === saved ? f : { ...state.settings, saved }));
  }, [saved, state.settings]);

  if (!form) return null;
  const set = (key, value) => setForm({ ...form, [key]: value });
  const submit = async () => {
    const r = await run('settings', () => api('/arena/settings', { method: 'PUT', body: { forceTier: form.forceTier, waves: form.waves, rewardMultiplier: form.rewardMultiplier, cooldown: form.cooldown, language: form.language } }), t('Réglages enregistrés'));
    if (r) reload();
  };

  return (
    <Card title={t('Réglages')} icon={Settings2}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Palier forcé')} className="sm:col-span-2">
          <Select
            value={String(form.forceTier || 0)}
            onChange={(e) => set('forceTier', Number(e.target.value))}
            options={[{ value: '0', label: t('Automatique (équipement et boss vaincus)') }, ...tiers.map((name, i) => ({ value: String(i + 1), label: `${i + 1} · ${t(name)}` }))]}
            disabled={!can('world.edit')}
          />
        </Field>
        <Field label={t('Vagues pour gagner')}>
          <Input type="number" min={3} max={30} value={form.waves} onChange={(e) => set('waves', Number(e.target.value))} disabled={!can('world.edit')} />
        </Field>
        <Field label={t('Multiplicateur de récompenses')}>
          <Input type="number" min={0.25} max={5} step={0.25} value={form.rewardMultiplier} onChange={(e) => set('rewardMultiplier', Number(e.target.value))} disabled={!can('world.edit')} />
        </Field>
        <Field label={t('Repos entre deux combats (s)')}>
          <Input type="number" min={0} max={3600} value={form.cooldown} onChange={(e) => set('cooldown', Number(e.target.value))} disabled={!can('world.edit')} />
        </Field>
        <Field label={t('Langue des messages en jeu')}>
          <Select value={form.language || 'fr'} onChange={(e) => set('language', e.target.value)} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} disabled={!can('world.edit')} />
        </Field>
      </div>
      {can('world.edit') && (
        <div className="mt-4 flex justify-end">
          <Button variant="primary" loading={busy === 'settings'} onClick={submit}>
            {t('Enregistrer')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Leaderboard({ state, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const tiers = state.tiers || [];
  const records = (state.records || []).slice().sort((a, b) => b.tier - a.tier || b.wave - a.wave || a.seconds - b.seconds).slice(0, 20);

  const clear = async () => {
    const ok = await confirm({ title: t('Effacer le classement ?'), message: t('Tous les combats enregistrés sont supprimés définitivement.'), confirmLabel: t('Effacer le classement'), danger: true });
    if (!ok) return;
    const r = await run('clear', () => api('/arena/records', { method: 'DELETE' }), t('Classement effacé'));
    if (r) reload();
  };

  return (
    <Card
      title={t('Classement')}
      icon={Trophy}
      padded={false}
      actions={
        records.length > 0 && can('world.edit') ? (
          <Button size="sm" variant="ghost" icon={Trash2} loading={busy === 'clear'} onClick={clear} aria-label={t('Effacer le classement')} />
        ) : null
      }
    >
      {!records.length ? (
        <div className="p-6">
          <Empty icon={Trophy} title={t('Aucun combat enregistré')}>
            {t('Le premier combat écrira l’histoire.')}
          </Empty>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-ink-800 text-left text-xs uppercase tracking-wider text-ink-500">
                <th className="px-4 py-2">{t('Équipe')}</th>
                <th className="px-3 py-2">{t('Palier')}</th>
                <th className="px-3 py-2 text-right">{t('Vague')}</th>
                <th className="px-3 py-2 text-right">{t('Durée')}</th>
                <th className="px-3 py-2 text-right">{t('Morts')}</th>
                <th className="px-3 py-2">{t('Résultat')}</th>
                <th className="px-3 py-2">{t('Date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/70">
              {records.map((r, i) => (
                <tr key={`${r.date}-${i}`}>
                  <td className="px-4 py-2 text-ink-100">{r.names.join(', ')}</td>
                  <td className="px-3 py-2 text-ink-300">{r.tier} · {t(tiers[r.tier - 1] || '?')}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-100">{r.wave}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-300">{duration(r.seconds)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-300">{r.deaths}</td>
                  <td className="px-3 py-2">
                    <Badge tone={OUTCOME[r.outcome]?.[1] || 'neutral'}>{t(OUTCOME[r.outcome]?.[0] || r.outcome)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">{formatDate(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
