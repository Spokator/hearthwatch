import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { api } from '../api.js';
import { LanguageSwitcher, useT } from '../i18n.jsx';
import { Button, ErrorNote, Field, Input, cx } from '../ui.jsx';

export function Logo({ small }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" className={cx('shrink-0', small ? 'size-7' : 'size-9')} aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="#1a1f28" stroke="#e39b35" strokeWidth="2" />
        <circle cx="20" cy="20" r="11" fill="none" stroke="#e39b35" strokeOpacity=".45" strokeWidth="1.5" />
        <path d="M20 2v36M2 20h36" stroke="#e39b35" strokeOpacity=".35" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="4.5" fill="#e39b35" />
      </svg>
      <div className="leading-tight">
        <div className={cx('rune-title text-ink-100', small ? 'text-xs' : 'text-sm')}>Hearthwatch</div>
        {!small && <div className="text-[11px] text-ink-500">{t("Panel d'administration")}</div>}
      </div>
    </div>
  );
}

export default function Login({ onLogin }) {
  const t = useT();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/login', { method: 'POST', body: form });
      onLogin(r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <form onSubmit={submit} className="rounded-2xl border border-ink-800 bg-ink-900/90 p-7 shadow-2xl backdrop-blur">
          <div className="mb-7 flex justify-center">
            <Logo />
          </div>
          <div className="space-y-4">
            <Field label={t('Utilisateur')}>
              <Input autoComplete="username" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label={t('Mot de passe')}>
              <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" icon={LogIn} loading={busy} className="w-full" disabled={!form.username || !form.password}>
              {t('Se connecter')}
            </Button>
          </div>
        </form>
        <div className="mt-4 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
