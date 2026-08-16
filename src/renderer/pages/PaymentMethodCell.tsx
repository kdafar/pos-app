// src/renderer/pages/PaymentMethodCell.tsx
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

type Method = {
  id: string;
  slug: string;
  name_en?: string | null;
  name_ar?: string | null;
};

/**
 * Change the payment method on an already-placed order.
 *
 * A cashier rings up "cash" and the customer then pays by KNET; with no way to
 * correct it, the day's takings are wrong by that amount and the discrepancy is
 * only found at closing. Deliberately available on closed orders — the
 * correction is almost always needed after the sale, not during it.
 *
 * A native <select> on purpose. The first version was a custom button plus a
 * portalled menu, and it never opened inside the table: the menu was clipped by
 * the container's overflow, and once portalled it still failed to mount. A
 * native select is rendered by the OS, so it cannot be clipped, overlapped or
 * mis-stacked — which is exactly the class of bug that made this look dead.
 */
export function PaymentMethodCell({
  orderId,
  slug,
  theme,
  disabled = false,
  onChanged,
}: {
  orderId: string;
  slug?: string | null;
  theme: 'light' | 'dark';
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const { t, lang } = useI18n();
  const [methods, setMethods] = useState<Method[]>([]);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string>(slug ?? '');

  useEffect(() => setCurrent(slug ?? ''), [slug]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await window.api.invoke('payments:listMethods')) || [];
        if (!cancelled) setMethods(list);
      } catch {
        if (!cancelled) setMethods([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const label = (m: Method) =>
    (lang === 'ar' ? m.name_ar || m.name_en : m.name_en || m.name_ar) || m.slug;

  const change = async (methodId: string) => {
    const m = methods.find((x) => String(x.id) === methodId);
    if (!m) return;
    const previous = current;
    setCurrent(m.slug); // optimistic, reverted on failure
    setBusy(true);
    try {
      await window.api.invoke('orders:setPaymentMethod', orderId, m.id);
      onChanged?.();
    } catch (e) {
      console.error('orders:setPaymentMethod failed', e);
      setCurrent(previous);
    } finally {
      setBusy(false);
    }
  };

  const dark = theme === 'dark';

  return (
    <select
      value={methods.find((m) => m.slug === current)?.id ?? ''}
      disabled={disabled || busy || methods.length === 0}
      onChange={(e) => change(e.target.value)}
      title={t('admin.orders.changePayment')}
      className={`w-full max-w-[8.5rem] h-8 px-2 rounded-md text-xs outline-none transition
        disabled:opacity-50 disabled:cursor-not-allowed
        focus:ring-2 focus:ring-sky-500/40 ${
          dark
            ? 'bg-white/10 text-slate-100 border border-white/15'
            : 'bg-white text-gray-800 border border-gray-300'
        }`}
    >
      {/* Shown when the order has no method, or one the catalogue lost. */}
      <option value=''>{current || '—'}</option>
      {methods.map((m) => (
        <option key={m.id} value={m.id}>
          {label(m)}
        </option>
      ))}
    </select>
  );
}
