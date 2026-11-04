import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
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
import { OrderCard } from '../components/OrderCard';
import { PaymentLinkModal } from './pos/components/PaymentLinkModal';
import { useRootTheme } from './pos/useRootTheme';
import { usePermissions } from '../hooks/usePermissions';
import { useI18n, useOrderTypeLabel, useStatusLabel } from '../i18n';
import type { StringKey } from '../i18n';
import { HelpButton } from '../help/HelpButton';
import { shortOrderLabel } from '../utils/orderLabel';

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
  const rowBtnCls = 'ui-icon-btn ui-icon-btn-outline';
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

  const timeText = (row: Order) => {
    const ms = bestUpdatedMs(row);
    // Latin numerals in both languages, as the table showed.
    return ms
      ? new Date(ms).toLocaleTimeString(
          lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB',
          { hour: '2-digit', minute: '2-digit' }
        )
      : '—';
  };

  // Same default order the table had: last update first.
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => bestUpdatedMs(b) - bestUpdatedMs(a)),
    [filtered]
  );
  const [pageIndex, setPageIndex] = useState(0);
  const resetKey = `${q}|${type}|${fromDate}|${toDate}|${pageSize}`;
  useEffect(() => setPageIndex(0), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const renderCard = (o: Order) => {
    const id = o.id ? String(o.id) : null;
    const label = o.reference_no || o.number;
    const settled =
      ['closed', 'completed', 'cancelled'].includes(
        String(o.status ?? '').toLowerCase()
      ) || [4, 5, 6, 8, 9].includes(Number(o.status_code));
    const canOpen = canViewDetail && !!id;
    return (
      <OrderCard
        key={id ?? o.number}
        header={shortOrderLabel(o as any)}
        type={<span className='ui-chip ui-chip-outline'>{typeLabel(o.order_type)}</span>}
        time={<span className='ui-chip ui-chip-outline money'>{timeText(o)}</span>}
        meta={[o.full_name || '—', o.mobile].filter(Boolean).join(' · ')}
        money={money(o.grand_total as number)}
        payment={
          <MarkPaidControl order={o as any} onChanged={() => refreshRef.current()} trigger='badge' />
        }
        // The Update status control below already shows the status to anyone
        // who may change it; the chip is for everyone else.
        status={canChangeStatus ? undefined : <StatusBadge order={o} />}
        onOpen={canOpen ? () => setDetailId(id!) : undefined}
        footer={
          <>
            <OrderStatusCell
              orderId={String(o.id)}
              status={o.status}
              statusCode={o.status_code}
              disabled={!canChangeStatus}
              onChanged={() => refreshRef.current()}
            />
            {id && !settled ? (
              <PaymentMethodCell
                orderId={id}
                slug={(o as any).payment_method_slug}
                mobile={o.mobile}
                amount={Number(o.grand_total ?? 0)}
                orderNumber={label}
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
                    amount: Number(o.grand_total ?? 0),
                    label,
                    orderId: id,
                  });
                }}
              />
            ) : (
              <span className='text-sm ink-2'>
                {(o as any).payment_method_slug || '—'}
              </span>
            )}
          </>
        }
        actions={
          canViewDetail ? (
            <>
              {id && (
                <Hint content={t('admin.orders.viewDetail')} placement='top'>
                  <button
                    className={rowBtnCls}
                    onClick={() => setDetailId(id)}
                    aria-label={t('admin.orders.viewDetail')}
                  >
                    <Eye size={16} strokeWidth={1.8} />
                  </button>
                </Hint>
              )}
              <Hint content={t('admin.orders.printReceipt')} placement='top'>
                <button
                  className={rowBtnCls}
                  onClick={() => handlePrint(o.id)}
                  aria-label={t('admin.orders.printReceipt')}
                >
                  <Printer size={16} strokeWidth={1.8} />
                </button>
              </Hint>
              {(o as any).payment_link_url && id && (
                <Hint content={t('admin.orders.showQr')} placement='top'>
                  <button
                    className={rowBtnCls}
                    onClick={() => showPaymentQr(id)}
                    aria-label={t('admin.orders.showQr')}
                  >
                    <QrCode size={16} strokeWidth={1.8} />
                  </button>
                </Hint>
              )}
            </>
          ) : null
        }
      />
    );
  };




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
            classNames={{ base: 'basis-full sm:basis-auto min-w-[12rem] flex-1 sm:max-w-sm', inputWrapper: 'ui-input' }}
          />

          <Select
            aria-label={t('admin.orders.orderTypeFilter')}
            selectedKeys={[type]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const next = Array.from(keys)[0];
              if (next != null) setType(String(next) as any);
            }}
            className='flex-1 sm:flex-none sm:w-36 min-w-[8.5rem]'
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
            className='flex-1 sm:flex-none sm:w-44 min-w-[9.5rem]'
            classNames={dateClasses}
          />

          <DatePicker
            aria-label={t('admin.orders.toDate')}
            value={toCalendar(toDate)}
            minValue={toCalendar(fromDate) ?? undefined}
            onChange={(v) => setToDate(v ? v.toString() : '')}
            className='flex-1 sm:flex-none sm:w-44 min-w-[9.5rem]'
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

      {loading && rows.length === 0 ? (
        <div className='py-12 text-center text-base ink-2'>{t('common.loading')}</div>
      ) : sorted.length === 0 ? (
        <div className='rounded-[20px] border border-dashed border-line-strong py-12 text-center text-base ink-2'>
          {q || type !== 'all'
            ? t('admin.orders.noneFiltered')
            : t('admin.orders.noneToday')}
        </div>
      ) : (
        <>
          <div className='grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 sm:gap-4'>
            {pageRows.map(renderCard)}
          </div>
          <div className='mt-4 flex flex-wrap items-center justify-center gap-3'>
            <button
              type='button'
              className='ui-btn ui-btn-outline ui-btn-sm'
              disabled={page <= 0}
              onClick={() => setPageIndex(page - 1)}
            >
              {t('admin.prev')}
            </button>
            <span className='text-sm ink-2'>
              {t('admin.pageOf', { page: page + 1, pages: pageCount })}
            </span>
            <button
              type='button'
              className='ui-btn ui-btn-outline ui-btn-sm'
              disabled={page >= pageCount - 1}
              onClick={() => setPageIndex(page + 1)}
            >
              {t('admin.next')}
            </button>
          </div>
        </>
      )}


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
