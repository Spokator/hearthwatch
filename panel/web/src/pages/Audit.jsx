import { useMemo, useState } from 'react';
import { ClipboardList, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { formatDate, useApi } from '../api.js';
import { useT } from '../i18n.jsx';
import { PageHeader } from '../status.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Input, Select, Spinner, cx } from '../ui.jsx';

export default function Audit() {
  const t = useT();
  const [user, setUser] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi(`/audit${user ? `?user=${encodeURIComponent(user)}` : ''}`, { interval: 15000 });

  const entries = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.entries || []).filter((e) => !s || `${e.action} ${e.user} ${e.ip}`.toLowerCase().includes(s));
  }, [data, q]);

  return (
    <>
      <PageHeader
        title={t("Journal d'audit")}
        description={t('Toutes les actions effectuées depuis le panel : qui, quoi, quand et depuis quelle adresse IP.')}
        actions={
          <Button icon={RefreshCw} loading={loading && !!data} onClick={reload}>
            {t('Actualiser')}
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-ink-800 px-4 py-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Rechercher une action, un joueur, une IP…')} className="pl-9" />
          </div>
          <Select
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="md:w-56"
            options={[{ value: '', label: t('Tous les comptes') }, ...(data?.users || []).map((u) => ({ value: u, label: u }))]}
          />
        </div>
        <ErrorNote error={error} />
        {!data ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : entries.length ? (
          <ul className="divide-y divide-ink-800">
            {entries.map((e, i) => (
              <li key={`${e.time}-${i}`} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
                <time className="shrink-0 text-xs tabular-nums text-ink-500 sm:w-32">{formatDate(e.time)}</time>
                <div className="flex shrink-0 items-center gap-2 sm:w-40">
                  {e.failed ? <ShieldAlert className="size-4 text-blood-400" /> : null}
                  <Badge tone={e.failed ? 'red' : 'neutral'} className="max-w-full truncate">
                    {e.user || '?'}
                  </Badge>
                </div>
                <span className={cx('min-w-0 flex-1 break-words text-sm', e.failed ? 'text-blood-400' : 'text-ink-200')}>{t(e.action)}</span>
                <span className="shrink-0 font-mono text-xs text-ink-600">{e.ip}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={ClipboardList} title={t('Aucune action enregistrée')} />
        )}
      </Card>
      <p className="mt-4 text-xs text-ink-500">{t('Les 500 dernières actions sont affichées. Le journal est conservé sur le serveur (rotation automatique).')}</p>
    </>
  );
}
