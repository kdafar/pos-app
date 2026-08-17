// src/renderer/pages/PaymentMethodCell.tsx
import { useEffect, useState } from 'react';
import { Select, SelectItem } from '@heroui/react';
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
 * A native <select> was used here for a while, because the first attempt was a
 * hand-rolled button plus a portalled menu that never opened inside the table —
 * clipped by the container's overflow, and still dead once portalled. HeroUI's
 * Select portals to the document root and manages its own stacking, so it does
 * not reproduce that bug, and unlike the native control it can actually be
 * themed to match the rest of the table.
 */
export function PaymentMethodCell({
  orderId,
  slug,
  disabled = false,
  onChanged,
}: {
  orderId: string;
  slug?: string | null;
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

  return (
    <Select
      size='sm'
      selectedKeys={
        methods.find((m) => m.slug === current)
          ? [String(methods.find((m) => m.slug === current)!.id)]
          : []
      }
      isDisabled={disabled || busy || methods.length === 0}
      isLoading={busy}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (next != null) change(String(next));
      }}
      aria-label={t('admin.orders.changePayment')}
      title={t('admin.orders.changePayment')}
      // Falls back to whatever the order carries, so a method the catalogue has
      // since dropped still shows its name instead of an empty control.
      placeholder={current || '—'}
      className='w-full max-w-[10rem]'
    >
      {methods.map((m) => (
        <SelectItem key={String(m.id)}>{label(m)}</SelectItem>
      ))}
    </Select>
  );
}
