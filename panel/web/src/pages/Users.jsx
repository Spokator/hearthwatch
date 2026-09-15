import { useState } from 'react';
import { Ban, Check, Copy, KeyRound, ShieldCheck, Trash2, UserCheck, UserCog, UserPlus } from 'lucide-react';
import { api, formatDate, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { PageHeader } from '../status.jsx';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner, cx, useAction, useFeedback } from '../ui.jsx';

const ROLE_TONE = { owner: 'ember', admin: 'blue', moderator: 'green', viewer: 'neutral' };

export default function Users() {
  const t = useT();
  const { data, error, reload } = useApi('/users');
  const { user: me } = useAuth();
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState(null);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;

  const roleOptions = Object.entries(data.roles).map(([value, r]) => ({ value, label: t(r.label) }));

  const changeRole = async (u, role) => {
    if (role === u.role) return;
    const ok = await confirm({
      title: t('Changer le rôle de {name} ?', { name: u.username }),
      message: t("Nouveau rôle : {role}. {description} Le changement s'applique immédiatement.", { role: t(data.roles[role].label), description: t(data.roles[role].description) }),
      confirmLabel: t('Changer le rôle'),
    });
    if (!ok) return;
    const r = await run(`role:${u.id}`, () => api(`/users/${u.id}`, { method: 'PATCH', body: { role } }), t('Rôle modifié'));
    if (r) reload();
  };

  const toggleDisabled = async (u) => {
    const disable = !u.disabled;
    if (disable) {
      const ok = await confirm({
        title: t('Désactiver {name} ?', { name: u.username }),
        message: t('Le compte est déconnecté immédiatement et ne peut plus se connecter. Tu pourras le réactiver à tout moment.'),
        confirmLabel: t('Désactiver'),
        danger: true,
      });
      if (!ok) return;
    }
    const r = await run(`dis:${u.id}`, () => api(`/users/${u.id}`, { method: 'PATCH', body: { disabled: disable } }), t(disable ? 'Compte désactivé' : 'Compte réactivé'));
    if (r) reload();
  };

  const resetPassword = async (u) => {
    const ok = await confirm({
      title: t('Réinitialiser le mot de passe de {name} ?', { name: u.username }),
      message: t('Un mot de passe temporaire est généré. Le compte est déconnecté et devra choisir un nouveau mot de passe à sa prochaine connexion.'),
      confirmLabel: t('Réinitialiser'),
      danger: true,
    });
    if (!ok) return;
    const r = await run(`pw:${u.id}`, () => api(`/users/${u.id}/reset-password`, { method: 'POST' }));
    if (r) {
      setSecret({ username: u.username, password: r.password, created: false });
      reload();
    }
  };

  const remove = async (u) => {
    const ok = await confirm({
      title: t('Supprimer le compte {name} ?', { name: u.username }),
      message: t("Le compte est supprimé définitivement et déconnecté. Ses actions restent visibles dans le journal d'audit."),
      confirmLabel: t('Supprimer'),
      danger: true,
    });
    if (!ok) return;
    const r = await run(`del:${u.id}`, () => api(`/users/${u.id}`, { method: 'DELETE' }), t('Compte supprimé'));
    if (r) reload();
  };

  return (
    <>
      <PageHeader
        title={t('Utilisateurs du panel')}
        description={t("Crée des comptes pour d'autres admins sans partager le tien, choisis leur rôle et gère leur accès.")}
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setCreating(true)}>
            {t('Nouveau compte')}
          </Button>
        }
      />

      <Card title={t('Comptes ({n})', { n: data.users.length })} icon={UserCog} padded={false}>
        <ul className="divide-y divide-ink-800">
          {data.users.map((u) => {
            const self = u.id === me.id;
            return (
              <li key={u.id} className={cx('flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center', u.disabled && 'opacity-60')}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-ink-800 font-semibold uppercase text-ember-300">{u.username[0]}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-100">{u.username}</span>
                      <Badge tone={ROLE_TONE[u.role]}>{t(u.roleLabel)}</Badge>
                      {self && <Badge>{t('Toi')}</Badge>}
                      {u.disabled && <Badge tone="red">{t('Désactivé')}</Badge>}
                      {u.mustChangePassword && !u.disabled && <Badge tone="ember">{t('Mot de passe temporaire')}</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-ink-500">
                      {t('Dernière connexion : {value}', { value: u.lastLoginAt ? `${formatDate(u.lastLoginAt)} (${u.lastLoginIp})` : t('jamais') })} ·{' '}
                      {t('créé le {date}', { date: formatDate(u.createdAt) })}
                      {u.createdBy ? t(' par {name}', { name: u.createdBy }) : ''}
                    </div>
                  </div>
                </div>
                {self ? (
                  <p className="text-xs text-ink-500 lg:max-w-56 lg:text-right">{t('Gère ton propre compte depuis « Mon compte ».')}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={u.role} onChange={(e) => changeRole(u, e.target.value)} options={roleOptions} className="w-44 py-1.5 text-xs" disabled={busy === `role:${u.id}`} />
                    <Button size="sm" icon={KeyRound} loading={busy === `pw:${u.id}`} onClick={() => resetPassword(u)}>
                      {t('Mot de passe')}
                    </Button>
                    <Button size="sm" variant={u.disabled ? 'success' : 'secondary'} icon={u.disabled ? UserCheck : Ban} loading={busy === `dis:${u.id}`} onClick={() => toggleDisabled(u)}>
                      {t(u.disabled ? 'Réactiver' : 'Désactiver')}
                    </Button>
                    <Button size="sm" variant="danger" icon={Trash2} loading={busy === `del:${u.id}`} onClick={() => remove(u)} aria-label={t('Supprimer')} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={t('Rôles et permissions')} icon={ShieldCheck} className="mt-6" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-ink-800 text-left">
                <th className="px-5 py-3 font-medium text-ink-400">{t('Permission')}</th>
                {Object.entries(data.roles).map(([key, r]) => (
                  <th key={key} className="px-3 py-3 text-center font-medium">
                    <Badge tone={ROLE_TONE[key]}>{t(r.label)}</Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/70">
              {Object.entries(data.permissions).map(([perm, label]) => (
                <tr key={perm}>
                  <td className="px-5 py-2.5 text-ink-300">{t(label)}</td>
                  {Object.entries(data.roles).map(([key, r]) => (
                    <td key={key} className="px-3 py-2.5 text-center">
                      {r.permissions.includes(perm) ? <Check className="mx-auto size-4 text-moss-400" /> : <span className="text-ink-700">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateUserModal
        open={creating}
        roles={roleOptions}
        onClose={() => setCreating(false)}
        onCreated={(r) => {
          setCreating(false);
          setSecret({ username: r.user.username, password: r.password, created: true });
          reload();
        }}
      />
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}

function CreateUserModal({ open, roles, onClose, onCreated }) {
  const t = useT();
  const [form, setForm] = useState({ username: '', role: 'moderator' });
  const [run, busy] = useAction();
  const valid = /^[A-Za-z0-9_.-]{3,32}$/.test(form.username);

  const submit = async (e) => {
    e?.preventDefault();
    const r = await run('create', () => api('/users', { method: 'POST', body: form }));
    if (r) {
      setForm({ username: '', role: 'moderator' });
      onCreated(r);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Nouveau compte')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" icon={UserPlus} loading={busy === 'create'} disabled={!valid} onClick={submit}>
            {t('Créer le compte')}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("Nom d'utilisateur")} hint={t('3 à 32 caractères : lettres, chiffres, _ . -')}>
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} autoFocus autoComplete="off" />
        </Field>
        <Field label={t('Rôle')} hint={t('Modifiable à tout moment.')}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={roles} />
        </Field>
        <p className="rounded-lg bg-ink-850 px-3 py-2 text-xs text-ink-400">
          {t("Un mot de passe temporaire est généré. Il s'affichera une seule fois, et la personne devra le remplacer à sa première connexion.")}
        </p>
      </form>
    </Modal>
  );
}

function SecretModal({ secret, onClose }) {
  const t = useT();
  const { toast } = useFeedback();
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast(t('Copié')));
  const summary =
    secret && t('Panel Hearthwatch : {url}\nUtilisateur : {user}\nMot de passe temporaire : {password}', { url: window.location.origin, user: secret.username, password: secret.password });
  return (
    <Modal
      open={!!secret}
      onClose={onClose}
      title={t(secret?.created ? 'Compte créé' : 'Mot de passe réinitialisé')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t("J'ai noté le mot de passe")}
        </Button>
      }
    >
      {secret && (
        <div className="space-y-4">
          <p className="text-sm text-ink-300">{t('Transmets ces informations à la personne par un moyen privé. Le mot de passe ne sera plus affiché.')}</p>
          <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-950 p-4 font-mono text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-ink-500">{t('Utilisateur')}</span>
              <span className="text-ink-100">{secret.username}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-500">{t('Mot de passe')}</span>
              <span className="break-all text-ember-300">{secret.password}</span>
            </div>
          </div>
          <Button icon={Copy} className="w-full" onClick={() => copy(summary)}>
            {t("Copier les identifiants et l'adresse")}
          </Button>
        </div>
      )}
    </Modal>
  );
}
