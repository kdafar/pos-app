// src/main/handlers/tables.ts
import type { IpcMain } from 'electron';
import db, { getMeta } from '../db';

export function registerTableHandlers(ipcMain: IpcMain) {
  ipcMain.handle('tables:list', async () => {
    const branchId = Number(getMeta('branch_id') || 0);

    const rows = db
      .prepare(
        `
        SELECT
          t.id,
          t.number,
          t.label,
          COALESCE(t.label, 'Table ' || t.number) AS name,
          t.capacity,
          t.is_available,
          t.branch_id,

          -- Active dine-in order id
          (
            SELECT o.id
            FROM orders o
            WHERE
              o.table_id   = t.id
              AND o.order_type = 3
              AND o.status IN ('open','pending','ready','prepared')
            ORDER BY o.opened_at DESC, o.created_at DESC
            LIMIT 1
          ) AS active_order_id,

          -- Active dine-in order status (for UI if needed)
          (
            SELECT o.status
            FROM orders o
            WHERE
              o.table_id   = t.id
              AND o.order_type = 3
              AND o.status IN ('open','pending','ready','prepared')
            ORDER BY o.opened_at DESC, o.created_at DESC
            LIMIT 1
          ) AS active_order_status
        FROM tables t
        WHERE (t.branch_id = ? OR ? = 0)
        ORDER BY t.number ASC, name COLLATE NOCASE ASC
      `
      )
      .all(branchId, branchId) as any[];

    return rows.map((r) => {
      const capacity = Number(r.capacity) || 0;
      const baseIsAvailable = Number(r.is_available) || 0;
      const hasActive = !!r.active_order_id;

      // If there is an active order, treat the table as NOT available in the UI
      const isAvailable = hasActive ? 0 : baseIsAvailable;

      const status = hasActive || isAvailable === 0 ? 'occupied' : 'available';

      return {
        id: r.id,
        number: r.number,
        label: r.label ?? r.name,
        name: r.name,
        capacity,
        seats: capacity,
        is_available: isAvailable,
        branch_id: Number(r.branch_id) || 0,

        active_order_id: r.active_order_id ? String(r.active_order_id) : null,
        active_order_status: r.active_order_status ?? null,

        // backward compat
        current_order_id: r.current_order_id ?? r.active_order_id ?? null,
        has_active_order: hasActive ? 1 : 0,
        status,
      };
    });
  });
}
