// src/main/utils/orderNumbers.ts

import db, { getMeta, setMeta } from '../db';
import { createSettingsService } from '../services/settings';
import type {
  DatabaseService,
  SettingsService,
  KVStore,
  MainServices,
} from '../types/common';

export type OrderNumberStyle = 'short' | 'mini';

interface NumberServices {
  rawDb: DatabaseService;
  settings: SettingsService;
  meta: KVStore;
}

/* ------------------------------------------------------------------
 * Global fallback services (for handlers that don't have MainServices)
 * ------------------------------------------------------------------ */

const metaStore: KVStore = {
  get(key: string): any {
    try {
      return getMeta(key);
    } catch {
      return undefined;
    }
  },
  set(key: string, value: any): void {
    try {
      setMeta(key, String(value));
    } catch {
      // best-effort only
    }
  },
};

let cachedServices: NumberServices | null = null;

function getNumberServices(): NumberServices {
  if (cachedServices) return cachedServices;

  const settings = createSettingsService({
    db: db as unknown as DatabaseService,
    store: metaStore,
  });

  cachedServices = {
    rawDb: db as unknown as DatabaseService,
    settings,
    meta: metaStore,
  };

  return cachedServices;
}

/* ------------------------------------------------------------------
 * Core helpers (work with NumberServices or MainServices)
 * ------------------------------------------------------------------ */

function getOrderNumberStyle(
  services: NumberServices | MainServices
): OrderNumberStyle {
  const raw = (services.settings.getRaw('orders.number_style') ?? 'short')
    .toString()
    .toLowerCase();

  return raw === 'mini' ? 'mini' : 'short';
}

function getOrderNumberPrefix(services: NumberServices | MainServices): string {
  const raw = (services.settings.getRaw('orders.number_prefix') ?? 'POS')
    .toString()
    .trim();

  return raw || 'POS';
}

function randBase36(len: number): string {
  let s = '';
  while (s.length < len) {
    s += Math.random().toString(36).slice(2).toUpperCase();
  }
  return s.slice(0, len);
}

function deviceSuffix(services: NumberServices | MainServices): string {
  const d = services.meta.get('device_id') || 'LOCAL';
  return String(d).slice(-4).toUpperCase();
}

/* ------------------------------------------------------------------
 * Public API: generation & allocation
 * ------------------------------------------------------------------ */

/**
 * Build a candidate order number (may still collide).
 *
 * Can be called with:
 *   - genCandidateOrderNumber(services)  // from order service
 *   - genCandidateOrderNumber()          // from handlers (uses global db/meta/settings)
 */
export function genCandidateOrderNumber(
  svcs?: NumberServices | MainServices
): string {
  const services =
    (svcs as NumberServices | MainServices) ?? getNumberServices();
  const style = getOrderNumberStyle(services);
  const prefix = getOrderNumberPrefix(services);
  const dev = deviceSuffix(services);

  // order_number is globally UNIQUE server-side (varchar(100)), so two branches
  // generating the same number makes the second push fail forever. Namespacing
  // by BRANCH — not device — follows the server's own split-order precedent:
  // the device is already carried in external_id, and a branch prefix keeps the
  // number stable when a till is reinstalled, which is exactly when a human is
  // reading it off a receipt.
  const branch = String(services.meta?.get?.('branch_id') ?? '').replace(
    /\D/g,
    ''
  );
  const scope = branch ? `${branch}-` : '';

  if (style === 'mini') {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const rand = randBase36(2);

    // Example: POS-12-20251109QHAB
    return `${prefix}-${scope}${ymd}${dev.slice(0, 2)}${rand}`;
  }

  // Default 'short' – Example: POS-12-QHHC3NTK
  const rand = randBase36(4);
  return `${prefix}-${scope}${dev}${rand}`;
}

/**
 * Allocate a unique order number, checking the DB for collisions.
 * Attempts up to 6 times, then falls back to a timestamp-based ID.
 *
 * Can be called with or without services (same as genCandidateOrderNumber).
 */
