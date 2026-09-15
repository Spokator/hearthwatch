import { useState } from 'react';
import { CalendarDays, Crosshair, Flag, KeyRound, Megaphone, PawPrint, Plus, Save, Search, Square, Star, Trash2, Zap } from 'lucide-react';
import { api, formatNumber, useApi } from '../api.js';
import { useCan } from '../auth.jsx';
import { PositionPicker, PrefabPicker, formatPos, positionBody, usePrefabLabels, usePrefabs } from '../components.jsx';
import { useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader, useOnlinePlayers, useStatus } from '../status.jsx';
import { Badge, Button, Card, Empty, Field, Input, Select, Spinner, Toggle, cx, useAction, useFeedback } from '../ui.jsx';

const EVENT_LABELS = {
  army_eikthyr: 'Eikthyr est en colère',
  army_theelder: "L'Ancien s'agite",
  army_bonemass: 'Odeur de Bonemass',
  army_moder: 'Moder appelle ses drakes',
  army_goblin: 'Horde de Fulings',
  army_gjall: 'Attaque de Gjalls',
  army_seekers: 'Attaque de Chercheurs',
  army_charred: 'Armée carbonisée',
  army_charredspawners: 'Invocateurs carbonisés',
  army_jotuns: 'Attaque de Jötunns',
  army_elakingar: 'Attaque des Elakingar',
  foresttrolls: 'Trolls de la forêt',
  skeletons: 'Squelettes',
  blobs: 'Blobs',
  wolves: 'Meute de loups',
  surtlings: 'Surtlings',
  bats: 'Chauves-souris',
  ghosts: 'Fantômes',
  gemgoblin: 'Fuling aux gemmes',
  fimbulvinter: 'Fimbulvinter',
  hildirboss1: 'Quête de Hildir (1)',
  hildirboss2: 'Quête de Hildir (2)',
  hildirboss3: 'Quête de Hildir (3)',
};

function useEventLabel() {
  const t = useT();
  return (e) => (EVENT_LABELS[e] ? t(EVENT_LABELS[e]) : e.startsWith('boss_') ? t('Combat de boss ({name})', { name: e.slice(5) }) : e);
}

const BOSS_KEYS = [
  ['defeated_eikthyr', 'Eikthyr'],
  ['defeated_gdking', 'L’Ancien'],
  ['defeated_bonemass', 'Bonemass'],
  ['defeated_dragon', 'Moder'],
  ['defeated_goblinking', 'Yagluth'],
  ['defeated_queen', 'La Reine'],
  ['defeated_fader', 'Fader'],
];

export default function World() {
  const t = useT();
  const { status } = useStatus();
  const can = useCan();
  const online = status?.phase === 'online';
  const world = useApi('/world', { interval: 15000, enabled: online });
  const edit = can('world.edit');

  return (
    <>
      <PageHeader title={t('Monde & événements')} description={t('Temps, progression, raids, invocations et messages aux joueurs.')} />
      <OfflineNotice />
      {online && !world.data && world.loading ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <TimeCard world={world.data} stats={status?.stats} canSave={edit} />
          {can('world.message') && <MessageCard />}
          {edit ? (
            <>
              <EventsCard world={world} />
              <KeysCard world={world} />
              <SpawnCard />
              <ObjectsCard />
            </>
          ) : (
            <ProgressCard world={world.data} />
          )}
        </div>
      )}
    </>
  );
}

function TimeCard({ world, stats, canSave }) {
  const t = useT();
  const [run, busy] = useAction();
  return (
    <Card
      title={t('Temps & sauvegarde')}
      icon={CalendarDays}
      actions={
        canSave && (
          <Button size="sm" icon={Save} loading={busy === 'save'} onClick={() => run('save', () => api('/world/save', { method: 'POST' }), t('Monde sauvegardé'))}>
            {t('Sauvegarder maintenant')}
          </Button>
        )
      }
    >
      <div className="grid grid-cols-3 gap-3 text-center">
        <Mini label={t('Jour')} value={world?.time?.day ?? stats?.day ?? '—'} />
        <Mini label={t('Objets')} value={formatNumber(stats?.objects)} />
        <Mini label="FPS" value={stats?.fps ?? '—'} />
      </div>
      <p className="mt-4 text-xs text-ink-500">{t('Le jeu sauvegarde aussi automatiquement (intervalle réglable dans Configuration).')}</p>
    </Card>
  );
}

