import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../src/store';
import { useEffect, useMemo, useRef, useState } from 'react';
import packageJson from '../../../package.json';
import { useToast } from '../components/ToastProvider';
import { useI18n } from '../i18n';
import { LanguageToggle } from './LanguageToggle';
import { Hint } from './Hint';
import { useUpdate } from '../hooks/useUpdate';
import { pushPartialCode } from '../../shared/errors';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  GitBranch,
  Timer,
  AlertTriangle,
  Rocket,
  ShoppingCart,
  ReceiptText,
  BarChart3,
  FolderTree,
  Package,
  Ticket,
  CreditCard,
  MapPin,
  Armchair,
  Settings,
  ArrowUpCircle,
  ShieldCheck,
  ChefHat,
  LogOut,
  type LucideIcon,
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
  permissions?: string[];
  type?: string;
  is_admin?: boolean | number;
};

const APP_VERSION = packageJson.version;
const APP_VENDOR = packageJson.author || 'Majestic POS';

export function Layout() {
  const toast = useToast();
  const { t } = useI18n();
  const collapsed = useStore((s) => s.collapsed);
  const toggleCollapsed = useStore((s) => s.actions.toggleCollapsed);
  const location = useLocation();
  const navigate = useNavigate();

  /* ---------------- Theme (persist via meta store) ---------------- */
  // Seeded from the class main.tsx has already applied, rather than a literal.
  // Hardcoding 'dark' here meant the first render disagreed with the document
  // until the effect below caught up — a visible flash, and the wrong one now
  // that light is the default.
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );

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

  // The backend returns effective permissions (role defaults with explicit
  // per-user grants/denials applied). Role-based bypasses here previously made
  // every unchecked permission ineffective for users whose role was admin.
  const canReport = !!user?.permissions?.includes('reports.view');
  const can = (permission: string) => !!user?.permissions?.includes(permission);

  // Each link is gated on the permission its ROUTE is gated on, so the two
  // agree. This was one any-of-seven flag wrapping all eight links: a till
  // holding nothing but 'tables.manage' was shown Categories, Items, Promos,
  // Payment methods, Locations, Settings and Updates, every one of which
  // bounced straight back off its PermissionRoute.
  const canCatalog = can('catalog.manage');
  const SYSTEM_LINKS = [
    'payments.manage',
    'locations.manage',
    'tables.manage',
    'settings.manage',
    'updates.manage',
    'users.permissions',
  ];
  // The heading only earns its place if something sits under it.
  const canSystemAny = SYSTEM_LINKS.some(can);

  /* ---------------- Software update ---------------- */
  // A downloaded update is worth surfacing on every screen — it only applies
  // when the operator chooses, so nothing happens until they do.
  const update = useUpdate();
  const updateReady = update.state.status === 'ready';
  // The running app is the authority on its own version; package.json is only
  // a fallback for the moment before the bridge answers.
  const shownVersion = update.currentVersion || APP_VERSION;

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
      const res = await window.api.invoke('sync:run');
      await refreshStatus();
      // A sync that pushed 3 of 4 used to report as a plain success. The
      // queued one is not an error — it retries by itself — but the cashier
      // should know the till is not fully caught up.
      const partial = pushPartialCode({
        acked: res?.pushed ?? 0,
        retryable: res?.failed ?? 0,
      });
      if (partial) toast.error(partial);
    } catch (e) {
      // Sync failing is usually "no connection", which is a normal state for a
      // till — the translated copy says so and offers the retry.
      toast.error(e, { title: t('sync.failed'), onRetry: () => void runSync() });
    } finally {
      setSyncing(false);
    }
  };

  const lastSyncText = useMemo(() => {
    if (!sync?.last_sync_at) return '—';
    const d = Date.now() - Number(sync.last_sync_at);
    if (d < 15_000) return t('sync.justNow');
    if (d < 60_000) return t('sync.secondsAgo', { n: Math.floor(d / 1000) });
    if (d < 3_600_000) return t('sync.minutesAgo', { n: Math.floor(d / 60_000) });
    if (d < 86_400_000) return t('sync.hoursAgo', { n: Math.floor(d / 3_600_000) });
    return t('sync.daysAgo', { n: Math.floor(d / 86_400_000) });
  }, [sync?.last_sync_at, t]);

  /** The stamp behind the relative one, for the hover. */
  const lastSyncExact = useMemo(
    () =>
      sync?.last_sync_at
        ? new Date(Number(sync.last_sync_at)).toLocaleString()
        : '',
    [sync?.last_sync_at]
  );

  const iconButtonClass =
    'inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-colors hover:bg-default-100 hover:text-foreground h-9 w-9 text-default-700';

  return (
    <div
      className='h-screen w-screen overflow-hidden grid bg-background transition-all duration-300 min-h-0 min-w-0'
      style={{ gridTemplateColumns: collapsed ? '64px 1fr' : '244px 1fr' }}
    >
      {/* Sidebar */}
      <aside
        className={`
          h-full border-e border-default-200 flex flex-col min-h-0 min-w-0
          ${collapsed ? 'gap-2 p-2' : 'gap-2 p-2.5'}
          bg-content1
        `}
      >
        {/* User header + controls */}
        <div
          className={`flex items-center gap-2 ${
            collapsed ? 'flex-col px-0' : 'px-1'
          }`}
        >
          {/* Collapsed, the sidebar is the only place the operator is named —
              the POS header used to repeat it, which meant the name appeared
              twice whenever the sidebar was open. Keeping the avatar here lets
              that duplicate go without losing the information. */}
          {collapsed && (
            <Hint
              content={`${user?.name || t('pos.operator')}${
                user?.role ? ` — ${user.role}` : ''
              }`}
            >
              <div className='w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xs uppercase shrink-0'>
                {(user?.name || 'U').slice(0, 2)}
              </div>
            </Hint>
          )}

          {!collapsed && (
            <div
              className={`
              flex items-center gap-2.5 overflow-hidden
              rounded-xl px-2.5 py-1.5
              bg-content1 shadow-sm border border-default-200
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
                  {user?.name || t('pos.operator')}
                </span>
                <span className='text-[10px] uppercase tracking-[0.16em] text-default-700 truncate'>
                  {user?.role ||
                    (user?.is_admin ? t('nav.role.admin') : t('nav.role.staff'))}
                </span>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className='flex flex-col gap-1 items-center'>
            <Hint content={t('nav.toggleTheme')}>
              <button
                className={`${iconButtonClass} ${collapsed ? 'hidden' : ''}`}
                onClick={toggleTheme}
              >
                {theme === 'light' ? (
                  <IconMoon className='h-5 w-5' />
                ) : (
                  <IconSun className='h-5 w-5' />
                )}
              </button>
            </Hint>
            <Hint
              content={
                collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')
              }
            >
              <button className={iconButtonClass} onClick={toggleCollapsed}>
                {collapsed ? (
                  <IconPanelRight className='h-5 w-5 flip-rtl' />
                ) : (
                  <IconPanelLeft className='h-5 w-5 flip-rtl' />
                )}
              </button>
            </Hint>
          </div>
        </div>

        {/* Sync card */}
        {!collapsed && (
          <section
            className='
              rounded-xl border border-default-200 bg-content1
              px-2.5 py-2 text-[11px] shadow-sm
            '
          >
            {/*
              The branch gets its own full-width line.
              Previously the branch name, the last-sync time, a status pill and
              the sync button all shared one row inside a 260px sidebar, and the
              branch was capped at max-w-[140px] — so "Habiba Sweets - Salmiya"
              rendered as "Habiba Sweets - " and the operator could not tell
              which branch the till was posting to. That is the one fact on this
              card that must never be ambiguous.
            */}
            <div className='flex items-center justify-between gap-2 mb-1'>
              <Hint placement='bottom' content={lastSyncExact}>
                <div className='flex min-w-0 items-center gap-1 text-[10px] text-default-700'>
                  <Timer size={11} className='shrink-0' />
                  <span className='truncate'>{lastSyncText}</span>
                </div>
              </Hint>

              {/* RIGHT: status + sync button */}
              <div className='flex items-center gap-2 shrink-0'>
                <Hint
                  placement='bottom'
                  content={
                    <span className='block'>
                      {sync?.mode === 'live'
                        ? t('sync.onlineHint')
                        : t('sync.offlineHint')}
                      {sync?.base_url && (
                        <span className='mt-0.5 block text-default-700'>
                          {sync.base_url}
                        </span>
                      )}
                    </span>
                  }
                >
                  <div
                    className={[
                      'inline-flex h-7 px-3 items-center justify-center gap-1 rounded-full border text-[10px] font-medium',
                      sync?.mode === 'live'
                        ? 'bg-success text-success-foreground border-success'
                        : 'bg-default-100 text-foreground border-default-200',
                    ].join(' ')}
                  >
                    {sync?.mode === 'live' ? (
                      <Cloud size={13} />
                    ) : (
                      <CloudOff size={13} />
                    )}
                    <span>
                      {sync?.mode === 'live'
                        ? t('sync.online')
                        : t('sync.offline')}
                    </span>
                  </div>
                </Hint>

                <Hint
                  placement='bottom'
                  content={
                    sync?.mode === 'live' ? t('nav.sync') : t('sync.cannotSync')
                  }
                >
                  <button
                    onClick={() => {
                      if (sync?.mode !== 'live' || syncing) return;
                      runSync();
                    }}
                    aria-disabled={sync?.mode !== 'live' || syncing}
                    className={[
                      'inline-flex h-8 w-8 items-center justify-center rounded-full border text-[10px]',
                      'bg-foreground text-background border-transparent hover:bg-foreground/90',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      // The button sits on the card, so the ring is offset off
                      // that surface rather than Tailwind's default white.
                      'focus-visible:ring-offset-1 focus-visible:ring-offset-content1',
                      'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
                      'aria-disabled:hover:bg-foreground',
                    ].join(' ')}
                  >
                    <RefreshCw
                      size={13}
                      className={syncing ? 'animate-spin' : ''}
                    />
                  </button>
                </Hint>
              </div>
            </div>

            {/* Branch: the whole width of the card, and the whole name on
                hover on the rare one that still outruns it. */}
            <Hint placement='bottom' content={sync?.branch_name || ''}>
              <div className='flex min-w-0 items-center gap-1.5 text-[11px] text-foreground'>
                <GitBranch size={11} className='shrink-0 text-default-700' />
                <span className='truncate font-medium'>
                  {sync?.branch_name || t('sync.noBranch')}
                </span>
              </div>
            </Hint>

            {!sync?.paired && (
              <button
                onClick={() => navigate('/settings')}
                className='
                  mt-2 flex h-6 w-full items-center justify-center gap-1.5 rounded-md
                  border border-warning bg-warning px-2 text-[10px] font-semibold
                  text-warning-foreground hover:bg-warning/90
                '
              >
                <AlertTriangle size={11} />
                <span className='truncate'>{t('sync.notPaired')}</span>
              </button>
            )}
          </section>
        )}

        {/* Nav (RBAC) */}
        <nav className='space-y-0.5 flex-grow overflow-y-auto nice-scroll rail-scroll min-h-0'>
          <SectionLabel hidden={collapsed}>{t('nav.orders')}</SectionLabel>
          {can('orders.create') && <NavLink
            to='/'
            text={t('nav.orderProcess')}
            icon={ShoppingCart}
            collapsed={collapsed}
            active={location.pathname === '/'}
          />}
          {can('orders.view_own') && <NavLink
            to='/orders'
            text={t('nav.recentOrders')}
            icon={ReceiptText}
            collapsed={collapsed}
            active={location.pathname === '/orders'}
          />}
          {can('orders.kitchen_view') && <NavLink to='/kitchen' text={t('nav.kitchen')} icon={ChefHat} collapsed={collapsed} active={location.pathname === '/kitchen'} />}
          {/* Closing Report → admin only */}{' '}
          {canReport && <NavLink to='/reports/closing' text={t('nav.closingReport')} icon={BarChart3} collapsed={collapsed} active={location.pathname === '/reports/closing'} />}
          {canCatalog && (
            <>
              <SectionLabel hidden={collapsed}>
                {t('nav.section.catalog')}
              </SectionLabel>
              <NavLink
                to='/categories'
                text={t('nav.categories')}
                icon={FolderTree}
                collapsed={collapsed}
                active={location.pathname === '/categories'}
              />
              <NavLink
                to='/items'
                text={t('nav.items')}
                icon={Package}
                collapsed={collapsed}
                active={location.pathname === '/items'}
              />
              <NavLink
                to='/promos'
                text={t('nav.promocodes')}
                icon={Ticket}
                collapsed={collapsed}
                active={location.pathname === '/promos'}
              />
            </>
          )}

          {canSystemAny && (
            <>
              <SectionLabel hidden={collapsed}>
                {t('nav.section.system')}
              </SectionLabel>
              {can('payments.manage') && (
                <NavLink
                  to='/payment-methods'
                  text={t('nav.paymentMethods')}
                  icon={CreditCard}
                  collapsed={collapsed}
                  active={location.pathname === '/payment-methods'}
                />
              )}
              {can('locations.manage') && (
                <NavLink
                  to='/locations'
                  text={t('nav.locations')}
                  icon={MapPin}
                  collapsed={collapsed}
                  active={location.pathname === '/locations'}
                />
              )}
              {can('tables.manage') && (
                <NavLink
                  to='/tables'
                  text={t('nav.tables')}
                  icon={Armchair}
                  collapsed={collapsed}
                  active={location.pathname === '/tables'}
                />
              )}
              {can('settings.manage') && (
                <NavLink
                  to='/settings'
                  text={t('nav.settings')}
                  icon={Settings}
                  collapsed={collapsed}
                  active={location.pathname === '/settings'}
                />
              )}
              {can('updates.manage') && (
                <NavLink
                  to='/updates'
                  text={t('nav.updates')}
                  icon={ArrowUpCircle}
                  collapsed={collapsed}
                  active={location.pathname === '/updates'}
                  dot={updateReady}
                />
              )}
              {can('users.permissions') && (
                <NavLink
                  to='/permissions'
                  text={t('nav.permissions')}
                  icon={ShieldCheck}
                  collapsed={collapsed}
                  active={location.pathname === '/permissions'}
                />
              )}
            </>
          )}
        </nav>

        {/* Footer / Language + Logout */}
        <div className='mt-1 pt-1.5 border-t border-default-200 dark:border-default-200'>
          {/* Language lives in the sidebar so it is reachable from every
              screen, not just the order screen. */}
          <div className={collapsed ? 'pb-1' : ''}>
            <LanguageToggle collapsed={collapsed} row={!collapsed} />
          </div>

          {/* A downloaded update is announced to every operator, not just
              admins, because whoever closes the till is who applies it. */}
          {updateReady && !collapsed && (
            <button
              onClick={() => navigate('/updates')}
              className='
                mb-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border
                border-success/40 bg-success/15 px-2 text-[10px] font-semibold
                text-success hover:bg-success/25
              '
            >
              <Rocket size={11} />
              <span className='truncate'>{t('update.badgeReady')}</span>
            </button>
          )}

          <NavLink
            to='/logout'
            text={t('auth.logout')}
            icon={LogOut}
            collapsed={collapsed}
            active={false}
          />
          {/* Tiny version badge */}
          {!collapsed && (
            <div className='px-2.5 pt-0.5 text-[10px] text-default-700 flex items-center justify-between'>
              {/* Version + vendor are identifiers, never localized. */}
              <span className='font-mono' dir='ltr'>
                v{shownVersion}
              </span>
              <span className='uppercase tracking-[0.14em] text-[10px]' dir='ltr'>
                {APP_VENDOR}
              </span>
            </div>
          )}

          {collapsed && (
            <div
              className='flex items-center justify-center pb-1 text-[9px] text-default-700 font-mono'
              dir='ltr'
            >
              v{shownVersion}
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

/**
 * A sidebar entry.
 *
 * The icon is a component, not an emoji. Emoji were the single biggest reason
 * the collapsed rail looked broken: they are rendered by the OS font, so they
 * ignore `currentColor` (staying full-colour on a dark active row), sit on a
 * text baseline rather than centring in their box, and vary in width between
 * glyphs — so a column of them is never actually aligned. A real icon takes the
 * row's colour and occupies a predictable square.
 */
function NavLink({
  to,
  text,
  icon: Icon,
  collapsed,
  active = false,
  dot = false,
}: {
  to: string;
  text: string;
  icon?: LucideIcon;
  collapsed?: boolean;
  active?: boolean;
  /** Small marker for "something is waiting here" — e.g. a downloaded update. */
  dot?: boolean;
}) {
  const baseClasses =
    'group relative flex items-center rounded-xl text-sm font-medium transition-colors duration-200';
  const activeClasses =
    // Inverts against the surface in both themes, so the active row is a dark
    // pill on light and a light pill on dark without a `dark:` pair. The pair
    // it replaces had drifted: a sweep rewrote `dark:text-slate-900` to
    // `dark:text-foreground`, which in dark mode is light ink on the light
    // pill — the active nav item was unreadable.
    'bg-foreground text-background shadow-sm';
  const inactiveClasses =
    'text-default-700 hover:text-foreground hover:bg-default-100';
  // Collapsed rows are square and centred so the icons form a straight column.
  const collapsedClasses = 'h-10 w-10 mx-auto justify-center';
  const expandedClasses = 'w-full gap-2.5 px-2.5 py-2 nav-row';

  return (
    // The label is the only thing identifying an icon once the rail is
    // collapsed, so it has to survive as a hint and for screen readers.
    <Hint content={text} isDisabled={!collapsed}>
      <Link
        to={to}
        aria-label={collapsed ? text : undefined}
        className={`${baseClasses} ${active ? activeClasses : inactiveClasses} ${
          collapsed ? collapsedClasses : expandedClasses
        }`}
      >
        <span className='relative flex-shrink-0 inline-flex items-center justify-center'>
          {Icon ? <Icon size={18} strokeWidth={1.9} /> : null}
          {dot && (
            <span className='absolute -top-1 -end-1 h-2 w-2 rounded-full bg-success ring-2 ring-content1' />
          )}
        </span>
        {!collapsed && <span className='truncate'>{text}</span>}
      </Link>
    </Hint>
  );
}

function SectionLabel({
  children,
  hidden,
}: {
  children: React.ReactNode;
  hidden?: boolean;
}) {
  // Collapsed, the heading has no room — but the grouping it conveys still
  // does. A rule keeps the sections readable instead of leaving a blank gap
  // that just looks like inconsistent spacing.
  if (hidden)
    return (
      <div className='mx-auto my-2 h-px w-6 bg-default-200' />
    );
  return (
    <div className='mt-2.5 mb-0.5 uppercase tracking-wide text-[10px] text-default-700 px-2.5 nav-section'>
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