export function allocUniqueOrderNumber(
  svcs?: NumberServices | MainServices
): string {
  const services =
    (svcs as NumberServices | MainServices) ?? getNumberServices();
  const dbLocal = services.rawDb;

  for (let i = 0; i < 6; i++) {
    const n = genCandidateOrderNumber(services);
    const exists = dbLocal
      .prepare('SELECT 1 FROM orders WHERE number = ? LIMIT 1')
      .get(n);
    if (!exists) return n;
  }

  // Ultra-rare fallback: add a high-res counter
  const dev = deviceSuffix(services);
  const n = `POS-${Date.now()}-${process.hrtime
    .bigint()
    .toString()
    .slice(-6)}-${dev}`;
  return n;
}

/* ------------------------------------------------------------------
 * Normalisation & triggers
 * ------------------------------------------------------------------ */

/**
 * Normalize duplicate existing numbers BEFORE we enforce a UNIQUE index.
 * Keeps the first row as-is and renumbers later duplicates.
 *
 * Can be called:
 *   - normalizeDuplicateOrderNumbers(services)
 *   - normalizeDuplicateOrderNumbers()
 */
export function normalizeDuplicateOrderNumbers(
  svcs?: NumberServices | MainServices
): void {
  const services =
    (svcs as NumberServices | MainServices) ?? getNumberServices();
  const dbLocal = services.rawDb;

  try {
    const dups = dbLocal
      .prepare(
        `
        SELECT number
        FROM orders
        GROUP BY number
        HAVING COUNT(*) > 1
      `
      )
      .all() as Array<{ number: string }>;

    for (const { number } of dups) {
      const rows = dbLocal
        .prepare(
          `
          SELECT id
          FROM orders
          WHERE number = ?
          ORDER BY created_at ASC, rowid ASC
        `
        )
        .all(number) as Array<{ id: string }>;

      // Keep the first row as-is, re-number the rest
      for (let i = 1; i < rows.length; i++) {
        const newNum = allocUniqueOrderNumber(services);
        dbLocal
          .prepare(`UPDATE orders SET number = ? WHERE id = ?`)
          .run(newNum, rows[i].id);
      }
    }
  } catch {
    // best-effort only
  }
}

/**
 * Install BEFORE INSERT / BEFORE UPDATE triggers that "kick out"
 * old rows trying to keep the same number as a new order.
 * Also ensures a UNIQUE index on orders(number).
 *
 * Can be called:
 *   - ensureOrderNumberDedupeTriggers(services)
 *   - ensureOrderNumberDedupeTriggers()
 */
