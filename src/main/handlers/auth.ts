// src/main/handlers/auth.ts

import type { IpcMain } from 'electron';
import bcrypt from 'bcryptjs';

import { readOrCreateMachineId } from '../machineId';
import { loadSecret, saveSecret } from '../secureStore';
import type { MainServices } from '../types/common';

type DBUser = {
  id: number;
  name: string;
  username: string | null;
  email: string | null;
  role: string | null;
  password_hash: string | null;
  is_active: number;
  branch_id: number | null;
};

function normalizeLaravelHash(h?: string | null) {
  return (h || '').replace(/^\$2y\$/, '$2b$');
}

// helper to decide "admin" style roles
function isAdminRole(role: string | null | undefined): boolean {
  const r = String(role || '').toLowerCase();
  return ['admin', 'owner', 'manager', 'super_admin', 'superadmin'].includes(r);
}

export function registerAuthHandlers(ipcMain: IpcMain, services: MainServices) {
  const db = services.rawDb;
  const store = services.store;
  const meta = services.meta;

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
  `);

  const qActiveSession = db.prepare(`
    SELECT * FROM auth_sessions
    WHERE ended_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `);

  const qUserByLogin = db.prepare(`
    SELECT id, name, email, username, role, password_hash, is_active, branch_id
    FROM pos_users
    WHERE is_active = 1
      AND (lower(email) = lower(?) OR lower(username) = lower(?))
    LIMIT 1
  `);

  const qCreateSession = db.prepare(`
    INSERT INTO auth_sessions (user_id, started_at)
    VALUES (?, ?)
  `);

  const qEndSession = db.prepare(`
    UPDATE auth_sessions
    SET ended_at = ?
    WHERE id = ?
  `);

  const qListUsers = db.prepare(`
    SELECT id, name, email, username, role, is_active, branch_id
    FROM pos_users
    WHERE is_active = 1
    ORDER BY name COLLATE NOCASE
  `);

  const getBaseUrl = () => store.get('server.base_url') ?? null;
  const getDeviceId = () =>
    store.get('device_id') ?? store.get('server.device_id') ?? null;
  const getBranchMeta = () => ({
    branch_id: store.get('branch_id') ?? store.get('branch.id') ?? null,
    branch_name: store.get('branch.name') ?? '',
  });

  function getCurrentUser() {
    const sess = qActiveSession.get() as any;
    if (!sess) return null;
    const u = db
      .prepare(
        `SELECT id, name, email, role, is_active, branch_id FROM pos_users WHERE id = ?`
      )
      .get(sess.user_id) as any;
    return u || null;
  }

  function canUseBranch(
    u: { role?: string | null; branch_id?: number | null },
    deviceBranchId: number
  ) {
    if (isAdminRole(u.role)) return true;
    const ub = Number(u.branch_id || 0);
    return ub !== 0 && deviceBranchId > 0 && ub === deviceBranchId;
  }

  /* ---------- Status ---------- */
  ipcMain.handle('auth:status', async () => {
    const base_url = getBaseUrl();
    const device_id = getDeviceId();
    const token_present = !!(await loadSecret('device_token'));
    const session = qActiveSession.get() as any;
    const user = getCurrentUser();
    const { branch_id, branch_name } = getBranchMeta();
    const paired = !!(base_url && device_id && token_present);

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
    };
  });

  ipcMain.handle('auth:listUsers', () => qListUsers.all());

  /* ---------- Login with Email/Username + Password (no PIN) ---------- */
  ipcMain.handle(
    'auth:loginWithPassword',
    async (_e, login: string, password: string) => {
      const ident = String(login || '')
        .trim()
        .toLowerCase();
      if (!ident || !password) throw new Error('Invalid credentials');

      const row = qUserByLogin.get(ident, ident) as DBUser | undefined;
      if (!row || !row.password_hash) throw new Error('Invalid credentials');

      const { branch_id: devBranch } = getBranchMeta();
      const deviceBranchId = Number(devBranch || 0);
      if (!canUseBranch(row, deviceBranchId))
        throw new Error('Invalid credentials');

      const ok = await bcrypt.compare(
        password,
        normalizeLaravelHash(row.password_hash)
      );
      if (!ok) throw new Error('Invalid credentials');

      const now = Date.now();
      const info = qCreateSession.run(row.id, now);
      store.set('auth.user_id', row.id);
      store.set('auth.session_id', info.lastInsertRowid);

      // Stamp current operator meta
      meta.set('pos.current_user_id', String(row.id));
      meta.set(
        'pos.current_user_json',
        JSON.stringify({ id: row.id, name: row.name, role: row.role })
      );

      return {
        id: row.id,
        name: row.name,
        role: row.role,
        is_admin: isAdminRole(row.role),
      };
    }
  );

  /* ---------- Logout ---------- */
  ipcMain.handle('auth:logout', () => {
    const sess = qActiveSession.get() as any;
    if (sess) qEndSession.run(Date.now(), sess.id);

    store.delete('auth.user_id');
    store.delete('auth.session_id');

    // instead of meta.delete(...)
    meta.set('pos.current_user_id', null);
    meta.set('pos.current_user_json', null);

    return { ok: true };
  });

  /* ---------- Pair ---------- */
  ipcMain.handle('auth:pair', async (_e, payload) => {
    const { baseUrl, pairCode, deviceName, branchId } = payload || {};
    if (!baseUrl || !pairCode) {
      throw new Error('baseUrl and pairCode are required');
    }

    // Persist config in KV store
    store.set('server.base_url', baseUrl);
    if (deviceName) store.set('tmp.device_name', deviceName);
    if (branchId != null) {
      store.set('tmp.branch_id', String(branchId));
      store.set('branch.id', String(branchId));
      store.set('branch_id', String(branchId));
    }

    const mid = await readOrCreateMachineId();
    store.set('machine_id', mid);

    const device_id =
      getDeviceId() ??
      store.get('device_id') ??
      store.get('server.device_id') ??
      null;

    return { device_id };
  });

  /* ---------- Who am I (used by layout for RBAC) ---------- */
  ipcMain.handle('auth:whoami', async () => {
    try {
      const user = getCurrentUser();

      // No session → treat as "Admin" for first-boot/dev
      if (!user) {
        return {
          id: null,
          name: 'Admin',
          role: 'admin',
          email: null,
          is_admin: true,
          branch_id: store.get('branch_id') ?? null,
          is_active: 1,
        };
      }

      const is_admin = isAdminRole(user.role);

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_admin,
        branch_id: user.branch_id,
        is_active: user.is_active,
      };
    } catch (e) {
      console.error('auth:whoami failed:', e);
      return {
        id: null,
        name: 'Admin',
        role: 'admin',
        email: null,
        is_admin: true,
        branch_id: store.get('branch_id') ?? null,
        is_active: 1,
      };
    }
  });

  /* ---------- Unpair ---------- */
  ipcMain.handle('auth:unpair', async () => {
    const sess = qActiveSession.get() as any;
    if (sess) qEndSession.run(Date.now(), sess.id);

    try {
      await saveSecret('device_token', '');
    } catch {
      // ignore
    }

    store.delete('server.base_url');
    store.delete('server.device_id');
    store.delete('device_id');
    store.delete('branch.id');
    store.delete('branch_id');
    store.delete('branch.name');
    store.delete('auth.user_id');
    store.delete('auth.session_id');
    store.delete('tmp.device_name');
    store.delete('tmp.branch_id');

    // instead of meta.delete(...)
    meta.set('pos.current_user_id', null);
    meta.set('pos.current_user_json', null);

    return { ok: true };
  });
}
