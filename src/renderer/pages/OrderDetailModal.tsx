// src/renderer/pages/OrderDetailModal.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react';
import {
  AlertTriangle,
  Clock,
  CreditCard,
  MapPin,
  QrCode,
  Receipt,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, useOrderTypeLabel, useStatusLabel } from '../i18n';
import { DataTable } from '../components/DataTable';
import { DataState } from '../components/PageShell';
import { OrderTimeline } from './OrderTimeline';
import { PaymentBadge } from '../components/PaymentBadge';
import { MarkPaidControl } from '../components/MarkPaidControl';

import { errorLine as errLine } from '../utils/posError';
import { SYNCED_EVENT } from '../utils/syncEvents';
/**
 * Everything one order holds: customer, address, items, totals, payment state
 * and a timeline of what happened when.
 *
 * The timeline reads pos_action_log, which the app has written since long
 * before this screen existed but never displayed — so "when was this printed",
 * "who closed it" had no answer on the till.
 *
 * Styling follows the shared system: a HeroUI Modal rather than a hand-rolled
 * `fixed inset-0` overlay, semantic tokens rather than slate/blue literals, and
 * DataState/DataTable so a failed load says so and offers a retry instead of
 * looking like an order with nothing in it.
 */

/** Status chip colour per docs/DESIGN-SYSTEM.md. */
function statusChip(status: unknown): string {
  const s = String(status ?? '').toLowerCase();
  if (s === 'closed' || s === 'completed' || s === 'done') return 'ui-chip-green';
  if (s === 'ready' || s === 'awaiting_pickup') return 'ui-chip-blue';
  if (s.startsWith('cancel') || s === 'rejected' || s === 'refunded') return 'ui-chip-red';
  if (s === 'placed' || s === 'new') return 'ui-chip-brand';
  return 'ui-chip-gray';
}

/** A labelled panel. The label is a solid tone, never a faded one. */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className='ui-card min-w-0 space-y-2 p-4'>
      <div className='flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ink-2'>
        <Icon size={16} strokeWidth={1.8} />
        {title}
      </div>
      {children}
    </div>
  );
}

