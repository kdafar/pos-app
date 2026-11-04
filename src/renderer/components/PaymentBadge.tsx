// src/renderer/components/PaymentBadge.tsx
import { CheckCircle2, Clock, CloudUpload, CreditCard, HandCoins, XCircle } from 'lucide-react';
import { useI18n } from '../i18n';

/**
 * Whether an order has been paid.
 *
 * Two different kinds of fact end up in this badge, and it deliberately does
 * not present them as the same thing:
 *
 *  - a payment LINK has a real, server-verified state, so "Paid" there means
 *    money has actually been confirmed received
 *  - a counter sale has no paid flag at all. Payment is taken when the order is
 *    closed, so a closed order was collected — but that is the till's own
 *    inference, not a verified receipt
 *
 * Every state is a solid status chip (green paid, amber awaiting, red failed,
 * gray other). The verified case and the inferred case are told apart by icon
 * and wording (CheckCircle "Paid" vs CreditCard "Collected"), so a cashier
 * handing over food can tell "the customer's payment cleared" from "we closed
 * this, so someone took the money".
 */

export type PaymentState =
  | 'paid' // provider-confirmed (link or online order): server `paid.how = gateway`
  | 'paid_hand' // a person marked it paid: server `paid.how = by_hand`
  | 'paid_queued' // marked on this till, still in the outbox
  | 'pending' // link, awaiting the customer
  | 'failed'
  | 'expired'
  | 'collected' // counter sale on a closed order — inferred
  | 'unpaid'; // still open, nothing taken

/** Statuses that mean the sale is finished and the money was taken. */
const SETTLED = ['closed', 'completed', 'prepared', 'ready'];

/** The order fields the badge reads. All optional; absent means "unknown". */
export type PaymentBadgeOrder = {
  payment_link_status?: string | null;
  status?: string | null;
  /** Mark order paid: the server's `paid.status`; NULL = server records none. */
  paid_status?: string | null;
  paid_how?: string | null;
  paid_by_name?: string | null;
  paid_method_name?: string | null;
  paid_method_name_ar?: string | null;
  /** 'mark' | 'undo' while waiting in the till's outbox. */
  paid_pending?: string | null;
};

export function paymentStateOf(order: PaymentBadgeOrder): PaymentState {
  // A queued tap is the newest fact this till has. An undo waiting to go is
  // shown as not paid — the cashier has already said the money is not in.
  const pending = String(order?.paid_pending ?? '').toLowerCase();
  if (pending === 'mark') return 'paid_queued';

  if (pending !== 'undo' && String(order?.paid_status ?? '').toLowerCase() === 'paid') {
    return String(order?.paid_how ?? '').toLowerCase() === 'by_hand' ? 'paid_hand' : 'paid';
  }

  // Server says unpaid, or does not record payment: today's inference.
  const link = String(order?.payment_link_status ?? '')
    .trim()
    .toLowerCase();

  if (link === 'paid') return 'paid';
  if (link === 'pending') return 'pending';
  if (link === 'failed') return 'failed';
  if (link === 'expired') return 'expired';

  const status = String(order?.status ?? '')
    .trim()
    .toLowerCase();
  if (status === 'cancelled') return 'unpaid';
  return SETTLED.includes(status) ? 'collected' : 'unpaid';
}

export function PaymentBadge({
  status,
  order,
  size = 'sm',
}: {
  /** Link status on its own — kept for callers that only have that. */
  status?: string | null;
  /** Preferred: the whole row, so a counter sale can be judged too. */
  order?: PaymentBadgeOrder;
  size?: 'sm' | 'md';
  /**
   * Accepted and ignored. Colour comes from semantic tokens now, so both
   * themes are correct without the caller knowing which one is active.
   * @deprecated remove from call sites.
   */
  theme?: 'light' | 'dark';
}) {
  const { t, lang } = useI18n();

  const state = order
    ? paymentStateOf(order)
    : paymentStateOf({ payment_link_status: status, status: null });

  // Callers passing only a link status want nothing when there is no link.
  if (!order && !String(status ?? '').trim()) return null;

  function handLabel() {
    const method =
      (lang === 'ar' ? order?.paid_method_name_ar : null) || order?.paid_method_name || '';
    const name = order?.paid_by_name || '';
    // Drop an empty part rather than print "Paid ·  · Sara".
    if (!method || !name) {
      return [t('paid.badgeGateway'), method, name].filter(Boolean).join(' · ');
    }
    return t('paid.badgeHand', { method, name });
  }

  const variants: Record<
    PaymentState,
    { label: string; chip: string; Icon: typeof Clock }
  > = {
    paid: {
      label: t('paid.badgeGateway'),
      chip: 'ui-chip-green', // verified by the payment provider
      Icon: CheckCircle2,
    },
    // §12: "Paid · {method} · {name}". The server holds a real record of who
    // took the money, which is a recorded fact, not the till's inference.
    paid_hand: {
      label: handLabel(),
      chip: 'ui-chip-green',
      Icon: HandCoins,
    },
    paid_queued: {
      label: t('paid.badgeQueued'),
      chip: 'ui-chip-amber',
      Icon: CloudUpload,
    },
    collected: {
      label: t('pay.collected'),
      chip: 'ui-chip-green', // inferred from the order being closed
      Icon: CreditCard,
    },
    pending: {
      label: t('pay.awaiting'),
      chip: 'ui-chip-amber',
      Icon: Clock,
    },
    expired: {
      label: t('pay.expired'),
      chip: 'ui-chip-red',
      Icon: XCircle,
    },
    failed: {
      label: t('pay.failed'),
      chip: 'ui-chip-red',
      Icon: XCircle,
    },
    unpaid: {
      label: t('pay.unpaid'),
      chip: 'ui-chip-amber',
      Icon: Clock,
    },
  };

  const v = variants[state];

  return (
    <span
      className={`ui-chip ${v.chip} ${size === 'md' ? '!h-7 !px-3 !text-sm' : ''}`}
      aria-label={v.label}
    >
      <v.Icon size={size === 'md' ? 15 : 13} strokeWidth={1.8} />
      {v.label}
    </span>
  );
}
