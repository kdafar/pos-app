// src/main/handlers/store.ts
import type { IpcMain } from 'electron';
import { getMeta, setMeta } from '../db';
import { saveSecret, loadSecret } from '../secureStore';

export function registerStoreHandlers(ipcMain: IpcMain) {
  ipcMain.handle('store:set', async (_e, key: string, value: string) => {
    // special case: device_token goes in secure store
    if (key === 'device_token') {
      return saveSecret('device_token', value);
    }

    setMeta(key, value);
    return null;
  });

  ipcMain.handle('store:get', async (_e, key: string) => {
    if (key === 'device_token') {
      return loadSecret('device_token');
    }
    return getMeta(key) ?? null;
  });
}
