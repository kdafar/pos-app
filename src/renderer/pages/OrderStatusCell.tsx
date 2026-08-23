// src/renderer/pages/OrderStatusCell.tsx
import { useEffect, useState } from 'react';
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
  { value: 'awaiting_pickup', key: 'admin.srv.7' },
  { value: 'closed', key: 'status.closed' },
  { value: 'cancelled_client', key: 'admin.srv.5' },
];

const TONE: Record<
  string,
  'default' | 'primary' | 'warning' | 'success' | 'danger'
> = {
  placed: 'primary',
  prepared: 'warning',
  ready: 'warning',
  awaiting_pickup: 'warning',
  closed: 'success',
  cancelled_client: 'danger',
};

export function OrderStatusCell({
  orderId,
  status,
  statusCode,
  disabled = false,
  onChanged,
}: {
  orderId: string;
  status?: string | null;
  statusCode?: number | null;
  disabled?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const statusNameForCode: Record<number, string> = {
    1: 'placed',
    2: 'prepared',
    3: 'ready',
    4: 'closed',
    5: 'cancelled_client',
    7: 'awaiting_pickup',
  };
  const [current, setCurrent] = useState(
    statusCode != null && statusNameForCode[Number(statusCode)]
      ? statusNameForCode[Number(statusCode)]
      : String(status ?? '').toLowerCase() || 'placed'
  );

  useEffect(() => {
    const fromServer =
      statusCode != null ? statusNameForCode[Number(statusCode)] : undefined;
    setCurrent(fromServer ?? (String(status ?? '').toLowerCase() || 'placed'));
  }, [status, statusCode]);

  // An order the till has finished with, or one the server owns, is not
  // something a cashier should be reordering from a dropdown.
  const known = FLOW.some((f) => f.value === current);

  const localCode: Record<string, number> = {
    placed: 1,
    prepared: 2,
    ready: 3,
    awaiting_pickup: 7,
    closed: 4,
    cancelled_client: 5,
  };
  const rawServerCode = statusCode == null ? NaN : Number(statusCode);
  const currentCode = Number.isFinite(rawServerCode)
    ? Math.max(rawServerCode, localCode[current] ?? 1)
    : localCode[current] ?? 1;
  const nextCodes: Record<number, number[]> = {
    1: [2, 5],
    2: [3, 5],
    3: [4, 7, 5],
    7: [4, 5],
    4: [],
    5: [],
  };
  const visible = FLOW.filter(
    (f) =>
      localCode[f.value] === currentCode ||
      (nextCodes[currentCode] ?? []).includes(localCode[f.value])
  );

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
      {visible.map((f) => (
        <SelectItem key={f.value}>{t(f.key)}</SelectItem>
      ))}
    </Select>
  );
}
