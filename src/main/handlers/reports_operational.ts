import { ipcMain } from 'electron';
import db from '../db';

/* ========== meta helpers ========== */
// This meta is for sync_state (branch_id, base_url, etc.), separate from meta table in db.ts
function getMeta(key: string): string | undefined {
  try {
    return db
      .prepare('SELECT value FROM sync_state WHERE key = ?')
      .pluck()
      .get(key) as string | undefined;
  } catch {
    return undefined;
  }
}

/* ========== schema helpers ========== */
type Col = { name: string };

function tableExists(name: string): boolean {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}

function tableHasColumn(table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Col[];
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

function firstExistingTable(candidates: string[]): string | null {
  for (const t of candidates) {
    if (tableExists(t)) return t;
  }
  return null;
}

/* ========== timestamp column pick ========== */
/**
 * Pick the "best" timestamp column that exists in orders.
 * Matches your migration:
 *   opened_at INTEGER, closed_at INTEGER, created_at TEXT, updated_at INTEGER, printed_at INTEGER ...
 */
function pickOrderTsColumn(): string {
  const candidates = [
    'completed_at',   // future-proof if we ever add it
    'paid_at',        // future-proof
    'opened_at',      // current main operational ts in our migration
    'created_at_ms',  // legacy possibilities
    'created_ms',
    'created_at',     // fallback to created_at text
  ];

  for (const col of candidates) {
    if (tableHasColumn('orders', col)) return col;
  }

  // Ultimate fallback – our migration always creates opened_at, so this should not be hit on fresh DBs
  return 'opened_at';
}

/* ========== operational time rules ========== */
/**
 * We support either:
 *  - branch_availability_rules(branch_id, day_of_week(0-6), is_open, open_at 'HH:MM:SS', close_at 'HH:MM:SS')
 *  - times(day TEXT or INT, always_close TINYINT, open 'HH:MM', close 'HH:MM')
 * If neither exists, we fallback to 00:00 → 23:59.
 */
type Rule = { is_open: number; open_at: string; close_at: string };

function getRuleForDay(jsDow: number): Rule | null {
  // Prefer branch rules
  if (tableExists('branch_availability_rules')) {
    const branchId = Number(getMeta('branch_id') ?? 0) || null;
    const row = db
      .prepare(
        `
        SELECT is_open, open_at, close_at
        FROM branch_availability_rules
        WHERE day_of_week = ? ${branchId ? 'AND branch_id = ' + branchId : ''}
        LIMIT 1
      `
      )
      .get(jsDow) as any;
    if (row) {
      return {
        is_open: Number(row.is_open || 0),
        open_at: row.open_at,
        close_at: row.close_at,
      };
    }
  }

  // Fallback: times table
  if (tableExists('times')) {
    const byNum = db
      .prepare(`SELECT always_close, open, close FROM times WHERE day IN (?, ?) LIMIT 1`)
      .get(jsDow, String(jsDow)) as any;
    if (byNum) {
      return {
        is_open: byNum.always_close ? 0 : 1,
        open_at: byNum.open || '00:00:00',
        close_at: byNum.close || '23:59:59',
      };
    }

    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byName = db
      .prepare(`SELECT always_close, open, close FROM times WHERE day = ? LIMIT 1`)
      .get(names[jsDow]) as any;
    if (byName) {
      return {
        is_open: byName.always_close ? 0 : 1,
        open_at: byName.open || '00:00:00',
        close_at: byName.close || '23:59:59',
      };
    }
  }

  return { is_open: 1, open_at: '00:00:00', close_at: '23:59:59' };
}

function hhmmssToMs(base: Date, t: string): number {
  const [hh, mm, ssRaw] = (t || '00:00:00').split(':');
  const ss = Number(ssRaw ?? 0);
  const d = new Date(base);
  d.setHours(Number(hh) || 0, Number(mm) || 0, Number(ss) || 0, 0);
  return d.getTime();
}

/** Returns {startMs, endMs, alwaysClose} for the given calendar day (local). Handles cross-midnight close. */
function getOperationalDayRange(baseDay: Date): { startMs: number; endMs: number; alwaysClose: boolean } {
  const jsDow = baseDay.getDay(); // 0=Sun
  const rule = getRuleForDay(jsDow);
  if (!rule) {
    const s = new Date(baseDay);
    s.setHours(0, 0, 0, 0);
    const e = new Date(baseDay);
    e.setHours(23, 59, 59, 999);
    return { startMs: s.getTime(), endMs: e.getTime(), alwaysClose: false };
  }

  if (!rule.is_open) {
    const s = new Date(baseDay);
    s.setHours(0, 0, 0, 0);
    const e = new Date(baseDay);
    e.setHours(23, 59, 59, 999);
    return { startMs: s.getTime(), endMs: e.getTime(), alwaysClose: true };
  }

  const startMs = hhmmssToMs(baseDay, rule.open_at || '00:00:00');
  const closeTodayMs = hhmmssToMs(baseDay, rule.close_at || '23:59:59');

  // If close <= open, it spills to the next day
  if (closeTodayMs <= startMs) {
    const nextDay = new Date(baseDay);
    nextDay.setDate(baseDay.getDate() + 1);
    const endMs = hhmmssToMs(nextDay, rule.close_at || '23:59:59');
    return { startMs, endMs, alwaysClose: false };
  }

  return { startMs, endMs: closeTodayMs, alwaysClose: false };
}

/** Default range (like your PHP): if now >= today's open → [todayOpen, now], else use yesterdayOpen → now. */
function defaultOperationalWindow(now = new Date()): { fromMs: number; toMs: number } {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const { startMs: todayStart, endMs: todayEnd, alwaysClose } = getOperationalDayRange(today);
  const nowMs = now.getTime();

  if (!alwaysClose && nowMs >= todayStart && nowMs <= todayEnd) {
    return { fromMs: todayStart, toMs: nowMs };
  }

  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const { startMs: yStart } = getOperationalDayRange(y);
  return { fromMs: yStart, toMs: nowMs };
}

/* ========== helpers to classify orders (sold/cancelled/inside/outside) ========== */

function isSold(row: any): boolean {
  // For our offline DB we mainly rely on grand_total > 0
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
  const d0 = new Date(d);
  d0.setHours(0, 0, 0, 0);
  const { startMs, endMs, alwaysClose } = getOperationalDayRange(d0);

  if (!alwaysClose && tsMs >= startMs && tsMs <= endMs) return true;

  // Check yesterday spillover window
  const y = new Date(d0);
  y.setDate(d0.getDate() - 1);
  const { startMs: yStart, endMs: yEnd, alwaysClose: yClose } = getOperationalDayRange(y);
  if (!yClose && tsMs >= yStart && tsMs <= yEnd) return true;

  return false;
}

/* ========== category resolver (based on our migration) ========== */
function resolveCategoryName(catId: any): string {
  // In our migration: categories(id, name, name_ar, ...)
  try {
    const r = db
      .prepare(`SELECT COALESCE(name, name_ar) AS n FROM categories WHERE id = ?`)
      .get(catId) as any;
    if (r?.n) return String(r.n);
  } catch {
    // ignore
  }
  return String(catId ?? 'No Category');
}

/* ---- helper: turn any date column to ms safely (supports INTEGER ms or TEXT datetime) ---- */
function msExpr(col: string, alias = 'o') {
  // typeof(..)='integer' → already ms; else STRFTIME('%s')*1000
  return `(CASE WHEN typeof(${alias}.${col}) = 'integer'
           THEN ${alias}.${col}
           ELSE CAST(STRFTIME('%s', ${alias}.${col}) AS INTEGER) * 1000
         END)`;
}

/* ---- main IPC ---- */

export function registerOperationalReportHandlers() {
  ipcMain.handle(
    'report:sales:preview',
    (_evt, opts?: { from?: number; to?: number }) => {
      // Default to the operational window you already implemented
      const def = defaultOperationalWindow(new Date());
      const fromMs = Number.isFinite(opts?.from) ? Number(opts!.from) : def.fromMs;
      const toMs = Number.isFinite(opts?.to) ? Number(opts!.to) : def.toMs;

      const tsCol = pickOrderTsColumn(); // e.g., opened_at | created_at
      const tsMs = msExpr(tsCol, 'o');
      const branchId = Number(getMeta('branch_id') ?? 0) || 0;
      const hasBranch = tableHasColumn('orders', 'branch_id');
      const andBranch = hasBranch && branchId ? ' AND o.branch_id = @branch_id ' : '';

      type Row = {
        id: string;
        status?: string | null;
        order_type?: number | null;
        subtotal?: number | null;
        discount_total?: number | null;
        discount_amount?: number | null;
        delivery_fee?: number | null;
        grand_total?: number | null;
        ts_ms: number;
        payment_method_slug?: string | null;
        payment_method_id?: string | null;
      };

      // ------- Base orders set -------
      const orders = db
        .prepare(
          `
        SELECT
          o.id,
          o.status,
          o.order_type,
          o.subtotal,
          o.discount_total,
          o.discount_amount,
          o.delivery_fee,
          o.grand_total,
          ${tsMs} AS ts_ms,
          ${tableHasColumn('orders', 'payment_method_slug') ? 'o.payment_method_slug' : 'NULL'} AS payment_method_slug,
          ${tableHasColumn('orders', 'payment_method_id') ? 'o.payment_method_id' : 'NULL'} AS payment_method_id
        FROM orders o
        WHERE ${tsMs} >= @fromMs AND ${tsMs} < @toMs
        ${andBranch}
      `
        )
        .all({ fromMs, toMs, branch_id: branchId }) as Row[];

      // ------- Footer tallies (like PHP) -------
      let total_order = 0;
      let inside_hours_count = 0;
      let outside_hours_count = 0;
      let canceled_order_count = 0;

      let gross_sales_total = 0; // sum(subtotal) for sold
      let discounts = 0; // sum(discount_total or discount_amount)
      let delivery_fees = 0; // sum(delivery_fee)
      let grand_total = 0; // sum(grand_total) for sold
      let outside_hours_total = 0; // sum(grand_total) for sold outside op hours
      let cancelled_total = 0; // sum(grand_total or subtotal) for cancelled

      for (const r of orders) {
        const ts = Number(r.ts_ms || 0);
        const inside = insideOperational(ts);

        if (isCancelled(r)) {
          canceled_order_count += 1;
          cancelled_total += Number(r.grand_total ?? r.subtotal ?? 0);
          continue;
        }

        if (isSold(r)) {
          total_order += 1;
          if (inside) inside_hours_count += 1;
          else outside_hours_count += 1;

const preRaw = Number(r.subtotal ?? 0);
const pre    = preRaw !== 0 ? preRaw : Number(r.grand_total ?? 0);

const disc = Number(r.discount_total ?? r.discount_amount ?? 0);
const delv = Number(r.delivery_fee ?? 0);
const gtot = Number(r.grand_total ?? 0);

gross_sales_total += pre;
discounts         += disc;
delivery_fees     += delv;
grand_total       += gtot;
if (!inside) outside_hours_total += gtot;
        }
      }

      // ------- Payments breakdown (sold only) -------
    // ------- Payments breakdown (sold only) -------
    const payments = (() => {
      const rows: Array<{ id: string; name: string; total: number }> = [];

      const hasPmTable  = tableExists('payment_methods');
      const hasSlugCol  = tableHasColumn('orders', 'payment_method_slug');
      const hasIdCol    = tableHasColumn('orders', 'payment_method_id');

      // helper: run query and push normalized rows
      const run = (sql: string) => {
        const result = db
          .prepare(sql)
          .all({ fromMs, toMs, branch_id: branchId }) as Array<{
          id: string;
          name: string;
          total: number;
        }>;
        for (const r of result) {
          rows.push({
            id: String(r.id ?? ''),
            name: String(r.name ?? 'Unknown'),
            total: Number(r.total ?? 0),
          });
        }
        return result.length;
      };

      let used = 0;

      // 1) Try slug-based grouping ONLY if there is at least one non-empty slug
      if (hasSlugCol) {
        const hasSlugData = !!db
          .prepare(`
            SELECT 1
            FROM orders
            WHERE payment_method_slug IS NOT NULL
              AND payment_method_slug != ''
              AND COALESCE(grand_total,0) > 0
            LIMIT 1
          `)
          .get();

        if (hasSlugData) {
          used = run(`
            SELECT
              COALESCE(pm.slug, s.payment_method_slug, 'unknown') AS id,
              COALESCE(pm.name_en, pm.name_ar, pm.slug, s.payment_method_slug, 'Unknown') AS name,
              ROUND(SUM(COALESCE(s.grand_total,0)), 3) AS total
            FROM orders s
            ${hasPmTable ? 'LEFT JOIN payment_methods pm ON pm.slug = s.payment_method_slug' : ''}
            WHERE ${msExpr(tsCol,'s')} >= @fromMs AND ${msExpr(tsCol,'s')} < @toMs
              ${hasBranch && branchId ? ' AND s.branch_id = @branch_id ' : ''}
              AND COALESCE(s.grand_total,0) > 0
            GROUP BY 1, 2
            ORDER BY total DESC
          `);
        }
      }

      // 2) If nothing from slug path, try payment_method_id → payment_methods.id
      if (!used && hasIdCol) {
        used = run(`
          SELECT
            CAST(COALESCE(s.payment_method_id, 0) AS TEXT) AS id,
            COALESCE(pm.name_en, pm.name_ar, pm.slug, CAST(s.payment_method_id AS TEXT), 'Unknown') AS name,
            ROUND(SUM(COALESCE(s.grand_total,0)), 3) AS total
          FROM orders s
          ${hasPmTable ? 'LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id' : ''}
          WHERE ${msExpr(tsCol,'s')} >= @fromMs AND ${msExpr(tsCol,'s')} < @toMs
            ${hasBranch && branchId ? ' AND s.branch_id = @branch_id ' : ''}
            AND COALESCE(s.grand_total,0) > 0
          GROUP BY 1, 2
          ORDER BY total DESC
        `);
      }

      // 3) Optional: fallback to payments table (order_payments / payments), same as before
      if (!used) {
        const payTbl = firstExistingTable(['order_payments', 'payments']);
        if (payTbl && tableHasColumn(payTbl, 'order_id') && tableHasColumn(payTbl, 'amount')) {
          const hasPmOnPay = tableHasColumn(payTbl, 'payment_method_id');
          const base = db
            .prepare(
              `
              SELECT
                CAST(COALESCE(p.payment_method_id, 0) AS TEXT) AS id,
                ROUND(SUM(COALESCE(p.amount,0)), 3) AS total
              FROM ${payTbl} p
              JOIN orders o ON o.id = p.order_id
              WHERE ${msExpr(tsCol,'o')} >= @fromMs AND ${msExpr(tsCol,'o')} < @toMs
                ${hasBranch && branchId ? ' AND o.branch_id = @branch_id ' : ''}
              GROUP BY ${hasPmOnPay ? 'p.payment_method_id' : '1'}
              ORDER BY total DESC
            `
            )
            .all({ fromMs, toMs, branch_id: branchId }) as Array<{ id: string; total: number }>;

          for (const r of base) {
            let name = r.id;
            if (hasPmTable && r.id) {
              try {
                const nm = db
                  .prepare(
                    `SELECT COALESCE(name_en, name_ar, slug) FROM payment_methods WHERE id = ?`
                  )
                  .pluck()
                  .get(r.id);
                if (nm) name = String(nm);
              } catch {}
            }
            rows.push({
              id: String(r.id ?? ''),
              name,
              total: Number(r.total ?? 0),
            });
          }
        }
      }

      return rows;
    })();


      // ------- Order type breakdown (sold only) -------
      const orderTypes = (() => {
        if (!tableHasColumn('orders', 'order_type')) {
          return [] as Array<{ order_type: number; label: string; count: number; total: number }>;
        }

        const rows = db
          .prepare(
            `
          SELECT
            o.order_type AS k,
            COUNT(*) AS count,
            ROUND(SUM(COALESCE(o.grand_total, 0)), 3) AS total
          FROM orders o
          WHERE ${tsMs} >= @fromMs AND ${tsMs} < @toMs
            ${andBranch}
            AND COALESCE(o.grand_total, 0) > 0
          GROUP BY o.order_type
          ORDER BY total DESC, count DESC
        `
          )
          .all({ fromMs, toMs, branch_id: branchId }) as Array<{
          k: number;
          count: number;
          total: number;
        }>;

        const label = (k: number) => (k === 1 ? 'Delivery' : k === 3 ? 'Dine-in' : 'Pickup');

        return rows.map((r) => ({
          order_type: r.k,
          label: label(r.k),
          count: r.count ?? 0,
          total: Number(r.total ?? 0),
        }));
      })();

      // ------- Categories (sold only) -------
      const categories = (() => {
        const linesTable = firstExistingTable(['order_lines']);
        const itemTbl = firstExistingTable(['items']);
        if (!linesTable || !itemTbl) {
          return [] as Array<{ item: string; sold: number; total: number }>;
        }

        // Our migration: items(category_id TEXT, ...)
        if (!tableHasColumn(itemTbl, 'category_id')) {
          return [] as Array<{ item: string; sold: number; total: number }>;
        }

        const hasCats = tableExists('categories');
        const joinCat = hasCats ? `LEFT JOIN categories c ON c.id = it.category_id` : '';

        // In our migration: categories(name, name_ar)
        const itemNameSelect = hasCats
          ? `COALESCE(c.name, c.name_ar, 'Uncategorized') AS item`
          : `CAST(it.category_id AS TEXT) AS item`;

        const sql = `
          SELECT
            ${itemNameSelect},
            SUM(COALESCE(l.qty, 0)) AS sold,
            ROUND(
              SUM(
                COALESCE(
                  l.line_total,
                  COALESCE(l.qty, 0) * COALESCE(l.unit_price, 0)
                )
              ),
              3
            ) AS total
          FROM ${linesTable} l
          JOIN orders o ON o.id = l.order_id
          JOIN ${itemTbl} it ON it.id = l.item_id
          ${joinCat}
          WHERE ${msExpr(tsCol, 'o')} >= @fromMs
            AND ${msExpr(tsCol, 'o')} < @toMs
            ${hasBranch && branchId ? ' AND o.branch_id = @branch_id ' : ''}
            AND COALESCE(o.grand_total, 0) > 0
          GROUP BY item
          ORDER BY total DESC, sold DESC
          LIMIT 50
        `;

        return db
          .prepare(sql)
          .all({ fromMs, toMs, branch_id: branchId }) as Array<{
          item: string;
          sold: number;
          total: number;
        }>;
      })();

      const footer = {
        date: `${new Date(fromMs).toLocaleString()} to ${new Date(toMs).toLocaleString()}`,
        total_order,
        inside_hours_count,
        outside_hours_count,
        canceled_order_count,
        gross_sales_total: +gross_sales_total.toFixed(3),
        grand_total: +grand_total.toFixed(3),
        discounts: +discounts.toFixed(3),
        delivery_fees: +delivery_fees.toFixed(3),
        outside_hours_total: +outside_hours_total.toFixed(3),
        cancelled_total: +cancelled_total.toFixed(3),
      };

      return { fromMs, toMs, footer, payments, orderTypes, categories } as const;
    }
  );
}
