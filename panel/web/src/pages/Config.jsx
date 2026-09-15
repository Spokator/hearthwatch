import { useEffect, useState } from 'react';
import { Clock, Eye, EyeOff, Globe, Puzzle, RotateCw, Save, Server, Swords } from 'lucide-react';
import { api, useApi } from '../api.js';
import { useT } from '../i18n.jsx';
import { PageHeader, useStatus } from '../status.jsx';
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner, Toggle, useAction } from '../ui.jsx';

const PRESETS = [
  ['', 'Aucun (réglages personnalisés)'],
  ['casual', 'Détendu'],
  ['easy', 'Facile'],
  ['normal', 'Normal'],
  ['hard', 'Difficile'],
  ['hardcore', 'Hardcore'],
  ['immersive', 'Immersif'],
  ['hammer', 'Créatif (construction libre)'],
];

const MODIFIERS = [
  ['combat', 'Combat', [['veryeasy', 'Très facile'], ['easy', 'Facile'], ['hard', 'Difficile'], ['veryhard', 'Très difficile']]],
  ['deathpenalty', 'Pénalité de mort', [['casual', 'Aucune perte'], ['veryeasy', 'Très légère'], ['easy', 'Légère'], ['hard', 'Lourde'], ['hardcore', 'Hardcore (tout est perdu)']]],
  ['resources', 'Ressources récoltées', [['muchless', 'Beaucoup moins'], ['less', 'Moins'], ['more', 'Plus'], ['muchmore', 'Beaucoup plus']]],
  ['raids', 'Fréquence des raids', [['none', 'Aucun raid'], ['muchless', 'Beaucoup moins'], ['less', 'Moins'], ['more', 'Plus'], ['muchmore', 'Beaucoup plus']]],
  ['portals', 'Portails', [['casual', 'Tout peut passer'], ['hard', 'Plus restrictifs'], ['veryhard', 'Désactivés']]],
];

const KEYS = [
  ['nobuildcost', 'Construction gratuite', 'Aucun matériau requis pour construire.'],
  ['playerevents', 'Raids selon chaque joueur', 'Les raids suivent la progression du joueur visé plutôt que celle du monde.'],
  ['passivemobs', 'Monstres passifs', "Les ennemis n'attaquent pas en premier."],
  ['nomap', 'Pas de carte', 'Carte et minicarte désactivées.'],
];

