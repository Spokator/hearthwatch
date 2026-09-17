import { lazy, Suspense, useEffect, useState } from 'react';
import { Box, Dices, DoorOpen, Gem, Hammer, Landmark, MapPin, Megaphone, Mountain, ScrollText, Send, Settings2, ShieldCheck, Trash2, TriangleAlert, Users, Wrench } from 'lucide-react';
import { api, formatDate, formatNumber, useApi } from '../api.js';
import { useCan } from '../auth.jsx';
import { Tabs } from '../components.jsx';
import { useI18n, useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader, useOnlinePlayers } from '../status.jsx';
import { Badge, Button, Card, Empty, Field, Input, Meter, Select, Spinner, Stat, Toggle, cx, useAction, useFeedback } from '../ui.jsx';
import { PREVIEW_COLORS } from './cityColors.js';

const CityPreview = lazy(() => import('./CityPreview.jsx'));

const SIZE_LABELS = { ville: 'Ville', cite: 'Cité', capitale: 'Capitale impériale' };
const DISTRICTS = {
  palace: 'Château impérial',
  arena: 'Arène',
  market: 'Marché et marchands',
  foundry: 'Fonderie',
  forge: 'Forge',
  workshop: 'Atelier',
  kitchen: 'Cuisines',
  mage: 'Cercle des mages',
  tavern: 'Taverne',
  brasserie: 'Grande brasserie',
  armory: 'Armurerie impériale',
  moat: 'Douves et promenade',
  portals: 'Place des portails',
  parcels: 'Parcelles',
  houses: 'Maisons vikings',
};
const PHASES = { zones: 'Génération des zones', clear: 'Défrichage', terrain: 'Nivellement', pieces: 'Construction', arena: 'Arène', done: 'Finitions' };
const WELCOME = [
  { value: 0, label: 'Désactivé' },
  { value: 1, label: 'Nouveaux venus (une fois)' },
  { value: 2, label: 'À chaque connexion' },
];

export default function City() {
  const t = useT();
  const { data, reload } = useApi('/city', { interval: 3000 });

  const city = data?.city;
  return (
    <>
      <PageHeader
        title={t('Ville')}
        description={t("Une cité médiévale entière, générée et bâtie par le serveur : remparts, palais, grand-place, tous les ateliers d'artisanat, marchands, taverne, arène et maisons. Les nouveaux joueurs y apparaissent.")}
      />
      <OfflineNotice />
      {!data ? (
        <Spinner />
      ) : !data.plugin ? (
        <Card>
          <Empty icon={Landmark} title={t('Plugin non détecté')}>
            {t("Le plugin HearthwatchArena n'a encore rien exporté. Il doit être installé sur le serveur, qui doit avoir redémarré depuis.")}
          </Empty>
        </Card>
      ) : city?.building ? (
        <BuildingCard city={city} />
      ) : city?.built ? (
        <BuiltCity city={city} reload={reload} />
      ) : (
        <Designer data={data} reload={reload} />
      )}
    </>
  );
}

// ---------- Conception ----------

