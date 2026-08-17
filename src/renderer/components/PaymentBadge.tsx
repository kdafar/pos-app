// src/renderer/components/PaymentBadge.tsx
import { Chip } from '@heroui/react';
import { CheckCircle2, Clock, CreditCard, XCircle } from 'lucide-react';
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
 * The verified case is rendered solid and the inferred case flat, so a cashier
 * handing over food can tell "the customer's payment cleared" from "we closed
 * this, so someone took the money". Collapsing them would make the stronger
 * claim for both.
 */

export type PaymentState =
  | 'paid' // link, verified
  | 'pending' // link, awaiting the customer
  | 'failed'
  | 'expired'
  | 'collected' // counter sale on a closed order — inferred
  | 'unpaid'; // still open, nothing taken

/** Statuses that mean the sale is finished and the money was taken. */
const SETTLED = ['closed', 'completed', 'prepared', 'ready'];

export function paymentStateOf(order: {
  payment_link_status?: string | null;
  status?: string | null;
}): PaymentState {
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
  order?: { payment_link_status?: string | null; status?: string | null };
  size?: 'sm' | 'md';
  /**
   * Accepted and ignored. Colour comes from semantic tokens now, so both
   * themes are correct without the caller knowing which one is active.
   * @deprecated remove from call sites.
   */
  theme?: 'light' | 'dark';
}) {
  const { t } = useI18n();

  const state = order
    ? paymentStateOf(order)
    : paymentStateOf({ payment_link_status: status, status: null });

  // Callers passing only a link status want nothing when there is no link.
  if (!order && !String(status ?? '').trim()) return null;

  const variants: Record<
    PaymentState,
    {
      label: string;
      color: 'success' | 'warning' | 'danger' | 'default';
      variant: 'solid' | 'flat';
      Icon: typeof Clock;
    }
  > = {
    paid: {
      label: t('pay.paid'),
      color: 'success',
      variant: 'solid', // verified by the payment provider
      Icon: CheckCircle2,
    },
    collected: {
      label: t('pay.collected'),
      color: 'success',
      variant: 'flat', // inferred from the order being closed
      Icon: CreditCard,
    },
    pending: {
      label: t('pay.awaiting'),
      color: 'warning',
      variant: 'flat',
      Icon: Clock,
    },
    expired: {
      label: t('pay.expired'),
      color: 'danger',
      variant: 'flat',
      Icon: XCircle,
    },
    failed: {
      label: t('pay.failed'),
      color: 'danger',
      variant: 'flat',
      Icon: XCircle,
    },
    unpaid: {
      label: t('pay.unpaid'),
      color: 'default',
      variant: 'flat',
      Icon: Clock,
    },
  };

  const v = variants[state];

  return (
    <Chip
      size={size}
      color={v.color}
      variant={v.variant}
      className='font-semibold'
      startContent={<v.Icon size={size === 'md' ? 15 : 13} />}
      title={v.label}
    >
      {v.label}
    </Chip>
  );
}
