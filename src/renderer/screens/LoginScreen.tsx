// src/renderer/screens/LoginScreen.tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function LoginScreen() {
  const [users, setUsers] = useState<{ id: number; name: string; role?: string }[]>([])
  const [pin, setPin] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [branch, setBranch] = useState<{ id: number | null; name: string }>({ id: null, name: '' })
  const [pinLoading, setPinLoading] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [capsOn, setCapsOn] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    ;(async () => {
      const s = await window.pos.auth.status()
      setBranch({ id: s.branch_id ?? null, name: s.branch_name ?? '' })
      const list = await window.pos.auth.listUsers()
      setUsers(Array.isArray(list) ? list : [])
    })()
  }, [])

  const hasUsers = useMemo(() => users.length > 0, [users])

  const doPin = async () => {
    setErr(null)
    setPinLoading(true)
    try {
      await window.pos.auth.loginWithPin(pin.trim())
      nav('/', { replace: true })
    } catch (e: any) {
      setErr(e?.message || 'Invalid PIN')
    } finally {
      setPinLoading(false)
    }
  }

  const doPassword = async () => {
    setErr(null)
    setPwdLoading(true)
    try {
      await window.pos.auth.loginWithPassword(login.trim(), password)
      nav('/', { replace: true })
    } catch (e: any) {
      setErr(e?.message || 'Invalid credentials')
    } finally {
      setPwdLoading(false)
    }
  }

  const onPwdKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // subtle improvement: Enter submits password login
    if (e.key === 'Enter') doPassword()
    // caps lock hint
    setCapsOn((e.nativeEvent as KeyboardEvent).getModifierState?.('CapsLock') ?? false)
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="
        w-[560px] max-w-[92vw]
        bg-card bg-content1/60 backdrop-blur-md
        border border-border/60 border-divider
        rounded-2xl shadow-lg p-6
      ">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl grid place-items-center bg-primary/10 text-primary font-semibold">
              POS
            </div>
            <h3 className="text-xl font-semibold tracking-tight">Operator Login</h3>
          </div>

          <div className="text-xs text-muted-foreground">
            <div className="opacity-80">Branch</div>
            <div className="text-foreground">
              {branch.name || '-'}
              {branch.id ? <span className="opacity-60"> (#{branch.id})</span> : null}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* PIN card */}
          <div className="p-4 rounded-xl border border-border/60">
            <div className="text-sm font-medium mb-2">Quick PIN</div>

            <input
              className="input w-full mb-2"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              inputMode="numeric"
              maxLength={6}
            />

            <button
              className="btn w-full"
              onClick={doPin}
              disabled={pinLoading || pin.trim() === ''}
            >
              {pinLoading ? 'Logging in…' : 'Login with PIN'}
            </button>

            <div className="text-xs text-muted-foreground mt-3">Active users</div>
            <ul className="text-sm text-muted-foreground mt-1 max-h-28 overflow-auto pr-1 space-y-1">
              {hasUsers ? (
                users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between">
                    <span>• {u.name}</span>
                    {u.role ? (
                      <span className="text-foreground/70 text-[11px] px-2 py-0.5 rounded bg-muted">
                        {u.role}
                      </span>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="opacity-70">No users synced yet</li>
              )}
            </ul>
          </div>

          {/* Password card */}
          <div className="p-4 rounded-xl border border-border/60">
            <div className="text-sm font-medium mb-2">Password</div>

            <input
              className="input w-full mb-2"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Email"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
            />

            <input
              className="input w-full mb-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onPwdKeyDown}
              placeholder="Password"
              autoCapitalize="none"
              autoCorrect="off"
            />

            {capsOn && (
              <div className="text-xs text-yellow-500 mb-2">Caps Lock is ON</div>
            )}

            <button
              className="btn w-full"
              onClick={doPassword}
              disabled={pwdLoading || !login.trim() || !password}
            >
              {pwdLoading ? 'Logging in…' : 'Login with Password'}
            </button>

            <div className="text-[11px] text-muted-foreground mt-2">
              Tip: staff must belong to this paired branch. Admins can log in from any branch.
            </div>
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {err}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap gap-2 justify-between mt-5">
          <button className="btn" onClick={() => window.history.back()}>Back</button>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => nav('/pair')}
              title="Re-run pairing wizard"
            >
              Pair device
            </button>
            <button
              className="btn btn-outline"
              onClick={() => window.location.reload()}
              title="Reload UI"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
