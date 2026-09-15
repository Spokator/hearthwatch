import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, Download, Globe, History, Plus, Trash2, Upload } from 'lucide-react';
import { api, formatBytes, formatDate, useApi } from '../api.js';
import { useT } from '../i18n.jsx';
import { PageHeader, useStatus } from '../status.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Spinner, useAction, useFeedback } from '../ui.jsx';

function archiveKind(file) {
  if (file.startsWith('worlds-')) return ['Quotidienne', 'blue'];
  if (file.startsWith('manuel-')) return ['Manuelle', 'green'];
  if (file.startsWith('avant_')) return ['Sécurité', 'ember'];
  if (file.startsWith('supprime_')) return ['Monde supprimé', 'red'];
  return ['Archive', 'neutral'];
}

export default function Worlds() {
  const t = useT();
  const { data, error, reload } = useApi('/worlds');
  const { reload: reloadStatus } = useStatus();
  const [run, busy] = useAction();
  const { confirm, toast } = useFeedback();
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const fileInput = useRef(null);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;

  const refresh = () => {
    reload();
    reloadStatus();
  };

  const activate = async (name, isNew) => {
    const ok = await confirm({
      title: t(isNew ? 'Créer le monde « {name} » ?' : 'Activer « {name} » ?', { name }),
      message: t(
        isNew
          ? 'Un nouveau monde est généré : les joueurs connectés seront déconnectés. Le monde actuel est conservé.'
          : 'Le serveur redémarre sur ce monde : les joueurs connectés seront déconnectés. Le monde actuel est conservé.',
      ),
      confirmLabel: t(isNew ? 'Créer et redémarrer' : 'Activer et redémarrer'),
    });
    if (!ok) return false;
    const r = await run(`act:${name}`, () => api('/worlds/activate', { method: 'POST', body: { name, restart: true } }), t('Monde « {name} » activé : redémarrage en cours', { name }));
    if (r) refresh();
    return !!r;
  };

  const removeWorld = async (name) => {
    const ok = await confirm({
      title: t('Supprimer « {name} » ?', { name }),
      message: t('Le monde est retiré du serveur. Une archive de sécurité est créée juste avant (visible plus bas), tu pourras le restaurer.'),
      confirmLabel: t('Supprimer'),
      danger: true,
    });
    if (!ok) return;
    const r = await run(`del:${name}`, () => api(`/worlds/${encodeURIComponent(name)}`, { method: 'DELETE' }), (res) => t('Monde supprimé (archive {file})', { file: res.archive }));
    if (r) reload();
  };

  const restoreBackup = async (world, backup) => {
    if (world.name === data.active && data.running) return toast(t("Arrête d'abord le serveur (tableau de bord) pour restaurer le monde actif."), 'error');
    const ok = await confirm({
      title: t('Restaurer cette sauvegarde ?'),
      message: t("« {name} » sera remplacé par la sauvegarde du {date}. L'état actuel est archivé avant.", { name: world.name, date: formatDate(backup.modified) }),
      confirmLabel: t('Restaurer'),
      danger: true,
    });
    if (!ok) return;
    const r = await run(`bk:${backup.tag}`, () => api(`/worlds/${encodeURIComponent(world.name)}/restore`, { method: 'POST', body: { tag: backup.tag } }), t('Sauvegarde restaurée'));
    if (r) reload();
  };

  const importWorld = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    const r = await run('import', () => api('/worlds/import', { method: 'POST', body }), (res) =>
      [
        t('Monde « {name} » importé', { name: res.name }),
        res.format === 'ancien' ? t(' (ancien format : converti au premier chargement)') : '',
        res.safety ? t('. L’ancienne version a été archivée.') : '',
      ].join(''),
    );
    if (r) reload();
  };

  const createArchive = async () => {
    const r = await run('archive', () => api('/archives', { method: 'POST' }), (res) => t('Archive {file} créée', { file: res.file }));
    if (r) reload();
  };

  const restoreArchive = async (a) => {
    if (data.running) return toast(t("Arrête d'abord le serveur (tableau de bord) avant de restaurer une archive."), 'error');
    const ok = await confirm({
      title: t('Restaurer cette archive ?'),
      message: t("Les mondes contenus dans {file} remplacent les mondes actuels correspondants. L'état actuel est archivé avant.", { file: a.file }),
      confirmLabel: t('Restaurer'),
      danger: true,
    });
    if (!ok) return;
    const r = await run(`rs:${a.file}`, () => api(`/archives/${encodeURIComponent(a.file)}/restore`, { method: 'POST' }), (res) => t('Archive restaurée (sécurité : {file})', { file: res.safety }));
    if (r) reload();
  };

  const deleteArchive = async (a) => {
    const ok = await confirm({ title: t("Supprimer l'archive ?"), message: t('{file} sera supprimée définitivement.', { file: a.file }), confirmLabel: t('Supprimer'), danger: true });
    if (!ok) return;
    const r = await run(`rm:${a.file}`, () => api(`/archives/${encodeURIComponent(a.file)}`, { method: 'DELETE' }), t('Archive supprimée'));
    if (r) reload();
  };

  return (
    <>
      <PageHeader
        title={t('Mondes & sauvegardes')}
        description={t('Change de monde, importe ton monde solo, télécharge ou restaure des sauvegardes.')}
        actions={
          <>
            <input ref={fileInput} type="file" accept=".zip,.tar.gz,.tgz" className="hidden" onChange={importWorld} />
            <Button icon={Upload} loading={busy === 'import'} onClick={() => fileInput.current?.click()}>
              {t('Importer un monde')}
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              {t('Nouveau monde')}
            </Button>
          </>
        }
      />

      <Card title={t('Mondes')} icon={Globe} padded={false}>
        {data.worlds.length ? (
          <ul className="divide-y divide-ink-800">
            {data.worlds.map((w) => {
              const active = w.name === data.active;
              return (
                <li key={w.name} className="px-5 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink-100">{w.name}</span>
                        {active && <Badge tone="green">{t('Actif')}</Badge>}
                        {w.format === 'ancien' && <Badge tone="ember">{t('Ancien format')}</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-ink-500">
                        {t('{size} · modifié le {date} · {n} sauvegarde(s) auto', { size: formatBytes(w.size), date: formatDate(w.modified), n: w.backups.length })}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {w.backups.length > 0 && (
                        <Button size="sm" variant="ghost" icon={History} onClick={() => setExpanded(expanded === w.name ? null : w.name)}>
                          {t('Sauvegardes')}
                        </Button>
                      )}
                      <a href={`/api/worlds/${encodeURIComponent(w.name)}/download`} download>
                        <Button size="sm" icon={Download}>
                          {t('Télécharger')}
                        </Button>
                      </a>
                      {!active && (
                        <>
                          <Button size="sm" variant="success" loading={busy === `act:${w.name}`} onClick={() => activate(w.name)}>
                            {t('Activer')}
                          </Button>
                          <Button size="sm" variant="danger" icon={Trash2} loading={busy === `del:${w.name}`} onClick={() => removeWorld(w.name)} aria-label={t('Supprimer')} />
                        </>
                      )}
                    </div>
                  </div>
                  {expanded === w.name && (
                    <ul className="mt-3 space-y-1.5 rounded-lg border border-ink-800 bg-ink-950/50 p-2">
                      {w.backups.map((b) => (
                        <li key={b.tag} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-ink-850">
                          <span className="min-w-0 truncate text-ink-300">
                            {formatDate(b.modified)}{' '}
                            <span className="font-mono text-xs text-ink-500">
                              ({b.tag}, {formatBytes(b.size)})
                            </span>
                          </span>
                          <Button size="sm" icon={ArchiveRestore} loading={busy === `bk:${b.tag}`} onClick={() => restoreBackup(w, b)}>
                            {t('Restaurer')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={Globe} title={t('Aucun monde sauvegardé')}>
            {t('Le monde « {name} » sera créé au prochain démarrage du serveur.', { name: data.active })}
          </Empty>
        )}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card
          title={t('Archives complètes')}
          icon={Archive}
          className="xl:col-span-2"
          padded={false}
          actions={
            <Button size="sm" variant="primary" icon={Plus} loading={busy === 'archive'} onClick={createArchive}>
              {t('Créer une archive')}
            </Button>
          }
        >
          {data.archives.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <tbody className="divide-y divide-ink-800">
                  {data.archives.map((a) => {
                    const [kind, tone] = archiveKind(a.file);
                    return (
                      <tr key={a.file} className="hover:bg-ink-850/60">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <Badge tone={tone}>{t(kind)}</Badge>
                            <span className="text-ink-200">{formatDate(a.created)}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-ink-500">{a.file}</div>
                        </td>
                        <td className="px-5 py-2.5 tabular-nums text-ink-400">{formatBytes(a.size)}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <a href={`/api/archives/${encodeURIComponent(a.file)}/download`} download>
                              <Button size="sm" variant="ghost" icon={Download} aria-label={t('Télécharger')} />
                            </a>
                            <Button size="sm" icon={ArchiveRestore} loading={busy === `rs:${a.file}`} onClick={() => restoreArchive(a)}>
                              {t('Restaurer')}
                            </Button>
                            <Button size="sm" variant="ghost" icon={Trash2} loading={busy === `rm:${a.file}`} onClick={() => deleteArchive(a)} aria-label={t('Supprimer')} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Archive} title={t('Aucune archive')}>
              {t('Une archive de tous les mondes est créée automatiquement chaque nuit.')}
            </Empty>
          )}
        </Card>

        <Card title={t('Importer ton monde solo')} icon={Upload}>
          <ol className="list-decimal space-y-2.5 pl-4 text-sm text-ink-300">
            <li>
              {t('Sur ton PC, ouvre')}{' '}
              <code className="break-all rounded bg-ink-850 px-1 font-mono text-xs text-ink-200">%USERPROFILE%\AppData\LocalLow\IronGate\Valheim\worlds_local</code>
            </li>
            <li>{t('Clic droit sur le dossier de ton monde → Compresser en fichier ZIP. (Ancien monde : zippe ensemble Nom.db et Nom.fwl.)')}</li>
            <li>{t('Clique sur « Importer un monde » et choisis le .zip.')}</li>
            <li>{t('Active le monde : le serveur redémarre dessus.')}</li>
          </ol>
          <p className="mt-4 text-xs text-ink-500">{t("Si un monde du même nom existe, il est archivé avant d'être remplacé.")}</p>
        </Card>
      </div>

      <NewWorldModal open={creating} existing={data.worlds.map((w) => w.name)} onClose={() => setCreating(false)} onCreate={async (name) => (await activate(name, true)) && setCreating(false)} />
    </>
  );
}

function NewWorldModal({ open, existing, onClose, onCreate }) {
  const t = useT();
  const [name, setName] = useState('');
  const valid = /^[A-Za-z0-9_-]{1,40}$/.test(name);
  const taken = existing.includes(name);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Nouveau monde')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" icon={Plus} disabled={!valid || taken} onClick={() => onCreate(name)}>
            {t('Créer')}
          </Button>
        </>
      }
    >
      <Field label={t('Nom du monde')} hint={t('Lettres sans accent, chiffres, _ et - (40 caractères max). La graine est tirée au hasard.')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="font-mono" />
      </Field>
      {taken && <p className="mt-2 text-xs text-ember-400">{t('Ce monde existe déjà : active-le depuis la liste.')}</p>}
      {name && !valid && <p className="mt-2 text-xs text-blood-400">{t('Nom invalide.')}</p>}
    </Modal>
  );
}
