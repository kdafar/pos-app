// src/main/handlers/customers.ts
import type { IpcMain } from 'electron';
import db from '../db';

/**
 * Customer lookup by mobile.
 *
 * The renderer has always called `customers:findByMobile`, but no handler was
 * ever registered — the invoke rejected and the caller's catch swallowed it, so
 * the search box silently did nothing.
 *
 * Source of truth is the local `orders` table: sync seeds recent server orders
 * into it *specifically* for phone lookup (see sync.ts "recent orders seed"),
 * which means this keeps working when the till is offline. Numbers are matched
 * on their last 8 digits so 65556263, +96565556263 and 965-6555-6263 all agree.
 */
export function registerCustomerHandlers(ipcMain: IpcMain) {
  const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

  ipcMain.handle('customers:findByMobile', async (_e, mobile: string) => {
    const key = digits(mobile);
    if (key.length < 6) return null;

    // Kuwait numbers are 8 digits; ignore any country prefix on either side.
    const tail = key.slice(-8);

    try {
      const row = db
        .prepare(
          `
          SELECT
            full_name, mobile, email,
            address, building, floor, house_no, landmark,
            state_id, city_id, block_id, block,
            MAX(COALESCE(created_at, 0)) AS last_seen,
            COUNT(*) AS order_count
          FROM orders
          WHERE full_name IS NOT NULL AND TRIM(full_name) <> ''
            AND REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(mobile,''),' ',''),'-',''),'+',''),'(','')
                LIKE '%' || ?
          GROUP BY REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(mobile,''),' ',''),'-',''),'+',''),'(','')
          ORDER BY last_seen DESC
          LIMIT 1
        `
        )
        .get(tail) as any;

      if (!row) return null;

      return {
        full_name: row.full_name ?? '',
        mobile: row.mobile ?? mobile,
        email: row.email ?? '',
        address: row.address ?? '',
        building: row.building ?? '',
        floor: row.floor ?? '',
        house_no: row.house_no ?? '',
        landmark: row.landmark ?? '',
        state_id: row.state_id ?? null,
        city_id: row.city_id ?? null,
        block_id: row.block_id ?? null,
        block: row.block ?? '',
        order_count: Number(row.order_count ?? 0),
      };
    } catch (e: any) {
      console.error('[customers:findByMobile] failed:', e?.message || e);
      return null;
    }
  });

  /**
   * Orders held back from the automatic push at the temp_id cut-over.
   *
   * These were queued before the client sent `temp_id`, so the server may hold
   * them under a generated ULID that nothing can map back — re-pushing blindly
   * would duplicate a real sale. Reconcile against the server's order list
   * first, then release only what is genuinely missing.
   */
  ipcMain.handle('orders:listHeld', async () => {
    try {
      return db
        .prepare(
          `SELECT o.id, o.number, o.status, o.grand_total, o.full_name,
                  o.mobile, o.created_at,
                  (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS lines
             FROM orders o
            WHERE COALESCE(o.push_legacy, 0) = 1
            ORDER BY o.created_at DESC`
        )
        .all();
    } catch (e: any) {
      console.error('[orders:listHeld] failed:', e?.message || e);
      return [];
    }
  });

  /** Release specific held orders back into the push queue, by order number. */
  ipcMain.handle('orders:releaseHeld', async (_e, numbers: string[]) => {
    const list = Array.isArray(numbers) ? numbers.filter(Boolean) : [];
    if (!list.length) return { released: 0 };

    try {
      const stmt = db.prepare(
        `UPDATE orders SET push_legacy = 0 WHERE number = ? AND COALESCE(push_legacy,0) = 1`
      );
      let released = 0;
      const tx = db.transaction(() => {
        for (const n of list) released += stmt.run(String(n)).changes;
      });
      tx();
      console.log('[orders:releaseHeld] released for push', { list, released });
      return { released };
    } catch (e: any) {
      console.error('[orders:releaseHeld] failed:', e?.message || e);
      return { released: 0, error: e?.message || String(e) };
    }
  });

  /** Recent distinct customers, for a picker / autocomplete. */
  ipcMain.handle('customers:recent', async (_e, limit = 20) => {
    try {
      return db
        .prepare(
          `
          SELECT full_name, mobile, MAX(COALESCE(created_at,0)) AS last_seen,
                 COUNT(*) AS order_count
          FROM orders
          WHERE full_name IS NOT NULL AND TRIM(full_name) <> ''
            AND mobile IS NOT NULL AND TRIM(mobile) <> ''
          GROUP BY mobile
          ORDER BY last_seen DESC
          LIMIT ?
        `
        )
        .all(Math.min(Number(limit) || 20, 100));
    } catch (e: any) {
      console.error('[customers:recent] failed:', e?.message || e);
      return [];
    }
  });
}
