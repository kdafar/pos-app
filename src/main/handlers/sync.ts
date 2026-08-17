import type { IpcMain } from 'electron';
import https from 'node:https';
import { URL } from 'node:url';
import axios from 'axios';
import db, {
  getMeta,
  setMeta,
  enforcePosLockKillSwitch,
  markDeviceRevoked,
  clearPosLock,
} from '../db';
import { PUSHABLE_STATUSES, sqlList } from '../utils/orderStatus';
import { safePushStatus } from '../utils/serverStatus';
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
  applyPushResult,
} from '../utils/orderNumbers';

import type { MainServices } from '../types/common';

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

  // Split tender is expressed as payments[]; the singular payment{} form only
  // supports a single method and takes its amount from grand_total (§A2).
  const payments = o.payment_method_slug
    ? [{ method: o.payment_method_slug, amount: Number(o.grand_total || 0) }]
    : [];

  return {
    // temp_id is the server's idempotency key — it reads this, NOT `id`.
    // Without it the server minted a fresh ULID on every push, so retries
    // duplicated and the ack came back under an id we had never seen. Must be
    // stable across every retry of the same order.
    temp_id: o.id,
    id: o.id, // harmless duplicate; unknown keys are ignored
    number: o.number,
    device_id: o.device_id,
    branch_id: o.branch_id,
    // Sent as a whitelisted code (1,2,3,4,7). The server is the truth for
    // status, so this may only ever move an order forward: several ordinary
    // till actions re-queue a push (close, payment-method change, delivery-fee
    // edit), and each would otherwise resend a stale local status over one the
    // dashboard had already advanced.
    status: safePushStatus(o.status, o.status_code),
    local_status: o.status,
    order_type: o.order_type,
    payments,
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
      SELECT o.id
      FROM orders o
      WHERE o.status IN (${sqlList(PUSHABLE_STATUSES)})
        AND (o.synced_at IS NULL OR o.synced_at = 0)
        -- Never replay pre-temp_id pushes: the server stored them under a
        -- ULID nothing can map back, so a re-push duplicates a real sale.
        AND COALESCE(o.push_legacy, 0) = 0
        -- Server seed rows (recent-orders feed, for phone lookup) live here
        -- too and carry no local lines. Pushing one back would echo the
        -- server's own order at it.
        AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id)
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

/**
 * Reserve the server's order reference for an order still being built.
 *
 * The reference is allocated server-side and only comes back in a push ack, and
 * until now nothing was pushed before `placed`. So the number a customer quotes
 * and the number on the dashboard did not exist while the order was on screen,
 * and the receipt fell back to the local POS-… string.
 *
 * This pushes the order once, as soon as it has a line, purely to obtain that
 * number. It is safe to do early because the push is idempotent on `temp_id`
 * (the server matches on it, not on `id`), so the real push at place/close
 * updates the same record rather than creating a second one — and `markForRepush`
 * clears `synced_at` at those points, so that later push still happens.
 *
 * Deliberately best-effort: it never throws, never blocks the cashier, and a
 * till that is offline or whose server rejects an incomplete order simply
 * carries on with the local number, exactly as before.
 */
