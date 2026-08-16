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
      return SERVER_STATUS.DONE; // 4
    case 'prepared':
    case 'ready':
      return SERVER_STATUS.READY; // 3
    default:
      return SERVER_STATUS.RECEIVED; // 1
  }
}
