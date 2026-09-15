import { Activity, CalendarDays, Copy, Cpu, Gamepad2, Gauge, HardDrive, MemoryStick, Monitor, Play, RotateCw, Square, TriangleAlert, Users } from 'lucide-react';
import { formatBytes, formatDuration, formatNumber } from '../api.js';
import { useCan } from '../auth.jsx';
import { HistoryList, PlatformBadge } from '../components.jsx';
import { useT } from '../i18n.jsx';
import { PageHeader, PhaseBadge, useServerControl, useStatus } from '../status.jsx';
import { Badge, Button, Card, Empty, Meter, Spinner, Stat, useFeedback } from '../ui.jsx';

export default function Dashboard() {
  const { status: s } = useStatus();
  const [control, busy] = useServerControl();
  const { toast } = useFeedback();
  const canControl = useCan()('server.control');
  const t = useT();

  if (!s) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner />
      </div>
    );
  }

  const running = ['online', 'starting'].includes(s.phase);
  const uptime = running && s.service.since ? (Date.now() - Date.parse(s.service.since)) / 1000 : null;
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast(t('Copié dans le presse-papiers')));

  return (
    <>
      <PageHeader title={t('Tableau de bord')} description={t('État du serveur en temps réel (actualisé toutes les 5 secondes).')} />

      {s.pendingRestart && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-frost-500/30 bg-frost-500/10 px-4 py-3 text-sm text-frost-400">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" />
            {t("La configuration a changé depuis le démarrage : redémarre le serveur pour l'appliquer.")}
          </span>
          {canControl && (
            <Button size="sm" icon={RotateCw} loading={busy === 'restart'} onClick={() => control('restart')}>
              {t('Redémarrer')}
            </Button>
          )}
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-ink-800 bg-gradient-to-br from-ink-850 via-ink-900 to-ink-950 p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-ember-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <PhaseBadge phase={s.phase} />
              {s.game.crossplay && <Badge tone="blue">Crossplay</Badge>}
              <Badge>{t(s.game.public ? 'Listé publiquement' : 'Non listé')}</Badge>
              {s.game.mods && <Badge tone="ember">{t('Mods serveur')}</Badge>}
            </div>
            <h2 className="mt-3 truncate text-3xl font-semibold text-ink-100">{s.game.name}</h2>
            <p className="mt-1 text-sm text-ink-400">
              {t('Monde')} <span className="text-ink-200">{s.game.world}</span>
              {s.game.version && <> · Valheim {s.game.version}</>}
              {uptime != null && <> · {t('en ligne depuis {duration}', { duration: formatDuration(uptime) })}</>}
            </p>
          </div>
          {canControl && (
            <div className="flex flex-wrap gap-2">
              {running || s.phase === 'updating' ? (
                <>
                  <Button icon={RotateCw} loading={busy === 'restart'} onClick={() => control('restart')}>
                    {t('Redémarrer')}
                  </Button>
                  <Button variant="danger" icon={Square} loading={busy === 'stop'} onClick={() => control('stop')}>
                    {t('Arrêter')}
                  </Button>
                </>
              ) : (
                <Button variant="primary" icon={Play} loading={busy === 'start'} disabled={s.phase === 'stopping'} onClick={() => control('start')}>
                  {t('Démarrer')}
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="relative mt-6 grid gap-3 md:grid-cols-2">
          <JoinTile icon={Monitor} title={t('PC — adresse du serveur')} value={`${s.game.host}:${s.game.port}`} hint={t('Rejoindre une partie → Ajouter un serveur')} onCopy={copy} />
          <JoinTile
            icon={Gamepad2}
            title={t("PS5 / Xbox — code d'accès")}
            value={s.game.joinCode || '—'}
            onCopy={s.game.joinCode ? copy : null}
            hint={
              !s.game.crossplay
                ? t('Crossplay désactivé : active-le dans Configuration.')
                : s.game.joinCode
                  ? t('Change à chaque redémarrage. Ou cherche « {name} » dans la liste.', { name: s.game.name })
                  : t('Disponible quelques secondes après le démarrage.')
            }
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={t('Joueurs')} icon={Users} value={s.players.length} sub={t('connectés')} />
        <Stat label={t('FPS serveur')} icon={Gauge} value={s.stats?.fps ?? '—'} sub={t('30 = fluide')} />
        <Stat label={t('CPU du jeu')} icon={Cpu} value={s.service.cpu != null ? `${s.service.cpu} %` : '—'} sub={t('100 % = 1 cœur sur {n}', { n: s.host.cpus })} />
        <Stat label={t('RAM du jeu')} icon={MemoryStick} value={formatBytes(s.service.memory)} sub={<Meter value={s.service.memory || 0} max={6 * 1024 ** 3} />} />
        <Stat label={t('Jour en jeu')} icon={CalendarDays} value={s.stats?.day ?? '—'} />
        <Stat label={t('Objets du monde')} icon={Activity} value={formatNumber(s.stats?.objects)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title={t('Joueurs en ligne')} icon={Users} className="lg:col-span-2" padded={false}>
          {s.players.length ? (
            <ul className="divide-y divide-ink-800">
              {s.players.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink-100">{p.name}</div>
                    <div className="truncate font-mono text-xs text-ink-500">{p.id}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {p.maxHp ? (
                      <span className="text-xs tabular-nums text-ink-400">
                        {Math.round(p.hp)} / {Math.round(p.maxHp)} {t('PV')}
                      </span>
                    ) : null}
                    <PlatformBadge platform={p.platform} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Users} title={t('Personne en ligne')}>
              {t(s.rconError && s.phase === 'starting' ? 'Le monde est en cours de chargement…' : 'Les joueurs connectés apparaîtront ici.')}
            </Empty>
          )}
        </Card>

        <Card title={t('Machine')} icon={HardDrive}>
          <div className="space-y-4">
            <HostRow label={t('Charge CPU')} value={`${s.host.load[0].toFixed(2)} / ${s.host.cpus}`} ratio={s.host.load[0] / s.host.cpus} />
            <HostRow label={t('Mémoire')} value={`${formatBytes(s.host.memTotal - s.host.memAvailable)} / ${formatBytes(s.host.memTotal)}`} ratio={1 - s.host.memAvailable / s.host.memTotal} />
            <HostRow label={t('Disque')} value={`${formatBytes(s.disk.total - s.disk.free)} / ${formatBytes(s.disk.total)}`} ratio={1 - s.disk.free / s.disk.total} />
            <div className="flex justify-between border-t border-ink-800 pt-3 text-xs text-ink-500">
              <span>{t('Machine allumée depuis')}</span>
              <span>{formatDuration(s.host.uptime)}</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title={t('Activité récente')} icon={Activity} className="mt-6">
        <HistoryList events={s.recent} limit={8} />
      </Card>
    </>
  );
}

function JoinTile({ icon: Icon, title, value, hint, onCopy }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-950/50 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ink-500">
        <Icon className="size-4" />
        {title}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-lg text-ink-100 sm:text-xl">{value}</span>
        {onCopy && (
          <Button size="sm" variant="ghost" icon={Copy} onClick={() => onCopy(value)}>
            {t('Copier')}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">{hint}</p>
    </div>
  );
}

function HostRow({ label, value, ratio }) {
  const tone = ratio > 0.85 ? 'bg-blood-500' : ratio > 0.65 ? 'bg-ember-500' : 'bg-moss-500';
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-ink-400">{label}</span>
        <span className="tabular-nums text-ink-200">{value}</span>
      </div>
      <Meter value={ratio} max={1} tone={tone} />
    </div>
  );
}
