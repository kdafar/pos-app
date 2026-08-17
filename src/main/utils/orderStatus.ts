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
} as const;

/** Still on the till: shown in the active-orders bar and editable. */
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
