import { useEffect, useMemo, useState } from 'react';
import { FileCog, Puzzle, RotateCcw, RotateCw, Save, Search } from 'lucide-react';
import { api, useApi } from '../api.js';
import { useT } from '../i18n.jsx';
import { PageHeader, useStatus } from '../status.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Input, Select, Spinner, Toggle, cx, useAction } from '../ui.jsx';

const NUMERIC = /^(Byte|SByte|Int16|UInt16|Int32|UInt32|Int64|UInt64|Single|Double|Decimal)$/;

export default function ModsPage() {
  const t = useT();
  const files = useApi('/modconfig');
  const mods = useApi('/mods');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!selected && files.data?.files.length) setSelected(files.data.files[0].file);
  }, [files.data, selected]);

  return (
    <>
      <PageHeader
        title={t('Mods du serveur')}
        description={t("Mods installés côté serveur et leurs réglages. Tous fonctionnent sans rien installer chez les joueurs (PS5 comprise). Les changements s'appliquent au redémarrage.")}
      />
      <ErrorNote error={files.error} />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-6">
          <Card title={t('Installés')} icon={Puzzle} padded={false}>
            <ul className="divide-y divide-ink-800">
              {(mods.data?.mods || []).map((m) => (
                <li key={m.name} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="truncate text-ink-200">{m.name}</span>
                  {m.version && <Badge>{m.version}</Badge>}
                </li>
              ))}
              {!mods.data?.mods?.length && <li className="px-4 py-3 text-sm text-ink-500">{t('Aucun mod détecté')}</li>}
            </ul>
          </Card>
          <Card title={t('Fichiers de réglages')} icon={FileCog} padded={false}>
            {!files.data ? (
              <div className="p-4">
                <Spinner />
              </div>
            ) : (
              <ul className="max-h-[50vh] overflow-y-auto p-2">
                {files.data.files.map((f) => (
                  <li key={f.file}>
                    <button
                      onClick={() => setSelected(f.file)}
                      className={cx('w-full rounded-lg px-3 py-2 text-left transition', selected === f.file ? 'bg-ember-500/10 text-ember-300' : 'text-ink-300 hover:bg-ink-800')}
                    >
                      <div className="truncate text-sm">{f.plugin || f.file}</div>
                      <div className="truncate font-mono text-[11px] text-ink-500">{t('{file} · {n} réglages', { file: f.file, n: f.entries })}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {selected ? (
          <ConfigEditor key={selected} file={selected} />
        ) : (
          <Card>
            <Empty icon={FileCog} title={t('Aucun fichier de réglages')} />
          </Card>
        )}
      </div>
    </>
  );
}

function ConfigEditor({ file }) {
  const t = useT();
  const { data, error, reload } = useApi(`/modconfig/${encodeURIComponent(file)}`);
  const { reload: reloadStatus } = useStatus();
  const [draft, setDraft] = useState({});
  const [q, setQ] = useState('');
  const [run, busy] = useAction();

  const sections = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    const map = new Map();
    for (const e of data.entries) {
      if (s && !`${e.section} ${e.key} ${e.description}`.toLowerCase().includes(s)) continue;
      if (!map.has(e.section)) map.set(e.section, []);
      map.get(e.section).push(e);
    }
    return [...map.entries()];
  }, [data, q]);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;

  const dirty = Object.keys(draft).length;
  const valueOf = (e) => (e.id in draft ? draft[e.id] : e.value);
  const change = (e, value) =>
    setDraft((d) => {
      const next = { ...d };
      if (String(value) === e.value) delete next[e.id];
      else next[e.id] = String(value);
      return next;
    });

  const save = async (restart) => {
    const r = await run(
      restart ? 'restart' : 'save',
      () => api(`/modconfig/${encodeURIComponent(file)}`, { method: 'PUT', body: { changes: draft, restart } }),
      t(restart ? 'Réglages enregistrés : redémarrage en cours' : 'Réglages enregistrés : redémarre le serveur pour les appliquer'),
    );
    if (r) {
      setDraft({});
      reload();
      reloadStatus();
    }
  };

  return (
    <div className="min-w-0 pb-24">
      <Card title={data.plugin || file} icon={FileCog} actions={<Badge>{t('{n} réglages', { n: data.entries.length })}</Badge>}>
        <div className="relative mb-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Rechercher un réglage…')} className="pl-9" />
        </div>
        {sections.length ? (
          <div className="space-y-6">
            {sections.map(([section, entries]) => (
              <section key={section}>
                <h3 className="mb-2 border-b border-ink-800 pb-1.5 text-xs font-semibold uppercase tracking-wider text-ember-400">{section}</h3>
                <div className="divide-y divide-ink-800/60">
                  {entries.map((e) => (
                    <EntryRow key={e.id} entry={e} value={valueOf(e)} changed={e.id in draft} onChange={(v) => change(e, v)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <Empty icon={Search} title={t('Aucun réglage ne correspond')} />
        )}
      </Card>

      {dirty > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700 bg-ink-900/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <span className="text-sm text-ink-300">{t('{n} réglage(s) modifié(s)', { n: dirty })}</span>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setDraft({})}>
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
    </div>
  );
}

function EntryRow({ entry, value, changed, onChange }) {
  const t = useT();
  const isDefault = entry.default !== null && value === entry.default;
  return (
    <div className={cx('grid gap-3 py-3 md:grid-cols-[1fr_16rem] md:items-start', changed && 'rounded-lg bg-ember-500/5 px-2')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink-100">{entry.key}</span>
          {changed && <Badge tone="ember">{t('modifié')}</Badge>}
        </div>
        {entry.description && <p className="mt-0.5 whitespace-pre-line text-xs text-ink-500">{entry.description}</p>}
        {entry.default !== null && (
          <p className="mt-0.5 text-[11px] text-ink-600">{t('Par défaut : {value}', { value: entry.default || t('(vide)') })}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ValueEditor entry={entry} value={value} onChange={onChange} />
        </div>
        {entry.default !== null && !isDefault && (
          <button onClick={() => onChange(entry.default)} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200" title={t('Valeur par défaut')} aria-label={t('Valeur par défaut')}>
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function ValueEditor({ entry, value, onChange }) {
  const t = useT();
  if (entry.type === 'Boolean') {
    const on = value.toLowerCase() === 'true';
    return (
      <div className="flex justify-end md:justify-start">
        <Toggle checked={on} onChange={(v) => onChange(v ? 'true' : 'false')} label={t(on ? 'Activé' : 'Désactivé')} />
      </div>
    );
  }
  if (entry.acceptable && entry.flags) {
    const selected = new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
    return (
      <div className="flex flex-wrap gap-1.5">
        {entry.acceptable.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => {
              const next = new Set(selected);
              next.has(opt) ? next.delete(opt) : next.add(opt);
              onChange(entry.acceptable.filter((o) => next.has(o)).join(', '));
            }}
            className={cx('rounded-md border px-2 py-1 text-xs', selected.has(opt) ? 'border-ember-500/60 bg-ember-500/15 text-ember-300' : 'border-ink-700 text-ink-400')}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }
  if (entry.acceptable) {
    return <Select value={value} onChange={(e) => onChange(e.target.value)} options={entry.acceptable.map((v) => ({ value: v, label: v }))} />;
  }
  if (NUMERIC.test(entry.type)) {
    return <Input type="number" step={/Int|Byte/.test(entry.type) ? 1 : 'any'} min={entry.range?.[0]} max={entry.range?.[1]} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />;
}
