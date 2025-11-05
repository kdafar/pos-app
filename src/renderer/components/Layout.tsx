import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../src/store';
import { useEffect, useMemo, useRef, useState } from 'react';

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

export function Layout() {
  const collapsed = useStore(s => s.collapsed);
  const brand = useStore(s => s.brand);
  const toggleCollapsed = useStore(s => s.actions.toggleCollapsed);
  const location = useLocation();
  const navigate = useNavigate();

  /* ---------------- Theme (persist via meta store) ---------------- */
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    (async () => {
      // try persisted choice, fallback to current DOM class
      const saved = await window.api.invoke('store:get', 'ui.theme');
      const initial =
        saved === 'light' || saved === 'dark'
          ? saved
          : (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
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

  /* ---------------- Sync status + controls ---------------- */
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<number | null>(null);

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
    // poll every 5s
    pollRef.current = window.setInterval(refreshStatus, 5000) as unknown as number;
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const toggleMode = async () => {
    if (!sync) return;
    const next = sync.mode === 'live' ? 'offline' : 'live';
    try {
      await window.api.invoke('sync:setMode', next);
      await refreshStatus();
    } catch (e) {
      console.error('sync:setMode failed', e);
    }
  };

  const runSync = async () => {
    try {
      setSyncing(true);
      await window.api.invoke('sync:run'); // bootstrap + pull
      await refreshStatus();
    } catch (e) {
      console.error('sync:run failed', e);
      alert('Sync failed. Check connection/base URL/pairing.');
    } finally {
      setSyncing(false);
    }
  };

  const statusPill = useMemo(() => {
    const good = sync?.mode === 'live' && sync?.paired && sync?.token_present && !!sync?.base_url;
    const warn = sync?.mode === 'offline' && sync?.paired;
    const bad  = !sync?.paired || !sync?.token_present || !sync?.base_url;

    const base =
      'px-2 py-1 rounded-lg text-[11px] font-medium border inline-flex items-center gap-1';
    if (good)
      return <span className={`${base} border-emerald-600/30 bg-emerald-500/15 text-emerald-300`}>
        <Dot /> Live
      </span>;
    if (warn)
      return <span className={`${base} border-amber-600/30 bg-amber-500/15 text-amber-300`}>
        <Dot /> Offline
      </span>;
    return (
      <span className={`${base} border-rose-600/30 bg-rose-500/15 text-rose-300`}>
        <Dot /> Not paired
      </span>
    );
  }, [sync]);

  const lastSyncText = useMemo(() => {
    if (!sync?.last_sync_at) return '—';
    const d = Date.now() - Number(sync.last_sync_at);
    if (d < 15_000) return 'just now';
    if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    return new Date(sync.last_sync_at).toLocaleString();
  }, [sync?.last_sync_at]);

  // Base class for icon buttons
  const iconButtonClass =
    'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-10 w-10 text-muted-foreground';

  return (
    <div
      className="h-screen w-screen overflow-hidden grid bg-background transition-all duration-300 min-h-0 min-w-0"
      style={{ gridTemplateColumns: collapsed ? '76px 1fr' : '260px 1fr' }}
    >
      {/* Sidebar */}
      <aside className="h-full bg-card border-r flex flex-col p-3 transition-all duration-300 min-h-0 min-w-0">
        {/* Brand + controls */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 px-2 h-10 mb-2`}>
          <div className={`font-bold tracking-wide text-lg text-foreground flex items-center gap-2 overflow-hidden ${collapsed ? 'hidden' : 'flex'}`}>
            <span className="flex-shrink-0">🍣</span>
            {!collapsed && <span className="transition-opacity duration-200 whitespace-nowrap">{brand}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button className={`${iconButtonClass} ${collapsed ? 'hidden' : 'inline-flex'}`} title="Toggle theme" onClick={toggleTheme}>
              {theme === 'light' ? <IconMoon className="h-5 w-5" /> : <IconSun className="h-5 w-5" />}
            </button>
            <button className={iconButtonClass} title="Collapse" onClick={toggleCollapsed}>
              {collapsed ? <IconPanelRight className="h-5 w-5" /> : <IconPanelLeft className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Sync mini-panel (only visible expanded) */}
        {!collapsed && (
          <div className="mx-1 mb-2 p-2 rounded-lg border bg-background/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">{statusPill}</div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleMode}
                  className="px-2 py-1 rounded-md text-[11px] border bg-white/5 hover:bg-white/10"
                  title="Toggle live/offline"
                >
                  {sync?.mode === 'live' ? 'Go Offline' : 'Go Live'}
                </button>
                <button
                  onClick={runSync}
                  disabled={sync?.mode !== 'live' || syncing}
                  className="px-2 py-1 rounded-md text-[11px] border bg-primary/20 text-primary-foreground/90 disabled:opacity-50"
                  title="Run sync now"
                >
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <div><span className="opacity-70">Branch:</span> <span className="text-foreground">{sync?.branch_name || '-'}</span></div>
              <div><span className="opacity-70">Last:</span> <span className="text-foreground">{lastSyncText}</span></div>
              <div className="col-span-2 truncate">
                <span className="opacity-70">Server:</span>{' '}
                <span className="text-foreground">{sync?.base_url || '—'}</span>
              </div>
              {!sync?.paired && (
                <div className="col-span-2">
                  <button
                    onClick={() => navigate('/settings')}
                    className="mt-1 w-full px-2 py-1 rounded-md border bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                  >
                    Pair device in Settings
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="mt-4 space-y-1 flex-grow overflow-y-auto nice-scroll min-h-0">
          <SectionLabel hidden={collapsed}>Orders</SectionLabel>
          <NavLink to="/" text="Order Process" icon="🧾" collapsed={collapsed} active={location.pathname === '/'} />
          <NavLink to="/orders" text="Recent Orders" icon="📜" collapsed={collapsed} active={location.pathname === '/orders'} />

          <SectionLabel hidden={collapsed}>Catalog</SectionLabel>
          <NavLink to="/categories" text="Categories" icon="🗂️" collapsed={collapsed} active={location.pathname === '/categories'} />
          <NavLink to="/items" text="Items" icon="📦" collapsed={collapsed} active={location.pathname === '/items'} />
          <NavLink to="/addons" text="Addons" icon="➕" collapsed={collapsed} active={location.pathname === '/addons'} />
          <NavLink to="/promos" text="Promocodes" icon="🏷️" collapsed={collapsed} active={location.pathname === '/promos'} />

          <SectionLabel hidden={collapsed}>System</SectionLabel>
          <NavLink to="/payment-methods" text="Payment Methods" icon="💳" collapsed={collapsed} active={location.pathname === '/payment-methods'} />
          <NavLink to="/locations" text="Locations" icon="📍" collapsed={collapsed} active={location.pathname === '/locations'} />
          <NavLink to="/tables" text="Tables" icon="🪑" collapsed={collapsed} active={location.pathname === '/tables'} />
          <NavLink to="/settings" text="Settings" icon="⚙️" collapsed={collapsed} active={location.pathname === '/settings'} />
        </nav>

        <div className="mt-auto pt-2">
          <NavLink to="/logout" text="Logout" icon="🚪" collapsed={collapsed} active={false} />
        </div>
      </aside>

      {/* Main */}
      <main className="h-full overflow-y-auto nice-scroll min-h-0 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({
  to, text, icon, collapsed, active = false,
}: { to: string; text: string; icon?: string; collapsed?: boolean; active?: boolean }) {
  const baseClasses = 'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors duration-200';
  const activeClasses = 'bg-primary text-primary-foreground';
  const inactiveClasses = 'text-muted-foreground hover:text-foreground hover:bg-muted';
  const collapsedClasses = 'w-10 h-10 justify-center px-0';
  const expandedClasses = 'w-full';

  return (
    <Link
      to={to}
      className={`${baseClasses} ${active ? activeClasses : inactiveClasses} ${collapsed ? collapsedClasses : expandedClasses}`}
    >
      <span className="text-lg flex-shrink-0">{icon || '•'}</span>
      {!collapsed && <span className="text-sm font-medium transition-opacity duration-200 whitespace-nowrap">{text}</span>}
    </Link>
  );
}

function SectionLabel({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  if (hidden) return <div className="h-4" />;
  return <div className="mt-3 mb-1 uppercase tracking-wide text-xs text-muted-foreground px-3">{children}</div>;
}

/* --- Tiny atoms --- */
const Dot = () => <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />;

/* --- Icons --- */
const IconPanelLeft = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" />
  </svg>
);
const IconPanelRight = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" />
  </svg>
);
const IconMoon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);
const IconSun = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" /><path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" /><path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
  </svg>
);
