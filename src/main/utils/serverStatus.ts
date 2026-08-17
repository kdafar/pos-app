// src/main/utils/serverStatus.ts
//
// The backend's order status enum (App\Order class constants), confirmed in
// docs/BACKEND-QUESTIONS.md §1.1. The integer in orders.status is the whole
// truth — there is no status table.
//
// Codes 3 and 4 read differently for delivery than for pickup / dine-in, so
// labels are resolved with the order_type in hand.

export const SERVER_STATUS = {
  PENDING: 0,
  RECEIVED: 1,
  PREPARING: 2,
  READY: 3,
  DONE: 4,
  CANCELLED_CLIENT: 5,
  CANCELLED_ADMIN: 6,
  AWAITING_PICKUP: 7,
  REJECTED_AUTO: 8,
  REJECTED: 9,
} as const;

/** §1.2 — edits must be blocked on these. */
export const TERMINAL_SERVER_STATUSES = [4, 5, 6, 8, 9];

export function isTerminalServerStatus(code: unknown): boolean {
  const n = Number(code);
  return Number.isFinite(n) && TERMINAL_SERVER_STATUSES.includes(n);
}

/** Delivery is order_type 1; 2 = pickup, 3 = dine-in. */
function isDelivery(orderType: unknown): boolean {
  return Number(orderType) === 1;
}

/**
 * §3.4 — Arabic supplied by the backend so the till and the admin dashboard
 * never describe the same order differently. Do not paraphrase these.
 */
const LABELS: Record<number, { en: string; ar: string }> = {
  0: { en: 'Pending payment', ar: 'بانتظار الدفع' },
  1: { en: 'Order received', ar: 'تم تسجيل الطلب' },
  2: { en: 'Preparing', ar: 'قيد التحضير' },
  5: { en: 'Cancelled by customer', ar: 'ألغيت من قبلك' },
  6: { en: 'Cancelled by admin', ar: 'ألغيت من قبل الإدارة' },
  7: { en: 'Waiting for pickup', ar: 'بانتظار الاستلام' },
  8: { en: 'Rejected (automatic)', ar: 'مرفوض (تلقائي)' },
  9: { en: 'Rejected (manual)', ar: 'مرفوض (يدوي)' },
};

const LABELS_BY_TYPE: Record<
  number,
  { delivery: { en: string; ar: string }; other: { en: string; ar: string } }
> = {
  3: {
    delivery: { en: 'Assigned to driver', ar: 'سلمت للسائق' },
    other: { en: 'Waiting for pickup', ar: 'بانتظار الاستلام' },
  },
  4: {
    delivery: { en: 'Delivered', ar: 'تم التوصيل' },
    other: { en: 'Picked up', ar: 'تم الاستلام' },
  },
};

export function serverStatusLabel(
  code: unknown,
  orderType: unknown,
  lang: 'en' | 'ar' = 'en'
): string {
  const n = Number(code);
  if (!Number.isFinite(n)) return lang === 'ar' ? 'غير معروف' : 'Unknown';

  const split = LABELS_BY_TYPE[n];
  if (split) return (isDelivery(orderType) ? split.delivery : split.other)[lang];

  const flat = LABELS[n];
  if (flat) return flat[lang];

  // Nothing outside 0–9 is written by any server code path, but keep unknown
  // codes visible rather than guessed — the backend asked us to keep doing this.
  return `${lang === 'ar' ? 'حالة' : 'Status'} ${n}`;
}

/**
 * §1.4 — the status code to send when pushing. The server currently hard-codes
 * 1 on insert and ignores this, but will honour a whitelist of 1,2,3,4,7 once
 * their change ships; sending the right value now means it starts working
 * without a client release.
 */
