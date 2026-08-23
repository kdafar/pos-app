// src/main/handlers/auth.ts

import type { IpcMain } from 'electron';
import bcrypt from 'bcryptjs';

import { readOrCreateMachineId } from '../machineId';
import { loadSecret, saveSecret } from '../secureStore';
import type { MainServices } from '../types/common';
import { allowAnonymousAdmin, isAdminRole } from '../utils/authContext';

import { posError } from '../../shared/errorCodes';
import { PERMISSIONS, rolePermissions, type Permission } from '../../shared/permissions';
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
    CREATE TABLE IF NOT EXISTS pos_user_permissions (
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
      updated_by INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, permission)
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

  function permissionsFor(user: any): Permission[] {
    if (!user) return [];
    const effective = new Set(rolePermissions(user.role));
    const overrides = db.prepare('SELECT permission, allowed FROM pos_user_permissions WHERE user_id = ?').all(user.id) as Array<{ permission: Permission; allowed: number }>;
    for (const item of overrides) item.allowed ? effective.add(item.permission) : effective.delete(item.permission);
    return [...effective];
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
      // Why the device lost its pairing, when it was not a manual unpair:
      // 'server_locked' | 'offline_too_long' | null
      unpaired_reason: paired ? null : meta.get('pos.unpaired_reason') || null,
      current_user: user
        ? {
            id: user.id,
            name: user.name,
            role: user.role,
            is_admin: isAdminRole(user.role),
            permissions: permissionsFor(user),
          }
        : null,
      session_open: !!session,
    };
  });

  ipcMain.handle('auth:listUsers', () => qListUsers.all());

  ipcMain.handle('permissions:listUsers', () => {
    const actor = getCurrentUser();
    if (!actor || !permissionsFor(actor).includes('users.permissions')) throw new Error('Permission denied.');
    return (qListUsers.all() as any[])
      .map((user) => ({
        ...user,
        is_self: Number(user.id) === Number(actor.id),
        permissions: permissionsFor(user),
      }));
  });

  ipcMain.handle('permissions:setUser', (_event, userId: number, permissions: string[]) => {
    const actor = getCurrentUser();
    if (!actor || !permissionsFor(actor).includes('users.permissions')) throw new Error('Permission denied.');
    if (Number(actor.id) === Number(userId)) throw new Error('You cannot change your own permissions.');
    const target = db.prepare('SELECT id, role FROM pos_users WHERE id = ?').get(userId) as any;
    if (!target) throw new Error('User not found.');
    const chosen = new Set(permissions.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)));
    const defaults = new Set(rolePermissions(target.role));
    const remove = db.prepare('DELETE FROM pos_user_permissions WHERE user_id = ?');
    const insert = db.prepare('INSERT INTO pos_user_permissions (user_id, permission, allowed, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      remove.run(userId);
      for (const permission of PERMISSIONS) {
        if (chosen.has(permission) !== defaults.has(permission)) insert.run(userId, permission, chosen.has(permission) ? 1 : 0, actor.id, Date.now());
      }
    })();
    return { ok: true, permissions: permissionsFor(target) };
  });

  /* ---------- Login with Email/Username + Password (no PIN) ---------- */
  ipcMain.handle(
    'auth:loginWithPassword',
    async (_e, login: string, password: string) => {
      const ident = String(login || '')
        .trim()
        .toLowerCase();
      if (!ident || !password) throw posError('POS_LOGIN_INVALID');

      const row = qUserByLogin.get(ident, ident) as DBUser | undefined;
      if (!row || !row.password_hash) throw posError('POS_LOGIN_INVALID');

      const { branch_id: devBranch } = getBranchMeta();
      const deviceBranchId = Number(devBranch || 0);
      if (!canUseBranch(row, deviceBranchId))
        throw posError('POS_LOGIN_INVALID');

      const ok = await bcrypt.compare(
        password,
        normalizeLaravelHash(row.password_hash)
      );
      if (!ok) throw posError('POS_LOGIN_INVALID');

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
        permissions: permissionsFor(row),
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
      throw posError('POS_PAIR_INPUT_MISSING');
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

      // No session → no privileges. Dev builds keep the old first-boot
      // convenience so there is still something to click without a seeded user.
      if (!user) {
        const devAdmin = allowAnonymousAdmin();
        return {
          id: null,
          name: devAdmin ? 'Admin (dev)' : 'Signed out',
          role: devAdmin ? 'admin' : null,
          email: null,
          is_admin: devAdmin,
          branch_id: store.get('branch_id') ?? null,
          is_active: devAdmin ? 1 : 0,
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
        permissions: permissionsFor(user),
      };
    } catch (e) {
      // Never escalate on failure — a broken lookup is not an admin.
      console.error('auth:whoami failed; denying admin:', e);
      return {
        id: null,
        name: 'Signed out',
        role: null,
        email: null,
        is_admin: false,
        branch_id: store.get('branch_id') ?? null,
        is_active: 0,
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

    meta.set('pos.unpaired_reason', 'manual');
    meta.set('pos.unpaired_at', String(Date.now()));

    return { ok: true };
  });
}