export function OrderDetailModal({
  orderId,
  onClose,
  onShowQr,
  onChanged,
}: {
  orderId: string;
  /**
   * Accepted but ignored: every colour here is a semantic token, so both themes
   * are correct from one definition. Kept optional only because call sites live
   * in files this change does not touch.
   */
  theme?: 'light' | 'dark';
  onClose: () => void;
  onShowQr?: (orderId: string) => void;
  /** After a paid mark or undo, so the list behind shows the new state too. */
  onChanged?: () => void | Promise<void>;
}) {
  const { t, name: localName, money, lang } = useI18n();
  const typeLabel = useOrderTypeLabel();
  const statusLabel = useStatusLabel();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the most recent request may write state: a retry fired while the first
  // call is still in flight must not be overwritten by the slower answer.
  const reqRef = useRef(0);

  // `quiet`: a background re-read after a sync. No spinner, and a failure
  // keeps what is on screen rather than replacing the order with an error.
  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = !!opts?.quiet;
    const seq = ++reqRef.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const d = await window.api.invoke('orders:getDetail', orderId);
      if (seq !== reqRef.current) return;
      if (quiet && !d) return;
      // Nothing changed: leave the screen alone rather than re-render it.
      if (quiet) {
        setData((prev: any) => (JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
        return;
      }
      if (!d) {
        setData(null);
        setError(t('admin.orders.detailMissing'));
      } else {
        setData(d);
      }
    } catch (e) {
      if (seq !== reqRef.current || quiet) return;
      setData(null);
      setError(errLine(e));
    } finally {
      if (seq === reqRef.current && !quiet) setLoading(false);
    }
  }, [orderId, t]);

  useEffect(() => {
    load();
    return () => {
      // Invalidate anything still in flight for the order we are leaving.
      reqRef.current++;
    };
  }, [load]);

  // A sync can change this order under the cashier's eyes — most often a
  // customer's online payment landing. Re-read it then, or the modal keeps
  // saying "Unpaid" for an order the till already knows is paid.
  useEffect(() => {
    const onSynced = () => void load({ quiet: true });
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, [load]);

  const when = (ms?: number | null) =>
    ms
      ? new Date(ms).toLocaleString(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB')
      : '—';

  const o = data?.order;
  // The handler builds `lines` from a join that can come back empty for orders
  // seeded from the server, so never dereference it directly.
  const lines: any[] = useMemo(() => data?.lines ?? [], [data]);
  const timeline: any[] = useMemo(() => data?.timeline ?? [], [data]);

  const geoLine = [data?.geo?.state, data?.geo?.city, data?.geo?.block]
    .filter(Boolean)
    .map((g: any) => (lang === 'ar' ? g.name_ar || g.name : g.name))
    .join(' — ');

  const columns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        id: 'item',
        header: () => t('opts.variation'),
        size: 240,
        enableSorting: false,
        cell: ({ row }) => {
          const l = row.original;
          return (
            <div className='leading-tight'>
              <span className='font-semibold ink'>
                {localName(l)}
              </span>
              {l.variation && (
                <span className='ms-1 text-xs ink-2'>
                  [{l.variation}]
                </span>
              )}
              {l.addons_name && (
                <div className='text-xs ink-2'>
                  + {l.addons_name}
                </div>
              )}
              {l.notes && (
                <div className='text-xs font-medium italic ink-2'>
                  {l.notes}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'qty',
        header: () => t('common.qty'),
        size: 70,
        enableSorting: false,
        meta: { align: 'end', nowrap: true },
        cell: ({ row }) => <span className='money'>{row.original.qty}</span>,
      },
      {
        id: 'total',
        header: () => t('common.total'),
        size: 100,
        enableSorting: false,
        meta: { align: 'end', nowrap: true },
        cell: ({ row }) => (
          <span className='money font-semibold'>
            {money(row.original.line_total)}
          </span>
        ),
      },
    ],
    [t, localName, money]
  );

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size='3xl'
      placement='center'
      backdrop='blur'
      scrollBehavior='inside'
      classNames={{
        base: 'm-2 max-h-[calc(100dvh-1rem)] w-full rounded-3xl bg-surface shadow-[var(--shadow-3)] sm:m-4 sm:max-h-[calc(100dvh-2rem)]',
      }}
    >
      <ModalContent>
        <ModalHeader className='flex flex-col gap-1'>
          <span className='text-xs font-semibold uppercase tracking-wide ink-2'>
            {t('admin.orders.detailTitle')}
          </span>
          <span className='flex flex-wrap items-center gap-2 text-2xl font-bold ink'>
            <span className='money min-w-0 break-words'>
              {o?.reference_no ? `#${o.reference_no}` : (o?.number ?? orderId)}
            </span>
            {o && (
              <span className='flex flex-wrap items-center gap-1.5'>
                <span className={`ui-chip ${statusChip(o.status)}`}>{statusLabel(o.status)}</span>
                <span className='ui-chip ui-chip-outline'>{typeLabel(o.order_type)}</span>
                <PaymentBadge order={o} size='md' />
              </span>
            )}
          </span>
          {o?.reference_no && (
            <span className='text-xs ink-2' dir='ltr'>
              {o.number}
            </span>
          )}
        </ModalHeader>

        <ModalBody className='nice-scroll space-y-3 px-3 sm:px-6'>
          <DataState loading={loading} error={error} onRetry={load}>
            {data && o && (
              <>
                {data.isServerSeed && (
                  <div className='ui-notice'>
                    <AlertTriangle
                      size={16}
                      strokeWidth={1.8}
                      className='mt-0.5 shrink-0 text-[var(--st-amber)]'
                    />
                    <span className='text-sm font-medium ink'>
                      {t('admin.orders.seedOnly')}
                    </span>
                  </div>
                )}

                <div className='grid gap-3 sm:grid-cols-2'>
                  <Section icon={User} title={t('cust.customer')}>
                    <div className='text-sm font-medium ink'>
                      {o.full_name || '—'}
                    </div>
                    <div
                      className='text-xs ink-2'
                      dir='ltr'
                    >
                      {o.mobile || '—'}
                    </div>
                    {o.email && (
                      <div
                        className='text-xs ink-2'
                        dir='ltr'
                      >
                        {o.email}
                      </div>
                    )}
                  </Section>

                  <Section icon={Receipt} title={t('admin.orders.summary')}>
                    <div className='text-sm font-medium ink'>
                      {typeLabel(o.order_type)} · {statusLabel(o.status)}
                    </div>
                    <div className='text-xs ink-2'>
                      {t('admin.orders.placedAt')}: {when(o.opened_at)}
                    </div>
                    {o.table_name && (
                      <div className='text-xs ink-2'>
                        {t('cust.table')}: {o.table_name}
                      </div>
                    )}
                  </Section>

                  <Section icon={MapPin} title={t('cust.address')}>
                    <div className='text-sm font-medium ink'>
                      {geoLine || '—'}
                    </div>
                    {o.address && (
                      <div className='text-xs ink-2'>
                        {o.address}
                      </div>
                    )}
                    {o.landmark && (
                      <div className='text-xs ink-2'>
                        {o.landmark}
                      </div>
                    )}
                  </Section>

                  <Section icon={CreditCard} title={t('cust.paymentMethod')}>
                    <div className='text-sm font-medium ink'>
                      {data.payment?.method_slug || '—'}
                    </div>
                    {data.payment?.link_url && (
                      <Button
                        size='md'
                        variant='bordered'
                        className='border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                        startContent={<QrCode size={16} strokeWidth={1.8} />}
                        onPress={() => onShowQr?.(orderId)}
                      >
                        {t('admin.orders.showQr')}
                      </Button>
                    )}
                    {data.payment?.verified_at && (
                      <div className='text-xs ink-2'>
                        {when(data.payment.verified_at)}
                      </div>
                    )}
                    {o.paid_status === 'paid' && o.paid_time && (
                      <div className='text-xs ink-2'>
                        {t('paid.at', {
                          time: when(Date.parse(o.paid_time) || null),
                        })}
                      </div>
                    )}
                    {o.paid_status === 'paid' && o.paid_reference && (
                      <div className='text-xs ink-2'>
                        {t('paid.referenceShown', { ref: '' })}
                        <span dir='ltr' className='font-semibold ink'>{o.paid_reference}</span>
                      </div>
                    )}
                    {/* Mark paid / Undo paid. Reloads the detail afterwards,
                        so the badge above shows the stored state. */}
                    <MarkPaidControl
                      order={o}
                      onChanged={async () => {
                        await load();
                        await onChanged?.();
                      }}
                    />
                  </Section>
                </div>

                {/* Items */}
                <div className='min-w-0 space-y-2'>
                  <div className='flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ink-2'>
                    {t('opts.variation')}
                    <span className='ui-count'>{lines.length}</span>
                  </div>
                  <div className='ui-card min-w-0 overflow-x-auto'>
                    <DataTable
                      data={lines}
                      columns={columns}
                      empty={t('cart.empty')}
                      getRowId={(r: any, i) => String(r?.id ?? i)}
                    />
                  </div>
                </div>

                {/* Totals */}
                <div className='ui-card space-y-1 p-4 text-sm'>
                  {[
                    [t('cart.subtotal'), o.subtotal],
                    [t('cart.discount'), o.discount_total],
                    [t('cart.deliveryFee'), o.delivery_fee],
                  ].map(([label, val]: any) => (
                    <div
                      key={label}
                      className='flex items-center justify-between gap-3 ink-2'
                    >
                      <span>{label}</span>
                      <span className='money text-end'>{money(val)}</span>
                    </div>
                  ))}
                  <div className='flex items-center justify-between gap-3 border-t border-line pt-2 text-base font-bold ink'>
                    <span>{t('cart.grandTotal')}</span>
                    <span className='money text-end'>
                      {money(o.grand_total)}
                    </span>
                  </div>
                </div>

                {/* Timeline */}
                <Section icon={Clock} title={t('admin.orders.timeline')}>
                  <OrderTimeline events={timeline} />
                </Section>
              </>
            )}
          </DataState>
        </ModalBody>

        <ModalFooter className='px-3 sm:px-6'>
          <Button color='primary' size='lg' fullWidth className='font-semibold' onPress={onClose}>
            {t('common.close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
