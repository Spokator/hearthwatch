import { useEffect, useMemo, useState } from 'react';
import { Gem, Gift, MapPin, Plus, RotateCw, Skull, Star, Timer, Trash2, X } from 'lucide-react';
import { api, formatDate, useApi } from '../api.js';
import { useCan } from '../auth.jsx';
import { PlayerSelect, usePrefabLabels, usePrefabs } from '../components.jsx';
import { useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader, useOnlinePlayers } from '../status.jsx';
import { Badge, Button, Card, Empty, Field, Input, Select, Spinner, cx, useAction, useFeedback } from '../ui.jsx';

const HUNT_STATUS = {
  active: ['En cours', 'ember'],
  found: ['Trouvé !', 'green'],
  gone: ['Coffre disparu', 'neutral'],
  cancelled: ['Annulée', 'neutral'],
};

export default function GameMaster() {
  const t = useT();
  const gm = useApi('/gm?refresh=1', { interval: 20000 });
  const can = useCan();

  return (
    <>
      <PageHeader title={t('Maître du jeu')} description={t('Anime la partie de tes potes : trésors cachés, cadeaux, boss surprise et redémarrages annoncés en jeu.')} />
      <OfflineNotice />
      {!gm.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <TreasureCard gm={gm} />
          <div className="space-y-6">
            <GiftCard presets={gm.data.presets} />
            <BossCard bosses={gm.data.bosses} schedule={gm.data.schedule} onDone={gm.reload} />
            {can('server.control') && <RestartCard schedule={gm.data.schedule} onDone={gm.reload} />}
          </div>
        </div>
      )}
    </>
  );
}

