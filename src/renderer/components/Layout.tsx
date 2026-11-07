import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../src/store';
import { useEffect, useMemo, useRef, useState } from 'react';
import packageJson from '../../../package.json';
import { useToast } from '../components/ToastProvider';
import { useI18n } from '../i18n';
import { LanguageToggle } from './LanguageToggle';
import { Hint } from './Hint';
import { useUpdate } from '../hooks/useUpdate';
import { PERMISSIONS_REFRESH_MS } from '../hooks/usePermissions';
import { announceSynced } from '../utils/syncEvents';
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
  CircleHelp,
  Ellipsis,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
} from '@heroui/react';

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
  // A draft's table taken by another till while this one could not renew its
  // hold (offline, say). Said once, before the cashier places the order.
  const warnHoldsLost = (res: any) => {
    for (const h of res?.holds_lost ?? []) {
      toast.error(
        { code: 'POS_TABLE_TAKEN', params: { held_by: h.held_by || '' }, fallback: '' },
        { title: t('holds.lost', { table: h.table, number: h.number }) }
      );
    }
  };
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

  // Re-read, not read once. Permissions change from the back office through
  // sync while a cashier stays signed in all day; reading them only on mount
  // kept a newly granted Reports menu hidden until they signed out and in.
  useEffect(() => {
    const load = async () => {
      try {
        const u = await window.api.invoke('auth:whoami');
        setUser(u || null);
      } catch {
        setUser(null);
      }
    };
    void load();
    const timer = window.setInterval(load, PERMISSIONS_REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
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


  useEffect(() => {
    if (!sync) return;

    const canAutoSync =
      sync.mode === 'live' &&
      sync.paired &&
      sync.token_present &&
      !!sync.base_url;

    if (!canAutoSync) return;

    // The server allows 240 requests a minute per till (2026-11-05); a sync is ~3.
    const AUTO_SYNC_MIN_INTERVAL = 15_000;

    const id = window.setInterval(async () => {
      if (syncingRef.current) return;

      const last = Number(sync.last_sync_at || 0);
      if (last && Date.now() - last < AUTO_SYNC_MIN_INTERVAL) return;

      try {
        syncingRef.current = true;
        setSyncing(true);
        const res = await window.api.invoke('sync:run');
        announceSynced();
        await refreshStatus();
        warnHoldsLost(res);
      } catch (e) {
        console.error('auto sync:run failed', e);
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    }, 5_000) as unknown as number;

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
      announceSynced();
      await refreshStatus();
      warnHoldsLost(res);
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

  const iconButtonClass = 'ui-icon-btn';

  /*
   * Screen size decides the rail first. Below 1280px wide — old 1024x768 and
   * 1366x768@125% PCs, Android tablets — the menu starts as icons so the order
   * screen keeps its width; the toggle still opens it, for this session only.
   * From 1280px the till's saved choice applies, as before.
   */
  const narrow = useMediaQuery('(max-width: 1279px)');
  const [openOnNarrow, setOpenOnNarrow] = useState(false);
  useEffect(() => setOpenOnNarrow(false), [location.pathname]);
  const rail = narrow ? !openOnNarrow : collapsed;
  const toggleRail = () => (narrow ? setOpenOnNarrow((v) => !v) : toggleCollapsed());

  /*
   * Phones (< 768px) get no side rail: a bottom dock with the main screens
   * and a "More" sheet for everything else.
   */
  const phone = useMediaQuery('(max-width: 767px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => setSheetOpen(false), [location.pathname]);
  useEffect(() => {
    if (!phone) setSheetOpen(false);
  }, [phone]);

  // The restaurant, as in the portal's rail: its initial in a brand square.
  const storeName = sync?.branch_name || APP_VENDOR;
  const storeInitial = (storeName.trim()[0] || 'M').toUpperCase();
  const userLine = [
    user?.name || t('pos.operator'),
    user?.role || (user?.is_admin ? t('nav.role.admin') : t('nav.role.staff')),
  ].join(' · ');

  /*
   * Every link and the permission it is gated on, in ONE place. The rail, the
   * "More" group, the popup, the dock and the phone sheet all read these
   * lists, so they can never disagree about who sees what.
   */
  const path = location.pathname;
  const mainItems: NavItemDef[] = [
    can('orders.create') && { to: '/', text: t('nav.orderProcess'), icon: ShoppingCart },
    can('orders.view_own') && { to: '/orders', text: t('nav.recentOrders'), icon: ReceiptText },
    can('orders.kitchen_view') && { to: '/kitchen', text: t('nav.kitchen'), icon: ChefHat },
    // Closing Report: reports.view
    canReport && { to: '/reports/closing', text: t('nav.closingReport'), icon: BarChart3 },
  ].filter(Boolean) as NavItemDef[];
  const catalogItems: NavItemDef[] = canCatalog
    ? [
        { to: '/categories', text: t('nav.categories'), icon: FolderTree },
        { to: '/items', text: t('nav.items'), icon: Package },
        { to: '/promos', text: t('nav.promocodes'), icon: Ticket },
      ]
    : [];
  const systemItems: NavItemDef[] = canSystemAny
    ? ([
        can('payments.manage') && { to: '/payment-methods', text: t('nav.paymentMethods'), icon: CreditCard },
        can('locations.manage') && { to: '/locations', text: t('nav.locations'), icon: MapPin },
        can('tables.manage') && { to: '/tables', text: t('nav.tables'), icon: Armchair },
        can('settings.manage') && { to: '/settings', text: t('nav.settings'), icon: Settings },
        can('updates.manage') && { to: '/updates', text: t('nav.updates'), icon: ArrowUpCircle, dot: updateReady },
        can('users.permissions') && { to: '/permissions', text: t('nav.permissions'), icon: ShieldCheck },
      ].filter(Boolean) as NavItemDef[])
    : [];
  const moreItems = [...catalogItems, ...systemItems];
  const inMore = moreItems.some((i) => i.to === path);


  const { dir } = useI18n();

  const renderItem = (
    i: NavItemDef,
    opts?: { onClick?: () => void; collapsed?: boolean }
  ) => (
    <NavLink
      key={i.to}
      to={i.to}
      text={i.text}
      icon={i.icon}
      collapsed={opts?.collapsed ?? rail}
      active={path === i.to}
      dot={i.dot}
      onClick={opts?.onClick}
    />
  );

  /* Sync card: one definition, shown in the rail and in the phone sheet. */
  const syncCard = (
    <section
      className='
        rounded-[14px] border border-line bg-surface-2
        px-3 py-2.5 text-xs
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
      {/* Two rows that fit a narrow menu: which branch + sync now; then
          online/offline + when it last synced. The branch line is the one
          fact that must never be ambiguous, so it gets the wide slot. */}
      <div className='flex items-center justify-between gap-2'>
        <Hint placement='bottom' content={sync?.branch_name || ''}>
          <div className='flex min-w-0 items-center gap-1.5 text-xs ink'>
            <GitBranch size={14} strokeWidth={1.8} className='shrink-0 ink-2' />
            <span className='line-clamp-2 break-words font-medium'>
              {sync?.branch_name || t('sync.noBranch')}
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
              aria-label={t('nav.sync')}
              className='ui-icon-btn ui-icon-btn-outline aria-disabled:cursor-not-allowed aria-disabled:opacity-50'
            >
              <RefreshCw
                size={16}
                strokeWidth={1.8}
                className={syncing ? 'animate-spin' : ''}
              />
            </button>
          </Hint>
      </div>
      <div className='mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
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
              className={`ui-chip ${
                sync?.mode === 'live' ? 'ui-chip-green' : 'ui-chip-gray'
              }`}
            >
              {sync?.mode === 'live' ? (
                <Cloud size={13} />
              ) : (
                <CloudOff size={13} />
              )}
              <span>
                {sync?.mode === 'live' ? t('sync.online') : t('sync.offline')}
              </span>
            </div>
          </Hint>

        <Hint placement='bottom' content={lastSyncExact}>
          <div className='flex min-w-0 items-center gap-1 text-xs ink-2'>
            <Timer size={14} strokeWidth={1.8} className='shrink-0' />
            <span className='whitespace-nowrap'>{lastSyncText}</span>
          </div>
        </Hint>
      </div>

      {!sync?.paired && (
        <button
          onClick={() => navigate('/settings')}
          className='ui-btn ui-btn-sm mt-2 w-full bg-[var(--st-amber)] text-white'
        >
          <AlertTriangle size={16} strokeWidth={1.8} />
          <span className='truncate'>{t('sync.notPaired')}</span>
        </button>
      )}
    </section>
  );

  const updateButton = updateReady ? (
    <button
      onClick={() => navigate('/updates')}
      className='ui-btn ui-btn-sm mb-1 w-full bg-[var(--st-green)] text-white'
    >
      <Rocket size={16} strokeWidth={1.8} />
      <span className='truncate'>{t('update.badgeReady')}</span>
    </button>
  ) : null;

  const versionLine = (
    <div className='px-3 pt-1 text-[11px] ink-3 flex items-center justify-between'>
      {/* Version + vendor are identifiers, never localized. */}
      <span className='font-mono' dir='ltr'>
        v{shownVersion}
      </span>
      <span className='uppercase tracking-[0.14em] text-[10px]' dir='ltr'>
        {APP_VENDOR}
      </span>
    </div>
  );

  /* The Catalog + System links, with their section labels. */
  const moreLinks = (opts?: { collapsed?: boolean; onClick?: () => void }) => (
    <>
      {catalogItems.length > 0 && (
        <>
          <SectionLabel>{t('nav.section.catalog')}</SectionLabel>
          {catalogItems.map((i) => renderItem(i, opts))}
        </>
      )}
      {systemItems.length > 0 && (
        <>
          <SectionLabel>{t('nav.section.system')}</SectionLabel>
          {systemItems.map((i) => renderItem(i, opts))}
        </>
      )}
    </>
  );

  /* ---------------- Phone: bottom dock + "More" sheet ---------------- */
  if (phone) {
    const closeSheet = () => setSheetOpen(false);
    return (
      <div className='h-screen w-screen overflow-hidden grid grid-cols-1 bg-background min-h-0 min-w-0'>
        <main
          className='h-full overflow-y-auto nice-scroll min-h-0 min-w-0'
          style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
        >
          <Outlet />
        </main>

        <nav
          aria-label={t('nav.orders')}
          className='fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface shadow-[var(--shadow-2)]'
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className='flex items-stretch justify-around gap-1 px-1 py-1'>
            {mainItems.slice(0, 4).map((i) => (
              <DockItem
                key={i.to}
                to={i.to}
                text={i.text}
                icon={i.icon}
                active={path === i.to}
              />
            ))}
            <DockItem
              text={t('nav.more')}
              icon={Ellipsis}
              active={sheetOpen || inMore}
              dot={updateReady}
              onPress={() => setSheetOpen(true)}
              expanded={sheetOpen}
            />
          </div>
        </nav>

        <Drawer
          isOpen={sheetOpen}
          onOpenChange={setSheetOpen}
          placement='bottom'
          hideCloseButton
          classNames={{
            base: 'ui-popup rounded-b-none max-h-[calc(100dvh-2rem)]',
          }}
        >
          <DrawerContent>
            <DrawerHeader className='flex items-center justify-between gap-2 pb-1 text-base font-semibold ink'>
              <span className='truncate'>{t('nav.more')}</span>
              <button
                type='button'
                className='ui-icon-btn'
                aria-label={t('common.close')}
                onClick={closeSheet}
              >
                <X size={20} strokeWidth={1.8} />
              </button>
            </DrawerHeader>
            <DrawerBody
              className='gap-2 overflow-y-auto nice-scroll'
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            >
              {syncCard}
              {updateButton}
              <nav className='space-y-0.5'>
                {moreLinks({ collapsed: false, onClick: closeSheet })}
              </nav>
              <div className='mt-1 pt-2 border-t border-line space-y-0.5'>
                <LanguageToggle row />
                <button
                  type='button'
                  onClick={toggleTheme}
                  className='ui-nav flex min-h-11 w-full items-center gap-3 px-3 text-sm'
                >
                  {theme === 'light' ? (
                    <IconMoon className='h-5 w-5 shrink-0' />
                  ) : (
                    <IconSun className='h-5 w-5 shrink-0' />
                  )}
                  <span className='truncate'>{t('nav.toggleTheme')}</span>
                </button>
                <NavLink
                  to='/help'
                  text={t('nav.help')}
                  icon={CircleHelp}
                  active={path === '/help'}
                  onClick={closeSheet}
                />
                <NavLink
                  to='/logout'
                  text={t('auth.logout')}
                  icon={LogOut}
                  active={false}
                  onClick={closeSheet}
                />
                {versionLine}
              </div>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }

  return (
    <div
      className='h-screen w-screen overflow-hidden grid bg-background transition-all duration-300 min-h-0 min-w-0'
      style={{ gridTemplateColumns: rail ? '76px 1fr' : '224px 1fr' }}
    >
      {/* Sidebar */}
      <aside
        className={`
          m-2 lg:m-3 me-0 lg:me-0 flex flex-col min-h-0 min-w-0 overflow-hidden
          rounded-[20px] border border-line bg-surface shadow-[var(--shadow-1)]
          ${rail ? 'gap-2 p-2' : 'gap-2 p-3'}
        `}
      >
        {/* Restaurant + operator, as in the portal's rail */}
        <div
          className={`flex items-center gap-2.5 ${
            rail ? 'flex-col px-0' : 'px-0.5'
          }`}
        >
          <Hint content={`${storeName} — ${userLine}`} isDisabled={!rail}>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--brand)] text-[var(--brand-ink)] text-lg font-bold'>
              {storeInitial}
            </div>
          </Hint>

          {!rail && (
            <div className='min-w-0 flex-1'>
              {/* One line each, cut with an ellipsis; the full text is on the
                  hover hint. Wrapping pushed menu items off short screens. */}
              <Hint content={`${storeName} — ${userLine}`}>
                <div className='min-w-0'>
                  <div dir='auto' className='truncate [text-align:match-parent] text-[0.9375rem] font-semibold leading-snug ink'>
                    {storeName}
                  </div>
                  <div dir='auto' className='truncate [text-align:match-parent] text-xs ink-2'>{userLine}</div>
                </div>
              </Hint>
            </div>
          )}

          {/* Controls: collapse only; the theme switch sits by the language. */}
          <div className='flex items-center'>
            <Hint
              content={
                rail ? t('nav.expandSidebar') : t('nav.collapseSidebar')
              }
            >
              <button
                type='button'
                className={iconButtonClass}
                onClick={toggleRail}
                aria-label={rail ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
              >
                {rail ? (
                  <IconPanelRight className='h-5 w-5 flip-rtl' />
                ) : (
                  <IconPanelLeft className='h-5 w-5 flip-rtl' />
                )}
              </button>
            </Hint>
          </div>
        </div>

        {/* Sync card */}
        {!rail && syncCard}

        {/* Nav (RBAC) */}
        <nav className='space-y-0.5 flex-grow overflow-y-auto nice-scroll rail-scroll min-h-0'>
          <SectionLabel hidden={rail}>{t('nav.orders')}</SectionLabel>
          {mainItems.map((i) => renderItem(i))}

          {/* Every item in plain sight, grouped. The Catalog and System links used
              to sit behind a "More" toggle (and a pop-up on the rail), which
              hid half the app from the people who needed it. */}
          {moreLinks()}
        </nav>

        {/* Footer / Language + Logout */}
        <div className='mt-1 pt-2 border-t border-line space-y-0.5'>
          {/* Language lives in the sidebar so it is reachable from every
              screen, not just the order screen. */}
          <div className={rail ? 'pb-1' : 'flex items-center gap-1'}>
            <div className='min-w-0 flex-1'>
              <LanguageToggle collapsed={rail} row={!rail} />
            </div>
            {!rail && (
              <>
              <Hint content={t('nav.toggleTheme')}>
                <button
                  type='button'
                  className={iconButtonClass}
                  aria-label={t('nav.toggleTheme')}
                  onClick={toggleTheme}
                >
                  {theme === 'light' ? (
                    <IconMoon className='h-5 w-5' />
                  ) : (
                    <IconSun className='h-5 w-5' />
                  )}
                </button>
              </Hint>
              {/* Help and sign-out share this row on the full sidebar: two
                  rows of their own pushed menu items off a laptop screen. */}
              <Hint content={t('nav.help')}>
                <Link
                  to='/help'
                  className={iconButtonClass}
                  aria-label={t('nav.help')}
                  aria-current={path === '/help' ? 'page' : undefined}
                >
                  <CircleHelp size={20} strokeWidth={1.8} />
                </Link>
              </Hint>
              <Hint content={t('auth.logout')}>
                <Link to='/logout' className={iconButtonClass} aria-label={t('auth.logout')}>
                  <LogOut size={20} strokeWidth={1.8} />
                </Link>
              </Hint>
              </>
            )}
          </div>

          {/* A downloaded update is announced to every operator, not just
              admins, because whoever closes the till is who applies it. */}
          {!rail && updateButton}

          {/* Help is for everyone, so it is not under System/Settings. On the
              icon rail it keeps its own row; expanded it sits by the language. */}
          {rail && (<>
          <NavLink
            to='/help'
            text={t('nav.help')}
            icon={CircleHelp}
            collapsed={rail}
            active={path === '/help'}
          />
          <NavLink
            to='/logout'
            text={t('auth.logout')}
            icon={LogOut}
            collapsed={rail}
            active={false}
          />
          </>)}
          {/* Tiny version badge */}
          {!rail && versionLine}

          {rail && (
            <div
              className='flex items-center justify-center pb-1 text-[10px] ink-3 font-mono'
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

type NavItemDef = {
  to: string;
  text: string;
  icon: LucideIcon;
  dot?: boolean;
};

/**
 * A phone dock entry: icon over a small label, 44px+ tall. The current screen
 * is the brand-filled pill around the icon with the label in brand-strong.
 * With `to` it is a router Link; without, a button (the "More" sheet opener).
 */
function DockItem({
  to,
  text,
  icon: Icon,
  active,
  dot = false,
  onPress,
  expanded,
}: {
  to?: string;
  text: string;
  icon: LucideIcon;
  active: boolean;
  dot?: boolean;
  onPress?: () => void;
  expanded?: boolean;
}) {
  const cls =
    'group flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[12px] px-1 py-1 text-[11px] font-medium transition-colors duration-150 ' +
    (active ? 'text-[var(--brand-strong)] font-semibold' : 'ink-2');
  const inner = (
    <>
      <span
        className={`relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150 ${
          active
            ? 'bg-[var(--brand)] text-[var(--brand-ink)]'
            : 'group-hover:bg-[var(--hover)]'
        }`}
      >
        <Icon size={22} strokeWidth={1.8} />
        {dot && (
          <span className='absolute top-0 end-2 h-2.5 w-2.5 rounded-full bg-[var(--st-green)] ring-2 ring-[var(--surface)]' />
        )}
      </span>
      <span className='max-w-full text-center leading-tight line-clamp-2 break-words'>{text}</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} aria-current={active ? 'page' : undefined} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type='button'
      onClick={onPress}
      aria-haspopup='dialog'
      aria-expanded={expanded}
      className={cls}
    >
      {inner}
    </button>
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
  onClick,
}: {
  to: string;
  text: string;
  icon?: LucideIcon;
  collapsed?: boolean;
  active?: boolean;
  /** Small marker for "something is waiting here" — e.g. a downloaded update. */
  dot?: boolean;
  onClick?: () => void;
}) {
  // The portal's nav item: the current screen is a brand fill with the
  // brand's own text colour (`.ui-nav[aria-current=page]`), the rest ink-2.
  // Rows are finger-sized (44px) in both shapes.
  const baseClasses = 'ui-nav group relative flex items-center text-sm';
  // Collapsed rows are square and centred so the icons form a straight column.
  const collapsedClasses = 'h-11 w-11 mx-auto justify-center';
  const expandedClasses = 'w-full gap-3 px-3 min-h-11 [@media(pointer:fine)]:min-h-9 nav-row';

  return (
    // The label is the only thing identifying an icon once the rail is
    // collapsed, so it has to survive as a hint and for screen readers.
    <Hint content={text} isDisabled={!collapsed}>
      <Link
        to={to}
        onClick={onClick}
        aria-label={collapsed ? text : undefined}
        aria-current={active ? 'page' : undefined}
        className={`${baseClasses} ${collapsed ? collapsedClasses : expandedClasses}`}
      >
        <span className='relative flex-shrink-0 inline-flex items-center justify-center'>
          {Icon ? <Icon size={20} strokeWidth={1.8} /> : null}
          {dot && (
            <span className='absolute -top-1 -end-1 h-2.5 w-2.5 rounded-full bg-[var(--st-green)] ring-2 ring-[var(--surface)]' />
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
  children?: React.ReactNode;
  hidden?: boolean;
}) {
  // Collapsed, the heading has no room — but the grouping it conveys still
  // does. A rule keeps the sections readable instead of leaving a blank gap
  // that just looks like inconsistent spacing.
  if (hidden)
    return (
      <div className='mx-auto my-2 h-px w-6 bg-[var(--line-strong)]' />
    );
  return (
    <div className='mt-2 mb-0.5 px-3 text-[11px] font-semibold uppercase tracking-wide ink-3 nav-section'>
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
    strokeWidth='1.8'
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
    strokeWidth='1.8'
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
    strokeWidth='1.8'
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
    strokeWidth='1.8'
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

/** True while the media query matches; follows window resizes. */
function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return matches;
}
