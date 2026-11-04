import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Printer, QrCode, Eye } from 'lucide-react';
import { Button, DatePicker, Input, Select, SelectItem } from '@heroui/react';
import { parseDate } from '@internationalized/date';
import { Hint } from '../components/Hint';
import { OrderStatusCell } from './OrderStatusCell';
import { useToast } from '../components/ToastProvider'; // adjust path if needed
import { PaymentMethodCell } from './PaymentMethodCell';
import { OrderDetailModal } from './OrderDetailModal';
import { MarkPaidControl } from '../components/MarkPaidControl';
import { SYNCED_EVENT } from '../utils/syncEvents';
import { DataTable } from '../components/DataTable';
import { PaymentLinkModal } from './pos/components/PaymentLinkModal';
import { useRootTheme } from './pos/useRootTheme';
import { usePermissions } from '../hooks/usePermissions';
import { useI18n, useOrderTypeLabel, useStatusLabel } from '../i18n';
import type { StringKey } from '../i18n';
import { HelpButton } from '../help/HelpButton';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

type Order = {
  id?: string;
  number: string;
  /** Human-facing order number allocated by the server after push. */
  reference_no?: string | null;
  status: string | null;
  /** Server enum 0–9 (sync.ts). Present on pulled orders; null on local ones. */
  status_code?: number | null;
  order_type: number | null; // 1 delivery, 2 pickup, 3 dine-in
  full_name?: string | null;
  mobile?: string | null;
  grand_total: number | null;
  updated_at?: number | null; // ms
  opened_at?: number | null; // ms
  created_at?: string | null; // ISO
};

/**
 * Server order status (§3.4). Codes 3 and 4 read differently for delivery than
 * for pickup / dine-in, so the order type has to be in hand. Wording is the
 * backend's own — do not paraphrase it here.
 */
function useServerStatusLabel() {
  const { t } = useI18n();
  return (code: unknown, orderType: unknown): string | null => {
    const n = Number(code);
    if (!Number.isFinite(n)) return null;
    const isDelivery = Number(orderType) === 1;
    if (n === 3 || n === 4) {
      return t(
        `admin.srv.${n}.${isDelivery ? 'delivery' : 'other'}` as StringKey
      );
    }
    if (n >= 0 && n <= 9) return t(`admin.srv.${n}` as StringKey);
    return t('admin.srv.unknown', { n });
  };
}

/**
 * Status chip colour per docs/DESIGN-SYSTEM.md: done / closed green, ready /
 * out for delivery blue, cancelled / rejected / failed / refunded red,
 * new / accepted brand, everything else (pending, preparing) gray; waiting for pickup (7) blue.
 * Solid chips with white text, identical in both themes.
 */
const SERVER_STATUS_CHIP: Record<number, string> = {
  0: 'ui-chip-gray', // pending
  1: 'ui-chip-brand', // accepted
  2: 'ui-chip-gray', // preparing
  3: 'ui-chip-blue', // out for delivery / ready
  4: 'ui-chip-green', // delivered / picked up
  5: 'ui-chip-red', // cancelled
  6: 'ui-chip-red', // rejected
  7: 'ui-chip-blue', // waiting for pickup (admin.srv.7)
  8: 'ui-chip-red', // failed
  9: 'ui-chip-red', // refunded
};

const LOCAL_STATUS_CHIP: Record<string, string> = {
  open: 'ui-chip-brand',
  placed: 'ui-chip-brand',
  prepared: 'ui-chip-gray',
  ready: 'ui-chip-blue',
  awaiting_pickup: 'ui-chip-blue',
  completed: 'ui-chip-green',
  closed: 'ui-chip-green',
  cancelled: 'ui-chip-red',
  cancelled_client: 'ui-chip-red',
};

const StatusBadge = ({ order }: { order: Order }) => {
  const statusLabel = useStatusLabel();
  const serverLabel = useServerStatusLabel();

  const code = Number(order.status_code);
  const hasCode = Number.isFinite(code) && order.status_code != null;
  const k = String(order.status ?? '').toLowerCase();

  const chip = hasCode
    ? SERVER_STATUS_CHIP[code] ?? 'ui-chip-gray'
    : LOCAL_STATUS_CHIP[k] ?? 'ui-chip-gray';

  const label = hasCode
    ? serverLabel(code, order.order_type)
    : order.status
    ? statusLabel(order.status)
    : null;

  return <span className={`ui-chip ${chip}`}>{label || '—'}</span>;
};