export function ensureOrderNumberDedupeTriggers(
  svcs?: NumberServices | MainServices
): void {
  const services =
    (svcs as NumberServices | MainServices) ?? getNumberServices();
  const dbLocal = services.rawDb;

  try {
    dbLocal.exec(`
      CREATE TRIGGER IF NOT EXISTS tr_orders_num_dedupe_ins
      BEFORE INSERT ON orders
      WHEN EXISTS (
        SELECT 1 FROM orders WHERE number = NEW.number AND id <> NEW.id
      )
      BEGIN
        UPDATE orders
        SET number = 'L-' || NEW.number || '-' || LOWER(HEX(RANDOMBLOB(3)))
        WHERE number = NEW.number AND id <> NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS tr_orders_num_dedupe_upd
      BEFORE UPDATE OF number ON orders
      WHEN NEW.number IS NOT NULL AND EXISTS (
        SELECT 1 FROM orders WHERE number = NEW.number AND id <> NEW.id
      )
      BEGIN
        UPDATE orders
        SET number = 'L-' || NEW.number || '-' || LOWER(HEX(RANDOMBLOB(3)))
        WHERE number = NEW.number AND id <> NEW.id;
      END;
    `);

    dbLocal.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_unique ON orders(number)`
    );
  } catch (e: any) {
    console.warn('ensureOrderNumberDedupeTriggers failed:', e?.message);
  }
}

/* ------------------------------------------------------------------
 * Sync helpers: used by handlers/sync.ts
 * ------------------------------------------------------------------ */

/**
 * Collect unsynced completed orders as payloads ready to send.
 */
export function collectUnsyncedOrders(limit = 50): any[] {
  const ids =
    (db
      .prepare(
        `
        SELECT id
        FROM orders
        WHERE status = 'completed'
          AND (synced_at IS NULL OR synced_at = 0)
        ORDER BY completed_at ASC, created_at ASC, id ASC
        LIMIT ?
      `
      )
      .all(limit) as Array<{ id: string }>) || [];

  const payloads: any[] = [];
  for (const row of ids) {
    const p = buildOrderPayload(row.id);
    if (p) payloads.push(p);
  }
  return payloads;
}

/**
 * Mark orders as synced (sets synced_at to now).
 */
/**
 * Apply a /push response.
 *
 * The backend's outbox rule: clear ONLY the temp_ids present in `ack`.
 * Anything in `warnings[]` with retryable:true must stay queued and be retried
 * under the SAME temp_id — that is what makes the retry idempotent instead of
 * duplicating a sale. retryable:false is permanent (e.g. the order is already
 * terminal server-side) and must be dropped rather than retried forever.
 *
 * `references` carries the human-facing running number (0001, 0002…) the server
 * allocates after insert, so a till can print it on a receipt for a sale it
 * took while offline.
 */
export function applyPushResult(result: any): {
  acked: number;
  retryable: number;
  dropped: number;
} {
  const ack = (result?.ack ?? {}) as Record<string, string>;
  const references = (result?.references ?? {}) as Record<string, string>;
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  const setSynced = db.prepare(
    `UPDATE orders
        SET synced_at  = strftime('%s','now'),
            server_id  = COALESCE(?, server_id),
            reference_no = COALESCE(?, reference_no)
      WHERE id = ?`
  );
  const setRef = db.prepare(
    `UPDATE orders SET reference_no = ? WHERE id = ?`
  );
  const dropPermanent = db.prepare(
    `UPDATE orders SET push_legacy = 1 WHERE id = ?`
  );

  let acked = 0;
  let retryable = 0;
  let dropped = 0;

  const tx = db.transaction(() => {
    for (const [tempId, serverId] of Object.entries(ack)) {
      setSynced.run(
        serverId != null ? String(serverId) : null,
        references[tempId] != null ? String(references[tempId]) : null,
        tempId
      );
      acked++;
    }

    // A reference can arrive for an order that was already acked earlier.
    for (const [tempId, ref] of Object.entries(references)) {
      if (!(tempId in ack) && ref != null) setRef.run(String(ref), tempId);
    }

    for (const w of warnings) {
      const tempId = w?.temp_id ?? w?.tempId;
      if (!tempId) continue;
      if (w?.retryable === false) {
        // Permanent: stop replaying it, but keep the row for reconciliation.
        dropPermanent.run(String(tempId));
        dropped++;
        console.warn('[push] permanent failure, removed from outbox', w);
      } else {
        retryable++;
        console.warn('[push] retryable failure, staying queued', w);
      }
    }
  });
  tx();

  return { acked, retryable, dropped };
}

export function markOrdersSynced(orderIds: string[]): void {
  if (!orderIds.length) return;

  const stmt = db.prepare(
    `UPDATE orders SET synced_at = strftime('%s','now') WHERE id = ?`
  );
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) {
      stmt.run(id);
    }
  });
  tx(orderIds);
}

/**
 * Build a single order payload (order + items) for pushing to server.
 * Returns null if the order does not exist.
 */
export function buildOrderPayload(orderId: string): any | null {
  const order = db
    .prepare(`SELECT * FROM orders WHERE id = ? LIMIT 1`)
    .get(orderId) as any | undefined;

  if (!order) return null;

  const items =
    (db
      .prepare(
        `
        SELECT *
        FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC
      `
      )
      .all(orderId) as any[]) || [];

  // Minimal sane payload – backend can shape it as needed.
  return {
    ...order,
    items,
  };
}