async function reserveOrderReference(orderId: string): Promise<string | null> {
  try {
    const row = db
      .prepare(
        `SELECT id, status, reference_no,
                (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS lines
         FROM orders o WHERE o.id = ?`
      )
      .get(orderId) as any;

    if (!row) return null;
    if (row.reference_no) return String(row.reference_no); // already have one
    if (!Number(row.lines)) return null; // nothing to reserve against
    if (Number(row.push_legacy ?? 0) === 1) return null;

    const payload = safeBuildOrderPayload(orderId);
    if (!payload) return null;

    const envelope = {
      client_msg_id: `pos-res-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    };
    const result = await pushOutbox(envelope, { orders: [payload] });
    applyPushResult(result);

    const after = db
      .prepare('SELECT reference_no FROM orders WHERE id = ?')
      .pluck()
      .get(orderId) as string | null;
    return after ?? null;
  } catch (e) {
    // An order that cannot be reserved is not an error the cashier can act on;
    // it just means the receipt shows the local number.
    console.warn('[sync] reference reservation failed', (e as any)?.message);
    return null;
  }
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
        `SELECT COUNT(*) FROM orders WHERE status IN (${sqlList(PUSHABLE_STATUSES)}) AND (synced_at IS NULL OR synced_at = 0)`
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

export function registerSyncHandlers(ipcMain: IpcMain, services: MainServices) {
  const { store } = services;
  ipcMain.handle('sync:configure', async (_e, baseUrl: string) => {
    const device_id =
      getMeta('device_id') ||
      store.get('device_id') ||
      store.get('server.device_id') ||
      '';
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

      const result = await pairDevice(
        baseUrl,
        pairCode,
        branchId,
        deviceName,
        mid
      );

      // pairDevice used to return only { deviceId, branchId }, so this read was
      // always undefined and the whole block below was dead — including the
      // clearPosLock() that a re-pair depends on. A till carrying a stale
      // pos.locked=1 could therefore never pair again: the check below threw
      // every time, and the only line that could clear the flag never ran.
      // Deleting the local DB was the sole escape.
      const device = result?.device;
      if (device) {
        // Save killswitch days
        if (device.killswitch_after_days != null) {
          setMeta(
            'security.kill_after_days',
            String(device.killswitch_after_days)
          );
        }

        // Save lock status
        if (device.locked_at) {
          // device is locked RIGHT NOW
          setMeta('pos.locked', '1');
          setMeta('pos.lock_reason', 'server_locked');
          setMeta(
            'pos.locked_at',
            String(new Date(device.locked_at).getTime())
          );
        } else {
          clearPosLock();
        }
      }

      // Immediately enforce lock policy if server says locked
      const outcome = enforcePosLockKillSwitch();
      if (outcome.action !== 'none') {
        throw new Error(
          'This device has been locked by the server. Contact your administrator.'
        );
      }

      // Fresh pairing succeeded — drop the "why were we unpaired" banner.
      setMeta('pos.unpaired_reason', '');
      setMeta('pos.unpaired_at', '');

      return result;
    }
  );

  ipcMain.handle('sync:bootstrap', async (_e, baseUrl?: string) => {
    ensureOrderNumberDedupeTriggers();
    const url = baseUrl || getMeta('server.base_url') || '';
    if (!url) throw new Error('Missing base URL');

    let payload: any;
    try {
      // 1. Run bootstrap logic
      payload = await bootstrap(url);
    } catch (err: any) {
      // 🔒 If backend says "Locked", enforce local kill-switch
      if (axios.isAxiosError(err) && err.response?.status === 423) {
        const data = err.response.data as any;
        const lockedAt = data?.locked_at;

        console.warn(
          '[sync:bootstrap] Device locked by server. Enforcing kill-switch.',
          {
            lockedAt,
          }
        );

        // A lock is reversible: stop syncing, keep every local row and the
        // whole outbox. An admin unlock resumes the same token (§6.4).
        setMeta('pos.locked', '1');
        setMeta('pos.lock_reason', 'server_locked');
        if (lockedAt) {
          setMeta('pos.locked_at', String(new Date(lockedAt).getTime()));
        }

        return { ok: false, reason: 'locked' as const, locked_at: lockedAt };
      }

      // 401 covers both a revoked device and a merely invalid/expired token,
      // so distinguish on the message — only an explicit revoke unpairs, and
      // even then local data is preserved (§6.4).
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        const msg = String((err.response.data as any)?.message ?? '');
        if (/revoked/i.test(msg)) {
          markDeviceRevoked();
          return { ok: false, reason: 'revoked' as const };
        }
        return { ok: false, reason: 'unauthorized' as const };
      }

      console.error('[sync:bootstrap] failed', err);
      throw err; // rethrow other errors
    }

    const device = payload?.device;
    if (device) {
      if (device.killswitch_after_days != null) {
        setMeta(
          'security.kill_after_days',
          String(device.killswitch_after_days)
        );
      }

      if (device.locked_at) {
        setMeta('pos.locked', '1');
        setMeta('pos.lock_reason', 'server_locked');
        setMeta('pos.locked_at', String(new Date(device.locked_at).getTime()));
      } else {
        clearPosLock();
      }
    }

    // Locked → stop here without importing. Nothing is destroyed; the till
    // keeps its catalog and outbox until an admin unlocks it (§6.4).
    const lockOutcome = enforcePosLockKillSwitch();
    if (lockOutcome.action !== 'none') {
      return {
        ok: false,
        reason: 'locked' as const,
        locked_at: device?.locked_at ?? null,
      };
    }

    const cat = payload?.catalog || {};
    console.log('[sync:bootstrap] payload snapshot', {
      branch: payload?.branch || null,
      items: Array.isArray(cat.items) ? cat.items.length : 0,
      item_variations: Array.isArray(cat.item_variations)
        ? cat.item_variations.length
        : 0,
      item_addon_groups: Array.isArray(cat.item_addon_groups)
        ? cat.item_addon_groups.length
        : 0,
      addons: Array.isArray(cat.addons) ? cat.addons.length : 0,
      promos: Array.isArray(cat.promos) ? cat.promos.length : 0,
    });

    // Optional: sample a specific item to see its addon groups
    try {
      const sampleItemId = '66'; // e.g. Burger Smash truffle
      const itemAddonGroups =
        Array.isArray(cat.item_addon_groups) && cat.item_addon_groups.length
          ? cat.item_addon_groups.filter((g: any) => g.item_id === sampleItemId)
          : [];
      console.log('[sync:bootstrap] item addon groups for item', sampleItemId, {
        itemAddonGroups,
      });
    } catch (e) {
      console.warn('[sync:bootstrap] debug item_addon_groups failed', e);
    }

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

  /**
   * Ask the server for this order's reference number now, rather than at place.
   *
   * Fired when the first line lands in the cart, so the number is on screen and
   * on the receipt for the whole of the sale. Returns null when it cannot be
   * had — offline, or a server that will not take an incomplete order — and the
   * caller simply keeps showing the local number.
   */
  ipcMain.handle('sync:reserveReference', async (_e, orderId: string) => {
    if (!orderId) return null;
    return reserveOrderReference(String(orderId));
  });

  ipcMain.handle('sync:run', async () => {
    console.log('[Sync] Manual sync:run triggered');

    const mode = getMeta('pos.mode') || 'live';

    if (mode !== 'live') {
      console.log('[Sync] Skipping manual sync: offline mode');
      return { ok: false, reason: 'offline' as const };
    }

    const base = getMeta('server.base_url') || '';
    const device_id =
      getMeta('device_id') ||
      store.get('device_id') ||
      store.get('server.device_id') ||
      '';
    const branch_id = Number(getMeta('branch_id') || 0);
    const token = await loadSecret('device_token');

    // ❌ DON'T touch bootstrap.last_at here

    if (!base || !device_id || !token) {
      console.log(
        '[Sync] Skipping manual sync: not configured (missing URL, device ID, or token)',
        { hasBase: !!base, hasDeviceId: !!device_id, hasToken: !!token }
      );
      return { ok: false, reason: 'not_configured' as const };
    }

    ensureOrderNumberDedupeTriggers();
    normalizeDuplicateOrderNumbers();

    configureApi(base, { id: device_id, branch_id }, token);

    console.log('[Sync] Manual sync: running FULL bootstrap…');

    let payload: any;
    try {
      payload = await bootstrap(base);

      // ✅ Only here: we know we actually reached the server
      setMeta('bootstrap.last_at', String(Date.now()));
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response?.status === 423) {
        const data = err.response.data as any;
        const lockedAt = data?.locked_at;

        console.warn(
          '[Sync] Manual sync: device locked by server. Enforcing kill-switch.',
          { lockedAt }
        );

        setMeta('pos.locked', '1');
        setMeta('pos.lock_reason', 'server_locked');
        if (lockedAt) {
          setMeta('pos.locked_at', String(new Date(lockedAt).getTime()));
        }

        return { ok: false, reason: 'locked' as const, locked_at: lockedAt };
      }

      console.error('[Sync] Manual sync: bootstrap failed', err);
      throw err;
    }

    // The unlock half of the kill-switch. sync:run is the ONLY sync the running
    // till ever performs — the Sync button, the 10s auto-sync and login all land
    // here, while sync:bootstrap runs only while pairing. Without this the lock
    // was one-way: a 423 set pos.locked and nothing on the success path ever
    // cleared it, so an admin pressing Unlock left the till dead until it was
    // re-paired. §6.4 says a lock is reversible, so honour that here too.
    const syncDevice = payload?.device;
    if (syncDevice) {
      if (syncDevice.killswitch_after_days != null) {
        setMeta(
          'security.kill_after_days',
          String(syncDevice.killswitch_after_days)
        );
      }

      if (syncDevice.locked_at) {
        setMeta('pos.locked', '1');
        setMeta('pos.lock_reason', 'server_locked');
        setMeta(
          'pos.locked_at',
          String(new Date(syncDevice.locked_at).getTime())
        );
      } else {
        clearPosLock();
      }
    }

    // Still locked → stop before importing or pushing. Nothing is destroyed;
    // the catalog and the outbox wait for the unlock.
    const runLockOutcome = enforcePosLockKillSwitch();
    if (runLockOutcome.action !== 'none') {
      console.warn('[Sync] Manual sync halted — till is locked.', runLockOutcome);
      return {
        ok: false,
        reason: 'locked' as const,
        locked_at: syncDevice?.locked_at ?? null,
      };
    }

    const cat = payload?.catalog || {};
    console.log('[Sync] Manual bootstrap snapshot', {
      items: Array.isArray(cat.items) ? cat.items.length : 0,
      item_addon_groups: Array.isArray(cat.item_addon_groups)
        ? cat.item_addon_groups.length
        : 0,
      addons: Array.isArray(cat.addons) ? cat.addons.length : 0,
    });

    setMeta('bootstrap.done', '1');

    console.log('[Sync] Manual sync: running incremental pull…');
    await pullChanges();

    prefetchItemImages(5).catch((err) => console.error('Prefetch error', err));

    let pushedCount = 0;
    const pending =
      (db
        .prepare(
          `
        SELECT COUNT(*)
        FROM orders
        WHERE status IN (${sqlList(PUSHABLE_STATUSES)})
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
        const result = await pushOutbox(envelope, { orders: batch });
        // Only clear what the server actually acked; retryable failures stay
        // queued under the same temp_id so the retry is idempotent.
        const applied = applyPushResult(result);
        pushedCount = applied.acked;
        if (applied.retryable || applied.dropped) {
          console.warn('[Sync] push partial', {
            sent: batch.length,
            ...applied,
          });
        }
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
          `SELECT COUNT(*) FROM orders WHERE status IN (${sqlList(PUSHABLE_STATUSES)}) AND (synced_at IS NULL OR synced_at=0)`
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