function Mini({ label, value }) {
  return (
    <div className="rounded-xl bg-ink-850 px-3 py-3">
      <div className="text-xl font-semibold tabular-nums text-ink-100">{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  );
}

// Vue en lecture seule pour les rôles sans droit de modification du monde.
function ProgressCard({ world }) {
  const t = useT();
  const keys = world?.globalKeys || [];
  return (
    <Card title={t('Progression & événements')} icon={KeyRound}>
      <div className="mb-4 rounded-lg bg-ink-850 px-3 py-2.5 text-sm text-ink-300">{world?.currentEvent || t('Aucun événement en cours')}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BOSS_KEYS.map(([key, label]) => {
          const done = keys.some((k) => k.key.toLowerCase() === key);
          return (
            <div key={key} className={cx('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', done ? 'border-moss-500/40 bg-moss-500/10 text-moss-400' : 'border-ink-700 text-ink-500')}>
              <Star className={cx('size-4', done && 'fill-current')} />
              {t(label)}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MessageCard() {
  const t = useT();
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const send = async (kind) => {
    const r = await run(kind, () => api('/world/message', { method: 'POST', body: { kind, text } }), t('Message envoyé'));
    if (r) setText('');
  };
  return (
    <Card title={t('Message aux joueurs')} icon={Megaphone}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={3} className="input resize-none" placeholder={t('Ex : Redémarrage du serveur dans 5 minutes !')} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" icon={Megaphone} disabled={!text.trim()} loading={busy === 'say'} onClick={() => send('say')}>{t('Dans le chat')}</Button>
        <Button icon={Zap} disabled={!text.trim()} loading={busy === 'center'} onClick={() => send('center')}>{t("Au centre de l'écran")}</Button>
      </div>
    </Card>
  );
}

function EventsCard({ world }) {
  const t = useT();
  const eventLabel = useEventLabel();
  const players = useOnlinePlayers();
  const [event, setEvent] = useState('');
  const [where, setWhere] = useState({ mode: 'player', player: '', x: '', y: '', z: '' });
  const [run, busy] = useAction();
  const events = world.data?.events || [];
  const selected = event || events[0] || '';
  const place = players.length ? where : { ...where, mode: 'coords' };

  const start = async () => {
    const r = await run('start', () => api('/world/event', { method: 'POST', body: { event: selected, ...positionBody(place) } }), t('Événement « {name} » lancé', { name: eventLabel(selected) }));
    if (r) world.reload();
  };
  const stop = async () => {
    const r = await run('stop', () => api('/world/event/stop', { method: 'POST' }), t('Événement arrêté'));
    if (r) world.reload();
  };

  return (
    <Card title={t('Raids & événements')} icon={Flag}>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-ink-850 px-3 py-2.5 text-sm">
        <span className="min-w-0 truncate text-ink-300">{world.data?.currentEvent || t('Aucun événement en cours')}</span>
        {world.data?.currentEvent && <Button size="sm" variant="danger" icon={Square} loading={busy === 'stop'} onClick={stop}>{t('Arrêter')}</Button>}
      </div>
      <div className="space-y-3">
        <Field label={t('Événement')}>
          <Select value={selected} onChange={(e) => setEvent(e.target.value)} options={events.map((e) => ({ value: e, label: eventLabel(e) }))} />
        </Field>
        <Field label={t('Lieu')}>
          <PositionPicker players={players} value={place} onChange={setWhere} />
        </Field>
        <Button variant="primary" icon={Flag} disabled={!selected} loading={busy === 'start'} onClick={start}>{t("Lancer l'événement")}</Button>
      </div>
    </Card>
  );
}

function KeysCard({ world }) {
  const t = useT();
  const [custom, setCustom] = useState('');
  const [run, busy] = useAction();
  const keys = world.data?.globalKeys || [];
  const has = (k) => keys.some((x) => x.key.toLowerCase() === k.toLowerCase());

  const add = async (key) => {
    const r = await run(key, () => api('/world/keys', { method: 'POST', body: { key } }), t('Clé {key} ajoutée', { key }));
    if (r) {
      setCustom('');
      world.reload();
    }
  };
  const remove = async (key) => {
    const r = await run(key, () => api(`/world/keys/${encodeURIComponent(key)}`, { method: 'DELETE' }), t('Clé {key} retirée', { key }));
    if (r) world.reload();
  };

  return (
    <Card title={t('Progression (clés globales)')} icon={KeyRound}>
      <p className="mb-3 text-xs text-ink-500">{t("Les boss vaincus débloquent des raids et des marchands. Coche un boss pour simuler sa défaite, décoche pour l'annuler.")}</p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BOSS_KEYS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => (has(key) ? remove(key) : add(key))}
            disabled={busy === key}
            className={cx(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-50',
              has(key) ? 'border-moss-500/40 bg-moss-500/10 text-moss-400' : 'border-ink-700 text-ink-400 hover:border-ink-600',
            )}
          >
            <Star className={cx('size-4', has(key) && 'fill-current')} />
            {t(label)}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {keys.length ? (
          keys.map(({ key, value }) => (
            <span key={key} className="inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-850 py-0.5 pl-2 pr-0.5 font-mono text-xs text-ink-300">
              {key}
              {value ? ` : ${value}` : ''}
              <button onClick={() => remove(key)} className="rounded p-0.5 text-ink-500 hover:bg-ink-700 hover:text-blood-400" aria-label={t('Retirer {key}', { key })}>
                <Trash2 className="size-3" />
              </button>
            </span>
          ))
        ) : (
          <span className="text-sm text-ink-500">{t('Aucune clé globale')}</span>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(custom.trim());
        }}
      >
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t('Autre clé (ex : defeated_…)')} className="font-mono text-xs" />
        <Button type="submit" icon={Plus} disabled={!custom.trim()} aria-label={t('Ajouter')} />
      </form>
    </Card>
  );
}

function SpawnCard() {
  const t = useT();
  const prefabs = usePrefabs();
  const players = useOnlinePlayers();
  const [form, setForm] = useState({ prefab: '', count: 1, stars: 0, radius: 3, tamed: false });
  const [where, setWhere] = useState({ mode: 'player', player: '', x: '', y: '', z: '' });
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const place = players.length ? where : { ...where, mode: 'coords' };

  const spawn = async () => {
    if (form.count > 10 && !(await confirm({ title: t('Invoquer {n} créatures ?', { n: form.count }), message: t('Beaucoup de créatures d’un coup peuvent ralentir le serveur.'), confirmLabel: t('Invoquer') }))) return;
    await run(
      'spawn',
      () => api('/world/spawn', { method: 'POST', body: { prefab: form.prefab, count: form.count, level: form.stars + 1, radius: form.radius, tamed: form.tamed, ...positionBody(place) } }),
      t('{count} × {name} invoqué(s)', { count: form.count, name: form.prefab }),
    );
  };

  return (
    <Card title={t('Invoquer une créature')} icon={PawPrint} className="lg:col-span-2">
      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <PrefabPicker list={prefabs?.creatures} value={form.prefab} onChange={(v) => set('prefab', v)} placeholder={t('Rechercher une créature…')} height="h-56" />
        <div className="space-y-4">
          <Field label={t('Lieu')}>
            <PositionPicker players={players} value={place} onChange={setWhere} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Nombre')}>
              <Input type="number" min={1} max={50} value={form.count} onChange={(e) => set('count', Number(e.target.value))} />
            </Field>
            <Field label={t('Rayon (m)')}>
              <Input type="number" min={0} max={100} value={form.radius} onChange={(e) => set('radius', Number(e.target.value))} />
            </Field>
          </div>
          <Field label={t('Étoiles')}>
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
          <Toggle checked={form.tamed} onChange={(v) => set('tamed', v)} label={t('Apprivoisée')} hint={t("La créature n'attaque pas les joueurs.")} />
          <Button variant="primary" icon={PawPrint} className="w-full" disabled={!form.prefab} loading={busy === 'spawn'} onClick={spawn}>{t('Invoquer')}</Button>
        </div>
      </div>
    </Card>
  );
}

function ObjectsCard() {
  const t = useT();
  const players = useOnlinePlayers();
  const labels = usePrefabLabels();
  const [prefab, setPrefab] = useState('');
  const [where, setWhere] = useState({ mode: 'player', player: '', x: '', y: '', z: '' });
  const [radius, setRadius] = useState(30);
  const [force, setForce] = useState(false);
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const place = players.length ? where : { ...where, mode: 'coords' };

  const search = async () => {
    const params = new URLSearchParams({ radius });
    if (prefab.trim()) params.set('prefab', prefab.trim());
    for (const [k, v] of Object.entries(positionBody(place))) if (v !== undefined && v !== '') params.set(k, v);
    const r = await run('search', () => api(`/objects?${params}`));
    if (r) setResult(r);
  };

  const remove = async (o) => {
    const ok = await confirm({
      title: t('Supprimer cet objet ?'),
      message: t('{name} ({id}) sera supprimé définitivement du monde.', { name: labels.get(o.prefab) || o.prefab, id: o.id }),
      confirmLabel: t('Supprimer'),
      danger: true,
    });
    if (!ok) return;
    const r = await run(o.id, () => api('/objects/delete', { method: 'POST', body: { id: o.id, force } }), t('Objet supprimé'));
    if (r) setResult((res) => ({ ...res, objects: res.objects.filter((x) => x.id !== o.id) }));
  };

  return (
    <Card title={t('Objets du monde')} icon={Crosshair} className="lg:col-span-2">
      <p className="mb-4 text-xs text-ink-500">
        {t("Retrouve et supprime des objets posés, constructions ou créatures autour d'un point (utile pour nettoyer un lieu ou débloquer un joueur).")}
      </p>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_8rem_auto] md:items-end">
        <Field label={t('Lieu')}>
          <PositionPicker players={players} value={place} onChange={setWhere} />
        </Field>
        <Field label={t('Prefab (optionnel)')}>
          <Input value={prefab} onChange={(e) => setPrefab(e.target.value)} placeholder={t('ex : Troll, piece_chest_wood')} className="font-mono text-xs" />
        </Field>
        <Field label={t('Rayon (m)')}>
          <Input type="number" min={1} max={20000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        </Field>
        <Button icon={Search} loading={busy === 'search'} onClick={search}>{t('Chercher')}</Button>
      </div>
      {result && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
            <span>
              {t('{total} trouvé(s)', { total: result.total })}
              {result.truncated ? t(' — {n} affichés (réduis le rayon pour tout voir)', { n: result.objects.length }) : ''}
            </span>
            <Toggle checked={force} onChange={setForce} label={t('Forcer la suppression')} />
          </div>
          {result.objects.length ? (
            <div className="max-h-96 overflow-auto rounded-lg border border-ink-800">
              <table className="w-full min-w-[36rem] text-sm">
                <tbody className="divide-y divide-ink-800">
                  {result.objects.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2">
                        <div className="text-ink-100">{labels.get(o.prefab) || o.prefab}</div>
                        <div className="font-mono text-[11px] text-ink-500">
                          {o.prefab} · {o.id}
                        </div>
                      </td>
                      <td className="px-4 py-2 tabular-nums text-ink-400">{formatPos(o.position)}</td>
                      <td className="px-4 py-2">{!o.persistent && <Badge>{t('Temporaire')}</Badge>}</td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="danger" icon={Trash2} loading={busy === o.id} onClick={() => remove(o)} aria-label={t('Supprimer')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Crosshair} title={t('Aucun objet trouvé')} />
          )}
        </div>
      )}
    </Card>
  );
}
