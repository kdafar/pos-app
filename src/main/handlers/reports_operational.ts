import { ipcMain } from 'electron';
import db from '../db';

/* ========== meta helpers ========== */
function getMeta(key: string): string | undefined {
  try { return db.prepare('SELECT value FROM sync_state WHERE key = ?').pluck().get(key) as string | undefined; }
  catch { return undefined; }
}

/* ========== schema helpers ========== */
type Col = { name: string };
function tableExists(name: string): boolean {
  try {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
    return !!row;
  } catch { return false; }
}
function tableHasColumn(table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Col[];
    return rows.some(r => r.name === column);
  } catch { return false; }
}
function firstExistingTable(candidates: string[]): string | null {
  for (const t of candidates) if (tableExists(t)) return t;
  return null;
}

/* ========== timestamp column pick ========== */
function pickOrderTsColumn(): string {
  if (tableHasColumn('orders','completed_at'))   return 'completed_at';
  if (tableHasColumn('orders','paid_at'))        return 'paid_at';
  if (tableHasColumn('orders','created_ms'))     return 'created_ms';
  if (tableHasColumn('orders','created_at_ms'))  return 'created_at_ms';
  return tableHasColumn('orders','opened_at') ? 'opened_at' : 'created_at_ms';
}

/* ========== operational time rules ========== */
/** We support either:
 *  - branch_availability_rules(branch_id, day_of_week(0-6 Sun=0), is_open, open_at 'HH:MM:SS', close_at 'HH:MM:SS')
 *  - times(day TEXT or INT, always_close TINYINT, open 'HH:MM', close 'HH:MM')
 * If neither exists, we fallback to 00:00 → 23:59.
 */
type Rule = { is_open: number; open_at: string; close_at: string };
function getRuleForDay(jsDow: number): Rule | null {
  // Prefer branch rules
  if (tableExists('branch_availability_rules')) {
    const branchId = Number(getMeta('branch_id') ?? 0) || null;
    const row = db.prepare(`
      SELECT is_open, open_at, close_at
      FROM branch_availability_rules
      WHERE day_of_week = ? ${branchId ? 'AND branch_id = '+branchId : ''}
      LIMIT 1
    `).get(jsDow) as any;
    if (row) return { is_open: Number(row.is_open||0), open_at: row.open_at, close_at: row.close_at };
  }
  // Fallback: times table
  if (tableExists('times')) {
    // many schemas store day as 0-6 or English name; we try both
    const byNum = db.prepare(`SELECT always_close, open, close FROM times WHERE day IN (?, ?) LIMIT 1`)
      .get(jsDow, String(jsDow)) as any;
    if (byNum) {
      return { is_open: byNum.always_close ? 0 : 1, open_at: byNum.open || '00:00:00', close_at: byNum.close || '23:59:59' };
    }
    // try by name
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const byName = db.prepare(`SELECT always_close, open, close FROM times WHERE day = ? LIMIT 1`)
      .get(names[jsDow]) as any;
    if (byName) {
      return { is_open: byName.always_close ? 0 : 1, open_at: byName.open || '00:00:00', close_at: byName.close || '23:59:59' };
    }
  }
  return { is_open: 1, open_at: '00:00:00', close_at: '23:59:59' };
}
function hhmmssToMs(base: Date, t: string): number {
  const [hh, mm, ssRaw] = (t||'00:00:00').split(':');
  const ss = Number(ssRaw ?? 0);
  const d = new Date(base);
  d.setHours(Number(hh)||0, Number(mm)||0, Number(ss)||0, 0);
  return d.getTime();
}
/** Returns {startMs, endMs, alwaysClose} for the given calendar day (local). Handles cross-midnight close. */
function getOperationalDayRange(baseDay: Date): { startMs: number; endMs: number; alwaysClose: boolean } {
  const jsDow = baseDay.getDay(); // 0=Sun
  const rule  = getRuleForDay(jsDow);
  if (!rule) {
    const s = new Date(baseDay); s.setHours(0,0,0,0);
    const e = new Date(baseDay); e.setHours(23,59,59,999);
    return { startMs: s.getTime(), endMs: e.getTime(), alwaysClose: false };
  }
  if (!rule.is_open) {
    const s = new Date(baseDay); s.setHours(0,0,0,0);
    const e = new Date(baseDay); e.setHours(23,59,59,999);
    return { startMs: s.getTime(), endMs: e.getTime(), alwaysClose: true };
  }
  const startMs = hhmmssToMs(baseDay, rule.open_at || '00:00:00');
  const closeTodayMs = hhmmssToMs(baseDay, rule.close_at || '23:59:59');

  // If close <= open, it spills to next day
  if (closeTodayMs <= startMs) {
    const nextDay = new Date(baseDay); nextDay.setDate(baseDay.getDate() + 1);
    const endMs = hhmmssToMs(nextDay, rule.close_at || '23:59:59');
    return { startMs, endMs, alwaysClose: false };
  }
  return { startMs, endMs: closeTodayMs, alwaysClose: false };
}

