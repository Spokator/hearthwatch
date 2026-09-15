import { useState } from 'react';
import { Check, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { api, formatDate, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { PageHeader } from '../status.jsx';
import { Badge, Button, Card, ErrorNote, Field, Input, useFeedback } from '../ui.jsx';
import { Logo } from './Login.jsx';

export function PasswordForm({ onDone, submitLabel, currentLabel }) {
  const t = useT();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const mismatch = f.confirm && f.next !== f.confirm;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/password', { method: 'POST', body: { current: f.current, next: f.next } });
      setF({ current: '', next: '', confirm: '' });
      onDone?.(r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={currentLabel || t('Mot de passe actuel')}>
        <Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
      </Field>
      <Field label={t('Nouveau mot de passe')} hint={t('10 caractères minimum.')}>
        <Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
      </Field>
      <Field label={t('Confirmation')}>
        <Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
      </Field>
      {mismatch && <p className="text-xs text-blood-400">{t('Les deux mots de passe ne correspondent pas.')}</p>}
      <ErrorNote error={error} />
      <Button type="submit" variant="primary" icon={KeyRound} loading={busy} disabled={!f.current || f.next.length < 10 || f.next !== f.confirm}>
        {submitLabel || t('Changer le mot de passe')}
      </Button>
    </form>
  );
}

// Écran imposé tant qu'un compte utilise un mot de passe temporaire.
export function ForcePasswordChange({ onLogout }) {
  const { user, setUser } = useAuth();
  const t = useT();
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-ink-800 bg-ink-900/90 p-7 shadow-2xl backdrop-blur">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-lg font-semibold text-ink-100">{t('Bienvenue {name}', { name: user.username })}</h1>
        <p className="mb-5 mt-1 text-sm text-ink-400">{t('Ton compte utilise un mot de passe temporaire. Choisis ton mot de passe personnel pour continuer.')}</p>
        <PasswordForm currentLabel={t('Mot de passe temporaire')} submitLabel={t('Enregistrer et continuer')} onDone={setUser} />
        <button onClick={onLogout} className="mt-5 flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-200">
          <LogOut className="size-3.5" /> {t('Se déconnecter')}
        </button>
      </div>
    </div>
  );
}

export default function Account() {
  const { user, setUser } = useAuth();
  const { data } = useApi('/auth/me');
  const { toast } = useFeedback();
  const t = useT();

  return (
    <>
      <PageHeader title={t('Mon compte')} description={t('Informations de ton compte du panel et changement de mot de passe.')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('Profil')} icon={UserRound}>
          <dl className="space-y-3 text-sm">
            <Row label={t('Utilisateur')} value={user.username} />
            <Row label={t('Rôle')} value={<Badge tone="ember">{t(user.roleLabel)}</Badge>} />
            <Row label={t('Créé le')} value={`${formatDate(user.createdAt)}${user.createdBy ? ` ${t('par')} ${user.createdBy}` : ''}`} />
            <Row label={t('Dernière connexion')} value={user.lastLoginAt ? `${formatDate(user.lastLoginAt)} (${user.lastLoginIp})` : '—'} />
          </dl>
          {data && (
            <div className="mt-5 border-t border-ink-800 pt-4">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-ink-500">
                <ShieldCheck className="size-3.5" /> {t('Ce que ton rôle permet')}
              </div>
              <ul className="space-y-1.5">
                {user.permissions.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-ink-300">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-moss-400" />
                    {t(data.permissions[p] || p)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title={t('Mot de passe')} icon={KeyRound}>
          <p className="mb-4 text-xs text-ink-500">{t('Changer ton mot de passe déconnecte tes autres sessions ouvertes.')}</p>
          <PasswordForm
            onDone={(u) => {
              setUser(u);
              toast(t('Mot de passe modifié'));
            }}
          />
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right text-ink-200">{value}</dd>
    </div>
  );
}