function Designer({ data, reload }) {
  const t = useT();
  const { lang } = useI18n();
  const can = useCan();
  const [run, busy] = useAction();
  const { confirm, toast } = useFeedback();
  const players = useOnlinePlayers();
  const survey = data.survey;
  const plan = data.plan;

  const [mode, setMode] = useState('start');
  const [player, setPlayer] = useState('');
  const [coords, setCoords] = useState({ x: '', z: '' });
  const [size, setSize] = useState(survey?.size || 'cite');
  const [search, setSearch] = useState(true);
  const [options, setOptions] = useState(() => ({
    name: plan?.options?.name || 'Spokaheim',
    emperor: plan?.options?.emperor || 'Spoka',
    seed: plan?.options?.seed ?? Math.floor(Math.random() * 100000),
    arena: plan?.options?.arena ?? true,
    houses: plan?.options?.houses ?? true,
    guards: plan?.options?.guards ?? true,
    language: plan?.options?.language || lang,
  }));
  const [force, setForce] = useState(false);
  const set = (key) => (value) => setOptions((o) => ({ ...o, [key]: value }));

  useEffect(() => {
    if (!players.some((p) => p.name === player)) setPlayer(players[0]?.name || '');
  }, [players, player]);

  const doSurvey = async () => {
    const body = mode === 'start' ? { anchor: true, size } : mode === 'player' ? { player, size, search } : { x: coords.x, z: coords.z, size, search };
    const r = await run('survey', () => api('/city/survey', { method: 'POST', body }), t('Terrain relevé'));
    if (r) {
      toast(r.message);
      reload();
    }
  };

  const doGenerate = async () => {
    const r = await run('generate', () => api('/city/generate', { method: 'POST', body: options }), t('Plan généré'));
    if (r) reload();
  };

  const doBuild = async () => {
    const ok = await confirm({
      title: t('Bâtir {name} ?', { name: options.name }),
      message: t("Le serveur génère les zones jamais visitées, retire arbres, rochers et créatures sauvages, nivelle le sol puis pose {n} pièces, sans geler la partie. Les joueurs présents sur le chantier risquent de se retrouver dans un mur : préviens-les.", { n: formatNumber(plan.pieces) }),
      confirmLabel: t('Bâtir la ville'),
    });
    if (!ok) return;
    const r = await run('build', () => api('/city/build', { method: 'POST', body: { force } }), t('Construction lancée'));
    if (r) reload();
  };

  const sizeOptions = Object.entries(data.sizes || {}).map(([key, radius]) => ({ value: key, label: t('{name} (Ø {d} m)', { name: t(SIZE_LABELS[key] || key), d: radius * 2 }) }));
  const relief = survey ? Math.round((survey.max - survey.min) * 10) / 10 : 0;
  const risky = survey && (survey.playerPieces > 0 || relief > 24);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={t('1. Emplacement')} icon={MapPin}>
          <div className="space-y-4">
            <Tabs
              tabs={[
                ['start', t('Pierres de départ'), Gem],
                ['player', t('Près d’un joueur'), Users],
                ['coords', t('Coordonnées'), MapPin],
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === 'start' ? (
              <p className="text-sm text-ink-400">{t('La grand-place entoure les pierres de départ, au centre du monde : là où tout aventurier commence. Leur sol reste intact.')}</p>
            ) : mode === 'player' ? (
              <Field label={t('Joueur connecté')}>
                <Select value={player} onChange={(e) => setPlayer(e.target.value)} options={players.map((p) => ({ value: p.name, label: p.name }))} disabled={!players.length} />
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="X">
                  <Input type="number" value={coords.x} onChange={(e) => setCoords((c) => ({ ...c, x: e.target.value }))} />
                </Field>
                <Field label="Z">
                  <Input type="number" value={coords.z} onChange={(e) => setCoords((c) => ({ ...c, z: e.target.value }))} />
                </Field>
              </div>
            )}
            <Field label={t('Taille')}>
              <Select value={size} onChange={(e) => setSize(e.target.value)} options={sizeOptions} />
            </Field>
            {mode !== 'start' && (
              <Toggle checked={search} onChange={setSearch} label={t('Chercher le meilleur terrain aux alentours')} hint={t("Jusqu'à 240 m autour du point : le jeu ne peut relever ou creuser le sol que de 8 m.")} />
            )}
            {can('world.edit') && (
              <Button variant="primary" icon={Mountain} loading={busy === 'survey'} disabled={mode === 'player' ? !player : coords.x === '' || coords.z === ''} onClick={doSurvey}>
                {t('Relever le terrain')}
              </Button>
            )}
            {survey && (
              <div className="space-y-2 rounded-lg border border-ink-800 bg-ink-950/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="blue">{t(SIZE_LABELS[survey.size] || survey.size)}</Badge>
                  <span className="font-mono text-ink-200">{t('Centre : X {x} · Z {z}', { x: Math.round(survey.center[0]), z: Math.round(survey.center[1]) })}</span>
                  <Badge>{survey.biome}</Badge>
                  {survey.anchor && <Badge tone="ember">{t('Pierres de départ')}</Badge>}
                </div>
                {survey.stones && (
                  <p className="text-ember-300">
                    {t('Le terrain autour des pierres de départ est trop accidenté ou noyé ({p} % hors de portée) : la cité est placée au meilleur endroit voisin, à {d} m. Les pierres restent un sanctuaire hors les murs et les joueurs apparaissent quand même dans la cité.', { p: Math.round(survey.stones.unfit * 100), d: Math.round(survey.stones.distance) })}
                  </p>
                )}
                <p className="text-ink-400">
                  {t('Dénivelé naturel : {d} m · sol de la ville à {y} m', { d: relief, y: survey.floorY })}
                </p>
                {survey.unexplored > 0 && <p className="text-ink-500">{t('{n} zone(s) jamais visitée(s) : le serveur les générera avant de bâtir.', { n: survey.unexplored })}</p>}
                {survey.playerPieces > 0 && (
                  <p className="flex gap-2 text-ember-300">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    {t('{n} pièce(s) construite(s) par des joueurs dans l’emprise : elles seraient noyées dans la ville.', { n: survey.playerPieces })}
                  </p>
                )}
                {relief > 24 && <p className="text-ember-300">{t('Terrain très accidenté : certains quartiers resteront vides là où le sol ne peut pas être nivelé.')}</p>}
                {survey.locations?.length > 0 && (
                  <p className="text-xs text-ink-500">{t('Lieux dans l’emprise : {list}', { list: survey.locations.map((l) => l.name).join(', ') })}</p>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card title={t('2. Plan')} icon={Landmark}>
          {!survey ? (
            <p className="text-sm text-ink-500">{t("Relève d'abord le terrain.")}</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('Nom de la ville')}>
                  <Input value={options.name} maxLength={40} onChange={(e) => set('name')(e.target.value)} />
                </Field>
                <Field label={t('Empereur')}>
                  <Input value={options.emperor} maxLength={40} onChange={(e) => set('emperor')(e.target.value)} />
                </Field>
                <Field label={t('Graine (disposition des maisons)')}>
                  <div className="flex gap-2">
                    <Input type="number" value={options.seed} onChange={(e) => set('seed')(e.target.value)} />
                    <Button icon={Dices} onClick={() => set('seed')(Math.floor(Math.random() * 100000))} aria-label={t('Graine au hasard')} />
                  </div>
                </Field>
                <Field label={t('Langue des panneaux')}>
                  <Select
                    value={options.language}
                    onChange={(e) => set('language')(e.target.value)}
                    options={[
                      { value: 'fr', label: 'Français' },
                      { value: 'en', label: 'English' },
                    ]}
                  />
                </Field>
              </div>
              <Toggle checked={options.arena} onChange={set('arena')} label={t('Arène impériale')} hint={t("Remplace l'arène actuelle s'il y en a une.")} />
              <Toggle checked={options.houses} onChange={set('houses')} label={t('Maisons')} hint={t('Le gros des pièces : désactive-les pour une ville plus légère.')} />
              <Toggle checked={options.guards} onChange={set('guards')} label={t('Gardes nains')} hint={t('Quelques Dvergrs neutres autour de la grand-place.')} />
              {can('world.edit') && (
                <Button variant="primary" icon={Box} loading={busy === 'generate'} onClick={doGenerate}>
                  {t('Générer le plan')}
                </Button>
              )}
              {plan && <PlanSummary plan={plan} />}
            </div>
          )}
        </Card>
      </div>

      {plan && (
        <Card title={t('Aperçu')} icon={Box} padded={false}>
          <PreviewPanel key={plan.generatedAt} />
          <div className="border-t border-ink-800 p-4">
            {risky && survey.playerPieces > 0 && (
              <div className="mb-4">
                <Toggle checked={force} onChange={setForce} label={t('Bâtir malgré les constructions de joueurs')} hint={t('Elles ne sont pas détruites, mais la ville sera posée par-dessus.')} />
              </div>
            )}
            {can('world.edit') && (
              <Button variant="primary" icon={Hammer} loading={busy === 'build'} disabled={survey?.playerPieces > 0 && !force} onClick={doBuild}>
                {t('Bâtir la ville ({n} pièces)', { n: formatNumber(plan.pieces) })}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function PlanSummary({ plan }) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3 text-sm">
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t('Pièces')} value={formatNumber(plan.pieces)} />
        <Stat label={t('Maisons')} value={plan.houses} sub={plan.parcels ? t('+ {n} parcelles', { n: plan.parcels }) : undefined} />
        <Stat label={t('Diamètre')} value={`${plan.radius * 2} m`} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {plan.districts.map((d) => (
          <Badge key={d} tone="green">
            {t(DISTRICTS[d] || d)}
          </Badge>
        ))}
      </div>
      {plan.options.arena && !plan.arena && <p className="text-ember-300">{t("L'arène ne tient pas ici : choisis une taille plus grande ou un terrain plus plat.")}</p>}
      {plan.arena && <p className="text-xs text-ink-500">{t('Plus les {n} pièces de l’arène, bâtie par le plugin.', { n: 283 })}</p>}
    </div>
  );
}

function PreviewPanel() {
  const t = useT();
  const { data, error } = useApi('/city/preview');
  if (error) return <p className="p-4 text-sm text-ink-500">{error.message}</p>;
  if (!data) return <Spinner className="m-4" />;
  return (
    <div>
      <Suspense fallback={<Spinner className="m-4" />}>
        <CityPreview data={data} className="h-[520px] w-full overflow-hidden" />
      </Suspense>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-800 px-4 py-2 text-xs text-ink-400">
        {PREVIEW_COLORS.map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color }} />
            {t(label)}
          </span>
        ))}
        <span className="ml-auto text-ink-500">{t('Clic gauche : tourner · clic droit : déplacer · molette : zoom')}</span>
      </div>
    </div>
  );
}

// ---------- Chantier ----------

function BuildingCard({ city }) {
  const t = useT();
  const b = city.building;
  const progress = b.phase === 'pieces' || b.phase === 'arena' || b.phase === 'done' ? b.placed : 0;
  return (
    <Card title={t('Construction de {name}', { name: city.name })} icon={Hammer}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ember">{t(PHASES[b.phase] || b.phase)}</Badge>
          {b.phase === 'zones' && b.zonesLeft > 0 && <span className="text-sm text-ink-400">{t('{n} zone(s) restante(s)', { n: b.zonesLeft })}</span>}
        </div>
        <Meter value={progress} max={city.total} />
        <p className="text-sm text-ink-400">{t('{n} / {total} pièces posées', { n: formatNumber(progress), total: formatNumber(city.total) })}</p>
      </div>
    </Card>
  );
}

// ---------- Ville bâtie ----------

function BuiltCity({ city, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const { confirm, toast } = useFeedback();
  const players = useOnlinePlayers();
  const [target, setTarget] = useState('');
  const [settings, setSettings] = useState(city.settings);

  useEffect(() => setSettings(city.settings), [city.settings?.welcome, city.settings?.autoRepair, city.settings?.spawn]);

  const repair = async () => {
    const r = await run('repair', () => api('/city/repair', { method: 'POST' }), t('Ville réparée'));
    if (r) {
      toast(r.message);
      reload();
    }
  };
  const teleport = async () => {
    const r = await run('teleport', () => api('/city/teleport', { method: 'POST', body: { player: target } }), t('Téléportation envoyée'));
    if (r) toast(r.message);
  };
  const demolish = async () => {
    const ok = await confirm({
      title: t('Démolir {name} ?', { name: city.name }),
      message: t('Toutes les pièces de la ville (et son arène) sont retirées et le terrain retrouve sa forme naturelle. Les constructions des joueurs ne sont pas touchées. Irréversible.'),
      confirmLabel: t('Démolir la ville'),
      danger: true,
    });
    if (!ok) return;
    const r = await run('demolish', () => api('/city/demolish', { method: 'POST' }), t('Ville démolie'));
    if (r) reload();
  };
  const save = async () => {
    const r = await run('settings', () => api('/city/settings', { method: 'PUT', body: settings }), t('Réglages enregistrés'));
    if (r) reload();
  };

  const standing = city.standing ?? city.total;
  return (
    <div className="space-y-6">
      {city.notInSave && (
        <div className="flex items-start gap-3 rounded-xl border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("La plupart des pièces de la ville sont absentes du monde : il a sans doute été rechargé depuis une sauvegarde antérieure à la construction (arrêt brutal, restauration). La réparation automatique est suspendue : « Réparer maintenant » rebâtit la ville, « Démolir » l'oublie.")}
          </span>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={city.name} icon={Landmark}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('Pièces debout')} value={formatNumber(standing)} sub={t('sur {n}', { n: formatNumber(city.total) })} />
              <Stat label={t('Manquantes')} value={city.missing ?? 0}  />
              <Stat label={t('Visiteurs accueillis')} value={city.visitors} />
            </div>
            <div className="space-y-1 text-sm text-ink-400">
              <p className="font-mono text-ink-200">{t('Centre : X {x} · Z {z}', { x: Math.round(city.center[0]), z: Math.round(city.center[1]) })}</p>
              <p>{t("Point d'apparition : X {x} · Z {z}", { x: Math.round(city.spawn[0]), z: Math.round(city.spawn[2]) })}</p>
              {city.builtAt && <p>{t('Bâtie le {date}', { date: formatDate(city.builtAt) })}</p>}
              {city.repaired > 0 && <p>{t('{n} pièce(s) remise(s) en place depuis le démarrage', { n: city.repaired })}</p>}
              {city.error && <p className="text-ember-300">{t('Construction interrompue : {error}', { error: city.error })}</p>}
            </div>
            <p className="flex gap-2 text-xs text-ink-500">
              <ShieldCheck className="size-4 shrink-0" />
              {t("Murs, toits et décors sont tenus par le serveur : ils ne s'usent pas, ne s'effondrent pas et ne peuvent pas être détruits. Portes, coffres, lits, fours et gardes restent normaux.")}
            </p>
            {can('world.edit') && (
              <div className="flex flex-wrap gap-2">
                <Button icon={Wrench} loading={busy === 'repair'} onClick={repair}>
                  {t('Réparer maintenant')}
                </Button>
                <Button variant="danger" icon={Trash2} loading={busy === 'demolish'} onClick={demolish}>
                  {t('Démolir')}
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card title={t('Accueil et réglages')} icon={Settings2}>
          <div className="space-y-4">
            <Toggle checked={!!settings?.spawn} onChange={(v) => setSettings((s) => ({ ...s, spawn: v }))} label={t('Apparition dans la ville')} hint={t('Les joueurs sans lit (nouveaux personnages, morts sans lit) apparaissent sur la place d’accueil.')} />
            <Field label={t('Téléporter à l’arrivée')} hint={t('Message de bienvenue et téléportation sur la place d’accueil.')}>
              <Select value={settings?.welcome ?? 1} onChange={(e) => setSettings((s) => ({ ...s, welcome: Number(e.target.value) }))} options={WELCOME.map((w) => ({ value: w.value, label: t(w.label) }))} />
            </Field>
            <Field label={t('Réparation automatique (minutes, 0 = jamais)')} hint={t('Remet en place les pièces disparues (four démonté, garde tué…) après ce délai.')}>
              <Input type="number" min={0} max={1440} value={settings?.autoRepair ?? 15} onChange={(e) => setSettings((s) => ({ ...s, autoRepair: Number(e.target.value) }))} />
            </Field>
            {can('world.edit') && (
              <Button variant="primary" loading={busy === 'settings'} onClick={save}>
                {t('Enregistrer')}
              </Button>
            )}
            {can('world.edit') && (
              <div className={cx('border-t border-ink-800 pt-4')}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field label={t('Téléporter dans la ville')} className="flex-1">
                    <Select value={target} onChange={(e) => setTarget(e.target.value)} options={[{ value: '', label: t('Tous les joueurs connectés') }, ...players.map((p) => ({ value: p.name, label: p.name }))]} />
                  </Field>
                  <Button icon={Send} loading={busy === 'teleport'} disabled={!players.length} onClick={teleport}>
                    {t('Téléporter')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
      {city.life && (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <LifeCard city={city} reload={reload} />
            {city.life.parcels?.length > 0 ? <ParcelsCard city={city} reload={reload} /> : <PortalsCard city={city} reload={reload} />}
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {city.life.parcels?.length > 0 && <PortalsCard city={city} reload={reload} />}
            <ArchitectsCard city={city} reload={reload} />
          </div>
        </>
      )}
      <BuiltPreview />
    </div>
  );
}

// ---------- Vie de la cité ----------

function LifeCard({ city, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const life = city.life;
  const [text, setText] = useState(life.proclamation || '');
  const [lines, setLines] = useState(() => [0, 1, 2, 3].map((i) => life.board?.[i] || ''));

  const proclaim = async () => {
    const r = await run('proclaim', () => api('/city/proclaim', { method: 'POST', body: { text } }), t('Proclamation publiée'));
    if (r) reload();
  };
  const publish = async () => {
    const r = await run('board', () => api('/city/board', { method: 'PUT', body: { lines } }), t('Tableau mis à jour'));
    if (r) reload();
  };
  const crier = async (value) => {
    const r = await run('crier', () => api('/city/settings', { method: 'PUT', body: { crier: value } }), value ? t('Crieur activé') : t('Crieur désactivé'));
    if (r) reload();
  };
  const protect = async (value) => {
    const r = await run('protect', () => api('/city/settings', { method: 'PUT', body: { protect: value } }), value ? t('Protection activée') : t('Protection désactivée'));
    if (r) reload();
  };

  return (
    <Card title={t('Vie de la cité')} icon={Megaphone}>
      <div className="space-y-5">
        <div className="space-y-2">
          <Field label={t('Proclamation impériale')} hint={t('Annoncée à tous les joueurs connectés et affichée sur la grand-place (60 caractères).')}>
            <Input value={text} maxLength={60} onChange={(e) => setText(e.target.value)} placeholder={t('Le tournoi de l’arène commence au crépuscule !')} />
          </Field>
          {can('world.edit') && (
            <Button icon={Megaphone} loading={busy === 'proclaim'} onClick={proclaim}>
              {t('Proclamer')}
            </Button>
          )}
        </div>
        <div className="space-y-2 border-t border-ink-800 pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-200">
            <ScrollText className="size-4" /> {t('Tableau des contrats (taverne)')}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {lines.map((line, i) => (
              <Input key={i} value={line} maxLength={60} placeholder={t('Contrat {n}', { n: i + 1 })} onChange={(e) => setLines((l) => l.map((v, j) => (j === i ? e.target.value : v)))} />
            ))}
          </div>
          {can('world.edit') && (
            <Button icon={ScrollText} loading={busy === 'board'} onClick={publish}>
              {t('Afficher les contrats')}
            </Button>
          )}
        </div>
        <div className="border-t border-ink-800 pt-4">
          <Toggle checked={!!life.crier} onChange={crier} disabled={!can('world.edit')} label={t('Crieur aux portes')} hint={t('Message discret quand un joueur entre ou sort de la cité.')} />
        </div>
        <div className="border-t border-ink-800 pt-4">
          <Toggle
            checked={life.protect !== false}
            onChange={protect}
            disabled={!can('world.edit')}
            label={t('Protection de la cité')}
            hint={t('Dans les murs, seuls les architectes impériaux construisent : toute autre pièce est retirée et ses matériaux rendus. Hors les murs, liberté totale.')}
          />
          {life.removed > 0 && <p className="mt-2 text-xs text-ink-500">{t('{n} construction(s) sauvage(s) retirée(s) depuis le démarrage', { n: life.removed })}</p>}
        </div>
      </div>
    </Card>
  );
}

function ParcelsCard({ city, reload }) {
  const t = useT();
  const can = useCan();
  const parcels = city.life.parcels || [];
  return (
    <Card title={t('Parcelles')} icon={DoorOpen}>
      <p className="mb-3 text-sm text-ink-400">
        {t("Dans les murs, un joueur ne peut construire que sur sa parcelle. Ailleurs dans la cité, ses pièces sont retirées et ses matériaux rendus. Hors les murs, liberté totale.")}
      </p>
      {parcels.length === 0 ? (
        <p className="text-sm text-ink-500">{t('Cette ville n’a pas de parcelles : régénère-la pour en avoir.')}</p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded-lg border border-ink-800">
          {parcels.map((p) => (
            <ParcelRow key={p.id} parcel={p} reload={reload} editable={can('world.edit')} />
          ))}
        </ul>
      )}
      {city.life.removed > 0 && <p className="mt-3 text-xs text-ink-500">{t('{n} construction(s) sauvage(s) retirée(s) depuis le démarrage', { n: city.life.removed })}</p>}
    </Card>
  );
}

function ParcelRow({ parcel, reload, editable }) {
  const t = useT();
  const [run, busy] = useAction();
  const players = useOnlinePlayers();
  const [owner, setOwner] = useState(parcel.owner?.name || '');
  const save = async (value) => {
    const r = await run('save', () => api('/city/parcel', { method: 'POST', body: { id: parcel.id, owner: value } }), value ? t('Parcelle attribuée') : t('Parcelle libérée'));
    if (r) reload();
  };
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="w-24 font-medium text-ink-100">{t('Parcelle {n}', { n: parcel.id })}</span>
      <span className="w-32 font-mono text-xs text-ink-500">
        X {Math.round(parcel.x)} · Z {Math.round(parcel.z)}
      </span>
      {editable ? (
        <>
          <Input className="min-w-40 flex-1" list={`parcel-players-${parcel.id}`} value={owner} maxLength={40} placeholder={t('Libre')} onChange={(e) => setOwner(e.target.value)} />
          <datalist id={`parcel-players-${parcel.id}`}>
            {players.map((pl) => (
              <option key={pl.name} value={pl.name} />
            ))}
          </datalist>
          <Button size="sm" loading={busy === 'save'} disabled={owner === (parcel.owner?.name || '')} onClick={() => save(owner)}>
            {t('Attribuer')}
          </Button>
          {parcel.owner && (
            <Button size="sm" variant="danger" onClick={() => { setOwner(''); save(''); }}>
              {t('Libérer')}
            </Button>
          )}
        </>
      ) : (
        <span className="text-ink-300">{parcel.owner?.name || t('Libre')}</span>
      )}
      {parcel.owner && !parcel.owner.known && <Badge tone="ember">{t('Pas encore vu en jeu')}</Badge>}
    </li>
  );
}

function PortalsCard({ city, reload }) {
  const t = useT();
  const can = useCan();
  const portals = city.life.portals || [];
  return (
    <Card title={t('Portails impériaux')} icon={Send}>
      <p className="mb-3 text-sm text-ink-400">
        {t('Un joueur qui construit un portail dans le monde et lui donne exactement l’un de ces noms le relie à la place des portails. Un seul portail par nom.')}
      </p>
      {portals.length === 0 ? (
        <p className="text-sm text-ink-500">{t('Cette ville n’a pas de place des portails : régénère-la pour en avoir.')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {portals.map((p) => (
            <PortalRow key={p.index} portal={p} reload={reload} editable={can('world.edit')} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PortalRow({ portal, reload, editable }) {
  const t = useT();
  const [run, busy] = useAction();
  const [tag, setTag] = useState(portal.tag);
  const save = async () => {
    const r = await run('save', () => api('/city/portal', { method: 'PUT', body: { index: portal.index, tag } }), t('Portail renommé'));
    if (r) reload();
  };
  return (
    <li className="flex items-center gap-2">
      <Input value={tag} maxLength={40} disabled={!editable} onChange={(e) => setTag(e.target.value)} />
      {editable && (
        <Button size="sm" loading={busy === 'save'} disabled={!tag.trim() || tag === portal.tag} onClick={save}>
          {t('Renommer')}
        </Button>
      )}
    </li>
  );
}

function ArchitectsCard({ city, reload }) {
  const t = useT();
  const can = useCan();
  const [run, busy] = useAction();
  const [names, setNames] = useState(() => (city.life.architects || []).map((a) => a.name).join(', '));
  const save = async () => {
    const list = names.split(',').map((n) => n.trim()).filter(Boolean);
    const r = await run('save', () => api('/city/architects', { method: 'PUT', body: { names: list } }), t('Architectes enregistrés'));
    if (r) reload();
  };
  return (
    <Card title={t('Architectes impériaux')} icon={ShieldCheck}>
      <p className="mb-3 text-sm text-ink-400">{t('Ces joueurs peuvent construire partout dans la cité : pour agrandir la ville à la main ou décorer les quartiers.')}</p>
      <Field label={t('Noms des personnages, séparés par des virgules')}>
        <Input value={names} disabled={!can('world.edit')} onChange={(e) => setNames(e.target.value)} placeholder="Spoka, Ragnar" />
      </Field>
      {(city.life.architects || []).some((a) => !a.known) && <p className="mt-2 text-xs text-ember-300">{t('Certains noms n’ont jamais été vus en jeu : ils seront reconnus à leur prochaine connexion.')}</p>}
      {can('world.edit') && (
        <Button className="mt-3" loading={busy === 'save'} onClick={save}>
          {t('Enregistrer')}
        </Button>
      )}
    </Card>
  );
}

function BuiltPreview() {
  const t = useT();
  const { data } = useApi('/city/preview');
  if (!data) return null;
  return (
    <Card title={t('Plan de la ville')} icon={Box} padded={false}>
      <PreviewPanel />
    </Card>
  );
}
