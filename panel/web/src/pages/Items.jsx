import { useEffect, useMemo, useState } from 'react';
import { Box, Gift, Package, PackageOpen, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { api, useApi } from '../api.js';
import { useCan } from '../auth.jsx';
import { GiveItemModal, PositionPicker, PrefabPicker, Tabs, formatPos, positionBody, usePrefabLabels, usePrefabs } from '../components.jsx';
import { useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader, useOnlinePlayers } from '../status.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Spinner, Toggle, cx, useAction, useFeedback } from '../ui.jsx';

export default function Items() {
  const t = useT();
  const [tab, setTab] = useState('catalogue');
  return (
    <>
      <PageHeader title={t('Objets & coffres')} description={t('Catalogue des objets du jeu, dons aux joueurs et gestion du contenu des coffres.')} />
      <OfflineNotice />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['catalogue', t('Catalogue & dons'), Package],
          ['coffres', t('Coffres'), Box],
        ]}
      />
      {tab === 'catalogue' ? <Catalogue /> : <Chests />}
    </>
  );
}

function Catalogue() {
  const t = useT();
  const prefabs = usePrefabs();
  const players = useOnlinePlayers();
  const canGive = useCan()('players.cheat');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('Tous');
  const [limit, setLimit] = useState(120);
  const [give, setGive] = useState(null);

  const categories = useMemo(() => {
    const count = {};
    prefabs?.items.forEach((i) => (count[i.category] = (count[i.category] || 0) + 1));
    return Object.entries(count).sort((a, b) => b[1] - a[1]);
  }, [prefabs]);

  const items = useMemo(() => {
    if (!prefabs) return [];
    const s = q.trim().toLowerCase();
    return prefabs.items.filter((i) => (category === 'Tous' || i.category === category) && (!s || i.label.toLowerCase().includes(s) || i.name.toLowerCase().includes(s)));
  }, [prefabs, q, category]);

  useEffect(() => setLimit(120), [q, category]);

  if (!prefabs) return <Spinner />;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Rechercher un objet (nom anglais ou prefab)…')} className="pl-9" />
        </div>
        <span className="text-xs text-ink-500">{t('{n} objets', { n: items.length })}</span>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {[['Tous', prefabs.items.length], ...categories].map(([name, n]) => (
          <button
            key={name}
            onClick={() => setCategory(name)}
            className={cx(
              'rounded-full border px-3 py-1 text-xs transition',
              category === name ? 'border-ember-500/60 bg-ember-500/15 text-ember-300' : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200',
            )}
          >
            {t(name)} <span className="opacity-60">{n}</span>
          </button>
        ))}
      </div>

      {items.length ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.slice(0, limit).map((item) => (
            <button
              key={item.name}
              onClick={() => canGive && setGive(item.name)}
              className={cx(
                'group flex items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-900/70 px-4 py-3 text-left transition',
                canGive ? 'hover:border-ember-500/40 hover:bg-ink-850' : 'cursor-default',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink-100">{item.label}</span>
                <span className="block truncate font-mono text-[11px] text-ink-500">{item.name}</span>
              </span>
              {canGive && <Gift className="size-4 shrink-0 text-ink-600 transition group-hover:text-ember-400" />}
            </button>
          ))}
        </div>
      ) : (
        <Empty icon={Package} title={t('Aucun objet trouvé')} />
      )}
      {items.length > limit && (
        <div className="mt-4 text-center">
          <Button onClick={() => setLimit((l) => l + 200)}>{t('Afficher plus ({n} restants)', { n: items.length - limit })}</Button>
        </div>
      )}
      <p className="mt-6 text-xs text-ink-500">
        {t('Catalogue généré depuis Valheim 1.0.7 (noms anglais). Pour un objet plus récent, saisis son nom de prefab exact dans la fenêtre « Donner ».')}
      </p>

      {canGive && <GiveItemModal open={!!give} item={give} players={players} onClose={() => setGive(null)} />}
    </>
  );
}

