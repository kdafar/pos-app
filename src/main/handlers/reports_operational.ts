import { ipcMain } from 'electron';
import db from '../db';
import type { MainServices } from '../types/common';
import { assertPermission, getCurrentPosUser } from '../utils/permissions';

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

/* ========== operational time rules (using `time` table) ========== */

type Rule = { is_open: number; open_at: string; close_at: string };

/** Parse '9:00am' / '09:00' → 'HH:MM:SS' (24h) */
function parseAmPmToHHMMSS(input: string | null | undefined): string {
  if (!input) return '00:00:00';
  const s = String(input).trim().toLowerCase();

  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) {
    // already time-ish
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

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function getRuleForDay(jsDow: number): Rule | null {
  // Prefer new `time` table (synced from Laravel)
  if (tableExists('time')) {
    const dayName = DAY_NAMES[jsDow];
    const row = db
      .prepare(
        `
        SELECT open_time, close_time, always_close
        FROM time
        WHERE
          lower(day) IN (lower(?), lower(?))
          OR day IN (?, ?)
        LIMIT 1
      `
      )
      .get(dayName, dayName.slice(0, 3), jsDow, String(jsDow)) as any;

    if (row) {
      return {
        is_open: row.always_close ? 0 : 1,
        open_at: parseAmPmToHHMMSS(row.open_time),
        close_at: parseAmPmToHHMMSS(row.close_time),
      };
    }
  }

  // Legacy `times` table (if present)
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

    const dayName = DAY_NAMES[jsDow];
    const byName = db
      .prepare(
        `SELECT always_close, open, close FROM times WHERE lower(day) = lower(?) LIMIT 1`
      )
      .get(dayName) as any;

    if (byName) {
      return {
        is_open: byName.always_close ? 0 : 1,
        open_at: byName.open || '00:00:00',
        close_at: byName.close || '23:59:59',
      };
    }
  }

  // Fallback: always open
  return { is_open: 1, open_at: '00:00:00', close_at: '23:59:59' };
}

function hhmmssToMs(base: Date, t: string): number {
  const [hh, mm, ssRaw] = (t || '00:00:00').split(':');
  const ss = Number(ssRaw ?? 0);
  const d = new Date(base);
  d.setHours(Number(hh) || 0, Number(mm) || 0, ss || 0, 0);
  return d.getTime();
}

/** Return [this opening, next open day's opening), matching the online report. */
function getOperationalDayRange(baseDay: Date): {
  startMs: number;
  endMs: number;
  alwaysClose: boolean;
} {
  const rule = getRuleForDay(baseDay.getDay());
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
  let nextOpeningMs: number | null = null;
  for (let offset = 1; offset <= 7; offset += 1) {
    const nextDay = new Date(baseDay);
    nextDay.setDate(baseDay.getDate() + offset);
    const nextRule = getRuleForDay(nextDay.getDay());
    if (nextRule?.is_open) {
      nextOpeningMs = hhmmssToMs(nextDay, nextRule.open_at || '00:00:00');
      break;
    }
  }

  // Half-open business-day boundary: closing time is intentionally not used.
  return {
    startMs,
    endMs: nextOpeningMs ?? startMs + 86_400_000,
    alwaysClose: nextOpeningMs == null,
  };
}

/** Default range = today's operational window → now; if outside, yesterday's window → now. */
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

