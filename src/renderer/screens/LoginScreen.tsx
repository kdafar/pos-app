// src/renderer/screens/LoginScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardFooter,
  Chip,
  Input,
  Switch,
  Divider,
} from '@heroui/react';
import { BrandHeader } from '../components/BrandHeader';
import { Wifi, WifiOff, Link2, RefreshCcw } from 'lucide-react';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';

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

export function LoginScreen() {
  const [users, setUsers] = useState<
    { id: number; name: string; role?: string; email?: string }[]
  >([]);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(true);
  const confirm = useConfirmDialog();

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
      setErr(e?.message || 'Failed to change mode');
    }
  };

  const changeMode = async (val: PosMode) => {
    setMode(val);
    setSyncOn(val === 'live');
    try {
      await (window as any).api.invoke('sync:setMode', val);
      await refreshStatus();
    } catch (e: any) {
      setErr(e?.message || 'Failed to change mode');
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
        setErr(res.message || 'Sync failed');
      }
    } catch (e: any) {
      setErr(e?.message || 'Sync failed');
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
      setErr(e?.message || 'Invalid credentials');
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
    const ok = await confirm({
      title: 'Unpair this device?',
      message: (
        <div className='space-y-1 text-sm'>
          <p>
            This will disconnect this POS from the online server and clear the
            paired branch for this machine.
          </p>
          <p className='text-xs text-slate-500'>
            You can pair again later using a new code from the admin panel.
          </p>
        </div>
      ),
      confirmLabel: 'Yes, unpair',
      cancelLabel: 'Keep paired',
      tone: 'danger',
    });

    if (!ok) return;

    setErr(null);
    setUnpairLoading(true);

    try {
      await (window as any).api.invoke('auth:unpair');

      setStatus(null);
      setBranch({ id: null, name: '' });
      setMode('live');
      setSyncOn(true);

      nav('/pair', { replace: true });
    } catch (e: any) {
      setErr(e?.message || 'Failed to unpair device');
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

  return (
    <div className='min-h-screen flex items-center justify-center bg-slate-100 px-4'>
      <Card className='w-full max-w-5xl shadow-2xl border border-slate-200 bg-white'>
        {/* HEADER */}
        <CardHeader className='flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-4'>
          <BrandHeader
            title='Majestic POS'
            subtitle={`Branch: ${branch.name || '-'}${
              branch.id ? ` (ID ${branch.id})` : ''
            }`}
            align='left'
          />

          <div className='flex flex-wrap gap-2 justify-end'>
            <Chip
              variant='bordered'
              color={mode === 'live' ? 'success' : 'warning'}
              size='sm'
              className='font-medium'
            >
              {mode === 'live' ? 'Mode: Live' : 'Mode: Offline'}
            </Chip>
            <Chip
              variant='bordered'
              color={paired ? 'success' : 'warning'}
              size='sm'
              startContent={<Link2 className='w-3 h-3' />}
            >
              {paired ? 'Paired' : 'Not paired'}
            </Chip>
            <Chip
              variant='bordered'
              color={online ? 'primary' : 'default'}
              size='sm'
              startContent={
                online ? (
                  <Wifi className='w-3 h-3' />
                ) : (
                  <WifiOff className='w-3 h-3' />
                )
              }
            >
              {online ? 'Online' : 'Offline (device)'}
            </Chip>
          </div>
        </CardHeader>

        <CardBody className='pt-5 pb-4'>
          <div className='grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
            {/* LEFT: LOGIN */}
            <div className='space-y-5'>
              <div>
                <div className='text-base font-semibold mb-1.5 text-slate-900'>
                  Sign in
                </div>
                <p className='text-xs text-slate-500 mb-4'>
                  Staff tap their name below and enter password. Admins can type
                  email manually.
                </p>

                <Input
                  label='Email'
                  variant='bordered'
                  size='lg'
                  radius='md'
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder='staff@restaurant.com'
                  type='email'
                  classNames={{
                    label: 'text-xs text-slate-600',
                    input: 'text-sm',
                  }}
                />

                <div className='mt-4 space-y-2'>
                  <Input
                    label='Password'
                    variant='bordered'
                    size='lg'
                    radius='md'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPwd ? 'text' : 'password'}
                    onKeyDown={onPwdKeyDown}
                    placeholder='Enter password'
                    classNames={{
                      label: 'text-xs text-slate-600',
                      input: 'text-sm',
                    }}
                    endContent={
                      <button
                        type='button'
                        className='text-xs text-slate-500 hover:text-slate-900'
                        onClick={() => setShowPwd((v) => !v)}
                      >
                        {showPwd ? 'Hide' : 'Show'}
                      </button>
                    }
                  />

                  <div className='flex items-center justify-between'>
                    <span className='text-[11px] text-slate-500'>
                      {capsOn && (
                        <span className='text-amber-500'>Caps Lock is ON</span>
                      )}
                    </span>
                    <div className='flex items-center gap-2 text-xs text-slate-700'>
                      <input
                        type='checkbox'
                        className='accent-primary h-4 w-4'
                        checked={rememberLogin}
                        onChange={(e) => setRememberLogin(e.target.checked)}
                      />
                      Remember email on this device
                    </div>
                  </div>
                </div>

                <Button
                  fullWidth
                  color='primary'
                  size='lg'
                  radius='md'
                  className='mt-4 font-medium'
                  isDisabled={pwdLoading || !login.trim() || !password}
                  isLoading={pwdLoading}
                  onPress={doPassword}
                >
                  {pwdLoading ? 'Signing in…' : 'Login'}
                </Button>

                <p className='text-[11px] text-slate-500 mt-3'>
                  Staff can only log into their own branch. Admins may log in
                  from any paired branch.
                </p>
              </div>

              {/* QUICK USERS */}
              <div>
                <div className='flex items-center justify-between mb-2'>
                  <div className='text-sm font-semibold text-slate-900'>
                    Quick users
                  </div>
                  {hasUsers && (
                    <span className='text-[11px] text-slate-500'>
                      Tap your name → we fill email.
                    </span>
                  )}
                </div>
                <div className='flex flex-wrap gap-2 max-h-24 overflow-auto pr-1'>
                  {hasUsers ? (
                    users.map((u) => (
                      <Chip
                        key={u.id}
                        size='sm'
                        variant='flat'
                        className='cursor-pointer bg-slate-100 hover:bg-slate-200 transition'
                        onClick={() => handleQuickUserClick(u)}
                      >
                        <span className='truncate max-w-[130px]'>{u.name}</span>
                        {u.role && (
                          <span className='ml-2 text-[10px] text-slate-600'>
                            {u.role}
                          </span>
                        )}
                      </Chip>
                    ))
                  ) : (
                    <span className='text-[11px] text-slate-500'>
                      No users synced yet. Pair this device and run sync.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: STATUS / SYNC */}
            <div className='space-y-4'>
              <div className='rounded-xl border border-slate-200 bg-slate-50 p-4'>
                <div className='text-base font-semibold mb-3 text-slate-900'>
                  Device status
                </div>

                <div className='space-y-2 text-xs text-slate-700 mb-4'>
                  <div className='flex justify-between gap-2'>
                    <span className='opacity-80'>Server</span>
                    <span className='text-right truncate max-w-[220px]'>
                      {baseUrl
                        ? baseUrl.replace(/^https?:\/\//, '')
                        : 'Not configured'}
                    </span>
                  </div>
                  <div className='flex justify-between gap-2'>
                    <span className='opacity-80'>Last sync</span>
                    <span className='text-right'>
                      {fmtTime(status?.last_sync_at)}
                    </span>
                  </div>
                  <div className='flex justify-between gap-2 items-center'>
                    <span className='opacity-80'>Outbox</span>
                    <Chip
                      size='sm'
                      variant='flat'
                      color={unsynced > 0 ? 'warning' : 'success'}
                      className='text-[11px]'
                    >
                      {unsynced > 0 ? `${unsynced} pending` : 'Up to date'}
                    </Chip>
                  </div>
                </div>

                <Divider className='my-2 bg-slate-200' />

                <div className='flex flex-wrap items-center gap-3 text-xs mt-1'>
                  <Switch
                    size='sm'
                    isSelected={syncOn}
                    onValueChange={toggleSync}
                    aria-label='Sync toggle'
                  >
                    Sync
                  </Switch>

                  <div className='flex items-center gap-2'>
                    <span className='opacity-80'>Mode</span>
                    <select
                      className='bg-white border border-slate-300 rounded-md px-2 py-1 text-[11px] text-slate-800'
                      value={mode}
                      onChange={(e) => changeMode(e.target.value as PosMode)}
                    >
                      <option value='live'>Live (sync)</option>
                      <option value='offline'>Offline only</option>
                    </select>
                  </div>

                  <Button
                    size='sm'
                    radius='md'
                    variant='bordered'
                    startContent={<RefreshCcw className='w-3 h-3' />}
                    className='ml-auto text-xs'
                    isDisabled={syncRunning || mode !== 'live'}
                    isLoading={syncRunning}
                    onPress={doManualSync}
                  >
                    Sync now
                  </Button>
                </div>

                {/* 🔹 NEW: Unpair button */}
                <div className='mt-3 flex justify-end'>
                  <Button
                    size='sm'
                    radius='md'
                    color='danger'
                    variant='light'
                    className='text-[11px]'
                    isLoading={unpairLoading}
                    onPress={doUnpair}
                  >
                    Unpair device
                  </Button>
                </div>
              </div>

              <div className='rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700 space-y-1.5'>
                <div className='font-semibold text-xs text-slate-900 mb-1'>
                  Shift tips
                </div>
                <div>
                  • If internet or server is down, switch mode to <b>Offline</b>{' '}
                  and continue.
                </div>
                <div>
                  • When back online, set mode to <b>Live</b> and press{' '}
                  <b>Sync now</b> until outbox is 0.
                </div>
                <div>
                  • Use <b>Pair device</b> if this machine is moved to another
                  restaurant/server.
                </div>
              </div>
            </div>
          </div>

          {err && (
            <div className='mt-4 rounded-lg border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-600'>
              {err}
            </div>
          )}
        </CardBody>

        <CardFooter className='flex flex-wrap gap-2 justify-between border-t border-slate-200 pt-3 pb-4 px-6'>
          <Button
            variant='light'
            size='sm'
            onPress={() => window.history.back()}
          >
            Back
          </Button>
          <div className='flex gap-2'>
            <Button variant='light' size='sm' onPress={() => nav('/pair')}>
              Pair device
            </Button>
            <Button
              variant='bordered'
              size='sm'
              onPress={() => window.location.reload()}
              startContent={<RefreshCcw className='w-3 h-3' />}
            >
              Reload
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