// Butin : préréglage ou liste personnalisée.
function LootEditor({ presets, value, onChange }) {
  const t = useT();
  const prefabs = usePrefabs();
  const labels = usePrefabLabels();
  const custom = value.preset === 'custom';
  const chip = (active) => cx('rounded-full border px-3 py-1 text-xs transition', active ? 'border-ember-500/60 bg-ember-500/15 text-ember-300' : 'border-ink-700 text-ink-400 hover:text-ink-200');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(presets).map(([key, p]) => (
          <button key={key} type="button" onClick={() => onChange({ ...value, preset: key })} className={chip(value.preset === key)}>
            {t(p.label)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...value, preset: 'custom', items: value.items.length ? value.items : [{ item: 'Coins', count: 100, quality: 1 }] })}
          className={chip(custom)}
        >
          {t('Personnalisé')}
        </button>
      </div>

      {custom ? (
        <div className="space-y-2">
          <datalist id="gm-items">
            {prefabs?.items.map((i) => (
              <option key={i.name} value={i.name}>
                {i.label}
              </option>
            ))}
          </datalist>
          {value.items.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                list="gm-items"
                value={row.item}
                onChange={(e) => onChange({ ...value, items: value.items.map((r, i) => (i === index ? { ...r, item: e.target.value.trim() } : r)) })}
                placeholder={t('Objet (prefab)')}
                className="font-mono text-xs"
              />
              <Input
                type="number"
                min={1}
                value={row.count}
                onChange={(e) => onChange({ ...value, items: value.items.map((r, i) => (i === index ? { ...r, count: Number(e.target.value) } : r)) })}
                className="w-24"
                aria-label={t('Quantité')}
              />
              <Button size="sm" variant="ghost" icon={X} onClick={() => onChange({ ...value, items: value.items.filter((_, i) => i !== index) })} aria-label={t('Retirer')} />
            </div>
          ))}
          {value.items.length < 12 && (
            <Button size="sm" icon={Plus} onClick={() => onChange({ ...value, items: [...value.items, { item: '', count: 1, quality: 1 }] })}>
              {t('Ajouter un objet')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {presets[value.preset]?.items.map(([item, count], i) => (
            <Badge key={i}>
              {count} × {labels.get(item) || item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const lootBody = (loot) => (loot.preset === 'custom' ? { items: loot.items.filter((i) => i.item) } : { preset: loot.preset });

function TreasureCard({ gm }) {
  const t = useT();
  const players = useOnlinePlayers();
  const { confirm } = useFeedback();
  const [run, busy] = useAction();
  const [loot, setLoot] = useState({ preset: 'bronze', items: [] });
  const [form, setForm] = useState({ player: '', minDistance: 150, maxDistance: 400, hint: 'direction', message: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const player = players.some((p) => p.id === form.player) ? form.player : players[0]?.id || '';

  const start = async () => {
    const r = await run('treasure', () => api('/gm/treasure', { method: 'POST', body: { ...form, player, ...lootBody(loot) } }), (h) =>
      t('Trésor caché à {distance} m {direction} de {name}', { distance: h.distance, direction: t(h.direction), name: h.origin }),
    );
    if (r) gm.reload();
  };
  const cancel = async (hunt) => {
    const ok = await confirm({ title: t('Annuler cette chasse ?'), message: t('Le coffre et son contenu sont supprimés du monde.'), confirmLabel: t('Annuler la chasse'), danger: true });
    if (!ok) return;
    const r = await run(`cancel:${hunt.id}`, () => api(`/gm/treasure/${hunt.id}`, { method: 'DELETE' }), t('Chasse annulée'));
    if (r) gm.reload();
  };

  return (
    <Card title={t('Chasse au trésor')} icon={Gem}>
      <p className="mb-4 text-xs text-ink-500">
        {t('Un coffre rempli de butin est caché sur la terre ferme, loin du joueur choisi. Tout le monde reçoit une annonce et un indice dans le jeu. Le panel détecte quand le coffre a été vidé.')}
      </p>
      <div className="space-y-4">
        <Field label={t('Butin')}>
          <LootEditor presets={gm.data.presets} value={loot} onChange={setLoot} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Autour de')}>
            <PlayerSelect players={players} value={player} onChange={(v) => set('player', v)} />
          </Field>
          <Field label={t('Distance min (m)')}>
            <Input type="number" min={20} max={3000} value={form.minDistance} onChange={(e) => set('minDistance', Number(e.target.value))} />
          </Field>
          <Field label={t('Distance max (m)')}>
            <Input type="number" min={form.minDistance} max={5000} value={form.maxDistance} onChange={(e) => set('maxDistance', Number(e.target.value))} />
          </Field>
        </div>
        <Field label={t('Indice')}>
          <Select
            value={form.hint}
            onChange={(e) => set('hint', e.target.value)}
            options={[
              { value: 'direction', label: t('Direction et distance (« à 300 m au nord-est de Ragnar »)') },
              { value: 'ping', label: t('Marque sur la carte du jeu (facile)') },
              { value: 'none', label: t('Aucun indice (difficile)') },
            ]}
          />
        </Field>
        <Field label={t('Message personnalisé (optionnel)')} hint={t("Remplace l'indice automatique dans le chat.")}>
          <Input value={form.message} maxLength={200} onChange={(e) => set('message', e.target.value)} placeholder={t('Ex : Le trésor dort près du grand chêne...')} />
        </Field>
        <Button variant="primary" icon={Gem} disabled={!player} loading={busy === 'treasure'} onClick={start}>
          {t('Cacher le trésor')}
        </Button>
      </div>

      <div className="mt-6 border-t border-ink-800 pt-4">
        <h4 className="mb-3 text-sm font-semibold text-ink-100">{t('Chasses')}</h4>
        {gm.data.hunts.length ? (
          <ul className="space-y-2">
            {gm.data.hunts.slice(0, 15).map((h) => {
              const [label, tone] = HUNT_STATUS[h.status] || [h.status, 'neutral'];
              return (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-850 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone}>{t(label)}</Badge>
                      <span className="text-ink-200">{t('{distance} m {direction} de {name}', { distance: h.distance, direction: t(h.direction), name: h.origin })}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                      <MapPin className="size-3" /> X {h.x} · Z {h.z} · {formatDate(h.createdAt)} {t('par')} {h.createdBy}
                    </div>
                  </div>
                  {h.status === 'active' && (
                    <Button size="sm" variant="ghost" icon={Trash2} loading={busy === `cancel:${h.id}`} onClick={() => cancel(h)}>
                      {t('Annuler')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={Gem} title={t("Aucune chasse pour l'instant")} />
        )}
      </div>
    </Card>
  );
}

function GiftCard({ presets }) {
  const t = useT();
  const players = useOnlinePlayers();
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const [loot, setLoot] = useState({ preset: 'prairies', items: [] });
  const [message, setMessage] = useState('');

  const send = async () => {
    const ok = await confirm({
      title: t('Offrir ce cadeau à {n} joueur(s) ?', { n: players.length }),
      message: t('Les objets apparaissent au sol, aux pieds de chaque joueur connecté.'),
      confirmLabel: t('Offrir'),
    });
    if (!ok) return;
    await run('gift', () => api('/gm/gift', { method: 'POST', body: { ...lootBody(loot), message } }), (r) => t('Cadeau envoyé à {n} joueur(s)', { n: r.players }));
  };

  return (
    <Card title={t('Cadeau à tous')} icon={Gift}>
      <div className="space-y-4">
        <LootEditor presets={presets} value={loot} onChange={setLoot} />
        <Input value={message} maxLength={120} onChange={(e) => setMessage(e.target.value)} placeholder={t("Message à l'écran (optionnel) : « Joyeux anniversaire Freya ! »")} />
        <Button variant="primary" icon={Gift} disabled={!players.length} loading={busy === 'gift'} onClick={send}>
          {t(players.length > 1 ? 'Offrir à {n} joueurs' : 'Offrir à {n} joueur', { n: players.length })}
        </Button>
      </div>
    </Card>
  );
}

function BossCard({ bosses, schedule, onDone }) {
  const t = useT();
  const players = useOnlinePlayers();
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const [form, setForm] = useState({ boss: 'Troll', player: '', countdown: 10, stars: 0, count: 1 });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const player = players.some((p) => p.id === form.player) ? form.player : players[0]?.id || '';

  const launch = async () => {
    const ok = await confirm({
      title: t('Faire apparaître {name} ?', { name: t(bosses[form.boss]) }),
      message: t('La créature apparaît à une quinzaine de mètres du joueur à la fin du compte à rebours. Elle peut tuer les joueurs et abîmer leurs constructions.'),
      confirmLabel: t('Lancer'),
      danger: true,
    });
    if (!ok) return;
    const r = await run('boss', () => api('/gm/boss', { method: 'POST', body: { ...form, player } }), (res) => t('{name} arrive sur {player} !', { name: t(res.label), player: res.player }));
    if (r) onDone();
  };

  return (
    <Card title={t('Boss surprise')} icon={Skull}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Créature')}>
          <Select value={form.boss} onChange={(e) => set('boss', e.target.value)} options={Object.entries(bosses).map(([value, label]) => ({ value, label: t(label) }))} />
        </Field>
        <Field label={t('Sur le joueur')}>
          <PlayerSelect players={players} value={player} onChange={(v) => set('player', v)} />
        </Field>
        <Field label={t('Compte à rebours (s)')}>
          <Input type="number" min={0} max={120} value={form.countdown} onChange={(e) => set('countdown', Number(e.target.value))} />
        </Field>
        <Field label={t('Nombre')}>
          <Input type="number" min={1} max={3} value={form.count} onChange={(e) => set('count', Number(e.target.value))} />
        </Field>
        <Field label={t('Étoiles')} className="sm:col-span-2">
          <div className="flex gap-2">
            {[0, 1, 2].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => set('stars', n)}
                className={cx('flex flex-1 items-center justify-center gap-0.5 rounded-lg border py-2', form.stars === n ? 'border-ember-500/60 bg-ember-500/10 text-ember-300' : 'border-ink-700 text-ink-500')}
              >
                {n === 0 ? <span className="text-xs">{t('Aucune')}</span> : Array.from({ length: n }, (_, i) => <Star key={i} className="size-3.5 fill-current" />)}
              </button>
            ))}
          </div>
        </Field>
      </div>
      {schedule.bosses.length > 0 && (
        <div className="mt-4 space-y-1">
          {schedule.bosses.map((b) => (
            <div key={b.id} className="text-xs text-ember-300">
              {t('{name} arrive sur {player}', { name: t(b.label), player: b.player })} <Countdown to={b.spawnAt} />
            </div>
          ))}
        </div>
      )}
      <Button variant="danger" icon={Skull} className="mt-4" disabled={!player} loading={busy === 'boss'} onClick={launch}>
        {t('Lancer le boss')}
      </Button>
    </Card>
  );
}

function RestartCard({ schedule, onDone }) {
  const t = useT();
  const [run, busy] = useAction();
  const [minutes, setMinutes] = useState(5);
  const [reason, setReason] = useState('');

  const program = async () => {
    const r = await run('restart', () => api('/gm/restart', { method: 'POST', body: { minutes, reason } }), t('Redémarrage annoncé dans {n} min', { n: minutes }));
    if (r) onDone();
  };
  const cancel = async () => {
    const r = await run('cancel', () => api('/gm/restart', { method: 'DELETE' }), t('Redémarrage annulé'));
    if (r) onDone();
  };

  return (
    <Card title={t('Redémarrage annoncé')} icon={Timer}>
      {schedule.restart ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ember-300">
            {t('Redémarrage')} <Countdown to={schedule.restart.at} />
            {schedule.restart.reason && <span className="text-ink-400"> — {schedule.restart.reason}</span>}
          </div>
          <Button variant="danger" icon={X} loading={busy === 'cancel'} onClick={cancel}>
            {t('Annuler')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-ink-500">{t("Les joueurs voient des alertes à l'écran avant le redémarrage (5 min, 1 min, 30 s, 10 s). Le monde est sauvegardé.")}</p>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label={t('Dans (min)')}>
              <Input type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </Field>
            <Field label={t('Raison (optionnel)')}>
              <Input value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} placeholder={t("Installation d'un mod")} />
            </Field>
          </div>
          <Button icon={RotateCw} loading={busy === 'restart'} onClick={program}>
            {t('Programmer')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Countdown({ to }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.round((Date.parse(to) - now) / 1000));
  const text = useMemo(() => (left >= 60 ? `${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s` : `${left} s`), [left]);
  return <span className="font-mono tabular-nums">{t('dans {time}', { time: text })}</span>;
}
