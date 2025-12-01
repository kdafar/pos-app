// src/main/handlers/settings.ts
import type { IpcMain } from 'electron';
import db, { getMeta } from '../db';
import {
  readSettingRaw,
  readSettingBool,
  readSettingNumber,
} from '../services/settings'; // use your service helpers

// type for the POS user we return to the renderer
type PosUserInfo = {
  name: string;
  id: number | string | null;
  username: string | null;
  email: string | null;
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
      }
    | undefined;

  if (userId && !Number.isNaN(userId)) {
    user = db
      .prepare(
        `
        SELECT id, name, username, email, role, branch_id
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

  return {
    // old keys — keep compatibility
    name: user?.name ?? readSettingRaw('pos.user_name') ?? 'POS User',
    id: user?.id ?? readSettingRaw('pos.user_id') ?? null,

    // extra info
    username: user?.username ?? null,
    email: user?.email ?? null,
    role: user?.role ?? null,
    is_admin: user?.role === 'admin' ? 1 : 0,

    deviceId: getMeta('device_id') ?? null,
    branchName: getMeta('branch.name') ?? null,
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
}
