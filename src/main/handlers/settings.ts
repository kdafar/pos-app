// src/main/handlers/settings.ts
import type { IpcMain } from 'electron';
import db, { getMeta } from '../db';
import {
  readSettingRaw,
  readSettingBool,
  readSettingNumber,
} from '../services/settings'; // still used for generic settings handlers

// type for the POS user we return to the renderer
type PosUserInfo = {
  name: string;
  id: number | string | null;
  username: string | null;
  email: string | null;
  mobile: string | null; // ✅ added
  role: string | null;
  is_admin: number;
  deviceId: string | null;
  branchName: string | null;
  branchId: number;
};

function getCurrentPosUserFromDb(): PosUserInfo {
  const rawUserId = getMeta('auth.user_id');
  const userId = rawUserId ? Number(rawUserId) : null;

  let user:
    | {
        id: number;
        name: string;
        username: string | null;
        email: string | null;
        role: string | null;
        branch_id: number | null;
        mobile: string | null; // ✅ we only use mobile from DB
      }
    | undefined;

  if (userId && !Number.isNaN(userId)) {
    user = db
      .prepare(
        `
        SELECT
          id,
          name,
          username,
          email,
          role,
          branch_id,
          mobile
        FROM pos_users
        WHERE id = ?
      `
      )
      .get(userId) as any;
  }

  const branchId =
    (user && user.branch_id != null
      ? user.branch_id
      : Number(getMeta('branch_id') ?? 0)) || 0;

  const role = (user?.role || '').toLowerCase();
  const isAdmin = ['admin', 'owner', 'manager', 'super_admin'].includes(role)
    ? 1
    : 0;

  return {
    // old keys — keep compatibility
    name: user?.name ?? 'POS User',
    id: user?.id ?? null,

    // extra info
    username: user?.username ?? null,
    email: user?.email ?? null,
    mobile: user?.mobile ?? null, // ✅ this is what quick mode will use
    role: user?.role ?? null,
    is_admin: isAdmin,

    deviceId: (getMeta('device_id') as string) ?? null,
    branchName: (getMeta('branch.name') as string) ?? null,
    branchId,
  };
}

export function registerSettingsHandlers(ipcMain: IpcMain) {
  // single value getters
  ipcMain.handle('settings:get', async (_e, key: string) =>
    readSettingRaw(key)
  );

  ipcMain.handle(
    'settings:getBool',
    async (_e, key: string, fallback = false) => readSettingBool(key, fallback)
  );

  ipcMain.handle('settings:getNumber', async (_e, key: string, fallback = 0) =>
    readSettingNumber(key, fallback)
  );

  // list all (from app_settings)
  const getAllSettings = () => {
    return db
      .prepare(`SELECT key, value FROM app_settings ORDER BY key ASC`)
      .all();
  };

  ipcMain.handle('settings:all', async () => getAllSettings());
  ipcMain.handle('settings:getAll', async () => getAllSettings()); // alias

  ipcMain.handle('meta:list', () => {
    return db.prepare('SELECT key, value FROM meta ORDER BY key').all();
  });

  // POS user info
  ipcMain.handle('settings:getPosUser', async () => {
    return getCurrentPosUserFromDb();
  });

  ipcMain.handle('debug:syncPosTime', async () => {
    const { syncPosTime } = await import('../sync');
    await syncPosTime();
    return { ok: true };
  });
}
