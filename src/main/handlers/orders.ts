// src/main/handlers/orders.ts
import type { IpcMain } from 'electron';
import type { Database as BetterSqliteDB } from 'better-sqlite3';

import db, {
  isPosLocked,
  logPosAction,
  nowMs,
  getCurrentUserId,
} from '../db';

type Services = {
  store: { get(k: string): any; set(k: string, v: any): void; delete(k: string): void };
};

/**
 * Register IPC handlers for orders & tables.
 *
 * NOTE:
 * - Schema is handled centrally in db.ts::migrate().
 * - This file only runs queries & updates; no CREATE TABLE / ALTER TABLE here.
 */
export function registerOrderHandlers(
  ipcMain: IpcMain,
  _db: BetterSqliteDB,      // kept for backwards compatibility (not used)
  _services: Services       // kept for backwards compatibility (not used)
) {
  /* ========== Prepared statements ========== */

  const qGetOrder = db.prepare(`
    SELECT *
    FROM orders
    WHERE id = ?
    LIMIT 1
  `);

  const qTableLabel = db.prepare(`
    SELECT label
    FROM tables
    WHERE id = ?
    LIMIT 1
  `);

  const qListTables = db.prepare(`
    SELECT
      t.id,
      t.label AS name,
      COALESCE(t.capacity, 0) AS seats,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.table_id = t.id
            AND o.status IN ('open', 'hold', 'draft')
        )
        THEN 'occupied'
        ELSE 'available'
      END AS status
    FROM tables t
    ORDER BY COALESCE(t.number, 0), t.label COLLATE NOCASE
  `);

  /* ========== IPC: tables:list ========== */

  ipcMain.handle('tables:list', () => {
    const rows = qListTables.all() as Array<{
      id: string;
      name: string;
      seats: number;
      status: string;
    }>;

    // You can later enrich with current_order_id if you track that mapping
    return rows.map((r) => ({
      ...r,
      current_order_id: null,
    }));
  });

  /* ========== IPC: orders:setTable(orderId, tableId|null) ========== */

  ipcMain.handle(
    'orders:setTable',
    (_e, orderId: string, tableId: string | null) => {
      if (isPosLocked()) throw new Error('POS is locked');

      const order = qGetOrder.get(orderId) as any;
      if (!order) throw new Error('Order not found');
      if (order.is_locked) throw new Error('Order is locked');

      const tableRow = tableId ? (qTableLabel.get(tableId) as any) : null;
      const tableLabel = tableRow?.label ?? null;
      const now = nowMs();

      db.prepare(
        `
        UPDATE orders
        SET table_id = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(tableId ?? null, now, orderId);

      logPosAction('orders:setTable', orderId, {
        table_id: tableId ?? null,
        table_label: tableLabel,
      });

      return {
        ok: true,
        table_id: tableId ?? null,
        table_label: tableLabel,
      };
    }
  );

  /* ========== IPC: orders:complete(orderId, payload) ========== */

  ipcMain.handle(
    'orders:complete',
    (
      _e,
      orderId: string,
      payload: {
        customer?: {
          full_name?: string;
          mobile?: string;
          address?: string;
          note?: string | null;
        };
        totals?: {
          subtotal: number;
          discount: number;
          tax: number;
          grand_total: number;
        };
        status?: string;
        state_id?: string | null;
        city_id?: string | null;
        block_id?: string | null;
        block?: string | null;

        // optional payment info (if you pass them from the UI)
        payment_method_id?: string | null;
        payment_method_slug?: string | null;
        payment_type?: number | null;
      }
    ) => {
      if (isPosLocked()) throw new Error('POS is locked');

      const order = qGetOrder.get(orderId) as any;
      if (!order) throw new Error('Order not found');
      if (order.is_locked) throw new Error('Order is locked');

      const status = payload?.status || 'completed';

      const c = payload?.customer ?? {};
      const t = payload?.totals ?? {
        subtotal: Number(order.subtotal ?? 0),
        discount: Number(order.discount_total ?? 0),
        tax: Number(order.tax_total ?? 0),
        grand_total: Number(order.grand_total ?? 0),
      };

      const now = nowMs();
      const currentUserId = getCurrentUserId(); // from meta('pos.current_user_id')

      db.prepare(
        `
        UPDATE orders
        SET
          status               = ?,
          completed_by_user_id = ?,
          closed_at            = ?,
          is_locked            = 1,

          -- customer snapshot (use real columns from migration)
          full_name            = COALESCE(?, full_name),
          mobile               = COALESCE(?, mobile),
          address              = COALESCE(?, address),
          note                 = COALESCE(?, note),

          -- geo
          state_id             = COALESCE(?, state_id),
          city_id              = COALESCE(?, city_id),
          block_id             = COALESCE(?, block_id),
          block                = COALESCE(?, block),

          -- payment metadata (if provided)
          payment_method_id    = COALESCE(?, payment_method_id),
          payment_method_slug  = COALESCE(?, payment_method_slug),
          payment_type         = COALESCE(?, payment_type),

          -- totals
          subtotal             = ?,
          discount_total       = ?,
          tax_total            = ?,
          grand_total          = ?,

          updated_at           = ?
        WHERE id = ?
      `
      ).run(
        status,
        currentUserId,
        now,
        c.full_name ?? null,
        c.mobile ?? null,
        c.address ?? null,
        c.note ?? null,
        payload?.state_id ?? null,
        payload?.city_id ?? null,
        payload?.block_id ?? null,
        payload?.block ?? null,
        payload?.payment_method_id ?? null,
        payload?.payment_method_slug ?? null,
        payload?.payment_type ?? null,
        t.subtotal ?? 0,
        t.discount ?? 0,
        t.tax ?? 0,
        t.grand_total ?? 0,
        now,
        orderId
      );

      logPosAction('orders:complete', orderId, {
        status,
        customer: c,
        totals: t,
        state_id: payload?.state_id ?? null,
        city_id: payload?.city_id ?? null,
        block_id: payload?.block_id ?? null,
        block: payload?.block ?? null,
        payment_method_id: payload?.payment_method_id ?? null,
        payment_method_slug: payload?.payment_method_slug ?? null,
        payment_type: payload?.payment_type ?? null,
      });

      return { ok: true };
    }
  );

  /* ========== IPC: orders:markPrinted(orderId) ========== */

  ipcMain.handle('orders:markPrinted', (_e, orderId: string) => {
    const order = qGetOrder.get(orderId) as any;
    if (!order) throw new Error('Order not found');

    const now = nowMs();
    const currentUserId = getCurrentUserId();

    db.prepare(
      `
      UPDATE orders
      SET printed_at = ?, printed_by_user_id = ?, is_locked = 1, updated_at = ?
      WHERE id = ?
    `
    ).run(now, currentUserId, now, orderId);

    logPosAction('orders:markPrinted', orderId, {});

    return { ok: true };
  });

  /* ========== IPC: orders:paymentLink:set(orderId, url) ========== */

  ipcMain.handle(
    'orders:paymentLink:set',
    (_e, orderId: string, url: string) => {
      const order = qGetOrder.get(orderId) as any;
      if (!order) throw new Error('Order not found');

      const now = nowMs();

      db.prepare(
        `
        UPDATE orders
        SET payment_link_url = ?, payment_link_status = ?, payment_verified_at = NULL, updated_at = ?
        WHERE id = ?
      `
      ).run(url, 'pending', now, orderId);

      logPosAction('orders:paymentLink:set', orderId, { url });

      return { ok: true, url };
    }
  );

  /* ========== IPC: orders:paymentLink:status(orderId, status) ========== */

  ipcMain.handle(
    'orders:paymentLink:status',
    (_e, orderId: string, status: string) => {
      const order = qGetOrder.get(orderId) as any;
      if (!order) throw new Error('Order not found');

      const normalized = (status || '').toLowerCase();
      const isPaid = ['paid', 'captured', 'success'].includes(normalized);
      const now = nowMs();

      db.prepare(
        `
        UPDATE orders
        SET payment_link_status = ?, payment_verified_at = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(status, isPaid ? now : null, now, orderId);

      logPosAction('orders:paymentLink:status', orderId, {
        status,
        isPaid,
      });

      return { ok: true };
    }
  );
}
