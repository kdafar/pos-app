import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../src/store';
import { useEffect, useMemo, useRef, useState } from 'react';
import packageJson from '../../../package.json';
import { useToast } from '../components/ToastProvider';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  GitBranch,
  Timer,
  AlertTriangle,
} from 'lucide-react';

type SyncStatus = {
  mode: 'live' | 'offline';
  last_sync_at: number;
  base_url: string;
  cursor: number;
  paired: boolean;
  token_present: boolean;
  device_id: string | null;
  branch_name: string;
  branch_id: number;
};

type PosUser = {
  id: string | number;
  name?: string;
  role?: string;
  type?: string;
  is_admin?: boolean | number;
};

const APP_VERSION = packageJson.version;
const APP_VENDOR = packageJson.author || 'Majestic POS';

export function Layout() {
  const toast = useToast();
  const collapsed = useStore((s) => s.collapsed);
  const toggleCollapsed = useStore((s) => s.actions.toggleCollapsed);
  const location = useLocation();
  const navigate = useNavigate();

  /* ---------------- Theme (persist via meta store) ---------------- */
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    (async () => {
      const saved = await window.api.invoke('store:get', 'ui.theme');
      const initial =
        saved === 'light' || saved === 'dark'
          ? saved
          : document.documentElement.classList.contains('dark')
          ? 'dark'
          : 'light';
      setTheme(initial);
      document.documentElement.classList.toggle('dark', initial === 'dark');
    })();
  }, []);

  const toggleTheme = async () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    await window.api.invoke('store:set', 'ui.theme', next);
  };

  /* ---------------- Auth: who am I? (for RBAC) ---------------- */
  const [user, setUser] = useState<PosUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await window.api.invoke('auth:whoami');
        setUser(u || null);
      } catch {
        setUser(null);
      }
    })();
  }, []);

  const isAdmin = useMemo(() => {
    if (!user) return true;
    if (user.is_admin === true || user.is_admin === 1) return true;

    const role = String(user.role ?? user.type ?? '').toLowerCase();
    if (role === 'admin' || role === 'manager' || role === 'owner') return true;

    return false;
  }, [user]);

  /* ---------------- Sync status + controls ---------------- */
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<number | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  const refreshStatus = async () => {
    try {
      const s = (await window.api.invoke('sync:status')) as SyncStatus;
      setSync(s);
    } catch (e) {
      console.error('sync:status failed', e);
    }
  };

  useEffect(() => {
    refreshStatus();
    pollRef.current = window.setInterval(
      refreshStatus,
      5000
    ) as unknown as number;

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const hasAutoCollapsedRef = useRef(false);

  useEffect(() => {
    const onPosScreen = location.pathname === '/';

    if (onPosScreen && !collapsed && !hasAutoCollapsedRef.current) {
      toggleCollapsed();
      hasAutoCollapsedRef.current = true;
    }

    if (!onPosScreen) {
      hasAutoCollapsedRef.current = false;
    }
  }, [location.pathname, collapsed, toggleCollapsed]);

  useEffect(() => {
    if (!sync) return;

    const canAutoSync =
      sync.mode === 'live' &&
      sync.paired &&
      sync.token_present &&
      !!sync.base_url;

    if (!canAutoSync) return;

    const AUTO_SYNC_MIN_INTERVAL = 60_000;

    const id = window.setInterval(async () => {
      if (syncingRef.current) return;
      if (typeof document !== 'undefined' && !document.hasFocus()) return;

      const last = Number(sync.last_sync_at || 0);
      if (last && Date.now() - last < AUTO_SYNC_MIN_INTERVAL) return;

      try {
        syncingRef.current = true;
        setSyncing(true);
        await window.api.invoke('sync:run');
        await refreshStatus();
      } catch (e) {
        console.error('auto sync:run failed', e);
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    }, 10_000) as unknown as number;

    return () => clearInterval(id);
  }, [
    sync?.mode,
    sync?.paired,
    sync?.token_present,
    sync?.base_url,
    sync?.last_sync_at,
  ]);

  const runSync = async () => {
    try {
      setSyncing(true);
      await window.api.invoke('sync:run');
      await refreshStatus();
    } catch (e) {
      console.error('sync:run failed', e);
      toast({
        tone: 'danger',
        title: 'Sync failed',
        message: 'Check connection/base URL/pairing.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const lastSyncText = useMemo(() => {
    if (!sync?.last_sync_at) return '—';
    const d = Date.now() - Number(sync.last_sync_at);
    if (d < 15_000) return 'just now';
    if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    return new Date(sync.last_sync_at).toLocaleString();
  }, [sync?.last_sync_at]);

  const iconButtonClass =
    'inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-9 w-9 text-muted-foreground';

  return (
    <div
      className='h-screen w-screen overflow-hidden grid bg-background transition-all duration-300 min-h-0 min-w-0'
      style={{ gridTemplateColumns: collapsed ? '76px 1fr' : '260px 1fr' }}
    >
      {/* Sidebar */}
      <aside
        className='
          h-full border-r flex flex-col gap-3 p-3 min-h-0 min-w-0
          bg-gradient-to-b from-slate-50 to-slate-100
          dark:from-slate-950 dark:to-slate-900
        '
      >
        {/* User header + controls */}
        <div className='flex items-center gap-2 px-1'>
          {!collapsed && (
            <div
              className={`
              flex items-center gap-3 overflow-hidden
              rounded-2xl px-3 py-2
              bg-white/80 shadow-sm border border-slate-200
              dark:bg-slate-900/80 dark:border-slate-800
              flex-1
            `}
            >
              {/* Avatar */}
              <div className='w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xs uppercase'>
                {(user?.name || 'U').slice(0, 2)}
              </div>

              {/* Name + role */}
              <div className='min-w-0 flex flex-col'>
                <span className='text-sm font-semibold truncate text-foreground'>
                  {user?.name || 'Operator'}
                </span>
                <span className='text-[10px] uppercase tracking-[0.16em] text-muted-foreground truncate'>
                  {user?.role || (user?.is_admin ? 'Admin' : 'Staff')}
                </span>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className='flex flex-col gap-1 items-center'>
            <button
              className={`${iconButtonClass} ${collapsed ? 'hidden' : ''}`}
              title='Toggle theme'
              onClick={toggleTheme}
            >
              {theme === 'light' ? (
                <IconMoon className='h-5 w-5' />
              ) : (
                <IconSun className='h-5 w-5' />
              )}
            </button>
            <button
              className={iconButtonClass}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <IconPanelRight className='h-5 w-5' />
              ) : (
                <IconPanelLeft className='h-5 w-5' />
              )}
            </button>
          </div>
        </div>

        {/* Sync card */}
        {!collapsed && (
          <section
            className='
              mx-1 rounded-2xl border bg-white/90 px-3 py-2.5 text-[11px] shadow-sm
              dark:bg-slate-900/80 dark:border-slate-800
            '
            title={sync?.base_url || ''}
          >
            <div className='flex items-center justify-between gap-3'>
              {/* LEFT: label + details */}
              <div className='min-w-0'>
                <div className='text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1'>
                  Sync
                </div>
                <div className='flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground'>
                  <span className='inline-flex items-center gap-1 max-w-[140px]'>
                    <GitBranch size={11} />
                    <span className='truncate'>
                      {sync?.branch_name || 'No branch'}
                    </span>
                  </span>
                  <span className='inline-flex items-center gap-1 max-w-[120px]'>
                    <Timer size={11} />
                    <span className='truncate'>{lastSyncText}</span>
                  </span>
                </div>
              </div>

              {/* RIGHT: status + sync button */}
              <div className='flex items-center gap-2 shrink-0'>
                <div
                  className={[
                    'inline-flex h-7 px-3 items-center justify-center gap-1 rounded-full border text-[10px] font-medium',
                    sync?.mode === 'live'
                      ? 'bg-emerald-600 text-emerald-50 border-emerald-700'
                      : 'bg-muted text-foreground border-border',
                  ].join(' ')}
                  title={
                    sync?.mode === 'live'
                      ? 'Online – syncing is enabled'
                      : 'Offline – syncing is paused'
                  }
                >
                  {sync?.mode === 'live' ? (
                    <Cloud size={13} />
                  ) : (
                    <CloudOff size={13} />
                  )}
                  <span>{sync?.mode === 'live' ? 'Online' : 'Offline'}</span>
                </div>

                <button
                  onClick={runSync}
                  disabled={sync?.mode !== 'live' || syncing}
                  className={[
                    'inline-flex h-8 w-8 items-center justify-center rounded-full border text-[10px]',
                    'bg-foreground text-background border-border hover:bg-foreground/90',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  ].join(' ')}
                  title={
                    sync?.mode === 'live'
                      ? 'Sync now'
                      : 'Cannot sync while offline'
                  }
                >
                  <RefreshCw
                    size={13}
                    className={syncing ? 'animate-spin' : ''}
                  />
                </button>
              </div>
            </div>

            {!sync?.paired && (
              <button
                onClick={() => navigate('/settings')}
                className='
                  mt-2 flex h-6 w-full items-center justify-center gap-1.5 rounded-md border
                  border-amber-500/40 bg-amber-500/10 px-2 text-[10px] font-medium
                  text-amber-900 hover:bg-amber-500/20 dark:text-amber-200
                '
              >
                <AlertTriangle size={11} />
                <span className='truncate'>
                  Device not paired – open Settings
                </span>
              </button>
            )}
          </section>
        )}

        {/* Nav (RBAC) */}
        <nav className='mt-1 space-y-1 flex-grow overflow-y-auto nice-scroll min-h-0'>
          <SectionLabel hidden={collapsed}>Orders</SectionLabel>
          <NavLink
            to='/'
            text='Order Process'
            icon='🧾'
            collapsed={collapsed}
            active={location.pathname === '/'}
          />
          <NavLink
            to='/orders'
            text='Recent Orders'
            icon='📜'
            collapsed={collapsed}
            active={location.pathname === '/orders'}
          />
          {/* Closing Report → admin only */}{' '}
          <NavLink
            to='/reports/closing'
            text='Closing Report'
            icon='📜'
            collapsed={collapsed}
            active={location.pathname === '/reports/closing'}
          />
          {isAdmin && (
            <>
              <SectionLabel hidden={collapsed}>Catalog</SectionLabel>
              <NavLink
                to='/categories'
                text='Categories'
                icon='🗂️'
                collapsed={collapsed}
                active={location.pathname === '/categories'}
              />
              <NavLink
                to='/items'
                text='Items'
                icon='📦'
                collapsed={collapsed}
                active={location.pathname === '/items'}
              />
              <NavLink
                to='/addons'
                text='Addons'
                icon='➕'
                collapsed={collapsed}
                active={location.pathname === '/addons'}
              />
              <NavLink
                to='/promos'
                text='Promocodes'
                icon='🏷️'
                collapsed={collapsed}
                active={location.pathname === '/promos'}
              />

              <SectionLabel hidden={collapsed}>System</SectionLabel>
              <NavLink
                to='/payment-methods'
                text='Payment Methods'
                icon='💳'
                collapsed={collapsed}
                active={location.pathname === '/payment-methods'}
              />
              <NavLink
                to='/locations'
                text='Locations'
                icon='📍'
                collapsed={collapsed}
                active={location.pathname === '/locations'}
              />
              <NavLink
                to='/tables'
                text='Tables'
                icon='🪑'
                collapsed={collapsed}
                active={location.pathname === '/tables'}
              />
              <NavLink
                to='/settings'
                text='Settings'
                icon='⚙️'
                collapsed={collapsed}
                active={location.pathname === '/settings'}
              />
            </>
          )}
        </nav>

        {/* Footer / Logout */}
        <div className='mt-2 pt-2 border-t border-slate-200 dark:border-slate-800'>
          <NavLink
            to='/logout'
            text='Logout'
            icon='🚪'
            collapsed={collapsed}
            active={false}
          />
          {/* Tiny version badge */}
          {!collapsed && (
            <div className='px-3 pb-1 text-[10px] text-muted-foreground/80 flex items-center justify-between'>
              <span className='font-mono'>v{APP_VERSION}</span>
              <span className='uppercase tracking-[0.18em] text-xs'>
                {APP_VENDOR}
              </span>
            </div>
          )}

          {collapsed && (
            <div className='flex items-center justify-center pb-1 text-[9px] text-muted-foreground/70 font-mono'>
              v{APP_VERSION}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className='h-full overflow-y-auto nice-scroll min-h-0 min-w-0'>
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({
  to,
  text,
  icon,
  collapsed,
  active = false,
}: {
  to: string;
  text: string;
  icon?: string;
  collapsed?: boolean;
  active?: boolean;
}) {
  const baseClasses =
    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200';
  const activeClasses =
    'bg-slate-900 text-slate-50 shadow-sm dark:bg-slate-100 dark:text-slate-900';
  const inactiveClasses =
    'text-muted-foreground hover:text-foreground hover:bg-slate-100/80 dark:hover:bg-slate-800/80';
  const collapsedClasses = 'w-10 h-10 justify-center px-0';
  const expandedClasses = 'w-full';

  return (
    <Link
      to={to}
      className={`${baseClasses} ${active ? activeClasses : inactiveClasses} ${
        collapsed ? collapsedClasses : expandedClasses
      }`}
    >
      <span className='text-lg flex-shrink-0'>{icon || '•'}</span>
      {!collapsed && <span className='truncate'>{text}</span>}
    </Link>
  );
}

function SectionLabel({
  children,
  hidden,
}: {
  children: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return <div className='h-2' />;
  return (
    <div className='mt-3 mb-1 uppercase tracking-wide text-[10px] text-muted-foreground px-3'>
      {children}
    </div>
  );
}

/* --- Icons --- */
const IconPanelLeft = ({ className }: { className?: string }) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
  >
    <rect width='18' height='18' x='3' y='3' rx='2' />
    <path d='M9 3v18' />
  </svg>
);
const IconPanelRight = ({ className }: { className?: string }) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
  >
    <rect width='18' height='18' x='3' y='3' rx='2' />
    <path d='M15 3v18' />
  </svg>
);
const IconMoon = ({ className }: { className?: string }) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
  >
    <path d='M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' />
  </svg>
);
const IconSun = ({ className }: { className?: string }) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
  >
    <circle cx='12' cy='12' r='4' />
    <path d='M12 2v2' />
    <path d='M12 20v2' />
    <path d='m4.93 4.93 1.41 1.41' />
    <path d='m17.66 17.66 1.41 1.41' />
    <path d='M2 12h2' />
    <path d='M20 12h2' />
    <path d='m6.34 17.66-1.41 1.41' />
    <path d='m19.07 4.93-1.41 1.41' />
  </svg>
);

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}
