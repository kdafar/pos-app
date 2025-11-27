import type { IpcMain } from 'electron';
import https from 'node:https';
import { URL } from 'node:url';

import db, { getMeta, setMeta } from '../db';
import { loadSecret } from '../secureStore';
import { readOrCreateMachineId } from '../machineId';
import {
  bootstrap,
  configureApi,
  pairDevice,
  pullChanges,
  pushOutbox,
} from '../sync';

import { prefetchItemImages } from '../imageCache';

// Order util
import {
  ensureOrderNumberDedupeTriggers,
  normalizeDuplicateOrderNumbers,
  markOrdersSynced,
} from '../utils/orderNumbers';

/* ------------------------------------------------------------------
 * 🛡️ ROBUST LOCAL HELPERS
 * ------------------------------------------------------------------ */

function hasColumn(table: string, column: string): boolean {
  try {
    const cols = db
      .prepare<unknown[]>(`PRAGMA table_info(${table})`)
      .all() as any[];
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

function safeBuildOrderPayload(orderId: string) {
  const o = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  if (!o) return null;

  const lines = db
    .prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`)
    .all(orderId);

  // Safe timestamp access
  const completedAt = o.completed_at || o.closed_at || o.updated_at;

  return {
    id: o.id,
    number: o.number,
    device_id: o.device_id,
    branch_id: o.branch_id,
    status: o.status,
    order_type: o.order_type,
    customer: {
      full_name: o.full_name,
      mobile: o.mobile,
      email: o.email,
    },
    address: {
      state_id: o.state_id,
      city_id: o.city_id,
      block_id: o.block_id,
      block: o.block,
      address_type: o.address_type,
      address: o.address,
      building: o.building,
      floor: o.floor,
      house_no: o.house_no,
      landmark: o.landmark,
      table_id: o.table_id,
      delivery_date: o.delivery_date,
    },
    payment: {
      method_id: o.payment_method_id,
      method_slug: o.payment_method_slug,
      type: o.payment_type,
      promocode: o.promocode,
    },
    totals: {
      subtotal: o.subtotal,
      tax_total: o.tax_total,
      discount_total: o.discount_total,
      delivery_fee: o.delivery_fee,
      grand_total: o.grand_total,
    },
    timestamps: {
      opened_at: o.opened_at,
      closed_at: o.closed_at,
      created_at: o.created_at,
      updated_at: o.updated_at,
      completed_at: completedAt,
    },
    lines,
  };
}

function safeCollectUnsyncedOrders(limit = 20) {
  const sortCol = hasColumn('orders', 'completed_at')
    ? 'completed_at'
    : 'created_at';

  const rows = db
    .prepare(
      `
      SELECT id
      FROM orders
      WHERE status = 'completed' AND (synced_at IS NULL OR synced_at = 0)
      ORDER BY ${sortCol} ASC
      LIMIT ?
    `
    )
    .all(limit) as Array<{ id: string }>;

  const payloads: any[] = [];
  for (const r of rows) {
    const p = safeBuildOrderPayload(r.id);
    if (p) payloads.push(p);
  }
  return payloads;
}

/* ------------------------------------------------------------------
 * Sync status + connectivity helpers
 * ------------------------------------------------------------------ */

type SyncStatus = {
  mode: 'live' | 'offline';
  last_sync_at: number;
  base_url: string;
  cursor: number;
  paired: boolean;
  token_present: boolean;
  device_id: string | null;
  branch_name: string;
  branch_id: number;
  unsynced: number;
  online: boolean;
};

const DEFAULT_CHECK_URL = 'https://www.google.com';

function checkOnlineOnce(target: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(target);
      const req = https.request(
        {
          method: 'HEAD',
          hostname: url.hostname,
          path: url.pathname || '/',
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          timeout: 5000,
        },
        (res) => {
          const ok = res.statusCode !== undefined && res.statusCode < 400;
          resolve(ok);
          req.destroy();
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function getSyncStatus(): Promise<SyncStatus> {
  const posMode = (getMeta('pos.mode') || 'live') as 'live' | 'offline';
  const base_url = getMeta('server.base_url') || '';
  const deviceId = getMeta('device_id') || null;
  const branch_name = getMeta('branch.name') || '';
  const branch_id = Number(getMeta('branch_id') || 0);
  const last_sync_at = Number(getMeta('sync.last_at') || 0);

  let token: string | null = null;
  if (deviceId) {
    token = (await loadSecret('device_token')) || null;
    if (!token) {
      await new Promise((r) => setTimeout(r, 100));
      token = (await loadSecret('device_token')) || null;
    }
  }

  const token_present = !!token;
  const paired = !!(deviceId && token_present);

  let cursor = 0;
  try {
    cursor = Number(
      db
        .prepare(`SELECT value FROM sync_state WHERE key = ?`)
        .pluck()
        .get('cursor') || 0
    );
  } catch {
    cursor = 0;
  }

  const unsynced =
    (db
      .prepare(
        `SELECT COUNT(*) FROM orders WHERE status = 'completed' AND (synced_at IS NULL OR synced_at = 0)`
      )
      .pluck()
      .get() as number) || 0;

  const target = base_url || DEFAULT_CHECK_URL;
  const online = await checkOnlineOnce(target);

  const mode: 'live' | 'offline' =
    online && posMode === 'live' ? 'live' : 'offline';

  return {
    mode,
    last_sync_at,
    base_url,
    cursor,
    paired,
    token_present,
    device_id: deviceId,
    branch_name,
    branch_id,
    unsynced,
    online,
  };
}

/* ------------------------------------------------------------------
 * Register sync-related IPC handlers
 * ------------------------------------------------------------------ */

export function registerSyncHandlers(ipcMain: IpcMain) {
  ipcMain.handle('sync:configure', async (_e, baseUrl: string) => {
    const device_id = getMeta('device_id') ?? '';
    const branch_id = Number(getMeta('branch_id') ?? 0);
    const token = await loadSecret('device_token');
    if (!device_id || !token) throw new Error('Not paired');

    setMeta('server.base_url', baseUrl);
    configureApi(baseUrl, { id: device_id, branch_id }, token);
  });

  ipcMain.handle(
    'sync:pair',
    async (
      _e,
      baseUrl: string,
      pairCode: string,
      branchId: string,
      deviceName: string
    ) => {
      const mid = await readOrCreateMachineId();
      setMeta('machine_id', mid);
      return pairDevice(baseUrl, pairCode, branchId, deviceName, mid);
    }
  );

  ipcMain.handle('sync:bootstrap', async (_e, baseUrl?: string) => {
    ensureOrderNumberDedupeTriggers();
    const url = baseUrl || getMeta('server.base_url') || '';
    if (!url) throw new Error('Missing base URL');

    // 1. Run bootstrap logic
    const payload = await bootstrap(url);

    // 2. Save Meta
    if (payload?.branch?.id) setMeta('branch_id', String(payload.branch.id));
    if (payload?.branch?.name)
      setMeta('branch.name', String(payload.branch.name));

    // 3. Upsert Users
    const users = payload?.catalog?.users || [];
    if (Array.isArray(users) && users.length) {
      const upsert = db.prepare(`
        INSERT INTO pos_users (id, name, username, email, role, password_hash, is_active, branch_id, updated_at)
        VALUES (@id, @name, NULL, @email, @role, @password_hash, @is_active, @branch_id, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,
          email=excluded.email,
          role=excluded.role,
          password_hash=excluded.password_hash,
          is_active=excluded.is_active,
          branch_id=excluded.branch_id,
          updated_at=excluded.updated_at
      `);
      const tx = db.transaction((list: any[]) => {
        for (const u of list) upsert.run(u);
      });
      tx(users);
    }

    // 4. Trigger Image Prefetch (NOW AWAITED & LOGGED)
    console.log('[sync] bootstrap completed, starting image prefetch...');
    try {
      await prefetchItemImages(5);
      console.log('[sync] image prefetch done');
    } catch (e: any) {
      console.warn('[sync] image prefetch failed:', e?.message || e);
    }

    return payload;
  });

  ipcMain.handle('sync:run', async () => {
    console.log('[Sync] Manual sync:run triggered');

    if ((getMeta('pos.mode') || 'live') !== 'live') {
      throw new Error('Offline mode: Sync disabled');
    }

    const base = getMeta('server.base_url') || '';
    const device_id = getMeta('device_id') || '';
    const branch_id = Number(getMeta('branch_id') || 0);
    const token = await loadSecret('device_token');

    if (!base || !device_id || !token) {
      throw new Error(
        'Not configured for sync (missing URL, device ID, or token)'
      );
    }

    ensureOrderNumberDedupeTriggers();
    normalizeDuplicateOrderNumbers();

    configureApi(base, { id: device_id, branch_id }, token);

    console.log('[Sync] Manual sync: running FULL bootstrap…');
    await bootstrap(base);
    setMeta('bootstrap.done', '1');

    console.log('[Sync] Manual sync: running incremental pull…');
    await pullChanges();

    // Trigger image prefetch after manual sync as well
    prefetchItemImages(5).catch((err) => console.error('Prefetch error', err));

    // Push logic...
    let pushedCount = 0;
    const pending =
      (db
        .prepare(
          `
        SELECT COUNT(*)
        FROM orders
        WHERE status = 'completed'
        AND (synced_at IS NULL OR synced_at = 0)
      `
        )
        .pluck()
        .get() as number) || 0;

    if (pending > 0) {
      const batch = safeCollectUnsyncedOrders(25);
      if (batch.length) {
        const envelope = {
          client_msg_id: `pos-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
        };
        await pushOutbox(envelope, { orders: batch });
        markOrdersSynced(batch.map((o) => o.id));
        pushedCount = batch.length;
      }
    }

    setMeta('sync.last_at', String(Date.now()));
    console.log(`[Sync] Manual sync:run complete. Pushed: ${pushedCount}`);

    return { ok: true, pulled: true, pushed: pushedCount };
  });

  ipcMain.handle('sync:pull', async () => {
    if ((getMeta('pos.mode') || 'live') !== 'live')
      throw new Error('Offline mode');
    return pullChanges();
  });

  ipcMain.handle('sync:push', async (_e, envelope, batch) => {
    if ((getMeta('pos.mode') || 'live') !== 'live')
      throw new Error('Offline mode');
    return pushOutbox(envelope, batch);
  });

  ipcMain.handle('app:ensureBootstrap', async () => {
    const itemsCount =
      (db.prepare('SELECT COUNT(*) FROM items').pluck().get() as number) || 0;

    // Even if items exist, we should check if images are missing and download them
    if (itemsCount > 0) {
      prefetchItemImages(3).catch(console.error); // Run in background
      return { bootstrapped: false, itemsCount };
    }

    const base = getMeta('server.base_url');
    if (!base)
      return {
        bootstrapped: false,
        itemsCount: 0,
        error: 'No server.base_url set',
      };

    await bootstrap(base);

    // Trigger download
    prefetchItemImages(5).catch(console.error);

    const after =
      (db.prepare('SELECT COUNT(*) FROM items').pluck().get() as number) || 0;
    return { bootstrapped: true, itemsCount: after };
  });

  ipcMain.handle('sync:setMode', async (_e, mode: 'live' | 'offline') => {
    setMeta('pos.mode', mode);
    return await getSyncStatus();
  });

  ipcMain.handle('sync:status', async () => {
    return await getSyncStatus();
  });

  ipcMain.handle('orders:unsyncedCount', async () => {
    const n =
      (db
        .prepare(
          `SELECT COUNT(*) FROM orders WHERE status='completed' AND (synced_at IS NULL OR synced_at=0)`
        )
        .pluck()
        .get() as number) || 0;
    return { count: n };
  });

  ipcMain.handle('orders:pushOne', async (_e, orderId: string) => {
    if ((getMeta('pos.mode') || 'live') !== 'live')
      throw new Error('Offline mode');

    const payload = safeBuildOrderPayload(orderId);
    if (!payload) throw new Error('Order not found');

    const envelope = {
      client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    await pushOutbox(envelope, { orders: [payload] });
    markOrdersSynced([orderId]);
    return { ok: true, pushed: 1 };
  });

  ipcMain.handle('sync:flushOrders', async (_e, limit = 20) => {
    if ((getMeta('pos.mode') || 'live') !== 'live')
      throw new Error('Offline mode');

    const toPush = safeCollectUnsyncedOrders(limit);
    if (!toPush.length) return { ok: true, pushed: 0 };

    const envelope = {
      client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    await pushOutbox(envelope, { orders: toPush });

    markOrdersSynced(toPush.map((o) => o.id));
    return { ok: true, pushed: toPush.length };
  });
}