/** Default range (like your PHP): if now >= today's open → [todayOpen, now], else use yesterdayOpen → now. */
function defaultOperationalWindow(now = new Date()): { fromMs: number; toMs: number } {
  const today = new Date(now); today.setHours(0,0,0,0);
  const { startMs: todayStart, endMs: todayEnd, alwaysClose } = getOperationalDayRange(today);
  const nowMs = now.getTime();
  if (!alwaysClose && nowMs >= todayStart && nowMs <= todayEnd) {
    return { fromMs: todayStart, toMs: nowMs };
  }
  const y = new Date(today); y.setDate(today.getDate() - 1);
  const { startMs: yStart } = getOperationalDayRange(y);
  return { fromMs: yStart, toMs: nowMs };
}

/* ========== helpers to classify orders (sold/cancelled/inside/outside) ========== */
function orderTimestamp(row: any, tsCol: string): number {
  const v = row?.[tsCol];
  return typeof v === 'number' ? v : new Date(v).getTime();
}
function isSold(row: any): boolean {
  // Heuristic: paid_at, completed_at, or positive grand_total
  if (row?.paid_at) return true;
  if (row?.completed_at) return true;
  const gt = Number(row?.grand_total ?? 0);
  return gt > 0;
}
function isCancelled(row: any): boolean {
  const s = String(row?.status ?? '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'rejected') return true;
  if ('is_cancelled' in row) return Boolean(row.is_cancelled);
  return false;
}
function insideOperational(tsMs: number): boolean {
  const d = new Date(tsMs);
  const d0 = new Date(d); d0.setHours(0,0,0,0);
  const { startMs, endMs, alwaysClose } = getOperationalDayRange(d0);
  if (!alwaysClose && tsMs >= startMs && tsMs <= endMs) return true;

  // check yesterday spillover
  const y = new Date(d0); y.setDate(d0.getDate() - 1);
  const { startMs: yStart, endMs: yEnd, alwaysClose: yClose } = getOperationalDayRange(y);
  if (!yClose && tsMs >= yStart && tsMs <= yEnd) return true;

  return false;
}

/* ========== categories resolver (optional) ========== */
function resolveCategoryName(catId: any): string {
  const candidates = [
    `SELECT name_en AS n FROM categories WHERE id = ?`,
    `SELECT category_name_en AS n FROM categories WHERE id = ?`,
    `SELECT category_name AS n FROM categories WHERE id = ?`,
  ];
  for (const sql of candidates) {
    try {
      const r = db.prepare(sql).get(catId) as any;
      if (r?.n) return String(r.n);
    } catch {}
  }
  return String(catId ?? 'No Category');
}

/* ========== main aggregation like PHP ========== */
function previewOperational(fromMs: number, toMs: number) {
  const tsCol = pickOrderTsColumn();

  // Pull minimal columns to classify and sum
  const rows = db.prepare(`
    SELECT id, ${tsCol} as ts, grand_total, subtotal, discount_total, discount_amount, delivery_fee, status, closed_at
    FROM orders
    WHERE ${tsCol} >= ? AND ${tsCol} < ?
  `).all(fromMs, toMs) as any[];

  // Footer tallies (like your PHP)
  let total_order = 0;
  let inside_hours_count = 0;
  let outside_hours_count = 0;
  let canceled_order_count = 0;

  let gross_sales_total = 0;      // sum(order_total) for sold → we use subtotal as “pre-discount” proxy if present
  let discounts = 0;              // discount_total or discount_amount
  let delivery_fees = 0;          // delivery_fee or delivery_charge
  let grand_total_sum = 0;        // sum(grand_total)
  let outside_hours_total = 0;
  let cancelled_total = 0;

  for (const r of rows) {
    total_order += 1;
    const ts = Number(r.ts ?? 0);
    const inside = insideOperational(ts);
    if (inside) inside_hours_count += 1; else outside_hours_count += 1;

    const disc = Number(r.discount_total ?? r.discount_amount ?? 0);
    const delv = Number(r.delivery_fee ?? r.delivery_charge ?? 0);
    const gtot = Number(r.grand_total ?? 0);
    const pre  = Number(r.subtotal ?? 0);

    if (isCancelled(r)) {
      canceled_order_count += 1;
      cancelled_total += gtot || pre || 0;
      // we still allow counting inside/outside for info; skip from sold tallies below
      continue;
    }

    if (isSold(r)) {
      gross_sales_total += pre;   // mirrors PHP’s “order_total”; best proxy is subtotal before discounts
      discounts         += disc;
      delivery_fees     += delv;
      grand_total_sum   += gtot;
      if (!inside) outside_hours_total += gtot;
    }
  }

  // per-payment breakdown (sold only)
  const byPayment = (() => {
    // Prefer orders.payment_method_id
    if (tableHasColumn('orders','payment_method_id')) {
      const rows = db.prepare(`
        SELECT o.payment_method_id AS id, SUM(COALESCE(o.grand_total,0)) AS total
        FROM orders o
        WHERE o.${tsCol} >= ? AND o.${tsCol} < ? AND COALESCE(o.grand_total,0) > 0
        GROUP BY o.payment_method_id
        ORDER BY total DESC
      `).all(fromMs, toMs) as { id: string; total: number }[];
      return rows.map(r => {
        let name = String(r.id ?? '');
        try {
          const nm = db.prepare(`SELECT COALESCE(name_en, slug) AS name FROM payment_methods WHERE id = ?`).pluck().get(r.id);
          if (nm) name = nm as string;
        } catch {}
        return { id: String(r.id ?? ''), name, total: Number(r.total ?? 0) };
      });
    }
    // else try order_payments/payments
    const payTbl = firstExistingTable(['order_payments','payments']);
    if (payTbl && tableHasColumn(payTbl,'amount') && tableHasColumn(payTbl,'order_id')) {
      const rows = db.prepare(`
        SELECT p.payment_method_id AS id, SUM(COALESCE(p.amount,0)) AS total
        FROM ${payTbl} p
        JOIN orders o ON o.id = p.order_id
        WHERE o.${tsCol} >= ? AND o.${tsCol} < ?
        GROUP BY p.payment_method_id
        ORDER BY total DESC
      `).all(fromMs, toMs) as { id: string; total: number }[];
      return rows.map(r => {
        let name = String(r.id ?? '');
        try {
          const nm = db.prepare(`SELECT COALESCE(name_en, slug) AS name FROM payment_methods WHERE id = ?`).pluck().get(r.id);
          if (nm) name = nm as string;
        } catch {}
        return { id: String(r.id ?? ''), name, total: Number(r.total ?? 0) };
      });
    }
    return [] as { id: string; name: string; total: number }[];
  })();

  // by order type (sold only)
  const orderTypes = (() => {
    if (!tableHasColumn('orders','order_type')) return [] as any[];
    const rows = db.prepare(`
      SELECT order_type AS k, COUNT(*) AS count, SUM(COALESCE(grand_total,0)) AS total
      FROM orders
      WHERE ${tsCol} >= ? AND ${tsCol} < ? AND COALESCE(grand_total,0) > 0
      GROUP BY order_type
      ORDER BY total DESC
    `).all(fromMs, toMs) as { k: number; count: number; total: number }[];
    const label = (k: number) => k === 1 ? 'Delivery' : k === 3 ? 'Dine-in' : 'Pickup';
    return rows.map(r => ({ order_type: r.k, label: label(r.k), count: r.count ?? 0, total: Number(r.total ?? 0) }));
  })();

  // categories aggregate (sold only)
  const categories = (() => {
    const linesTable = firstExistingTable(['order_lines','order_details','order_items']);
    if (!linesTable) return [] as any[];
    const hasLineTotal = tableHasColumn(linesTable,'line_total');
    const itemTbl = firstExistingTable(['items','item']);
    const catCol  = itemTbl && tableHasColumn(itemTbl,'category_id') ? 'category_id'
                   : itemTbl && tableHasColumn(itemTbl,'cat_id') ? 'cat_id'
                   : null;
    if (!itemTbl || !catCol) return [] as any[];

    const sql = `
      SELECT it.${catCol} AS cat_id,
             SUM(COALESCE(l.qty,0)) AS sold,
             ${hasLineTotal ? 'SUM(COALESCE(l.line_total,0))' : 'SUM( COALESCE(l.qty,0) * COALESCE(l.unit_price,0) )'} AS total
      FROM ${linesTable} l
      JOIN orders o ON o.id = l.order_id
      JOIN ${itemTbl} it ON it.id = l.item_id
      WHERE o.${tsCol} >= ? AND o.${tsCol} < ? AND COALESCE(o.grand_total,0) > 0
      GROUP BY it.${catCol}
      ORDER BY total DESC
    `;
    const rows = db.prepare(sql).all(fromMs, toMs) as { cat_id: any; sold: number; total: number }[];
    return rows.map(r => ({ item: resolveCategoryName(r.cat_id), sold: Number(r.sold ?? 0), total: Number(r.total ?? 0) }));
  })();

  const footer = {
    // display string like PHP “date” label
    date: `${new Date(fromMs).toLocaleString()} to ${new Date(toMs).toLocaleString()}`,
    total_order,
    inside_hours_count,
    outside_hours_count,
    canceled_order_count,
    gross_sales_total,
    grand_total: (gross_sales_total - discounts + delivery_fees), // mirrors your PHP formula
    discounts,
    delivery_fees,
    outside_hours_total,
    cancelled_total,
  };

  return { fromMs, toMs, footer, payments: byPayment, orderTypes, categories };
}

/* ========== IPC ========== */
export function registerOperationalReportHandlers() {
  ipcMain.handle('report:sales:preview', async (_e, range?: { from?: number; to?: number }) => {
    // default to operational window if not provided
    const now = new Date();
    const base = (range?.from && range?.to)
      ? { fromMs: Number(range.from), toMs: Number(range.to) }
      : defaultOperationalWindow(now);
    return previewOperational(base.fromMs, base.toMs);
  });
}
