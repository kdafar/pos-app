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
  password_hash: string | null
  is_active: number
  branch_id: number | null
}

function normalizeLaravelHash(h?: string | null) {
  return (h || '').replace(/^\$2y\$/, '$2b$')
}

// helper to decide "admin" style roles
function isAdminRole(role: string | null | undefined): boolean {
  const r = String(role || '').toLowerCase()
  return ['admin', 'owner', 'manager', 'super_admin', 'superadmin'].includes(r)
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
  /* ---------- Minimal schema (no PIN) ---------- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      role TEXT,
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

  const qActiveSession = db.prepare(`
    SELECT * FROM auth_sessions
    WHERE ended_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `)

  const qUserByLogin = db.prepare(`
    SELECT id, name, email, username, role, password_hash, is_active, branch_id
    FROM pos_users
    WHERE is_active = 1
      AND (lower(email) = lower(?) OR lower(username) = lower(?))
    LIMIT 1
  `)

  const qCreateSession = db.prepare(`
    INSERT INTO auth_sessions (user_id, started_at)
    VALUES (?, ?)
  `)

  const qEndSession = db.prepare(`
    UPDATE auth_sessions
    SET ended_at = ?
    WHERE id = ?
  `)

  const qListUsers = db.prepare(`
    SELECT id, name, email, username, role, is_active, branch_id
    FROM pos_users
    WHERE is_active = 1
    ORDER BY name COLLATE NOCASE
  `)

  const getBaseUrl = () => services.store.get('server.base_url') ?? null
  const getDeviceId = () =>
    services.store.get('device_id') ?? services.store.get('server.device_id') ?? null
  const getBranchMeta = () => ({
    branch_id: services.store.get('branch_id') ?? services.store.get('branch.id') ?? null,
    branch_name: services.store.get('branch.name') ?? '',
  })

  function getCurrentUser() {
    const sess = qActiveSession.get() as any
    if (!sess) return null
    const u = db
      .prepare(`SELECT id, name, email, role, is_active, branch_id FROM pos_users WHERE id = ?`)
      .get(sess.user_id) as any
    return u || null
  }

  function canUseBranch(
    u: { role?: string | null; branch_id?: number | null },
    deviceBranchId: number
  ) {
    if (isAdminRole(u.role)) return true
    const ub = Number(u.branch_id || 0)
    return ub !== 0 && deviceBranchId > 0 && ub === deviceBranchId
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
      current_user: user
        ? {
            id: user.id,
            name: user.name,
            role: user.role,
            is_admin: isAdminRole(user.role),
          }
        : null,
      session_open: !!session,
    }
  })

  ipcMain.handle('auth:listUsers', () => qListUsers.all())

  /* ---------- Login with Email/Username + Password (no PIN) ---------- */
  ipcMain.handle(
    'auth:loginWithPassword',
    async (_e, login: string, password: string) => {
      const ident = String(login || '').trim().toLowerCase()
      if (!ident || !password) throw new Error('Invalid credentials')

      const row = qUserByLogin.get(ident, ident) as DBUser | undefined
      if (!row || !row.password_hash) throw new Error('Invalid credentials')

      const { branch_id: devBranch } = getBranchMeta()
      const deviceBranchId = Number(devBranch || 0)
      if (!canUseBranch(row, deviceBranchId)) throw new Error('Invalid credentials')

      const ok = await bcrypt.compare(
        password,
        normalizeLaravelHash(row.password_hash)
      )
      if (!ok) throw new Error('Invalid credentials')

      const now = Date.now()
      const info = qCreateSession.run(row.id, now)
      services.store.set('auth.user_id', row.id)
      services.store.set('auth.session_id', info.lastInsertRowid)

      // Stamp current operator meta
      setMeta('pos.current_user_id', String(row.id))
      setMeta(
        'pos.current_user_json',
        JSON.stringify({ id: row.id, name: row.name, role: row.role })
      )

      return {
        id: row.id,
        name: row.name,
        role: row.role,
        is_admin: isAdminRole(row.role),
      }
    }
  )

  /* ---------- Logout ---------- */
  ipcMain.handle('auth:logout', () => {
    const sess = qActiveSession.get() as any
    if (sess) qEndSession.run(Date.now(), sess.id)
    services.store.delete('auth.user_id')
    services.store.delete('auth.session_id')

    setMeta('pos.current_user_id', null)
    setMeta('pos.current_user_json', null)

    return { ok: true }
  })

  /* ---------- Pair ---------- */
  ipcMain.handle('auth:pair', async (_e, payload) => {
    const { baseUrl, pairCode, deviceName, branchId } = payload || {}
    if (!baseUrl || !pairCode) throw new Error('baseUrl and pairCode are required')

    services.store.set('server.base_url', baseUrl)
    if (deviceName) services.store.set('tmp.device_name', deviceName)
    if (branchId != null) {
      services.store.set('tmp.branch_id', String(branchId))
      services.store.set('branch.id', String(branchId))
      services.store.set('branch_id', String(branchId))
    }

    await readOrCreateMachineId()

    const { device_id } = await services.sync.bootstrap(baseUrl, pairCode)
    if (device_id) {
      services.store.set('device_id', device_id)
      services.store.set('server.device_id', device_id)
    }

    try {
      await services.sync.run()
    } catch (e: any) {
      console.warn(
        '[PAIR] optional sync.run failed (ok to ignore on first boot):',
        e?.message
      )
    }

    return { device_id: device_id ?? (services.store.get('device_id') ?? null) }
  })

  /* ---------- Who am I (used by layout for RBAC) ---------- */
  ipcMain.handle('auth:whoami', async () => {
    try {
      const user = getCurrentUser()

      // No session → treat as "Admin" for first-boot/dev
      if (!user) {
        return {
          id: null,
          name: 'Admin',
          role: 'admin',
          email: null,
          is_admin: true,
          branch_id: services.store.get('branch_id') ?? null,
          is_active: 1,
        }
      }

      const is_admin = isAdminRole(user.role)

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_admin,
        branch_id: user.branch_id,
        is_active: user.is_active,
      }
    } catch (e) {
      console.error('auth:whoami failed:', e)
      return {
        id: null,
        name: 'Admin',
        role: 'admin',
        email: null,
        is_admin: true,
        branch_id: services.store.get('branch_id') ?? null,
        is_active: 1,
      }
    }
  })

  /* ---------- Unpair ---------- */
  ipcMain.handle('auth:unpair', async () => {
    const sess = qActiveSession.get() as any
    if (sess) qEndSession.run(Date.now(), sess.id)

    try {
      await saveSecret('device_token', '')
    } catch {}

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

    setMeta('pos.current_user_id', null)
    setMeta('pos.current_user_json', null)

    return { ok: true }
  })
}
