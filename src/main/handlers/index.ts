import { ipcMain } from 'electron';
import { CatalogRepo } from '../repositories/catalogRepository';
import { OrderRepo } from '../repositories/orderRepository';
import { DineinRepo } from '../repositories/dineinRepository';
import { SystemRepo } from '../repositories/systemRepository';
import db, { getMeta, setMeta } from '../db';
import { loadSecret, saveSecret, deleteSecret } from '../secureStore';
import { configureApi, registerDevice, verifyToken, pullChanges, pushOutbox } from '../sync';

// Catalog
ipcMain.handle('catalog:listCategories', () => CatalogRepo.listCategories());
ipcMain.handle('catalog:listSubcategories', (_e, categoryId?: string) => CatalogRepo.listSubcategories(categoryId));
ipcMain.handle('catalog:listItems', (_e, filter?: any) => CatalogRepo.listItems(filter));
ipcMain.handle('catalog:listPromos', () => CatalogRepo.listPromos());

// Orders
ipcMain.handle('orders:start', (_e, args: { orderType?:number; branchId?:number; deviceId?:string }) => OrderRepo.start(args ?? {}));
ipcMain.handle('orders:get', (_e, orderId: string) => OrderRepo.get(orderId));
ipcMain.handle('orders:addLine', (_e, orderId: string, itemId: string, qty = 1) => OrderRepo.addLine(orderId, itemId, qty));
ipcMain.handle('orders:setType', (_e, orderId: string, type: 1|2|3) => OrderRepo.setOrderType(orderId, type));
ipcMain.handle('orders:setCustomer', (_e, orderId: string, info: any) => OrderRepo.setCustomer(orderId, info));
ipcMain.handle('orders:setStatus', (_e, orderId: string, status: string) => OrderRepo.setStatus(orderId, status as any));
ipcMain.handle('orders:listActive', () => OrderRepo.listActive());
ipcMain.handle('orders:listPrepared', (_e, limit?: number) => OrderRepo.listPrepared(limit ?? 12));

// Dine-in
ipcMain.handle('dinein:listTables', () => DineinRepo.listTables());

// System
ipcMain.handle('system:listPaymentMethods', () => SystemRepo.listPaymentMethods());
ipcMain.handle('system:listStates', () => SystemRepo.listStates());
ipcMain.handle('system:listCities', () => SystemRepo.listCities());
ipcMain.handle('system:listBlocks', () => SystemRepo.listBlocks());

// Settings / KV
ipcMain.handle('settings:getAll', () => db.prepare(`SELECT key, value FROM app_settings ORDER BY key`).all());
ipcMain.handle('settings:set', (_e, key: string, value: string) => {
  db.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, value);
  return true;
});

// Tiny store (meta) to keep your previous bridge API stable
ipcMain.handle('store:get', (_e, key: string) => getMeta(key));
ipcMain.handle('store:set', (_e, key: string, value: string) => { setMeta(key, value); return true; });

const SERVICE = 'pos-app';

// --- bootstrap status: never call keytar if not paired ---
ipcMain.handle('app:ensureBootstrap', async () => {
  const baseUrl  = getMeta('api.base') as string | null;
  const deviceId = getMeta('device.id') as string | null;

  if (!baseUrl) return { ok: false, step: 'CONFIG_URL' };
  configureApi(baseUrl);

  if (!deviceId || deviceId.trim() === '') {
    return { ok: false, step: 'PAIR', reason: 'NO_DEVICE' };
  }

  const token = await loadSecret(SERVICE, `device:${deviceId}`);
  if (!token) return { ok: false, step: 'PAIR', reason: 'NO_TOKEN', deviceId };

  let valid = true;
  try { valid = await verifyToken(token); } catch { /* allow offline */ }
  if (!valid) return { ok: false, step: 'PAIR', reason: 'INVALID_TOKEN', deviceId };

  return { ok: true, deviceId, baseUrl };
});

// --- configure base URL ---
ipcMain.handle('sync:configure', async (_e, baseUrl: string) => {
  if (!baseUrl) throw new Error('Base URL is required');
  setMeta('api.base', baseUrl);
  configureApi(baseUrl);
  return true;
});

// --- pair using pair code -> stores device.id + token (in keytar) ---
ipcMain.handle('sync:bootstrap', async (_e, baseUrl: string | null, pairCode: string) => {
  if (baseUrl) setMeta('api.base', baseUrl);
  const url = getMeta('api.base') as string | null;
  if (!url) throw new Error('Base URL not configured');
  configureApi(url);

  if (!pairCode) throw new Error('Pair code is required');

  const { deviceId, token } = await registerDevice(pairCode);
  setMeta('device.id', deviceId);
  await saveSecret(SERVICE, `device:${deviceId}`, token);
  return { deviceId };
});

// --- pull / push use the stored token safely ---
ipcMain.handle('sync:pull', async () => {
  const baseUrl  = getMeta('api.base') as string | null;
  const deviceId = getMeta('device.id') as string | null;
  if (!baseUrl || !deviceId) throw new Error('Not configured');
  configureApi(baseUrl);
  const token = await loadSecret(SERVICE, `device:${deviceId}`);
  if (!token) throw new Error('Not paired');
  return pullChanges(token);
});

ipcMain.handle('sync:push', async (_e, envelope: any, batch: any) => {
  const baseUrl  = getMeta('api.base') as string | null;
  const deviceId = getMeta('device.id') as string | null;
  if (!baseUrl || !deviceId) throw new Error('Not configured');
  configureApi(baseUrl);
  const token = await loadSecret(SERVICE, `device:${deviceId}`);
  if (!token) throw new Error('Not paired');
  return pushOutbox(token, envelope, batch);
});

// --- optional: wipe pairing if you detect a fresh DB ---
ipcMain.handle('device:resetPairing', async () => {
  const deviceId = getMeta('device.id') as string | null;
  if (deviceId) await deleteSecret(SERVICE, `device:${deviceId}`);
  setMeta('device.id', ''); // mark as unpaired
  return true;
});