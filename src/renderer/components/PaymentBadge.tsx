// src/renderer/components/PaymentBadge.tsx
import { CreditCard, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useI18n } from '../i18n';

/**
 * Paid / unpaid state for an online-link order.
 *
 * Nothing surfaced this before: the till created a payment link and then never
 * showed the outcome, so a cashier handing over food had no way to tell whether
 * the customer had actually paid. Absence of a badge means the order was not
 * paid by link at all (cash, KNET terminal, …) — only link orders get one.
 */
export function PaymentBadge({
  status,
  theme = 'light',
  size = 'sm',
}: {
  status?: string | null;
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md';
}) {
  const { t } = useI18n();
  const s = String(status ?? '').toLowerCase();
  if (!s) return null;

  const dark = theme === 'dark';
  const pad = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[11px]';
  const icon = size === 'md' ? 14 : 12;

  const variants: Record<
    string,
    { label: string; cls: string; Icon: typeof Clock }
  > = {
    paid: {
      label: t('pay.paid'),
      cls: dark
        ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40'
        : 'bg-emerald-50 text-emerald-800 border-emerald-300',
      Icon: CheckCircle2,
    },
    pending: {
      label: t('pay.awaiting'),
      cls: 'bg-amber-500/15 text-warning border-amber-500/40',
      Icon: Clock,
    },
    failed: {
      label: t('pay.failed'),
      cls: dark
        ? 'bg-rose-500/15 text-rose-200 border-rose-500/40'
        : 'bg-rose-50 text-rose-800 border-rose-300',
      Icon: XCircle,
    },
  };

  const v = variants[s] ?? {
    label: status as string,
    cls: 'bg-default-100 text-default-600 border-default-200',
    Icon: CreditCard,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap ${pad} ${v.cls}`}
      title={v.label}
    >
      <v.Icon size={icon} />
      {v.label}
    </span>
  );
}
