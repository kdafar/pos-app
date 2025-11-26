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

  if (style === 'mini') {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const rand = randBase36(2);

    // Example: POS-20251109QHAB (YYYYMMDD + 2 char dev + 2 random char)
    return `${prefix}-${ymd}${dev.slice(0, 2)}${rand}`;
  }

  // Default 'short' – Example: POS-QHHC3NTK
  const rand = randBase36(4);
  return `${prefix}-${dev}${rand}`;
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
