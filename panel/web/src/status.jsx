import { createContext, useContext } from 'react';
import { TriangleAlert } from 'lucide-react';
import { api, useApi } from './api.js';
import { useT } from './i18n.jsx';
import { Badge, cx, useAction, useFeedback } from './ui.jsx';

const StatusContext = createContext({ status: null });

export function StatusProvider({ children }) {
  const { data, error, reload } = useApi('/status', { interval: 5000 });
  return <StatusContext.Provider value={{ status: data, error, reload }}>{children}</StatusContext.Provider>;
}

export const useStatus = () => useContext(StatusContext);
export const useOnlinePlayers = () => useStatus().status?.players || [];

export const PHASES = {
  online: { label: 'En ligne', tone: 'green', dot: 'bg-moss-400' },
  starting: { label: 'Démarrage…', tone: 'ember', dot: 'bg-ember-400 animate-pulse' },
  updating: { label: 'Mise à jour…', tone: 'blue', dot: 'bg-frost-400 animate-pulse' },
  stopping: { label: 'Arrêt…', tone: 'ember', dot: 'bg-ember-400 animate-pulse' },
  stopped: { label: 'Arrêté', tone: 'neutral', dot: 'bg-ink-500' },
  failed: { label: 'En erreur', tone: 'red', dot: 'bg-blood-400' },
};

export function PhaseBadge({ phase }) {
  const t = useT();
  const p = PHASES[phase] || PHASES.stopped;
  return (
    <Badge tone={p.tone}>
      <span className={cx('size-1.5 rounded-full', p.dot)} />
      {t(p.label)}
    </Badge>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function OfflineNotice() {
  const { status } = useStatus();
  const t = useT();
  if (!status || status.phase === 'online') return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-300">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        {t("Le serveur de jeu n'est pas en ligne ({phase}). Les actions en direct (joueurs, objets, événements) seront disponibles dès qu'il aura démarré.", {
          phase: t(PHASES[status.phase]?.label || 'Arrêté').toLowerCase(),
        })}
      </span>
    </div>
  );
}

// Démarrer / arrêter / redémarrer avec confirmation.
export function useServerControl() {
  const { status, reload } = useStatus();
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const t = useT();
  const control = async (action) => {
    if (action !== 'start') {
      const n = status?.players?.length || 0;
      const ok = await confirm({
        title: t(action === 'stop' ? 'Arrêter le serveur ?' : 'Redémarrer le serveur ?'),
        message: `${n ? t('{n} joueur(s) connecté(s) seront déconnectés. ', { n }) : ''}${t("Le monde est sauvegardé avant l'arrêt.")}${
          action === 'restart' ? t(' Le redémarrage installe aussi la dernière version de Valheim (1 à 2 minutes).') : ''
        }`,
        confirmLabel: t(action === 'stop' ? 'Arrêter' : 'Redémarrer'),
        danger: action === 'stop',
      });
      if (!ok) return;
    }
    await run(action, () => api(`/server/${action}`, { method: 'POST' }), t({ start: 'Démarrage lancé', stop: 'Arrêt en cours', restart: 'Redémarrage lancé' }[action]));
    setTimeout(reload, 1500);
  };
  return [control, busy];
}
