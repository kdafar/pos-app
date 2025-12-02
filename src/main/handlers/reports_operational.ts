import { ipcMain } from 'electron';
import db from '../db';

/* ========== meta helpers ========== */
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
function pickOrderTsColumn(): string {
  const candidates = [
    'completed_at',
    'paid_at',
    'opened_at',
    'created_at_ms',
    'created_ms',
    'created_at',
  ];

  for (const col of candidates) {
    if (tableHasColumn('orders', col)) return col;
  }

  return 'opened_at';
}

/* ========== operational time rules ========== */

type Rule = { is_open: number; open_at: string; close_at: string };

/** Parse '9:00am' / '1:00am' → 'HH:MM:SS' (24h) */
function parseAmPmToHHMMSS(input: string | null | undefined): string {
  if (!input) return '00:00:00';
  const s = String(input).trim().toLowerCase();

  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) {
    // if already something like "09:00" just append ":00"
    if (/^\d{1,2}:\d{2}$/.test(s)) return `${s}:00`;
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) return s;
    return '00:00:00';
  }

  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ampm = m[3].toLowerCase();

  if (ampm === 'pm' && hh !== 12) hh += 12;
  if (ampm === 'am' && hh === 12) hh = 0;

  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:00`;
}

function getRuleForDay(jsDow: number): Rule | null {
  // 1) branch_availability_rules (if present)
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

  // 2) Your new 'time' table (day, open_time, close_time, always_close)
  if (tableExists('time')) {
    const names = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    const dayName = names[jsDow];

    const r = db
      .prepare(
        `SELECT open_time, close_time, always_close
         FROM time
         WHERE day = ?
         LIMIT 1`
      )
      .get(dayName) as any;

    if (r) {
      return {
        is_open: r.always_close ? 0 : 1,
        open_at: parseAmPmToHHMMSS(r.open_time),
        close_at: parseAmPmToHHMMSS(r.close_time),
      };
    }
  }

  // 3) Legacy 'times' table (number / string / name)
  if (tableExists('times')) {
    const byNum = db
      .prepare(
        `SELECT always_close, open, close FROM times WHERE day IN (?, ?) LIMIT 1`
      )
      .get(jsDow, String(jsDow)) as any;
    if (byNum) {
      return {
        is_open: byNum.always_close ? 0 : 1,
        open_at: byNum.open || '00:00:00',
        close_at: byNum.close || '23:59:59',
      };
    }

    const names = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    const byName = db
      .prepare(
        `SELECT always_close, open, close FROM times WHERE day = ? LIMIT 1`
      )
      .get(names[jsDow]) as any;
    if (byName) {
      return {
        is_open: byName.always_close ? 0 : 1,
        open_at: byName.open || '00:00:00',
        close_at: byName.close || '23:59:59',
      };
    }
  }

  // 4) Fallback: always open day
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
function getOperationalDayRange(baseDay: Date): {
  startMs: number;
  endMs: number;
  alwaysClose: boolean;
} {
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

  if (closeTodayMs <= startMs) {
    const nextDay = new Date(baseDay);
    nextDay.setDate(baseDay.getDate() + 1);
    const endMs = hhmmssToMs(nextDay, rule.close_at || '23:59:59');
    return { startMs, endMs, alwaysClose: false };
  }

  return { startMs, endMs: closeTodayMs, alwaysClose: false };
}

/** Default range: if now in today's window → [open, now], else yesterday's open → now. */
function defaultOperationalWindow(now = new Date()): {
  fromMs: number;
  toMs: number;
} {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const {
    startMs: todayStart,
    endMs: todayEnd,
    alwaysClose,
  } = getOperationalDayRange(today);
  const nowMs = now.getTime();

  if (!alwaysClose && nowMs >= todayStart && nowMs <= todayEnd) {
    return { fromMs: todayStart, toMs: nowMs };
  }

  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const { startMs: yStart } = getOperationalDayRange(y);
  return { fromMs: yStart, toMs: nowMs };
}

/* ========== helpers to classify orders ========== */

function isSold(row: any): boolean {
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

  const y = new Date(d0);
  y.setDate(d0.getDate() - 1);
  const {
    startMs: yStart,
    endMs: yEnd,
    alwaysClose: yClose,
  } = getOperationalDayRange(y);
  if (!yClose && tsMs >= yStart && tsMs <= yEnd) return true;

  return false;
}

/* ---- helper: turn any date column to ms safely (supports INTEGER ms or TEXT datetime) ---- */
function msExpr(col: string, alias = 'o') {
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
      const def = defaultOperationalWindow(new Date());
      const fromMs = Number.isFinite(opts?.from)
        ? Number(opts!.from)
        : def.fromMs;
      const toMs = Number.isFinite(opts?.to) ? Number(opts!.to) : def.toMs;

      const tsCol = pickOrderTsColumn();
      const tsMs = msExpr(tsCol, 'o');
      const branchId = Number(getMeta('branch_id') ?? 0) || 0;
      const hasBranch = tableHasColumn('orders', 'branch_id');
      const andBranch =
        hasBranch && branchId ? ' AND o.branch_id = @branch_id ' : '';

      const orderNumberCol = tableHasColumn('orders', 'order_number')
        ? 'o.order_number'
        : tableHasColumn('orders', 'number')
        ? 'o.number'
        : 'o.id';

      const fullNameCol = tableHasColumn('orders', 'customer_name')
        ? 'o.customer_name'
        : tableHasColumn('orders', 'full_name')
        ? 'o.full_name'
        : `' '`;

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
        order_number?: string | null;
        full_name?: string | null;
      };

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
          ${orderNumberCol} AS order_number,
          ${fullNameCol} AS full_name,
          ${
            tableHasColumn('orders', 'payment_method_slug')
              ? 'o.payment_method_slug'
              : 'NULL'
          } AS payment_method_slug,
          ${
            tableHasColumn('orders', 'payment_method_id')
              ? 'o.payment_method_id'
              : 'NULL'
          } AS payment_method_id
        FROM orders o
        WHERE ${tsMs} >= @fromMs AND ${tsMs} < @toMs
        ${andBranch}
      `
        )
        .all({ fromMs, toMs, branch_id: branchId }) as Row[];

      let total_order = 0;
      let inside_hours_count = 0;
      let outside_hours_count = 0;
      let canceled_order_count = 0;

      let gross_sales_total = 0;
      let discounts = 0;
      let delivery_fees = 0;
      let grand_total = 0;
      let outside_hours_total = 0;
      let cancelled_total = 0;

      const decoratedOrders: Array<{
        id: string;
        order_number: string;
        full_name: string;
        ts_ms: number;
        payment_method_id?: string;
        order_type: number;
        status: string | number;
        operational_status: 'inside' | 'outside';
        discount_amount?: number;
        discount_total?: number;
        delivery_fee?: number;
        grand_total: number;
      }> = [];

      for (const r of orders) {
        const ts = Number(r.ts_ms || 0);
        const inside = insideOperational(ts);

        const decorated = {
          id: String(r.id),
          order_number: String(r.order_number ?? r.id ?? ''),
          full_name: String(r.full_name ?? ''),
          ts_ms: ts,
          payment_method_id: r.payment_method_id ?? undefined,
          order_type: Number(r.order_type ?? 0),
          status: r.status ?? '',
          operational_status: inside ? 'inside' : 'outside',
          discount_amount:
            r.discount_amount != null ? Number(r.discount_amount) : undefined,
          discount_total:
            r.discount_total != null ? Number(r.discount_total) : undefined,
          delivery_fee:
            r.delivery_fee != null ? Number(r.delivery_fee) : undefined,
          grand_total: Number(r.grand_total ?? 0),
        };

        decoratedOrders.push(decorated);

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
          const pre = preRaw !== 0 ? preRaw : Number(r.grand_total ?? 0);

          const disc = Number(r.discount_total ?? r.discount_amount ?? 0);
          const delv = Number(r.delivery_fee ?? 0);
          const gtot = Number(r.grand_total ?? 0);

          gross_sales_total += pre;
          discounts += disc;
          delivery_fees += delv;
          grand_total += gtot;
          if (!inside) outside_hours_total += gtot;
        }
      }

      /* ---------- Payments, orderTypes, categories unchanged from previous answer ---------- */
      const payments = (() => {
        const rows: Array<{ id: string; name: string; total: number }> = [];

        const hasPmTable = tableExists('payment_methods');
        const hasSlugCol = tableHasColumn('orders', 'payment_method_slug');
        const hasIdCol = tableHasColumn('orders', 'payment_method_id');

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

        if (hasSlugCol) {
          const hasSlugData = !!db
            .prepare(
              `
            SELECT 1
            FROM orders
            WHERE payment_method_slug IS NOT NULL
              AND payment_method_slug != ''
              AND COALESCE(grand_total,0) > 0
            LIMIT 1
          `
            )
            .get();

          if (hasSlugData) {
            used = run(`
            SELECT
              COALESCE(pm.slug, s.payment_method_slug, 'unknown') AS id,
              COALESCE(pm.name_en, pm.name_ar, pm.slug, s.payment_method_slug, 'Unknown') AS name,
              ROUND(SUM(COALESCE(s.grand_total,0)), 3) AS total
            FROM orders s
            ${
              hasPmTable
                ? 'LEFT JOIN payment_methods pm ON pm.slug = s.payment_method_slug'
                : ''
            }
            WHERE ${msExpr(tsCol, 's')} >= @fromMs AND ${msExpr(
              tsCol,
              's'
            )} < @toMs
              ${hasBranch && branchId ? ' AND s.branch_id = @branch_id ' : ''}
              AND COALESCE(s.grand_total,0) > 0
            GROUP BY 1, 2
            ORDER BY total DESC
          `);
          }
        }

        if (!used && hasIdCol) {
          used = run(`
          SELECT
            CAST(COALESCE(s.payment_method_id, 0) AS TEXT) AS id,
            COALESCE(pm.name_en, pm.name_ar, pm.slug, CAST(s.payment_method_id AS TEXT), 'Unknown') AS name,
            ROUND(SUM(COALESCE(s.grand_total,0)), 3) AS total
          FROM orders s
          ${
            hasPmTable
              ? 'LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id'
              : ''
          }
          WHERE ${msExpr(tsCol, 's')} >= @fromMs AND ${msExpr(
            tsCol,
            's'
          )} < @toMs
            ${hasBranch && branchId ? ' AND s.branch_id = @branch_id ' : ''}
            AND COALESCE(s.grand_total,0) > 0
          GROUP BY 1, 2
          ORDER BY total DESC
        `);
        }

        if (!used) {
          const payTbl = firstExistingTable(['order_payments', 'payments']);
          if (
            payTbl &&
            tableHasColumn(payTbl, 'order_id') &&
            tableHasColumn(payTbl, 'amount')
          ) {
            const hasPmOnPay = tableHasColumn(payTbl, 'payment_method_id');
            const base = db
              .prepare(
                `
              SELECT
                CAST(COALESCE(p.payment_method_id, 0) AS TEXT) AS id,
                ROUND(SUM(COALESCE(p.amount,0)), 3) AS total
              FROM ${payTbl} p
              JOIN orders o ON o.id = p.order_id
              WHERE ${msExpr(tsCol, 'o')} >= @fromMs AND ${msExpr(
                  tsCol,
                  'o'
                )} < @toMs
                ${hasBranch && branchId ? ' AND o.branch_id = @branch_id ' : ''}
              GROUP BY ${hasPmOnPay ? 'p.payment_method_id' : '1'}
              ORDER BY total DESC
            `
              )
              .all({ fromMs, toMs, branch_id: branchId }) as Array<{
              id: string;
              total: number;
            }>;

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

      const orderTypes = (() => {
        if (!tableHasColumn('orders', 'order_type')) {
          return [] as Array<{
            order_type: number;
            label: string;
            count: number;
            total: number;
          }>;
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

        const label = (k: number) =>
          k === 1 ? 'Delivery' : k === 3 ? 'Dine-in' : 'Pickup';

        return rows.map((r) => ({
          order_type: r.k,
          label: label(r.k),
          count: r.count ?? 0,
          total: Number(r.total ?? 0),
        }));
      })();

      const categories = (() => {
        const linesTable = firstExistingTable(['order_lines']);
        const itemTbl = firstExistingTable(['items']);
        if (!linesTable || !itemTbl) {
          return [] as Array<{
            item: string;
            sold: number;
            total: number;
          }>;
        }

        if (!tableHasColumn(itemTbl, 'category_id')) {
          return [] as Array<{
            item: string;
            sold: number;
            total: number;
          }>;
        }

        const hasCats = tableExists('categories');
        const joinCat = hasCats
          ? `LEFT JOIN categories c ON c.id = it.category_id`
          : '';

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

      // ---------- Items aggregate for "By Item" tab ----------
      const aggregates = (() => {
        const linesTable = firstExistingTable(['order_lines']);
        const itemTbl = firstExistingTable(['items']);
        if (!linesTable || !itemTbl) {
          return [] as Array<{
            item: string;
            sold: number;
            total: number;
          }>;
        }

        const hasNameEn = tableHasColumn(itemTbl, 'name_en');
        const hasNameAr = tableHasColumn(itemTbl, 'name_ar');
        const hasName = tableHasColumn(itemTbl, 'name');

        const itemNameExpr =
          hasNameEn || hasNameAr
            ? `COALESCE(it.name, it.name_ar, 'Unknown Item')`
            : hasName
            ? `COALESCE(it.name, 'Unknown Item')`
            : `CAST(it.id AS TEXT)`;

        const sql = `
          SELECT
            ${itemNameExpr} AS item,
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
          WHERE ${msExpr(tsCol, 'o')} >= @fromMs
            AND ${msExpr(tsCol, 'o')} < @toMs
            ${hasBranch && branchId ? ' AND o.branch_id = @branch_id ' : ''}
            AND COALESCE(o.grand_total, 0) > 0
          GROUP BY item
          ORDER BY total DESC, sold DESC
          LIMIT 100
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
        date: `${new Date(fromMs).toLocaleString()} to ${new Date(
          toMs
        ).toLocaleString()}`,
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

      return {
        fromMs,
        toMs,
        footer,
        payments,
        orderTypes,
        categories,
        orders: decoratedOrders,
        aggregates,
      } as const;
    }
  );
}
