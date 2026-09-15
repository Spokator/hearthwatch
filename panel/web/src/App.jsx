import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Archive,
  Boxes,
  CircleUserRound,
  ClipboardList,
  LayoutDashboard,
  Lock,
  LogOut,
  Map as MapIcon,
  Menu,
  Mountain,
  Puzzle,
  ScrollText,
  Settings,
  SquareTerminal,
  UserCog,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import { api } from './api.js';
import { AuthProvider, useAuth, useCan } from './auth.jsx';
import { LanguageSwitcher, currentLanguage, useT } from './i18n.jsx';
import { PhaseBadge, StatusProvider, useStatus } from './status.jsx';
import { Empty, Spinner, cx } from './ui.jsx';
import Login, { Logo } from './pages/Login.jsx';
import Account, { ForcePasswordChange } from './pages/Account.jsx';
import Audit from './pages/Audit.jsx';
import Config from './pages/Config.jsx';
import Console from './pages/Console.jsx';
import Dashboard from './pages/Dashboard.jsx';
import GameMaster from './pages/GameMaster.jsx';
import Items from './pages/Items.jsx';
import Logs from './pages/Logs.jsx';
import MapPage from './pages/MapPage.jsx';
import ModsPage from './pages/ModsPage.jsx';
import Players from './pages/Players.jsx';
import UsersPage from './pages/Users.jsx';
import World from './pages/World.jsx';
import Worlds from './pages/Worlds.jsx';

// Les libellés sont les textes sources français, traduits à l'affichage.
const NAV = [
  { section: 'Serveur', to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true, element: <Dashboard /> },
  { section: 'Serveur', to: '/carte', label: 'Carte en direct', icon: MapIcon, perm: 'map.view', element: <MapPage /> },
  { section: 'Serveur', to: '/joueurs', label: 'Joueurs', icon: Users, perm: 'players.view', element: <Players /> },
  { section: 'Serveur', to: '/objets', label: 'Objets & coffres', icon: Boxes, perm: 'world.view', element: <Items /> },
  { section: 'Serveur', to: '/monde', label: 'Monde & événements', icon: Mountain, perm: 'world.view', element: <World /> },
  { section: 'Serveur', to: '/maitre-du-jeu', label: 'Maître du jeu', icon: WandSparkles, perm: 'world.edit', element: <GameMaster /> },
  { section: 'Serveur', to: '/mondes', label: 'Mondes & sauvegardes', icon: Archive, perm: 'worlds.manage', element: <Worlds /> },
  { section: 'Serveur', to: '/configuration', label: 'Configuration', icon: Settings, perm: 'config.edit', element: <Config /> },
  { section: 'Serveur', to: '/mods', label: 'Mods', icon: Puzzle, perm: 'config.edit', element: <ModsPage /> },
  { section: 'Serveur', to: '/journaux', label: 'Journaux', icon: ScrollText, perm: 'logs.view', element: <Logs /> },
  { section: 'Serveur', to: '/console', label: 'Console', icon: SquareTerminal, perm: 'console', element: <Console /> },
  { section: 'Panel', to: '/utilisateurs', label: 'Utilisateurs', icon: UserCog, perm: 'users.manage', element: <UsersPage /> },
  { section: 'Panel', to: '/audit', label: "Journal d'audit", icon: ClipboardList, perm: 'audit.view', element: <Audit /> },
  { section: 'Panel', to: '/compte', label: 'Mon compte', icon: CircleUserRound, element: <Account /> },
];

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener('panel:unauthorized', onUnauthorized);
    return () => window.removeEventListener('panel:unauthorized', onUnauthorized);
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  if (user === undefined) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Login onLogin={setUser} />;

  return (
    <AuthProvider value={{ user, setUser }}>
      {user.mustChangePassword ? (
        <ForcePasswordChange onLogout={logout} />
      ) : (
        <StatusProvider>
          <Shell onLogout={logout} />
        </StatusProvider>
      )}
    </AuthProvider>
  );
}

function Shell({ onLogout }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { status } = useStatus();
  const { user } = useAuth();
  const can = useCan();
  const t = useT();

  useEffect(() => setOpen(false), [location.pathname]);

  const visible = NAV.filter((item) => !item.perm || can(item.perm));
  const sections = [...new Set(visible.map((item) => item.section))];
  const online = status?.players.length ?? 0;

  return (
    <div className="min-h-full">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ink-800 bg-ink-900/95 backdrop-blur transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <Logo />
          <button className="rounded-md p-1 text-ink-400 hover:text-ink-100 lg:hidden" onClick={() => setOpen(false)} aria-label={t('Fermer le menu')}>
            <X className="size-5" />
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-3">
          {sections.map((section) => (
            <div key={section}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-600">{t(section)}</div>
              <div className="space-y-1">
                {visible
                  .filter((item) => item.section === section)
                  .map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={({ isActive }) =>
                        cx(
                          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition',
                          isActive ? 'bg-ember-500/10 text-ember-300 shadow-[inset_2px_0_0_0_var(--color-ember-500)]' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100',
                        )
                      }
                    >
                      <Icon className="size-4" />
                      {t(label)}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-ink-800 p-4">
          {status && (
            <div className="mb-3 rounded-lg bg-ink-850 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-ink-200">{status.game.name}</span>
                <PhaseBadge phase={status.phase} />
              </div>
              <div className="mt-1 text-xs text-ink-500">{t(new Intl.PluralRules(currentLanguage()).select(online) === 'one' ? '{n} joueur en ligne' : '{n} joueurs en ligne', { n: online })}</div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-xs">
            <Link to="/compte" className="min-w-0 rounded-md px-2 py-1 hover:bg-ink-800">
              <div className="truncate text-ink-200">{user.username}</div>
              <div className="truncate text-ink-500">{t(user.roleLabel)}</div>
            </Link>
            <button onClick={onLogout} className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-ink-500 hover:bg-ink-800 hover:text-ink-100">
              <LogOut className="size-3.5" />
              {t('Déconnexion')}
            </button>
          </div>
          <LanguageSwitcher className="mt-2 px-2" />
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-ink-950/70 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-h-full min-w-0 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-ink-300 hover:bg-ink-800" aria-label={t('Ouvrir le menu')}>
            <Menu className="size-5" />
          </button>
          <Logo small />
          {status ? <PhaseBadge phase={status.phase} /> : <span />}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Routes>
            {NAV.map((item) => (
              <Route key={item.to} path={item.to} element={!item.perm || can(item.perm) ? item.element : <Forbidden />} />
            ))}
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Forbidden() {
  const t = useT();
  return (
    <Empty icon={Lock} title={t('Accès refusé')}>
      {t('Ton rôle ne donne pas accès à cette page. Demande au propriétaire du panel si tu en as besoin.')}
    </Empty>
  );
}