/** Resolve whole operational days for date-only filters used by report screens. */
function operationalDateRange(fromDate?: string, toDate?: string): {
  fromMs: number;
  toMs: number;
} {
  if (!fromDate && !toDate) return defaultOperationalWindow(new Date());

  const parseDate = (value: string | undefined) => {
    const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const fromDay = parseDate(fromDate) ?? parseDate(toDate) ?? new Date();
  const toDay = parseDate(toDate) ?? fromDay;
  const first = fromDay.getTime() <= toDay.getTime() ? fromDay : toDay;
  const last = fromDay.getTime() <= toDay.getTime() ? toDay : fromDay;
  const fromRange = getOperationalDayRange(first);
  const toRange = getOperationalDayRange(last);
  return { fromMs: fromRange.startMs, toMs: toRange.endMs };
}

/**
 * Hold a requested range inside the window an operator is allowed to see.
 *
 * Narrowing is preserved: asking for one hour of the current shift is a
 * legitimate question and stays exactly as asked. Only a range that reaches
 * outside the window is pulled back to its edge.
 */
export function clampRangeToWindow(
  requestedFrom: number,
  requestedTo: number,
  window: { fromMs: number; toMs: number }
): { fromMs: number; toMs: number; clamped: boolean } {
  const pin = (v: number) =>
    Math.min(Math.max(v, window.fromMs), window.toMs);
  const fromMs = pin(requestedFrom);
  const toMs = pin(requestedTo);
  return {
    fromMs,
    toMs,
    clamped: fromMs !== requestedFrom || toMs !== requestedTo,
  };
}

/* ---- helpers to classify orders ---- */

/**
 * A ticket the cashier has not put through yet is not revenue.
 *
 * This used to be `grand_total > 0` alone — `paid_at` and `completed_at` are
 * selected as literal NULL when the columns are absent, which they are, so the
 * first two lines never fired. An open ticket sitting on screen with items on
 * it was therefore counted as a completed sale, and appeared in Gross and Net.
 */
const NOT_YET_SOLD = new Set(['open', 'pending', 'draft', 'pending payment']);

export function isSold(row: any): boolean {
  if (Number(row?.grand_total ?? 0) <= 0) return false;
  return !NOT_YET_SOLD.has(String(row?.status ?? '').trim().toLowerCase());
}

/**
 * Every shape a cancellation reaches this table in.
 *
 * The exact-match list missed four of them, and a missed cancellation is not a
 * neutral error: the row falls through to isSold() and is counted as a sale.
 *   - 'cancelled_client'        — local, ORDER_STATUS.CANCELLED_CLIENT
 *   - 'cancelled by customer'   — server status_code 5
 *   - 'cancelled by admin'      — server status_code 6
 *   - 'rejected (auto)'         — server status_code 8
 * Only the bare 'cancelled'/'rejected' forms matched, which is why the till
 * reported cancelled-on-the-dashboard orders as revenue.
 */
const CANCELLED_SERVER_CODES = new Set([5, 6, 8, 9]);

export function isCancelled(row: any): boolean {
  if ('is_cancelled' in row && row.is_cancelled) return true;

  const code = Number(row?.status_code);
  if (Number.isFinite(code) && CANCELLED_SERVER_CODES.has(code)) return true;

  const s = String(row?.status ?? '').trim().toLowerCase();
  if (!s) return false;
  return (
    s.startsWith('cancel') || s.startsWith('canceled') || s.startsWith('rejected')
  );
}

export type RowVerdict = {
  counted: 'sale' | 'cancelled' | 'uncounted';
  /** Only on `uncounted` — the two have different fixes. */
  uncounted_reason?: 'no_total' | 'not_placed';
};

/**
 * Which bucket a row falls in, and why if it falls in none.
 *
 * Extracted so the highlight in the table and the counts in the footer cannot
 * drift apart: they are now the same decision read twice, not two conditions
 * that happen to agree today.
 */
export function classifyRow(r: any): RowVerdict {
  if (isCancelled(r)) return { counted: 'cancelled' };
  if (isSold(r)) return { counted: 'sale' };
  // An unpaid ticket needs putting through; a zero total needs looking at.
  // Same highlight, different fix, so the row says which.
  return {
    counted: 'uncounted',
    uncounted_reason: Number(r?.grand_total ?? 0) <= 0 ? 'no_total' : 'not_placed',
  };
}

/**
 * Split one order row into the four figures the report footer prints.
 *
 * The invariant that matters: gross - discount + delivery === net. Break it and
 * the report stops adding up, which is how the delivery fee got counted twice.
 *
 * `grand_total` already contains the delivery fee (calculations.ts builds it as
 * subtotal - discount + delivery). So when `subtotal` is missing — server-seeded
 * lookup rows carry a total and nothing else — gross has to be *backed out* of
 * grand_total, not substituted for it. Assigning grand_total straight to gross
 * counted the delivery fee once inside gross and again in the delivery line.
 */
export function rowMoney(r: any): {
  gross: number;
  discount: number;
  delivery: number;
  net: number;
} {
  const discount = Number(r?.discount_total ?? r?.discount_amount ?? 0);
  const delivery = Number(r?.delivery_fee ?? 0);
  const net = Number(r?.grand_total ?? 0);

  const subtotal = Number(r?.subtotal ?? 0);
  const gross = subtotal !== 0 ? subtotal : net - delivery + discount;

  return { gross, discount, delivery, net };
}

function insideOperational(tsMs: number): boolean {
  const d = new Date(tsMs);
  const d0 = new Date(d);
  d0.setHours(0, 0, 0, 0);

  const { startMs, endMs, alwaysClose } = getOperationalDayRange(d0);
  if (!alwaysClose && tsMs >= startMs && tsMs <= endMs) return true;

  // also consider previous day's cross-midnight window
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

/* ========== MAIN IPC HANDLER ========== */

export function registerOperationalReportHandlers(services: MainServices) {
  const assertReportAccess = () => assertPermission(services, 'reports.view');
  // Deliberately ungated. This returns only { fromMs, toMs } derived from the
  // branch opening hours in `time` — no sales, no totals, no order rows. It is
  // the first call Today's Orders makes, and gating it on 'reports.view' meant
  // a `pos` / `branch` operator (who holds 'orders.view_own' and passes the
  // route guard) was denied here and saw an empty order list all day.
  ipcMain.handle(
    'report:operationalWindow',
    (_evt, opts?: { fromDate?: string; toDate?: string }) => {
      return operationalDateRange(opts?.fromDate, opts?.toDate);
    }
  );

  ipcMain.handle(
    'report:sales:preview',
    (_evt, opts?: { from?: number; to?: number }) => {
      assertReportAccess();
      const def = defaultOperationalWindow(new Date());

      // Reaching back into previous days is a separate right from reading the
      // current one. A cashier closing the till needs the shift they are
      // standing in; last month's takings are a back-office question.
      //
      // This was gated on 'reports.export' and that conflated two unrelated
      // things. A shop that wants its cashiers to export today's takings to
      // Excel grants reports.export — and thereby handed them the whole date
      // picker and every previous day's revenue. Exporting the current shift
      // and reading history are different rights, and only one of them is a
      // till-operator concern.
      //
      // Admin-tier is the rule now: admin, owner, manager, super_admin,
      // superadmin. Everyone else gets the operational window, which is what
      // the branch opening hours in `time` already define.
      //
      // It is enforced here rather than in the screen because the range
      // arrives over IPC, and the renderer is not a trusted source of it — any
      // caller could ask for a year.
      const canPickRange = getCurrentPosUser(services).isAdmin;

      const requestedFrom = Number.isFinite(opts?.from)
        ? Number(opts!.from)
        : def.fromMs;
      const requestedTo = Number.isFinite(opts?.to) ? Number(opts!.to) : def.toMs;

      // Clamped rather than rejected: a stale date sitting in the picker when
      // a manager hands the till to a cashier would otherwise turn the report
      // into an error message mid-shift. Narrowing inside the current window
      // is still allowed — that is a legitimate look at part of the shift.
      const limited = canPickRange
        ? { fromMs: requestedFrom, toMs: requestedTo, clamped: false }
        : clampRangeToWindow(requestedFrom, requestedTo, def);
      const { fromMs, toMs, clamped } = limited;

      if (clamped) {
        console.log('[report] range clamped to the current operational day', {
          requestedFrom,
          requestedTo,
          fromMs,
          toMs,
        });
      }

      const tsCol = pickOrderTsColumn();
      const tsMs = msExpr(tsCol, 'o');

      const branchId = Number(getMeta('branch_id') ?? 0) || 0;
      const hasBranch = tableHasColumn('orders', 'branch_id');
      // NULL is kept deliberately: orders seeded from the server for phone
      // lookup carry no branch_id, and so do older local rows. Excluding them
      // would drop real sales out of the report the day this filter started
      // working — a separate decision from fixing the lookup itself.
      const andBranch =
        hasBranch && branchId
          ? ' AND (o.branch_id = @branch_id OR o.branch_id IS NULL) '
          : '';

      // Prefer the server's running number (0057) over the local key
      // (POS-1-8ZH57CLV). The report is what gets reconciled against the
      // dashboard, and the dashboard only knows the reference — printing the
      // local key made every row look like an order the office had never seen.
      // The local key is still returned alongside, for rows with no reference
      // yet and for support.
      const referenceCol = tableHasColumn('orders', 'reference_no')
        ? 'o.reference_no'
        : 'NULL';
      const localNumberCol = tableHasColumn('orders', 'order_number')
        ? 'o.order_number'
        : tableHasColumn('orders', 'number')
        ? 'o.number'
        : 'o.id';
      const orderNumberCol = `COALESCE(NULLIF(${referenceCol}, ''), ${localNumberCol})`;

      const fullNameCol = tableHasColumn('orders', 'customer_name')
        ? 'o.customer_name'
        : tableHasColumn('orders', 'full_name')
        ? 'o.full_name'
        : `' '`; // fallback

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
        reference_no?: string | null;
        full_name?: string | null;
        paid_at?: any;
        completed_at?: any;
        status_code?: any;
      };

      // ── 1) Load orders in range ───────────────────────
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
          ${referenceCol} AS reference_no,
          ${localNumberCol} AS local_number,
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
          } AS payment_method_id,
          ${
            tableHasColumn('orders', 'paid_at') ? 'o.paid_at' : 'NULL'
          } AS paid_at,
          ${
            tableHasColumn('orders', 'completed_at') ? 'o.completed_at' : 'NULL'
          } AS completed_at,
          ${
            tableHasColumn('orders', 'status_code') ? 'o.status_code' : 'NULL'
          } AS status_code
        FROM orders o
        WHERE ${tsMs} >= @fromMs AND ${tsMs} < @toMs
        ${andBranch}
      `
        )
        .all({ fromMs, toMs, branch_id: branchId }) as Row[];

      // ── 2) Counters / totals ──────────────────────────
      let total_order = 0;
      let inside_hours_count = 0;
      let outside_hours_count = 0;
      let canceled_order_count = 0;
      // Rows that are neither a sale nor a cancellation — an open ticket, or a
      // row whose total never got recalculated. They were previously counted
      // nowhere while still being printed in the table, which is why the cards
      // (29 + 1 + 1) did not add up to the table's own row count (37).
      let uncounted_order_count = 0;

      let gross_sales_total = 0;
      let discounts = 0;
      let delivery_fees = 0;
      let grand_total = 0;
      let outside_hours_total = 0;
      let cancelled_total = 0;

      const decoratedOrders: Array<{
        counted: 'sale' | 'cancelled' | 'uncounted';
        uncounted_reason?: 'no_total' | 'not_placed';
        id: string;
        order_number: string;
        full_name: string;
        ts_ms: number;
        payment_method_id?: string;
        payment_method_slug?: string;
        reference_no?: string;
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

        // Decided once, here, and carried on the row. The table used to be
        // built before this and so could not say which rows the totals had
        // skipped — the footer knew, the reader did not.
        const { counted, uncounted_reason } = classifyRow(r);
        const cancelled = counted === 'cancelled';
        const sold = counted === 'sale';

        const decorated = {
          counted,
          uncounted_reason,
          id: String(r.id),
          order_number: String(r.order_number ?? r.id ?? ''),
          full_name: String(r.full_name ?? ''),
          ts_ms: ts,
          payment_method_id: r.payment_method_id ?? undefined,
          payment_method_slug: r.payment_method_slug ?? undefined,
          reference_no: r.reference_no != null ? String(r.reference_no) : undefined,
          order_type: Number(r.order_type ?? 0),
          status: r.status ?? '',
          // `as const`: without it this widens to `string` and stops matching
          // the declared row shape — a pre-existing typecheck failure in this
          // file, and the reason its errors were noise rather than signal.
          operational_status: (inside ? 'inside' : 'outside') as
            | 'inside'
            | 'outside',
          discount_amount:
            r.discount_amount != null ? Number(r.discount_amount) : undefined,
          discount_total:
            r.discount_total != null ? Number(r.discount_total) : undefined,
          delivery_fee:
            r.delivery_fee != null ? Number(r.delivery_fee) : undefined,
          grand_total: Number(r.grand_total ?? 0),
        };

        decoratedOrders.push(decorated);

        if (cancelled) {
          canceled_order_count += 1;
          cancelled_total += Number(r.grand_total ?? r.subtotal ?? 0);
          continue;
        }

        if (sold) {
          total_order += 1;
          if (inside) inside_hours_count += 1;
          else outside_hours_count += 1;

          const money = rowMoney(r);

          gross_sales_total += money.gross;
          discounts += money.discount;
          delivery_fees += money.delivery;
          grand_total += money.net;
          if (!inside) outside_hours_total += money.net;
        } else {
          uncounted_order_count += 1;
        }
      }

      // ── 3) Payments aggregate ─────────────────────────
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
                  ${
                    hasBranch && branchId
                      ? ' AND o.branch_id = @branch_id '
                      : ''
                  }
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

      // ── 4) Order type aggregate ───────────────────────
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

      // ── 5) Category aggregate ─────────────────────────
      const categories = (() => {
        const linesTable = firstExistingTable(['order_lines']);
        const itemTbl = firstExistingTable(['items']);
        if (!linesTable || !itemTbl) {
          return [] as Array<{ item: string; sold: number; total: number }>;
        }

        // If items table doesn't have category_id, we can't group by category
        if (!tableHasColumn(itemTbl, 'category_id')) {
          return [] as Array<{ item: string; sold: number; total: number }>;
        }

        const hasCats = tableExists('categories');

        let joinCat = '';
        let catNameExpr = `CAST(it.category_id AS TEXT)`; // fallback

        if (hasCats) {
          const hasCatNameEn = tableHasColumn('categories', 'name_en');
          const hasCatNameAr = tableHasColumn('categories', 'name_ar');
          const hasCatName = tableHasColumn('categories', 'name');

          joinCat = 'LEFT JOIN categories c ON c.id = it.category_id';

          const parts: string[] = [];
          if (hasCatNameEn) parts.push('c.name_en');
          if (hasCatNameAr) parts.push('c.name_ar');
          if (hasCatName) parts.push('c.name');

          if (parts.length > 0) {
            catNameExpr = `COALESCE(${parts.join(', ')}, 'Uncategorized')`;
          } else {
            catNameExpr = `CAST(it.category_id AS TEXT)`;
          }
        }

        const sql = `
          SELECT
            ${catNameExpr} AS item,
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

      // ── 6) Items aggregate ("By Item" tab) ────────────
      const aggregates = (() => {
        const linesTable = firstExistingTable(['order_lines']);
        const itemTbl = firstExistingTable(['items']);
        if (!linesTable || !itemTbl) {
          return [] as Array<{ item: string; sold: number; total: number }>;
        }

        const hasNameEn = tableHasColumn(itemTbl, 'name_en');
        const hasNameAr = tableHasColumn(itemTbl, 'name_ar');
        const hasName = tableHasColumn(itemTbl, 'name');

        let itemNameExpr: string;
        if (hasNameEn || hasNameAr) {
          itemNameExpr = `COALESCE(it.name_ar, it.name, 'Unknown Item')`;
        } else if (hasName) {
          itemNameExpr = `COALESCE(it.name, 'Unknown Item')`;
        } else {
          itemNameExpr = `CAST(it.id AS TEXT)`;
        }

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

      // ── 7) Footer summary ─────────────────────────────
      const footer = {
        date: `${new Date(fromMs).toLocaleString()} to ${new Date(
          toMs
        ).toLocaleString()}`,
        total_order,
        inside_hours_count,
        outside_hours_count,
        canceled_order_count,
        uncounted_order_count,
        // Sales + cancelled + uncounted == the number of rows in the table
        // below. If these two ever disagree again, the report is dropping
        // orders on the floor and this is where it shows.
        listed_order_count: decoratedOrders.length,
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
        // The screen needs to know the range is fixed, so it can say so rather
        // than show a date picker that silently does nothing.
        canPickRange,
        clamped,
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