function Chests() {
  const t = useT();
  const prefabs = usePrefabs();
  const labels = usePrefabLabels();
  const players = useOnlinePlayers();
  const [scope, setScope] = useState('near');
  const [where, setWhere] = useState({ mode: 'player', player: '', x: '', y: '', z: '' });
  const [radius, setRadius] = useState(50);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(null);
  const [run, busy] = useAction();

  const search = async () => {
    const params = new URLSearchParams();
    if (scope === 'near') {
      for (const [k, v] of Object.entries(positionBody(players.length ? where : { ...where, mode: 'coords' }))) if (v !== undefined && v !== '') params.set(k, v);
      params.set('radius', radius);
    }
    const r = await run('search', () => api(`/containers?${params}`));
    if (r) setResult(r);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[20rem_1fr]">
      <Card title={t('Rechercher des coffres')} icon={Search}>
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg border border-ink-800 bg-ink-950 p-1 text-xs">
            {[
              ['near', 'Autour de…'],
              ['all', 'Tous les coffres'],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setScope(key)} className={cx('flex-1 rounded-md px-2 py-1.5', scope === key ? 'bg-ink-700 text-ink-100' : 'text-ink-400')}>
                {t(label)}
              </button>
            ))}
          </div>
          {scope === 'near' ? (
            <>
              <PositionPicker players={players} value={players.length ? where : { ...where, mode: 'coords' }} onChange={setWhere} />
              <Field label={t('Rayon (mètres)')}>
                <Input type="number" min={1} max={20000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
              </Field>
            </>
          ) : (
            <p className="text-xs text-ink-500">{t('Liste tous les coffres construits du monde. Sur un grand monde, le résultat peut être tronqué : préfère une recherche par zone.')}</p>
          )}
          <Button variant="primary" icon={Search} className="w-full" loading={busy === 'search'} onClick={search}>{t('Rechercher')}</Button>
        </div>
      </Card>

      <Card title={result ? t('{n} coffre(s)', { n: result.objects.length }) : t('Résultats')} icon={Box} padded={false}>
        {result?.truncated && (
          <div className="flex items-center gap-2 border-b border-ink-800 bg-ember-500/10 px-5 py-2 text-xs text-ember-300">
            <TriangleAlert className="size-4" /> {t('Résultat tronqué : réduis la zone de recherche pour tout voir.')}
          </div>
        )}
        {!result ? (
          <Empty icon={Box} title={t('Lance une recherche')}>
            {t("Trouve les coffres autour d'un joueur ou dans tout le monde, puis ouvre-les pour voir leur contenu.")}
          </Empty>
        ) : result.objects.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink-500">
                <tr className="border-b border-ink-800">
                  <th className="px-5 py-2.5 font-medium">{t('Coffre')}</th>
                  <th className="px-5 py-2.5 font-medium">Position</th>
                  <th className="px-5 py-2.5 font-medium">{t('Contenu')}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {result.objects.map((o) => (
                  <tr key={o.id} className="hover:bg-ink-850/60">
                    <td className="px-5 py-2.5">
                      <div className="text-ink-100">{labels.get(o.prefab) || o.prefab}</div>
                      <div className="font-mono text-[11px] text-ink-500">{o.id}</div>
                    </td>
                    <td className="px-5 py-2.5 tabular-nums text-ink-400">{formatPos(o.position)}</td>
                    <td className="px-5 py-2.5">{o.items ? <Badge tone="ember">{t('{n} objet(s)', { n: o.items })}</Badge> : <Badge>{t('Vide')}</Badge>}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Button size="sm" icon={PackageOpen} onClick={() => setOpen(o)}>{t('Ouvrir')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={Box} title={t('Aucun coffre trouvé')} />
        )}
      </Card>

      <ContainerModal chest={open} labels={labels} items={prefabs?.items} onClose={() => setOpen(null)} />
    </div>
  );
}

function ContainerModal({ chest, labels, items, onClose }) {
  const t = useT();
  const { data, error, loading, reload } = useApi(chest ? `/containers/${chest.id}` : null, { enabled: !!chest });
  const editable = useCan()('world.edit');
  const [force, setForce] = useState(false);
  const [add, setAdd] = useState({ item: '', count: 1, quality: 1 });
  const [counts, setCounts] = useState({});
  const [run, busy] = useAction();
  const { confirm } = useFeedback();

  useEffect(() => {
    setCounts({});
    setForce(false);
  }, [chest?.id]);

  const url = (action) => `/containers/${chest.id}/${action}`;
  const remove = async (it) => {
    const count = Number(counts[it.index] ?? it.stack);
    const r = await run(`rm${it.index}`, () => api(url('remove'), { method: 'POST', body: { index: it.index, count, force } }), (res) => res.output);
    if (r) {
      setCounts({});
      reload();
    }
  };
  const clear = async () => {
    const ok = await confirm({ title: t('Vider ce coffre ?'), message: t('Tous les objets du coffre seront supprimés définitivement.'), confirmLabel: t('Vider'), danger: true });
    if (!ok) return;
    const r = await run('clear', () => api(url('clear'), { method: 'POST', body: { force } }), t('Coffre vidé'));
    if (r) reload();
  };
  const addItem = async () => {
    const r = await run('add', () => api(url('add'), { method: 'POST', body: { ...add, force } }), (res) => res.output);
    if (r) {
      setAdd({ item: '', count: 1, quality: 1 });
      reload();
    }
  };

  return (
    <Modal open={!!chest} onClose={onClose} wide={editable} title={chest ? `${labels.get(chest.prefab) || chest.prefab} · ${formatPos(chest.position)}` : ''}>
      {chest && (
        <div className={cx('grid gap-6', editable && 'md:grid-cols-2')}>
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink-100">{t('Contenu')}</h4>
              {editable && (
                <Button size="sm" variant="danger" icon={Trash2} loading={busy === 'clear'} disabled={!data?.items.length} onClick={clear}>
                  {t('Vider')}
                </Button>
              )}
            </div>
            <ErrorNote error={error} />
            {loading && !data ? (
              <Spinner />
            ) : data?.items.length ? (
              <ul className="space-y-1.5">
                {data.items.map((it) => (
                  <li key={it.index} className="flex min-h-11 items-center gap-2 rounded-lg bg-ink-850 py-1.5 pl-3 pr-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink-100">
                        {labels.get(it.name) || it.name} <span className="text-ink-400">× {it.stack}</span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-ink-500">
                        {it.name} · {t('qualité {q}', { q: it.quality })}
                        {it.crafter ? ` · ${t('fabriqué par {name}', { name: it.crafter })}` : ''}
                      </div>
                    </div>
                    {editable && (
                      <>
                        <Input
                          type="number"
                          min={1}
                          max={it.stack}
                          value={counts[it.index] ?? it.stack}
                          onChange={(e) => setCounts({ ...counts, [it.index]: e.target.value })}
                          className="w-16 px-2 py-1 text-xs"
                          aria-label={t('Quantité à retirer')}
                        />
                        <Button size="sm" variant="ghost" icon={Trash2} loading={busy === `rm${it.index}`} onClick={() => remove(it)} aria-label={t('Retirer')} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={PackageOpen} title={t('Coffre vide')} />
            )}
            {editable && (
              <div className="mt-4 rounded-lg border border-ink-800 p-3">
                <Toggle checked={force} onChange={setForce} label={t('Forcer la modification')} hint={t('Nécessaire si un joueur en ligne est à proximité du coffre.')} />
              </div>
            )}
          </div>
          {editable && (
            <div>
              <h4 className="mb-3 text-sm font-semibold text-ink-100">{t('Ajouter un objet')}</h4>
              <PrefabPicker list={items} value={add.item} onChange={(item) => setAdd({ ...add, item })} height="h-52" />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label={t('Quantité')}>
                  <Input type="number" min={1} value={add.count} onChange={(e) => setAdd({ ...add, count: Number(e.target.value) })} />
                </Field>
                <Field label={t('Qualité')}>
                  <Input type="number" min={1} max={10} value={add.quality} onChange={(e) => setAdd({ ...add, quality: Number(e.target.value) })} />
                </Field>
              </div>
              <Button variant="primary" icon={Plus} className="mt-4 w-full" disabled={!add.item} loading={busy === 'add'} onClick={addItem}>
                {t('Ajouter au coffre')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
