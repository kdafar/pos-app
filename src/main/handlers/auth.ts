import { readOrCreateMachineId } from '../machineId'
import type { Database as BetterSqliteDB } from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { loadSecret, saveSecret } from '../secureStore'
import type { IpcMain } from 'electron'
import { setMeta } from '../db'

type DBUser = {
  id: number
  name: string
  username: string | null
  email: string | null
  role: string | null
  pin: string | null
  password_hash: string | null
  is_active: number
  branch_id: number | null
}

export function registerAuthHandlers(
  ipcMain: IpcMain,
  db: BetterSqliteDB,
  services: {
    store: { get(k: string): any; set(k: string, v: any): void; delete(k: string): void }
    sync: {
      configure(baseUrl: string): Promise<void>
      bootstrap(baseUrl: string | null, pairCode: string): Promise<{ device_id: string | null }>
      run(): Promise<void>
    }
  }
) {
  /* ---------- Migrations (lightweight) ---------- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      role TEXT,
      pin TEXT,
      password_hash TEXT,
      is_active INTEGER DEFAULT 1,
      branch_id INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES pos_users(id)
    );
  `)

  const qActiveSession = db.prepare(`SELECT * FROM auth_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`)
  const qUserByPin = db.prepare(`SELECT * FROM pos_users WHERE is_active=1 AND pin=? LIMIT 1`)
  const qUserByEmail = db.prepare(`
    SELECT id, name, email, role, password_hash, is_active, branch_id
    FROM pos_users
    WHERE is_active = 1 AND lower(email) = ?
    LIMIT 1
  `)
  const qCreateSession = db.prepare(`INSERT INTO auth_sessions (user_id, started_at) VALUES (?, ?)`)
  const qEndSession = db.prepare(`UPDATE auth_sessions SET ended_at=? WHERE id=?`)
  const qListUsers = db.prepare(`SELECT id, name, role FROM pos_users WHERE is_active=1 ORDER BY name`)

  function getBaseUrl(): string | null {
    return services.store.get('server.base_url') ?? null
  }
  function getDeviceId(): string | null {
    return services.store.get('device_id') ?? services.store.get('server.device_id') ?? null
  }
  function getBranchMeta() {
    return {
      branch_id: services.store.get('branch_id') ?? services.store.get('branch.id') ?? null,
      branch_name: services.store.get('branch.name') ?? '',
    }
  }
  function getCurrentUser() {
    const sess = qActiveSession.get() as any
    if (!sess) return null
    const u = db.prepare(`SELECT id, name, role FROM pos_users WHERE id=?`).get(sess.user_id) as any
    return u || null
  }

  function canUseBranch(u: { role?: string; branch_id?: number | null }, deviceBranchId: number) {
    const role = String(u.role || '').toLowerCase()
    if (role === 'admin') return true
    const ub = Number(u.branch_id || 0)
    return ub === 0 ? false : (deviceBranchId > 0 && ub === deviceBranchId)
  }

  /* ---------- Status ---------- */
  ipcMain.handle('auth:status', async () => {
    const base_url = getBaseUrl()
    const device_id = getDeviceId()
    const token_present = !!(await loadSecret('device_token'))
    const session = qActiveSession.get() as any
    const user = getCurrentUser()
    const { branch_id, branch_name } = getBranchMeta()
    const paired = !!(base_url && device_id && token_present)
    return {
      paired,
      base_url,
      device_id,
      token_present,
      branch_id,
      branch_name,
      current_user: user,
      session_open: !!session,
    }
  })

  ipcMain.handle('auth:listUsers', () => qListUsers.all())

  /* ---------- Login with PIN ---------- */
  ipcMain.handle('auth:loginWithPin', (_e, pin: string) => {
    const u = qUserByPin.get(pin) as DBUser | undefined
    if (!u) throw new Error('Invalid PIN')

    const { branch_id: devBranch } = getBranchMeta()
    const deviceBranchId = Number(devBranch || 0)
    if (!canUseBranch(u, deviceBranchId)) throw new Error('Invalid PIN')

    const now = Date.now()
    const info = qCreateSession.run(u.id, now)
    services.store.set('auth.user_id', u.id)
    services.store.set('auth.session_id', info.lastInsertRowid)

    // Phase-2: stamp current operator meta
    setMeta('pos.current_user_id', String(u.id))
    setMeta('pos.current_user_json', JSON.stringify({ id: u.id, name: u.name, role: u.role }))

    return { id: u.id, name: u.name, role: u.role }
  })

  /* ---------- Login with Email + Password ---------- */
  ipcMain.handle('auth:loginWithPassword', async (_e, login: string, password: string) => {
    const email = String(login || '').trim().toLowerCase()
    if (!email || !password) throw new Error('Invalid credentials')

    const row = qUserByEmail.get(email) as
      | { id: number; name: string; email: string; role: string; password_hash: string; is_active: number; branch_id: number | null }
      | undefined

    if (!row) throw new Error('Invalid credentials')

    const { branch_id: devBranch } = getBranchMeta()
    const deviceBranchId = Number(devBranch || 0)
    if (!canUseBranch(row, deviceBranchId)) throw new Error('Invalid credentials')

    const hash = (row.password_hash || '').replace(/^\$2y\$/, '$2b$')
    const ok = await bcrypt.compare(password, hash)
    if (!ok) throw new Error('Invalid credentials')

    const now = Date.now()
    const info = qCreateSession.run(row.id, now)
    services.store.set('auth.user_id', row.id)
    services.store.set('auth.session_id', info.lastInsertRowid)

    // Phase-2: stamp current operator meta
    setMeta('pos.current_user_id', String(row.id))
    setMeta('pos.current_user_json', JSON.stringify({ id: row.id, name: row.name, role: row.role }))

    return { id: row.id, name: row.name, role: row.role }
  })

  /* ---------- Logout ---------- */
  ipcMain.handle('auth:logout', () => {
    const sess = qActiveSession.get() as any
    if (sess) qEndSession.run(Date.now(), sess.id)
    services.store.delete('auth.user_id')
    services.store.delete('auth.session_id')

    // Phase-2: clear operator meta
    setMeta('pos.current_user_id', null)
    setMeta('pos.current_user_json', null)

    return { ok: true }
  })

  /* ---------- Pair ---------- */
  ipcMain.handle('auth:pair', async (_e, payload) => {
    const { baseUrl, pairCode, deviceName, branchId } = payload || {}
    if (!baseUrl || !pairCode) throw new Error('baseUrl and pairCode are required')

    // Persist initial hints so branch guard works post-bootstrap
    services.store.set('server.base_url', baseUrl)
    if (deviceName) services.store.set('tmp.device_name', deviceName)
    if (branchId != null) {
      services.store.set('tmp.branch_id', String(branchId))
      services.store.set('branch.id', String(branchId))
      services.store.set('branch_id', String(branchId))
    }

    // Optional but nice: unique machine hint for backend auditing
    await readOrCreateMachineId()

    // Single call per your declared interface
    const { device_id } = await services.sync.bootstrap(baseUrl, pairCode)
    if (device_id) {
      services.store.set('device_id', device_id)
      services.store.set('server.device_id', device_id)
    }

    // Optional first incremental after seed
    try {
      await services.sync.run()
    } catch (e: any) {
      console.warn('[PAIR] optional sync.run failed (ok to ignore on first boot):', e?.message)
    }

    return { device_id: device_id ?? getDeviceId() ?? null }
  })

  /* ---------- Unpair ---------- */
  ipcMain.handle('auth:unpair', async () => {
    // end active session if any
    const sess = qActiveSession.get() as any
    if (sess) qEndSession.run(Date.now(), sess.id)

    // clear secrets & meta
    try { await saveSecret('device_token', '') } catch {}

    services.store.delete('server.base_url')
    services.store.delete('server.device_id')
    services.store.delete('device_id')
    services.store.delete('branch.id')
    services.store.delete('branch_id')
    services.store.delete('branch.name')
    services.store.delete('auth.user_id')
    services.store.delete('auth.session_id')
    services.store.delete('tmp.device_name')
    services.store.delete('tmp.branch_id')

    // Phase-2: clear operator meta (safety)
    setMeta('pos.current_user_id', null)
    setMeta('pos.current_user_json', null)

    return { ok: true }
  })
}