export function pushStatusForLocal(localStatus: string): number {
  switch (String(localStatus || '').toLowerCase()) {
    case 'closed':
    case 'completed':
      return SERVER_STATUS.DONE; // 4 — the status revenue posts against

    case 'ready':
      return SERVER_STATUS.READY; // 3 — "assigned to driver" / "waiting for pickup"

    case 'awaiting_pickup':
      return SERVER_STATUS.AWAITING_PICKUP;

    case 'prepared':
      // Was reported as READY, which the dashboard shows as ready to collect or
      // already with a driver. An order still being made is PREPARING; sending
      // 3 told the customer their food was on its way while it was on the pass.
      return SERVER_STATUS.PREPARING; // 2

    case 'cancelled_client':
      return SERVER_STATUS.CANCELLED_CLIENT;

    case 'cancelled':
      // Never reachable through the push channel — the backend's pushable list
      // excludes both cancelled codes and silently drops anything outside it,
      // so this would land as RECEIVED. Mapped for completeness only; the till
      // does not offer cancelling for exactly this reason.
      return SERVER_STATUS.CANCELLED_ADMIN; // 6

    default:
      // open / pending / placed — the sale exists, nothing has happened to it.
      return SERVER_STATUS.RECEIVED; // 1
  }
}

/**
 * How far through its life a status is.
 *
 * Not the raw integer: 7 (awaiting pickup) sits alongside 3 (ready) rather than
 * after 4 (done), and the cancelled/rejected codes are not "further along" than
 * anything — they are simply final.
 */
function progressRank(code: number): number {
  if (TERMINAL_SERVER_STATUSES.includes(code) && code !== SERVER_STATUS.DONE) {
    return 99; // cancelled or rejected — nothing may move it
  }
  switch (code) {
    case SERVER_STATUS.PENDING:
      return 0;
    case SERVER_STATUS.RECEIVED:
      return 1;
    case SERVER_STATUS.PREPARING:
      return 2;
    case SERVER_STATUS.READY:
    case SERVER_STATUS.AWAITING_PICKUP:
      return 3;
    case SERVER_STATUS.DONE:
      return 4;
    default:
      return 1;
  }
}

/**
 * The status this till may safely push, given what the server last told us.
 *
 * The server is the truth for status. An order can be advanced from the
 * dashboard — marked preparing, delivered, or cancelled — while the till still
 * holds whatever it last set locally. Several ordinary till actions re-queue an
 * order for push (closing it, changing its payment method, editing the delivery
 * fee), and each of those would otherwise resend the local status and drag the
 * order backwards: a delivered order returned to "received", or a cancelled one
 * quietly revived.
 *
 * So a push may move an order forward, never back. When the server is already
 * at or beyond where the till thinks it is, the till echoes the server's own
 * code — a no-op — rather than asserting its own.
 */
export function safePushStatus(
  localStatus: string,
  serverCode: unknown
): number {
  const local = pushStatusForLocal(localStatus);
  const server = Number(serverCode);
  if (!Number.isFinite(server)) return local; // never synced; nothing to protect

  return progressRank(server) >= progressRank(local) ? server : local;
}

const ALLOWED_POS_TRANSITIONS: Record<number, readonly number[]> = {
  [SERVER_STATUS.RECEIVED]: [SERVER_STATUS.PREPARING, SERVER_STATUS.CANCELLED_CLIENT],
  [SERVER_STATUS.PREPARING]: [SERVER_STATUS.READY, SERVER_STATUS.CANCELLED_CLIENT],
  [SERVER_STATUS.READY]: [
    SERVER_STATUS.DONE,
    SERVER_STATUS.AWAITING_PICKUP,
    SERVER_STATUS.CANCELLED_CLIENT,
  ],
  [SERVER_STATUS.AWAITING_PICKUP]: [SERVER_STATUS.DONE, SERVER_STATUS.CANCELLED_CLIENT],
  [SERVER_STATUS.DONE]: [],
  [SERVER_STATUS.CANCELLED_CLIENT]: [],
};

export function isAllowedPosTransition(current: unknown, next: unknown): boolean {
  const from = Number(current);
  const to = Number(next);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (!(from in ALLOWED_POS_TRANSITIONS) || !(to in ALLOWED_POS_TRANSITIONS)) return false;
  return from === to || ALLOWED_POS_TRANSITIONS[from].includes(to);
}
