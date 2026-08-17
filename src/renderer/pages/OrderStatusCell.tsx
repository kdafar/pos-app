// src/renderer/pages/OrderStatusCell.tsx
import { useState } from 'react';
import { Select, SelectItem } from '@heroui/react';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n';

/**
 * Move an order along its lifecycle from the orders list.
 *
 * Placing an order used to jump straight to closed, so there was nothing to
 * record between "rung up" and "finished" — a delivery was marked done before
 * anyone had driven anywhere, and staff had no way to say otherwise.
 *
 * Cancelling is not offered. The push channel cannot express it: the backend's
 * pushable statuses exclude both cancelled codes and silently drop anything
 * outside that list, so a cancel would sync back as received. Offering a
 * control that quietly does the opposite of what it says is worse than not
 * offering it.
 */

const FLOW: { value: string; key: StringKey }[] = [
  { value: 'placed', key: 'status.placed' },
  { value: 'prepared', key: 'status.prepared' },
  { value: 'ready', key: 'status.ready' },
  { value: 'closed', key: 'status.closed' },
];

const TONE: Record<string, 'default' | 'primary' | 'warning' | 'success'> = {
  placed: 'primary',
  prepared: 'warning',
  ready: 'warning',
  closed: 'success',
};

export function OrderStatusCell({
  orderId,
  status,
  disabled = false,
  onChanged,
}: {
  orderId: string;
  status?: string | null;
  disabled?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(
    String(status ?? '').toLowerCase() || 'placed'
  );

  // An order the till has finished with, or one the server owns, is not
  // something a cashier should be reordering from a dropdown.
  const known = FLOW.some((f) => f.value === current);

  const change = async (next: string) => {
    const previous = current;
    setCurrent(next); // optimistic; reverted if the handler refuses
    setBusy(true);
    try {
      await window.api.invoke('orders:setStatus', orderId, next);
      await onChanged?.();
    } catch (e) {
      console.error('orders:setStatus failed', e);
      setCurrent(previous);
    } finally {
      setBusy(false);
    }
  };

  if (!known) {
    return <span className='text-default-700'>{status || '—'}</span>;
  }

  return (
    <Select
      size='sm'
      selectedKeys={[current]}
      isDisabled={disabled || busy}
      isLoading={busy}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (next != null && String(next) !== current) change(String(next));
      }}
      aria-label={t('admin.orders.changeStatus')}
      title={t('admin.orders.changeStatus')}
      color={TONE[current] ?? 'default'}
      className='w-full max-w-[10rem]'
    >
      {FLOW.map((f) => (
        <SelectItem key={f.value}>{t(f.key)}</SelectItem>
      ))}
    </Select>
  );
}
