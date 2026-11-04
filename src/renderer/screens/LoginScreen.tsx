// src/renderer/screens/LoginScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Switch } from '@heroui/react';
import { BrandHeader } from '../components/BrandHeader';
import { LanguageToggle } from '../components/LanguageToggle';
import { Wifi, WifiOff, Link2, RefreshCcw, TriangleAlert } from 'lucide-react';
import { unpairDevice, useConfirmUnpair } from '../components/useConfirmUnpair';
import { HelpButton } from '../help/HelpButton';
import { useI18n } from '../i18n';

import { useErrorLine } from '../utils/posError';
import { AppVersion } from '../components/AppVersion';

type PosMode = 'live' | 'offline';

type SyncStatus = {
  mode: PosMode;
  last_sync_at: number;
  base_url: string;
  cursor: number;
  paired: boolean;
  token_present: boolean;
  device_id: string | null;
  branch_name: string;
  branch_id: number;
  unsynced: number;
};

const fmtTime = (ms?: number) => {
  if (!ms) return '—';
  try {
    const d = new Date(Number(ms));
    return d.toLocaleString();
  } catch {
    return '—';
  }
};

/**
 * Renders `*emphasised*` runs of a translated string as <b>. Keeping the
 * markers inside the string lets the Arabic translation put the emphasis where
 * Arabic word order needs it instead of where English happened to put it.
 */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*]+\*)/g).map((part, i) =>
        part.length > 2 && part.startsWith('*') && part.endsWith('*') ? (
          <b key={i}>{part.slice(1, -1)}</b>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export function LoginScreen() {
  const [users, setUsers] = useState<
    { id: number; name: string; role?: string; email?: string }[]
  >([]);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(true);
  const confirmUnpair = useConfirmUnpair();
  const { t } = useI18n();
  const errLine = useErrorLine();

  const [err, setErr] = useState<string | null>(null);
  const [branch, setBranch] = useState<{ id: number | null; name: string }>({
    id: null,
    name: '',
  });

  const [pwdLoading, setPwdLoading] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const [mode, setMode] = useState<PosMode>('live');
  const [syncOn, setSyncOn] = useState<boolean>(true);
  const [syncRunning, setSyncRunning] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  // 🔹 NEW: loading state for Unpair button
  const [unpairLoading, setUnpairLoading] = useState(false);

  const nav = useNavigate();
  const hasUsers = useMemo(() => users.length > 0, [users]);

  useEffect(() => {
    (async () => {
      const saved = localStorage.getItem('pos.last_login');
      if (saved) setLogin(saved);

      const s = await (window as any).pos.auth.status();
      // Nobody can sign in to a till with no server and no staff.
      if (!s.paired) {
        nav('/pair', { replace: true });
        return;
      }
      setBranch({ id: s.branch_id ?? null, name: s.branch_name ?? '' });

      const list = await (window as any).pos.auth.listUsers();
      setUsers(Array.isArray(list) ? list : []);

      try {
        const st = (await (window as any).api.invoke(
          'sync:status'
        )) as SyncStatus;
        const m: PosMode = st?.mode === 'offline' ? 'offline' : 'live';
        setMode(m);
        setSyncOn(m === 'live');
        setStatus(st);
      } catch {
        setMode('live');
        setSyncOn(true);
      }
    })();
  }, []);

  const refreshStatus = async () => {
    try {
      const st = (await (window as any).api.invoke(
        'sync:status'
      )) as SyncStatus;
      setStatus(st);
      setMode(st.mode === 'offline' ? 'offline' : 'live');
      setSyncOn(st.mode === 'live');
    } catch {}
  };

  const toggleSync = async (val: boolean) => {
    setSyncOn(val);
    const newMode: PosMode = val ? 'live' : 'offline';
    setMode(newMode);
    try {
      await (window as any).api.invoke('sync:setMode', newMode);
      if (val) await doManualSync();
      else await refreshStatus();
    } catch (e: any) {
      setErr(errLine(e));
    }
  };

  const changeMode = async (val: PosMode) => {
    setMode(val);
    setSyncOn(val === 'live');
    try {
      await (window as any).api.invoke('sync:setMode', val);
      await refreshStatus();
    } catch (e: any) {
      setErr(errLine(e));
    }
  };

  const doManualSync = async () => {
    setErr(null);
    setSyncRunning(true);
    try {
      const res = await (window as any).api.invoke('sync:run');
      if (res?.reason === 'not_configured') {
        // optional message
      } else if (res?.reason === 'offline') {
        // ignore
      } else if (res?.reason === 'error') {
        setErr(res.message || t('auth.errSync'));
      }
    } catch (e: any) {
      setErr(errLine(e));
    } finally {
      setSyncRunning(false);
      await refreshStatus();
    }
  };

  const doPassword = async () => {
    setErr(null);
    setPwdLoading(true);
    try {
      if (rememberLogin) {
        localStorage.setItem('pos.last_login', login.trim());
      } else {
        localStorage.removeItem('pos.last_login');
      }
      await (window as any).pos.auth.loginWithPassword(login.trim(), password);
      nav('/', { replace: true });
    } catch (e: any) {
      setErr(errLine(e));
    } finally {
      setPwdLoading(false);
    }
  };

  const onPwdKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') doPassword();
    setCapsOn(
      (e.nativeEvent as KeyboardEvent).getModifierState?.('CapsLock') ?? false
    );
  };

  const doUnpair = async () => {
    const choice = await confirmUnpair();
    if (!choice) return;

    setErr(null);
    setUnpairLoading(true);

    try {
      await unpairDevice(choice.wipe);

      setStatus(null);
      setBranch({ id: null, name: '' });
      setMode('live');
      setSyncOn(true);

      nav('/pair', { replace: true });
    } catch (e: any) {
      setErr(errLine(e));
    } finally {
      setUnpairLoading(false);
    }
  };

  const paired = !!status?.paired;
  const baseUrl = status?.base_url || '';
  const unsynced = status?.unsynced ?? 0;
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const handleQuickUserClick = (u: { name: string; email?: string }) => {
    if (u.email) {
      setLogin(u.email);
    } else {
      setLogin(u.name);
    }
    setPassword('');
    setErr(null);
    const el = document.querySelector<HTMLInputElement>(
      'input[type="password"]'
    );
    if (el) el.focus();
  };

  const branchSubtitle =
    t('auth.branchSubtitle', { name: branch.name || '-' }) +
    (branch.id ? t('auth.branchIdSuffix', { id: branch.id }) : '');

  const modes: { value: PosMode; label: string }[] = [
    { value: 'live', label: t('auth.modeLiveOption') },
    { value: 'offline', label: t('auth.modeOfflineOption') },
  ];

  return (
    <div className='min-h-dvh flex items-center justify-center bg-canvas p-3 sm:p-4 lg:p-6'>
      <div className='ui-card w-full max-w-5xl min-w-0'>
        {/* HEADER */}
        <div className='flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between lg:px-6'>
          <BrandHeader
            title='Majestic POS'
            subtitle={branchSubtitle}
            align='left'
          />

          <div className='flex flex-wrap items-center gap-2 sm:justify-end'>
            <LanguageToggle compact />
            <HelpButton />
            <span
              className={`ui-chip ${mode === 'live' ? 'ui-chip-green' : 'ui-chip-amber'}`}
            >
              {mode === 'live' ? t('auth.modeLive') : t('auth.modeOffline')}
            </span>
            <span
              className={`ui-chip ${paired ? 'ui-chip-green' : 'ui-chip-amber'}`}
            >
              <Link2 size={14} strokeWidth={1.8} />
              {paired ? t('auth.paired') : t('auth.notPaired')}
            </span>
            <span
              className={`ui-chip ${online ? 'ui-chip-green' : 'ui-chip-gray'}`}
            >
              {online ? (
                <Wifi size={14} strokeWidth={1.8} />
              ) : (
                <WifiOff size={14} strokeWidth={1.8} />
              )}
              {online ? t('auth.online') : t('auth.deviceOffline')}
            </span>
          </div>
        </div>

        <div className='p-4 lg:p-6'>
          <div className='grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
            {/* LEFT: LOGIN */}
            <div className='min-w-0 space-y-5'>
              <div>
                <div className='mb-1 text-xl font-semibold ink'>
                  {t('auth.login')}
                </div>
                <p className='mb-4 text-xs ink-2'>{t('auth.signInHelp')}</p>

                <Input
                  label={t('auth.email')}
                  variant='bordered'
                  size='lg'
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder='staff@restaurant.com'
                  type='email'
                  dir='ltr'
                  classNames={{
                    inputWrapper: 'ui-input',
                    label: 'text-sm font-semibold',
                    input: 'text-sm text-start',
                  }}
                />

                <div className='mt-4 space-y-2'>
                  <Input
                    label={t('auth.password')}
                    variant='bordered'
                    size='lg'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPwd ? 'text' : 'password'}
                    onKeyDown={onPwdKeyDown}
                    placeholder={t('auth.passwordPlaceholder')}
                    classNames={{
                      inputWrapper: 'ui-input',
                      label: 'text-sm font-semibold',
                      input: 'text-sm',
                    }}
                    endContent={
                      <button
                        type='button'
                        className='ui-btn ui-btn-ghost ui-btn-sm'
                        onClick={() => setShowPwd((v) => !v)}
                      >
                        {showPwd ? t('auth.hide') : t('auth.show')}
                      </button>
                    }
                  />

                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs'>
                      {capsOn && (
                        <span className='font-semibold text-warning'>
                          {t('auth.capsLock')}
                        </span>
                      )}
                    </span>
                    <label className='flex min-h-11 items-center gap-2 text-xs ink-2'>
                      <input
                        type='checkbox'
                        className='accent-primary h-4 w-4'
                        checked={rememberLogin}
                        onChange={(e) => setRememberLogin(e.target.checked)}
                      />
                      {t('auth.rememberEmail')}
                    </label>
                  </div>
                </div>

                <Button
                  fullWidth
                  color='primary'
                  size='lg'
                  className='mt-4 font-semibold'
                  isDisabled={pwdLoading || !login.trim() || !password}
                  isLoading={pwdLoading}
                  onPress={doPassword}
                >
                  {pwdLoading ? t('auth.signingIn') : t('auth.login')}
                </Button>

                <p className='mt-3 text-xs ink-3'>{t('auth.branchRuleNote')}</p>
              </div>

              {/* QUICK USERS */}
              <div>
                <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
                  <div className='text-xs font-semibold uppercase tracking-wide ink-2'>
                    {t('auth.quickUsers')}
                  </div>
                  {hasUsers && (
                    <span className='text-xs ink-3'>
                      {t('auth.quickUsersHint')}
                    </span>
                  )}
                </div>
                {hasUsers ? (
                  <div className='grid max-h-64 gap-2 overflow-auto pe-1 sm:grid-cols-2'>
                    {users.map((u) => (
                      <button
                        key={u.id}
                        type='button'
                        onClick={() => handleQuickUserClick(u)}
                        className='flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-[11px] border border-line-strong bg-surface px-3 py-2 text-start transition-colors hover:bg-surface-2'
                      >
                        <span className='truncate text-sm font-semibold ink'>
                          {u.name}
                        </span>
                        {u.role && (
                          <span className='ui-chip ui-chip-outline shrink-0'>
                            {u.role}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className='text-xs ink-3'>{t('auth.noUsers')}</span>
                )}
              </div>
            </div>

            {/* RIGHT: STATUS / SYNC */}
            <div className='min-w-0 space-y-4'>
              <div className='rounded-2xl border border-line bg-surface-2 p-4'>
                <div className='mb-3 text-base font-semibold ink'>
                  {t('auth.deviceStatus')}
                </div>

                <div className='mb-4 space-y-2 text-xs ink-2'>
                  <div className='flex justify-between gap-2'>
                    <span>{t('auth.server')}</span>
                    <span className='min-w-0 truncate text-end ink' dir='ltr'>
                      {baseUrl
                        ? baseUrl.replace(/^https?:\/\//, '')
                        : t('auth.notConfigured')}
                    </span>
                  </div>
                  <div className='flex justify-between gap-2'>
                    <span>{t('auth.lastSync')}</span>
                    <span className='text-end ink' dir='ltr'>
                      {fmtTime(status?.last_sync_at)}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-2'>
                    <span>{t('auth.outbox')}</span>
                    <span
                      className={`ui-chip ${unsynced > 0 ? 'ui-chip-amber' : 'ui-chip-green'}`}
                    >
                      {unsynced > 0
                        ? t('auth.pendingCount', { n: unsynced })
                        : t('auth.upToDate')}
                    </span>
                  </div>
                </div>

                <div className='border-t border-line pt-3'>
                  <div className='flex flex-wrap items-center gap-3 text-xs'>
                    <Switch
                      size='sm'
                      isSelected={syncOn}
                      onValueChange={toggleSync}
                      aria-label={t('auth.syncToggle')}
                    >
                      {t('auth.sync')}
                    </Switch>

                    <div className='flex items-center gap-2'>
                      <span className='ink-2'>{t('auth.mode')}</span>
                      <div className='ui-seg' role='group' aria-label={t('auth.mode')}>
                        {modes.map((m) => (
                          <button
                            key={m.value}
                            type='button'
                            aria-pressed={mode === m.value}
                            onClick={() => changeMode(m.value)}
                            className='ui-seg-item'
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Button
                      size='md'
                      variant='bordered'
                      startContent={<RefreshCcw size={16} strokeWidth={1.8} />}
                      className='ms-auto border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                      isDisabled={syncRunning || mode !== 'live'}
                      isLoading={syncRunning}
                      onPress={doManualSync}
                    >
                      {t('nav.sync')}
                    </Button>
                  </div>

                  {/* Unpair button */}
                  <div className='mt-3 flex justify-end'>
                    <Button
                      size='md'
                      color='danger'
                      variant='light'
                      className='font-semibold'
                      isLoading={unpairLoading}
                      onPress={doUnpair}
                    >
                      {t('auth.unpairDevice')}
                    </Button>
                  </div>
                </div>
              </div>

              <div className='space-y-1.5 rounded-2xl border border-line bg-surface-2 p-4 text-xs ink-2'>
                <div className='mb-1 text-xs font-semibold uppercase tracking-wide ink-2'>
                  {t('auth.shiftTips')}
                </div>
                <div>
                  • <Rich text={t('auth.tipOffline')} />
                </div>
                <div>
                  • <Rich text={t('auth.tipBackOnline')} />
                </div>
                <div>
                  • <Rich text={t('auth.tipPair')} />
                </div>
              </div>
            </div>
          </div>

          {err && (
            <div className='ui-notice mt-4 text-sm' role='alert'>
              <TriangleAlert
                size={18}
                strokeWidth={1.8}
                className='mt-0.5 shrink-0 text-danger'
              />
              <span className='min-w-0 break-words'>{err}</span>
            </div>
          )}
        </div>

        <div className='flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 lg:px-6'>
          <Button
            variant='light'
            size='md'
            onPress={() => window.history.back()}
          >
            {t('auth.back')}
          </Button>
          <AppVersion />
          <div className='flex flex-wrap gap-2'>
            <Button variant='light' size='md' onPress={() => nav('/pair')}>
              {t('auth.pairDevice')}
            </Button>
            <Button
              variant='bordered'
              size='md'
              className='border border-[var(--line-strong)] bg-[var(--surface)]'
              onPress={() => window.location.reload()}
              startContent={<RefreshCcw size={16} strokeWidth={1.8} />}
            >
              {t('auth.reload')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
