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
  Chip,
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

import { errorLine as errLine } from '../utils/posError';
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

/** Payment state as a token-coloured chip — correct in both themes. */
function PaymentChip({ status }: { status?: string | null }) {
  const { t } = useI18n();
  const s = String(status ?? '').toLowerCase();
  if (!s) return null;

  const tone =
    s === 'paid'
      ? 'success'
      : s === 'pending'
        ? 'warning'
        : s === 'failed'
          ? 'danger'
          : 'default';

  const label =
    s === 'paid'
      ? t('pay.paid')
      : s === 'pending'
        ? t('pay.awaiting')
        : s === 'failed'
          ? t('pay.failed')
          : String(status);

  return (
    <Chip size='sm' variant='flat' color={tone} className='font-semibold'>
      {label}
    </Chip>
  );
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
    <div className='rounded-xl border border-default-200 bg-default-50 p-3.5 space-y-2'>
      <div className='flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-default-700'>
        <Icon size={14} />
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

  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const d = await window.api.invoke('orders:getDetail', orderId);
      if (seq !== reqRef.current) return;
      if (!d) {
        setData(null);
        setError(t('admin.orders.detailMissing'));
      } else {
        setData(d);
      }
    } catch (e) {
      if (seq !== reqRef.current) return;
      setData(null);
      setError(errLine(e));
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [orderId, t]);

  useEffect(() => {
    load();
    return () => {
      // Invalidate anything still in flight for the order we are leaving.
      reqRef.current++;
    };
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
              <span className='font-semibold text-foreground'>
                {localName(l)}
              </span>
              {l.variation && (
                <span className='ms-1 text-xs font-medium text-default-700'>
                  [{l.variation}]
                </span>
              )}
              {l.addons_name && (
                <div className='text-xs font-medium text-default-700'>
                  + {l.addons_name}
                </div>
              )}
              {l.notes && (
                <div className='text-xs font-medium italic text-default-700'>
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
      className='rounded-2xl'
    >
      <ModalContent>
        <ModalHeader className='flex flex-col gap-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-default-700'>
            {t('admin.orders.detailTitle')}
          </span>
          <span className='flex items-center gap-2 text-lg font-bold text-foreground'>
            {o?.reference_no ? `#${o.reference_no}` : (o?.number ?? orderId)}
            {o && <PaymentChip status={o.payment_link_status} />}
          </span>
          {o?.reference_no && (
            <span className='text-xs font-medium text-default-700' dir='ltr'>
              {o.number}
            </span>
          )}
        </ModalHeader>

        <ModalBody className='nice-scroll space-y-3'>
          <DataState loading={loading} error={error} onRetry={load}>
            {data && o && (
              <>
                {data.isServerSeed && (
                  <div className='flex items-start gap-2 rounded-lg border border-warning bg-content1 px-3 py-2'>
                    <AlertTriangle
                      size={16}
                      className='shrink-0 mt-0.5 text-warning'
                    />
                    <span className='text-sm font-medium text-foreground'>
                      {t('admin.orders.seedOnly')}
                    </span>
                  </div>
                )}

                <div className='grid gap-3 sm:grid-cols-2'>
                  <Section icon={User} title={t('cust.customer')}>
                    <div className='text-sm font-medium text-foreground'>
                      {o.full_name || '—'}
                    </div>
                    <div
                      className='text-xs font-medium text-default-700'
                      dir='ltr'
                    >
                      {o.mobile || '—'}
                    </div>
                    {o.email && (
                      <div
                        className='text-xs font-medium text-default-700'
                        dir='ltr'
                      >
                        {o.email}
                      </div>
                    )}
                  </Section>

                  <Section icon={Receipt} title={t('admin.orders.summary')}>
                    <div className='text-sm font-medium text-foreground'>
                      {typeLabel(o.order_type)} · {statusLabel(o.status)}
                    </div>
                    <div className='text-xs font-medium text-default-700'>
                      {t('admin.orders.placedAt')}: {when(o.opened_at)}
                    </div>
                    {o.table_name && (
                      <div className='text-xs font-medium text-default-700'>
                        {t('cust.table')}: {o.table_name}
                      </div>
                    )}
                  </Section>

                  <Section icon={MapPin} title={t('cust.address')}>
                    <div className='text-sm font-medium text-foreground'>
                      {geoLine || '—'}
                    </div>
                    {o.address && (
                      <div className='text-xs font-medium text-default-700'>
                        {o.address}
                      </div>
                    )}
                    {o.landmark && (
                      <div className='text-xs font-medium text-default-700'>
                        {o.landmark}
                      </div>
                    )}
                  </Section>

                  <Section icon={CreditCard} title={t('cust.paymentMethod')}>
                    <div className='text-sm font-medium text-foreground'>
                      {data.payment?.method_slug || '—'}
                    </div>
                    {data.payment?.link_url && (
                      <Button
                        size='sm'
                        variant='flat'
                        color='primary'
                        startContent={<QrCode size={15} />}
                        onPress={() => onShowQr?.(orderId)}
                      >
                        {t('admin.orders.showQr')}
                      </Button>
                    )}
                    {data.payment?.verified_at && (
                      <div className='text-xs font-medium text-default-700'>
                        {when(data.payment.verified_at)}
                      </div>
                    )}
                  </Section>
                </div>

                {/* Items */}
                <DataTable
                  data={lines}
                  columns={columns}
                  empty={t('cart.empty')}
                  getRowId={(r: any, i) => String(r?.id ?? i)}
                />

                {/* Totals */}
                <div className='rounded-xl border border-default-200 bg-default-50 p-3.5 space-y-1 text-sm'>
                  {[
                    [t('cart.subtotal'), o.subtotal],
                    [t('cart.discount'), o.discount_total],
                    [t('cart.deliveryFee'), o.delivery_fee],
                  ].map(([label, val]: any) => (
                    <div
                      key={label}
                      className='flex items-center justify-between gap-3 font-medium text-default-700'
                    >
                      <span>{label}</span>
                      <span className='money text-end'>{money(val)}</span>
                    </div>
                  ))}
                  <div className='flex items-center justify-between gap-3 border-t border-default-200 pt-1 text-base font-bold text-foreground'>
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

        <ModalFooter>
          <Button color='primary' onPress={onClose}>
            {t('common.close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
