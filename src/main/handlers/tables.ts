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
          id,
          number,
          label,
          COALESCE(label, 'Table ' || number) AS name,
          capacity,
          is_available,
          branch_id
        FROM tables
        WHERE (branch_id = ? OR ? = 0)
        ORDER BY number ASC, name COLLATE NOCASE ASC
      `
      )
      .all(branchId, branchId) as any[];

    return rows.map((r) => ({
      id: r.id,
      // keep both so your normalizer can use them
      number: r.number,
      label: r.label ?? r.name,
      name: r.name,
      capacity: Number(r.capacity) || 0,
      seats: Number(r.capacity) || 0, // if something else uses seats
      is_available: Number(r.is_available) || 0,
      branch_id: Number(r.branch_id) || 0,
      current_order_id: r.current_order_id ?? null, // if you ever store this
      status: Number(r.is_available) === 1 ? 'available' : 'occupied',
    }));
  });
}
