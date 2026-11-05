// src/main/handlers/tables.ts
import type { IpcMain } from 'electron';
import db, { getMeta } from '../db';
import { activeOrderSql } from '../utils/orderStatus';
import { tableNumber } from '../sync';

// The one shared list, not a copy: this one used to leave out `placed`, which
// is what every dine-in order becomes on "Place order". A seated table then
// lost its order — no active highlight, and a tap could not reopen it.

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
          NULLIF(t.label_ar, '') AS name_ar,
          t.capacity,
          t.is_available,
          t.branch_id,
          t.section_id,
          COALESCE(t.sort_order, 0) AS sort_order,
          s.name_en AS section_name_en,
          s.name_ar AS section_name_ar,
          COALESCE(s.sort_order, 0) AS section_sort,

          -- Active dine-in order id
          (
            SELECT o.id
            FROM orders o
            WHERE
              o.table_id   = t.id
              AND o.order_type = 3
              AND ${activeOrderSql("o")}
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
              AND ${activeOrderSql("o")}
            ORDER BY o.opened_at DESC, o.created_at DESC
            LIMIT 1
          ) AS active_order_status,

          -- What staff call the order: the running reference, else its number
          (
            SELECT COALESCE(NULLIF(o.reference_no, ''), o.number)
            FROM orders o
            WHERE
              o.table_id   = t.id
              AND o.order_type = 3
              AND ${activeOrderSql("o")}
            ORDER BY o.opened_at DESC, o.created_at DESC
            LIMIT 1
          ) AS active_order_number
        FROM tables t
        -- A section that was deleted or switched off leaves its tables
        -- floor-less rather than hiding them.
        LEFT JOIN table_sections s
          ON s.id = t.section_id AND COALESCE(s.is_active, 1) = 1
        WHERE (t.branch_id = ? OR ? = 0)
        ORDER BY t.number ASC, name COLLATE NOCASE ASC
      `
      )
      .all(branchId, branchId) as any[];

    // Rows synced before the label fallback existed are stored with number 0,
    // so the SQL order is label text (Table 1, Table 10 … Table 2). Sort on
    // the effective number here so those rows are right without a re-sync.
    // Floor first, then the admin's order within it; tables with no floor
    // last. A sort_order of 0 means "not set" and falls through to number.
    for (const r of rows) r.number = tableNumber(r);
    const floorRank = (r: any) =>
      r.section_name_en || r.section_name_ar ? Number(r.section_sort) || 0 : Infinity;
    const orderRank = (r: any) => Number(r.sort_order) || Infinity;
    rows.sort(
      (a, b) =>
        floorRank(a) - floorRank(b) ||
        String(a.section_id ?? '').localeCompare(String(b.section_id ?? '')) ||
        (orderRank(a) === orderRank(b) ? 0 : orderRank(a) - orderRank(b)) ||
        a.number - b.number ||
        String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
    );

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
        name_ar: r.name_ar ?? null,
        capacity,
        seats: capacity,
        is_available: isAvailable,
        branch_id: Number(r.branch_id) || 0,

        section_id:
          r.section_name_en || r.section_name_ar ? String(r.section_id) : null,
        section_name_en: r.section_name_en ?? null,
        section_name_ar: r.section_name_ar ?? null,

        active_order_id: r.active_order_id ? String(r.active_order_id) : null,
        active_order_status: r.active_order_status ?? null,
        active_order_number: r.active_order_number ?? null,

        // backward compat
        current_order_id: r.current_order_id ?? r.active_order_id ?? null,
        has_active_order: hasActive ? 1 : 0,
        status,
      };
    });
  });
}