const bestUpdatedMs = (row: Order) => {
  if (row.updated_at && Number(row.updated_at) > 0)
    return Number(row.updated_at);
  if (row.opened_at && Number(row.opened_at) > 0) return Number(row.opened_at);
  if (row.created_at) {
    const x = Date.parse(row.created_at);
    if (!Number.isNaN(x)) return x;
  }
  return 0;
};

export default function TodayOrdersReport() {
  const theme = useRootTheme();
  const { t, money, lang } = useI18n();
  const typeLabel = useOrderTypeLabel();
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  // filters
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | '1' | '2' | '3'>('all');
  // Empty until the first load: "today" is the server's business day, which is
  // not the calendar date in the small hours (01:30 on 3 Nov is still 2 Nov),
  // so the main process picks it and the pickers are filled from its answer.
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // table state
  const [pageSize, setPageSize] = useState(25);
  const toast = useToast();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [qrOrder, setQrOrder] = useState<{
    url: string;
    amount: number;
    mobile: string | null;
    label: string | null;
    orderId: string;
  } | null>(null);

  // Re-show the payment QR for an order that already has a link, so a customer
  // who did not scan at the counter can be served without re-ringing the sale.
  const showPaymentQr = useCallback(
    async (orderId: string) => {
      try {
        const link = await window.api.invoke('orders:paymentLink:get', orderId);
        if (!link?.url) {
          toast({
            tone: 'warning',
            title: t('admin.orders.noPayLink'),
            message: t('admin.orders.noPayLinkMsg'),
          });
          return;
        }
        setQrOrder({ ...link, orderId });
      } catch (e) {
        // Was silent: a rejected invoke left the button looking dead.
        toast.error(e, { title: t('admin.orders.noPayLink') });
      }
    },
    [t, toast]
  );

  // small icon button for row actions (44px on touch via .ui-icon-btn)
  const rowBtnCls = 'ui-icon-btn ui-icon-btn-outline !h-9 !w-9';
  const selectClasses = {
    trigger: 'ui-input min-h-10 px-3 shadow-none',
    value: 'text-sm ink',
    popoverContent: 'ui-popup',
  };
  const dateClasses = { inputWrapper: 'ui-input' };
  const toCalendar = (v: string) => {
    try {
      return v ? parseDate(v) : null;
    } catch {
      return null;
    }
  };

  /* ---------------- Auth: what may this operator do? ---------------- */
  // Gates ask for the permission the main process asserts. They used to ask
  // whether the role was 'admin' | 'manager' | 'owner', which no grant could
  // ever satisfy — the handler checks permissions and nothing else.
  const { can } = usePermissions();

  const canChangeStatus = can('orders.change_status');
  const canViewDetail = can('orders.view_all') || can('orders.view_own');

  // `quiet`: the re-read after a background sync. No spinner and no error
  // toast every minute; a failure keeps the rows already on screen.
  const refresh = async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!quiet) setLoading(true);
    try {
      const range = await window.api.invoke(
        'report:operationalWindow',
        fromDate || toDate ? { fromDate, toDate } : undefined
      );
      const start_ms = Number(range?.fromMs);
      const end_ms = Number(range?.toMs);
      if (!fromDate && range?.fromDate) setFromDate(String(range.fromDate));
      if (!toDate && range?.toDate) setToDate(String(range.toDate));

      let list: Order[] = [];
      try {
        list = await window.api.invoke('orders:listByDate', {
          start_ms,
          end_ms,
        });
      } catch {
        const all = await window.api.invoke('orders:listAll');
        list = (all || []).filter((o: Order) => {
          const ms = bestUpdatedMs(o);
          return ms >= start_ms && ms <= end_ms;
        });
      }
      const next = list || [];
      if (quiet) {
        // Keep every unchanged row as the same object, and skip the update
        // entirely when nothing changed, so a background refresh does not
        // re-render the table under the cashier — an open status menu or
        // Mark paid dialog stays exactly as it was.
        setRows((prev) => {
          const byId = new Map(prev.map((r) => [String((r as any).id), r]));
          let changed = prev.length !== next.length;
          const merged = next.map((r, i) => {
            const old = byId.get(String((r as any).id));
            if (old && JSON.stringify(old) === JSON.stringify(r)) {
              if (prev[i] !== old) changed = true;
              return old;
            }
            changed = true;
            return r;
          });
          return changed ? merged : prev;
        });
      } else {
        setRows(next);
      }
    } catch (e) {
      if (quiet) return;
      // Was try/finally with no catch: a rejected invoke escaped as an
      // unhandled rejection and left the table empty with nothing on screen,
      // which read as "there are no orders today" rather than as a failure.
      setRows([]);
      toast.error(e, { title: t('admin.loadFailed') });
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Initial load only; date changes are applied with the Filter button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The list is the till's database as it was when the page opened. A sync
  // brings orders placed on the web and payments made online; without this an
  // order paid by the customer kept showing "Unpaid" until the page was left
  // and reopened. Through a ref so the listener runs this render's refresh,
  // with the dates currently in the filter.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const onSynced = () => void refreshRef.current({ quiet: true });
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (type !== 'all' && String(r.order_type ?? '') !== type) return false;
      if (!qq) return true;
      const hay = `${r.reference_no ?? ''}|${r.number}|${r.status ?? ''}|${typeLabel(
        r.order_type
      )}|${r.full_name ?? ''}|${r.mobile ?? ''}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [rows, q, type, typeLabel]);

  const handlePrint = useCallback(
    async (orderId?: string) => {
      try {
        if (!orderId) {
          toast({
            tone: 'warning',
            title: t('admin.orders.printNoId'),
            message: t('admin.supportHint'),
          });
          return;
        }
        await window.api.invoke('orders:print', orderId);
      } catch (e) {
        // Says what actually went wrong (no printer, lookup-only order, …)
        // rather than a generic failure the cashier cannot act on.
        toast.error(e, {
          title: t('admin.orders.printFailed'),
          onRetry: () => void handlePrint(orderId),
        });
      }
    },
    [t]
  );

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        id: 'reference_no',
        accessorFn: (row) => row.reference_no || row.number,
        header: () => t('admin.orders.number'),
        cell: (info) => info.getValue() as string,
        size: 105,
      },
      {
        accessorKey: 'status',
        header: () => t('admin.status'),
        cell: ({ row }) => <StatusBadge order={row.original} />,
        enableSorting: false,
        size: 100,
      },
      {
        id: 'setStatus',
        header: () => t('admin.orders.changeStatus'),
        size: 135,
        enableSorting: false,
        meta: { nowrap: true },
        // Read-only badge above shows where the order is; this moves it on.
        cell: ({ row }) => (
          <OrderStatusCell
            orderId={String((row.original as any).id)}
            status={row.original.status}
            statusCode={row.original.status_code}
            disabled={!canChangeStatus}
            onChanged={() => refreshRef.current()}
          />
        ),
      },
      {
        id: 'paid',
        header: () => t('admin.orders.paid'),
        // Room for "Paid · KNET · Admin".
        size: 170,
        enableSorting: false,
        // Always visible now: it is also where an order is marked paid.
        meta: { nowrap: true },
        // The till creates payment links and then never surfaced the outcome,
        // so a cashier handing over food had no way to tell whether the
        // customer had actually paid. Pressing an unpaid badge marks it paid.
        cell: ({ row }) => (
          <MarkPaidControl order={row.original as any} onChanged={() => refreshRef.current()} trigger='badge' />
        ),
      },
      {
        accessorKey: 'order_type',
        header: () => t('admin.type'),
        cell: ({ row }) => typeLabel(row.original.order_type),
        sortingFn: 'alphanumeric',
        size: 85,
      },
      {
        id: 'customer',
        header: () => t('admin.orders.customer'),
        cell: ({ row }) => (
          <div className='leading-tight'>
            <div className='font-medium'>{row.original.full_name || '—'}</div>
            <div className='text-xs ink-2'>
              {row.original.mobile || ''}
            </div>
          </div>
        ),
        enableSorting: false,
        size: 170,
      },
      {
        accessorKey: 'grand_total',
        header: () => t('common.total'),
        cell: (info) => (
          <span className='font-semibold money'>
            {money(info.getValue() as number)}
          </span>
        ),
        sortingFn: 'alphanumeric',
        size: 85,
      },
      {
        id: 'updated_at',
        header: () => t('admin.orders.updated'),
        accessorFn: (row) => bestUpdatedMs(row),
        cell: ({ row }) => {
          const ms = bestUpdatedMs(row.original);
          // Latin numerals in both languages — Kuwaiti receipts never use
          // Arabic-Indic digits, so the report must match.
          return ms ? (
            <span className='money'>
              {new Date(ms).toLocaleString(
                lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB'
              )}
            </span>
          ) : (
            '—'
          );
        },
        sortingFn: 'basic',
        size: 145,
        meta: { nowrap: true, className: 'hidden' },
      },
      {
        id: 'actions',
        header: () => t('admin.actions'),
        enableSorting: false,
        // Wide enough for three buttons. Under `table-fixed` an undersized
        // column does not clip — it overflows and overlaps its neighbour.
        size: 110,
        cell: ({ row }) =>
          canViewDetail ? (
            <div className='flex items-center gap-1.5'>
              {row.original.id && (
                <Hint content={t('admin.orders.viewDetail')} placement='top'>
                  <button
                    className={rowBtnCls}
                    onClick={() => setDetailId(String(row.original.id))}
                    aria-label={t('admin.orders.viewDetail')}
                  >
                    <Eye size={16} strokeWidth={1.8} />
                  </button>
                </Hint>
              )}
              <Hint content={t('admin.orders.printReceipt')} placement='top'>
                <button
                  className={rowBtnCls}
                  onClick={() => handlePrint(row.original.id)}
                  aria-label={t('admin.orders.printReceipt')}
                >
                  <Printer size={16} strokeWidth={1.8} />
                </button>
              </Hint>
              {(row.original as any).payment_link_url && row.original.id && (
                <Hint content={t('admin.orders.showQr')} placement='top'>
                  <button
                    className={rowBtnCls}
                    onClick={() => showPaymentQr(String(row.original.id))}
                    aria-label={t('admin.orders.showQr')}
                  >
                    <QrCode size={16} strokeWidth={1.8} />
                  </button>
                </Hint>
              )}
            </div>
          ) : null,
      },
      {
        id: 'payment',
        header: () => t('cust.paymentMethod'),
        enableSorting: false,
        size: 105,
        cell: ({ row }) =>
          row.original.id &&
          !['closed', 'completed', 'cancelled'].includes(
            String(row.original.status ?? '').toLowerCase()
          ) &&
          ![4, 5, 6, 8, 9].includes(Number(row.original.status_code)) ? (
            <PaymentMethodCell
              orderId={String(row.original.id)}
              slug={(row.original as any).payment_method_slug}
              mobile={row.original.mobile}
              amount={Number(row.original.grand_total ?? 0)}
              orderNumber={row.original.reference_no || row.original.number}
              onChanged={() => refreshRef.current()}
              onPaymentLink={({ url, mobile, delivery }) => {
                toast({
                  tone: 'success',
                  title: t('admin.orders.payLinkSent'),
                  message: t('admin.orders.payLinkDelivery', {
                    sms: delivery?.sms?.sent ? t('common.yes') : t('common.no'),
                    whatsapp: delivery?.whatsapp?.sent
                      ? t('common.yes')
                      : t('common.no'),
                  }),
                });
                setQrOrder({
                  url,
                  mobile,
                  amount: Number(row.original.grand_total ?? 0),
                  label: row.original.reference_no || row.original.number,
                  orderId: String(row.original.id),
                });
              }}
            />
          ) : (
            <span className='ink-2'>
              {(row.original as any).payment_method_slug || '—'}
            </span>
          ),
      },
      {
        id: 'order_time',
        header: () => t('admin.orders.time'),
        accessorFn: (row) => bestUpdatedMs(row),
        cell: ({ row }) => {
          const ms = bestUpdatedMs(row.original);
          return ms ? (
            <span className='money'>
              {new Date(ms).toLocaleTimeString(
                lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB',
                { hour: '2-digit', minute: '2-digit' }
              )}
            </span>
          ) : (
            '—'
          );
        },
        sortingFn: 'basic',
        size: 75,
        meta: { nowrap: true },
      },
    ],
    [
      handlePrint,
      showPaymentQr,
      canViewDetail,
      canChangeStatus,
      t,
      money,
      lang,
      typeLabel,
      theme,
    ]
  ); // keep in sync with admin state



  return (
    <div className='mx-auto w-full max-w-[110rem] p-3 sm:p-4'>
      {/* Header + Toolbar, with the guide's "?" in the top-end corner like
          every other screen. */}
      <div className='mb-4 flex items-start gap-3'>
      <div className='flex min-w-0 flex-1 flex-col gap-3'>
        <div>
          <h1 className='text-xl font-semibold'>{t('admin.orders.title')}</h1>
          <div className='text-sm ink-2'>
            {t('admin.orders.subtitle')}
          </div>
        </div>

        {/* Toolbar: wraps on narrow screens, controls have minimum widths. */}
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            value={q}
            onValueChange={setQ}
            placeholder={t('admin.orders.searchPlaceholder')}
            aria-label={t('admin.orders.searchPlaceholder')}
            classNames={{ base: 'min-w-[12rem] flex-1 sm:max-w-sm', inputWrapper: 'ui-input' }}
          />

          <Select
            aria-label={t('admin.orders.orderTypeFilter')}
            selectedKeys={[type]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const next = Array.from(keys)[0];
              if (next != null) setType(String(next) as any);
            }}
            className='w-36 min-w-[8.5rem]'
            classNames={selectClasses}
          >
            <SelectItem key='all'>{t('admin.orders.allTypes')}</SelectItem>
            <SelectItem key='1'>{typeLabel(1)}</SelectItem>
            <SelectItem key='2'>{typeLabel(2)}</SelectItem>
            <SelectItem key='3'>{typeLabel(3)}</SelectItem>
          </Select>

          <DatePicker
            aria-label={t('admin.orders.fromDate')}
            value={toCalendar(fromDate)}
            onChange={(v) => setFromDate(v ? v.toString() : '')}
            className='w-44 min-w-[10.5rem]'
            classNames={dateClasses}
          />

          <DatePicker
            aria-label={t('admin.orders.toDate')}
            value={toCalendar(toDate)}
            minValue={toCalendar(fromDate) ?? undefined}
            onChange={(v) => setToDate(v ? v.toString() : '')}
            className='w-44 min-w-[10.5rem]'
            classNames={dateClasses}
          />

          <Button
            color='primary'
            size='lg'
            className='font-semibold'
            onPress={() => refresh()}
            isDisabled={loading}
            aria-label={t('admin.refresh')}
          >
            {loading ? t('admin.refreshing') : t('admin.orders.filter')}
          </Button>

          <div className='flex items-center gap-2'>
            <span className='text-sm font-semibold ink-2'>{t('admin.rows')}</span>
            <Select
              aria-label={t('admin.rows')}
              selectedKeys={[String(pageSize)]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0];
                if (next != null) setPageSize(Number(next));
              }}
              className='w-24 min-w-[5.5rem]'
              classNames={selectClasses}
            >
              {[10, 25, 50, 100].map((n) => (
                <SelectItem key={String(n)}>{String(n)}</SelectItem>
              ))}
            </Select>
          </div>
        </div>
      </div>
      <HelpButton />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={loading}
        initialSorting={[{ id: 'updated_at', desc: true }]}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        getRowId={(r, i) => String((r as any).id ?? i)}
        resetPageKey={`${q}|${type}|${fromDate}|${toDate}`}
        empty={
          q || type !== 'all'
            ? t('admin.orders.noneFiltered')
            : t('admin.orders.noneToday')
        }
      />


      {detailId && (
        <OrderDetailModal
          orderId={detailId}
          theme={theme}
          onShowQr={(id) => {
            setDetailId(null);
            showPaymentQr(id);
          }}
          onClose={() => setDetailId(null)}
          onChanged={refresh}
        />
      )}

      {qrOrder && (
        <PaymentLinkModal
          theme={theme}
          url={qrOrder.url}
          amount={qrOrder.amount}
          mobile={qrOrder.mobile}
          orderLabel={qrOrder.label}
          onCheckStatus={async () => {
            const r = await window.api.invoke(
              'payments:checkStatus',
              qrOrder.orderId
            );
            await refresh();
            return (r?.status ?? null) as 'pending' | 'paid' | 'failed' | null;
          }}
          onClose={() => setQrOrder(null)}
        />
      )}
    </div>
  );
}
