// src/main/utils/orderStatus.ts
//
// Single source of truth for the LOCAL order lifecycle.
//
//   open     – being built at the till
//   placed   – "Place order" pressed: paid/confirmed, still on screen so the
//              cashier can add to it. Pushed to the server immediately.
//   prepared – dine-in equivalent of `placed`
//   closed   – "Close order" pressed: finished and cleared from the till
//   completed– legacy/server-side terminal state; still treated as final
//   cancelled– voided
//
// Previously "Place order" jumped straight to `completed`, which both cleared
// the order off the till and was the ONLY state the sync push looked at.

export const ORDER_STATUS = {
  OPEN: 'open',
  PENDING: 'pending',
  PLACED: 'placed',
  PREPARED: 'prepared',
  READY: 'ready',
  AWAITING_PICKUP: 'awaiting_pickup',
  CLOSED: 'closed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  CANCELLED_CLIENT: 'cancelled_client',
} as const;

/** Operationally active; only drafts and active dine-in appear in the cart bar. */
export const ACTIVE_STATUSES = [
  ORDER_STATUS.OPEN,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PLACED,
  ORDER_STATUS.PREPARED,
  ORDER_STATUS.READY,
  ORDER_STATUS.AWAITING_PICKUP,
] as const;

/** Finished — no longer shown as active. */
export const TERMINAL_STATUSES = [
  ORDER_STATUS.CLOSED,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.CANCELLED_CLIENT,
] as const;

/**
 * Statuses the sync push must send. `placed`/`prepared` are included so a sale
 * reaches the server the moment it is taken — waiting for `close` would mean an
 * order left open all day (or lost to a crash) never syncs.
 */
export const PUSHABLE_STATUSES = [
  ORDER_STATUS.PLACED,
  ORDER_STATUS.PREPARED,
  ORDER_STATUS.READY,
  ORDER_STATUS.AWAITING_PICKUP,
  ORDER_STATUS.CLOSED,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED_CLIENT,
] as const;

/** Render as a SQL list, e.g. `'placed','closed'`. */
export function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

export function isTerminal(status: unknown): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(
    String(status || '').toLowerCase()
  );
}

/**
 * Server status codes that occupy a dine-in table and keep an order on the
 * strip / kitchen board: RECEIVED, PREPARING, READY. This is the SAME rule the
 * server uses for Table busy-ness (Table.php), so every device agrees.
 */
export const ACTIVE_SERVER_CODES = [1, 2, 3] as const;

/**
 * One definition of "active" for any order row, own or pulled:
 *   - its local status word is an active one (own orders), OR
 *   - the server says code 1-3 AND the word is not a finished one. The
 *     terminal guard matters: a till-closed order keeps a stale code 1 until
 *     the server acknowledges the close.
 * `alias` is the orders table alias.
 */
export function activeOrderSql(alias = 'o'): string {
  return `(${alias}.status IN (${sqlList(ACTIVE_STATUSES)}) OR (${alias}.status_code IN (${ACTIVE_SERVER_CODES.join(', ')}) AND ${alias}.status NOT IN (${sqlList(TERMINAL_STATUSES)})))`;
}

/** JS twin of activeOrderSql, for rows already in memory. */
export function isActiveOrder(row: { status?: unknown; status_code?: unknown }): boolean {
  const word = String(row?.status ?? '').toLowerCase();
  if ((ACTIVE_STATUSES as readonly string[]).includes(word)) return true;
  if ((TERMINAL_STATUSES as readonly string[]).includes(word)) return false;
  const code = row?.status_code == null ? NaN : Number(row.status_code);
  return (ACTIVE_SERVER_CODES as readonly number[]).includes(code);
}
