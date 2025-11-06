// src/renderer/screens/LoginScreen.tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type PosMode = 'live' | 'offline'

type SyncStatus = {
  mode: PosMode
  last_sync_at: number
  base_url: string
  cursor: number
  paired: boolean
  token_present: boolean
  device_id: string | null
  branch_name: string
  branch_id: number
  unsynced: number
}

const fmtTime = (ms?: number) => {
  if (!ms) return '—'
  try {
    const d = new Date(Number(ms))
    return d.toLocaleString()
  } catch {
    return '—'
  }
}

export function LoginScreen() {
  const [users, setUsers] = useState<{ id: number; name: string; role?: string }[]>([])
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [rememberLogin, setRememberLogin] = useState(true)

  const [err, setErr] = useState<string | null>(null)
  const [branch, setBranch] = useState<{ id: number | null; name: string }>({ id: null, name: '' })

  const [pwdLoading, setPwdLoading] = useState(false)
  const [capsOn, setCapsOn] = useState(false)

  // Sync/mode UI state — backed by main process (no index.ts changes needed)
  const [mode, setMode] = useState<PosMode>('live')
  const [syncOn, setSyncOn] = useState<boolean>(true)
  const [syncRunning, setSyncRunning] = useState(false)
  const [status, setStatus] = useState<SyncStatus | null>(null)

  const nav = useNavigate()
  const hasUsers = useMemo(() => users.length > 0, [users])

  useEffect(() => {
    ;(async () => {
      // Prefill remembered login
      const saved = localStorage.getItem('pos.last_login')
      if (saved) setLogin(saved)

      // Branch + users
      const s = await (window as any).pos.auth.status()
      setBranch({ id: s.branch_id ?? null, name: s.branch_name ?? '' })

      const list = await (window as any).pos.auth.listUsers()
      setUsers(Array.isArray(list) ? list : [])

      // Load status from main
      try {
        const st = (await (window as any).api.invoke('sync:status')) as SyncStatus
        const m: PosMode = st?.mode === 'offline' ? 'offline' : 'live'
        setMode(m)
        setSyncOn(m === 'live')
        setStatus(st)
      } catch {
        setMode('live')
        setSyncOn(true)
      }
    })()
  }, [])

  const refreshStatus = async () => {
    try {
      const st = (await (window as any).api.invoke('sync:status')) as SyncStatus
      setStatus(st)
      setMode(st.mode === 'offline' ? 'offline' : 'live')
      setSyncOn(st.mode === 'live')
    } catch {}
  }

  // Toggle = map ON→live, OFF→offline and tell main
  const toggleSync = async (val: boolean) => {
    setSyncOn(val)
    const newMode: PosMode = val ? 'live' : 'offline'
    setMode(newMode)
    try {
      await (window as any).api.invoke('sync:setMode', newMode)
      if (val) await doManualSync()
      else await refreshStatus()
    } catch (e: any) {
      setErr(e?.message || 'Failed to change mode')
    }
  }

  // Dropdown selector -> same IPC
  const changeMode = async (val: PosMode) => {
    setMode(val)
    setSyncOn(val === 'live')
    try {
      await (window as any).api.invoke('sync:setMode', val)
      await refreshStatus()
    } catch (e: any) {
      setErr(e?.message || 'Failed to change mode')
    }
  }

  // Manual sync (works only in live mode; main will throw otherwise)
  const doManualSync = async () => {
    setErr(null)
    setSyncRunning(true)
    try {
      await (window as any).api.invoke('sync:run')
    } catch (e: any) {
      setErr(e?.message || 'Sync failed')
    } finally {
      setSyncRunning(false)
      await refreshStatus()
    }
  }

  const doPassword = async () => {
    setErr(null)
    setPwdLoading(true)
    try {
      if (rememberLogin) {
        localStorage.setItem('pos.last_login', login.trim())
      } else {
        localStorage.removeItem('pos.last_login')
      }
      await (window as any).pos.auth.loginWithPassword(login.trim(), password)
      nav('/', { replace: true })
    } catch (e: any) {
      setErr(e?.message || 'Invalid credentials')
    } finally {
      setPwdLoading(false)
    }
  }

  const onPwdKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') doPassword()
    setCapsOn((e.nativeEvent as KeyboardEvent).getModifierState?.('CapsLock') ?? false)
  }

  const paired = !!status?.paired
  const baseUrl = status?.base_url || ''
  const unsynced = status?.unsynced ?? 0
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div
        className="
          w-[720px] max-w-[92vw]
          bg-card bg-content1/60 backdrop-blur-md
          border border-border/60 border-divider
          rounded-2xl shadow-lg p-6
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl grid place-items-center bg-primary/10 text-primary font-semibold">POS</div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Operator Login</h3>
              <div className="text-xs text-muted-foreground">
                Branch: <span className="text-foreground">{branch.name || '-'}</span>
                {branch.id ? <span className="opacity-60"> (#{branch.id})</span> : null}
              </div>
            </div>
          </div>

          {/* RIGHT TOP: Status + Sync + Mode */}
          <div className="flex items-center gap-3">
            {/* Paired pill */}
            <span
              className={`text-xs px-2 py-1 rounded-full border ${
                paired ? 'border-green-500/40 bg-green-500/10 text-green-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              }`}
              title={paired ? `Device ${status?.device_id || ''}` : 'Not paired'}
            >
              {paired ? 'Paired' : 'Not paired'}
            </span>

            {/* Online pill */}
            <span
              className={`text-xs px-2 py-1 rounded-full border ${
                online ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-zinc-500/40 bg-zinc-700/30 text-zinc-300'
              }`}
              title={online ? 'Network online' : 'Network offline'}
            >
              {online ? 'Online' : 'Offline (browser)'}
            </span>

            {/* Divider */}
            <div className="w-px h-8 bg-border/60" />

            {/* Sync toggle */}
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none" title="Enable/disable syncing (sets mode to Live/Offline)">
              <span className="opacity-80">Sync</span>
              <input type="checkbox" className="accent-primary h-4 w-4" checked={syncOn} onChange={(e) => toggleSync(e.target.checked)} />
              <span
                className={`ml-1 inline-block h-2.5 w-2.5 rounded-full ${syncOn ? 'bg-green-500/90' : 'bg-zinc-500/70'}`}
                aria-hidden
              />
            </label>

            {/* Mode selector */}
            <div className="flex items-center gap-2 text-xs" title="Connection mode">
              <span className="opacity-80">Mode</span>
              <select className="input h-8 px-2 py-1 text-xs w-[128px]" value={mode} onChange={(e) => changeMode(e.target.value as PosMode)}>
                <option value="live">Live (Sync)</option>
                <option value="offline">Offline only</option>
              </select>
            </div>

            {/* Sync button */}
            <button
              className="btn btn-outline h-8"
              onClick={doManualSync}
              disabled={syncRunning || mode !== 'live'}
              title={mode !== 'live' ? 'Switch mode to Live to sync' : 'Run pull + push now'}
            >
              {syncRunning ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: Password login */}
          <div className="p-4 rounded-xl border border-border/60">
            <div className="text-sm font-medium mb-2">Sign in</div>

            <label className="text-xs text-muted-foreground">Email</label>
            <input
              className="input w-full mb-2"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="email@example.com"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
            />

            <label className="text-xs text-muted-foreground">Password</label>
            <div className="flex gap-2 items-center mb-2">
              <input
                className="input w-full"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onPwdKeyDown}
                placeholder="••••••••"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <button
                className="btn btn-ghost h-10 px-3"
                onClick={() => setShowPwd((v) => !v)}
                title={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="flex items-center justify-between mb-2">
              {capsOn && <div className="text-xs text-yellow-500">Caps Lock is ON</div>}
              <label className="text-xs flex items-center gap-2 ml-auto">
                <input
                  type="checkbox"
                  className="accent-primary h-3.5 w-3.5"
                  checked={rememberLogin}
                  onChange={(e) => setRememberLogin(e.target.checked)}
                />
                Remember email
              </label>
            </div>

            <button className="btn w-full" onClick={doPassword} disabled={pwdLoading || !login.trim() || !password}>
              {pwdLoading ? 'Signing in…' : 'Login'}
            </button>

            <div className="text-[11px] text-muted-foreground mt-2">
              Tip: Staff must belong to this paired branch. Admins can log in from any branch.
            </div>
          </div>

          {/* Right: Helpful status panel */}
          <div className="p-4 rounded-xl border border-border/60">
            <div className="text-sm font-medium mb-2">Status & Tips</div>

            <div className="text-xs mb-2 text-muted-foreground">
              <div>
                <span className="opacity-80">Server:</span>{' '}
                <span className="text-foreground">{baseUrl ? baseUrl.replace(/^https?:\/\//, '') : '—'}</span>
              </div>
              <div>
                <span className="opacity-80">Last sync:</span> <span className="text-foreground">{fmtTime(status?.last_sync_at)}</span>
              </div>
              <div>
                <span className="opacity-80">Outbox:</span>{' '}
                <span className={unsynced > 0 ? 'text-amber-300' : 'text-foreground'}>{unsynced} pending</span>
              </div>
            </div>

            <div className="text-xs text-muted-foreground mb-3">
              <div className="opacity-80 mb-1">Active users</div>
              <ul className="text-sm text-muted-foreground max-h-28 overflow-auto pr-1 space-y-1">
                {hasUsers ? (
                  users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between">
                      <span>• {u.name}</span>
                      {u.role ? (
                        <span className="text-foreground/70 text-[11px] px-2 py-0.5 rounded bg-muted">{u.role}</span>
                      ) : null}
                    </li>
                  ))
                ) : (
                  <li className="opacity-70">No users synced yet</li>
                )}
              </ul>
            </div>

            <div className="text-[11px] leading-relaxed text-muted-foreground space-y-1">
              <div>• If the server is unreachable, switch Mode to <b>Offline</b> to continue taking orders.</div>
              <div>• When back online, switch to <b>Live</b> and press <b>Sync now</b> to push pending orders.</div>
            </div>
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{err}</div>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap gap-2 justify-between mt-5">
          <button className="btn" onClick={() => window.history.back()}>
            Back
          </button>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => nav('/pair')} title="Re-run pairing wizard">
              Pair device
            </button>
            <button className="btn btn-outline" onClick={() => window.location.reload()} title="Reload UI">
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