export default function Config() {
  const t = useT();
  const { data, error, reload } = useApi('/config');
  const { reload: reloadStatus } = useStatus();
  const [form, setForm] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [run, busy] = useAction();

  useEffect(() => {
    if (data) setForm(structuredClone(data.values));
  }, [data]);

  if (error && !data) return <ErrorNote error={error} />;
  if (!form) return <Spinner />;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(data.values);
  const newWorld = form.world && !data.worlds.includes(form.world);

  const save = async (restart) => {
    const r = await run(
      restart ? 'restart' : 'save',
      () => api('/config', { method: 'PUT', body: { ...form, restart } }),
      t(restart ? 'Configuration enregistrée : redémarrage en cours' : 'Configuration enregistrée : redémarre le serveur pour l’appliquer'),
    );
    if (r) {
      reload();
      reloadStatus();
    }
  };

  const setModifier = (key, value) => {
    const next = { ...form.modifiers };
    if (value) next[key] = value;
    else delete next[key];
    set('modifiers', next);
  };

  return (
    <>
      <PageHeader title={t('Configuration')} description={t("Paramètres de lancement du serveur. Ils s'appliquent au prochain redémarrage.")} />

      <div className="grid gap-6 pb-24 lg:grid-cols-2">
        <Card title={t('Serveur')} icon={Server}>
          <div className="space-y-4">
            <Field label={t('Nom du serveur')} hint={t('Affiché dans la liste des serveurs.')}>
              <Input value={form.name} maxLength={64} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label={t('Mot de passe')} hint={t('5 caractères minimum, sans espace. Ne doit pas apparaître dans le nom.')}>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => set('password', e.target.value)} className="pr-10 font-mono" autoComplete="off" />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-100"
                  aria-label={t(showPassword ? 'Masquer' : 'Afficher')}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <Field
              label={t('Monde')}
              hint={newWorld ? t("« {name} » n'existe pas encore : il sera généré au redémarrage.", { name: form.world }) : t('Monde chargé au démarrage (voir aussi Mondes & sauvegardes).')}
            >
              <Input list="known-worlds" value={form.world} onChange={(e) => set('world', e.target.value)} className="font-mono" />
              <datalist id="known-worlds">
                {data.worlds.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </Field>
            <Field label="Port" hint={t('Fixe : il correspond aux règles du pare-feu (UDP 2456-2457).')}>
              <Input value={data.port} disabled />
            </Field>
          </div>
        </Card>

        <Card title={t('Accès & mods')} icon={Globe}>
          <div className="space-y-5">
            <Toggle checked={form.crossplay} onChange={(v) => set('crossplay', v)} label="Crossplay (PS5, Xbox, Game Pass)" hint={t("Indispensable pour les joueurs console. Fournit un code d'accès à chaque démarrage.")} />
            <Toggle checked={form.public} onChange={(v) => set('public', v)} label={t('Visible dans la liste des serveurs')} hint={t('Permet de trouver le serveur par son nom. Le mot de passe reste obligatoire.')} />
            <Toggle checked={form.mods} onChange={(v) => set('mods', v)} label={t('Mods serveur (BepInEx + RCON)')} hint={t('Requis pour gérer joueurs, objets, coffres et événements depuis ce panel.')} />
            {!form.mods && (
              <p className="rounded-lg border border-blood-500/30 bg-blood-500/10 px-3 py-2 text-xs text-blood-400">
                {t('Sans les mods, seules la configuration, les mondes, les sauvegardes et les journaux restent utilisables.')}
              </p>
            )}
            <ModsList />
          </div>
        </Card>

        <Card title={t('Difficulté du monde')} icon={Swords} className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('Préréglage')} hint={t("Les réglages ci-dessous s'appliquent par-dessus le préréglage.")}>
              <Select value={form.preset} onChange={(e) => set('preset', e.target.value)} options={PRESETS.map(([value, label]) => ({ value, label: t(label) }))} />
            </Field>
            {MODIFIERS.map(([key, label, options]) => (
              <Field key={key} label={t(label)}>
                <Select
                  value={form.modifiers[key] || ''}
                  onChange={(e) => setModifier(key, e.target.value)}
                  options={[{ value: '', label: t('Par défaut') }, ...options.map(([value, text]) => ({ value, label: t(text) }))]}
                />
              </Field>
            ))}
          </div>
          <div className="mt-6 grid gap-5 border-t border-ink-800 pt-5 md:grid-cols-2">
            {KEYS.map(([key, label, hint]) => (
              <Toggle
                key={key}
                checked={form.keys.includes(key)}
                onChange={(v) => set('keys', v ? [...form.keys, key] : form.keys.filter((k) => k !== key))}
                label={t(label)}
                hint={t(hint)}
              />
            ))}
          </div>
        </Card>

        <Card title={t('Sauvegardes automatiques du jeu')} icon={Clock} className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label={t('Sauvegarde toutes les (min)')}>
              <Input type="number" min={1} max={120} value={Math.round(form.saveInterval / 60)} onChange={(e) => set('saveInterval', Number(e.target.value) * 60)} />
            </Field>
            <Field label={t('Sauvegardes conservées')}>
              <Input type="number" min={1} max={50} value={form.backups} onChange={(e) => set('backups', Number(e.target.value))} />
            </Field>
            <Field label={t('1re copie de secours après (min)')}>
              <Input type="number" min={5} max={1440} value={Math.round(form.backupShort / 60)} onChange={(e) => set('backupShort', Number(e.target.value) * 60)} />
            </Field>
            <Field label={t('Puis toutes les (h)')}>
              <Input type="number" min={1} max={168} value={Math.round(form.backupLong / 3600)} onChange={(e) => set('backupLong', Number(e.target.value) * 3600)} />
            </Field>
          </div>
          <p className="mt-4 text-xs text-ink-500">{t('En plus : archive complète chaque nuit et redémarrage automatique pour installer les mises à jour quand personne n’est connecté.')}</p>
        </Card>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700 bg-ink-900/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <span className="text-sm text-ink-300">{t('Modifications non enregistrées')}</span>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setForm(structuredClone(data.values))}>
                {t('Annuler')}
              </Button>
              <Button icon={Save} loading={busy === 'save'} onClick={() => save(false)}>
                {t('Enregistrer')}
              </Button>
              <Button variant="primary" icon={RotateCw} loading={busy === 'restart'} onClick={() => save(true)}>
                {t('Enregistrer et redémarrer')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModsList() {
  const t = useT();
  const { data } = useApi('/mods');
  if (!data?.mods?.length) return null;
  return (
    <div className="rounded-lg border border-ink-800 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-ink-500">
        <Puzzle className="size-3.5" /> {t('Mods installés')}
      </div>
      <ul className="space-y-1.5">
        {data.mods.map((m) => (
          <li key={m.name} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-ink-200">{m.name}</span>
            {m.version && <Badge>{m.version}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}
