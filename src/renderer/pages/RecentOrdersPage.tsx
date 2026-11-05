import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { Printer, QrCode, Eye, MoreHorizontal, CreditCard, CalendarDays, Search, RotateCw } from 'lucide-react';
import {
  DatePicker,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectItem,
} from '@heroui/react';
import { parseDate } from '@internationalized/date';
import { Hint } from '../components/Hint';
import { useOrderStatusFlow } from './OrderStatusCell';
import { useToast } from '../components/ToastProvider'; // adjust path if needed
import { PaymentMethodCell } from './PaymentMethodCell';
import { OrderDetailModal } from './OrderDetailModal';
import { MarkPaidControl } from '../components/MarkPaidControl';
import { paymentStateOf } from '../components/PaymentBadge';
import { SYNCED_EVENT } from '../utils/syncEvents';
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

type Group = 'live' | 'done' | 'cancelled';
const GROUP_RANK: Record<Group, number> = { live: 0, done: 1, cancelled: 2 };

/** Live = still moving; Done = closed / completed; Cancelled = cancelled, rejected, failed, refunded. */
function groupOf(o: Order): Group {
  const code = Number(o.status_code);
  const hasCode = o.status_code != null && Number.isFinite(code);
  const st = String(o.status ?? '').trim().toLowerCase();
  if (
    (hasCode && [5, 6, 8, 9].includes(code)) ||
    st.startsWith('cancel') ||
    st.startsWith('reject')
  )
    return 'cancelled';
  if ((hasCode && code === 4) || ['closed', 'completed', 'done'].includes(st))
    return 'done';
  return 'live';
}

/** Same paid logic as PaymentBadge / MarkPaidControl (a collected counter sale counts as paid). */
function isPaidOrder(o: Order): boolean {
  return ['paid', 'paid_hand', 'paid_queued', 'collected'].includes(
    paymentStateOf(o as any)
  );
}

/** A choice kept for the session (survives leaving and reopening the screen). */
function useSessionChoice<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[]
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = sessionStorage.getItem(key) as T | null;
      if (v && allowed.includes(v)) return v;
    } catch {
      /* storage unavailable: fall back to the default */
    }
    return initial;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        sessionStorage.setItem(key, v);
      } catch {
        /* ignore */
      }
    },
    [key]
  );
  return [value, set] as const;
}

type CardProps = {
  o: Order;
  layout: 'row' | 'card';
  canChangeStatus: boolean;
  canViewDetail: boolean;
  timeText: string;
  onChanged: () => void;
  onOpenDetail: (id: string) => void;
  onPrint: (id?: string) => void;
  onShowQr: (id: string) => void;
  onPaymentLink: (
    o: Order,
    link: { url: string; mobile: string | null; delivery?: any }
  ) => void;
};

/**
 * One order card. The footer carries a single next-step button (the order's
 * own status flow) and a print button; everything else — the other status
 * choices, change payment method, payment QR, details — is in the "more" menu.
 */
function TodayOrderCard({
  o,
  layout,
  canChangeStatus,
  canViewDetail,
  timeText,
  onChanged,
  onOpenDetail,
  onPrint,
  onShowQr,
  onPaymentLink,
}: CardProps) {
  const { t, money } = useI18n();
  const typeLabel = useOrderTypeLabel();
  const [payOpen, setPayOpen] = useState(false);
  const id = o.id ? String(o.id) : null;
  const label = o.reference_no || o.number;
  const flow = useOrderStatusFlow({
    orderId: String(o.id),
    status: o.status,
    statusCode: o.status_code,
    onChanged,
  });
  const settled =
    ['closed', 'completed', 'cancelled'].includes(
      String(o.status ?? '').toLowerCase()
    ) || [4, 5, 6, 8, 9].includes(Number(o.status_code));
  const canOpen = canViewDetail && !!id;

  const next = canChangeStatus ? flow.next : null;
  const stepItems = canChangeStatus ? flow.others : [];
  const canPay = !!id && !settled;
  const canQr = canViewDetail && !!id && !!(o as any).payment_link_url;

  const items: ReactElement[] = [];
  for (const f of stepItems) {
    const cancel = f.value === 'cancelled_client';
    items.push(
      <DropdownItem
        key={`st:${f.value}`}
        color={cancel ? 'danger' : 'default'}
        className={cancel ? 'text-danger' : ''}
        onPress={() => void flow.change(f.value)}
      >
        {t(f.key)}
      </DropdownItem>
    );
  }
  if (canPay) {
    items.push(
      <DropdownItem
        key='pay'
        startContent={<CreditCard size={16} strokeWidth={1.8} />}
        onPress={() => setPayOpen(true)}
      >
        {t('admin.orders.changePayment')}
      </DropdownItem>
    );
  }
  if (canQr) {
    items.push(
      <DropdownItem
        key='qr'
        startContent={<QrCode size={16} strokeWidth={1.8} />}
        onPress={() => onShowQr(id!)}
      >
        {t('admin.orders.showQr')}
      </DropdownItem>
    );
  }
  if (canOpen) {
    items.push(
      <DropdownItem
        key='view'
        startContent={<Eye size={16} strokeWidth={1.8} />}
        onPress={() => onOpenDetail(id!)}
      >
        {t('admin.orders.viewDetail')}
      </DropdownItem>
    );
  }

  const nextBtn = next ? (
    <button
      type='button'
      className='ui-btn ui-btn-outline ui-btn-sm whitespace-nowrap'
      disabled={flow.busy}
      onClick={() => void flow.change(next.value)}
    >
      {/* An action, like the portal and the kitchen screen ("Start
          preparing", "Mark ready", "Complete order"); other targets keep
          their status name. */}
      {next.value === 'prepared'
        ? t('kitchen.start')
        : next.value === 'ready'
        ? t('kitchen.markReady')
        : next.value === 'closed'
        ? t('kitchen.complete')
        : t(next.key)}
    </button>
  ) : null;

  const rowBtnCls = 'ui-icon-btn';
  const tools = (
    <>
      {items.length > 0 && (
        <Dropdown classNames={{ content: 'ui-popup min-w-[12rem]' }} placement='bottom-end'>
          <DropdownTrigger>
            <button type='button' className={rowBtnCls} aria-label={t('admin.orders.view.more')}>
              <MoreHorizontal size={16} strokeWidth={1.8} />
            </button>
          </DropdownTrigger>
          <DropdownMenu aria-label={t('admin.orders.view.more')}>{items}</DropdownMenu>
        </Dropdown>
      )}
      {canViewDetail && (
        <Hint content={t('admin.orders.printReceipt')} placement='top'>
          <button
            type='button'
            className={rowBtnCls}
            onClick={() => onPrint(o.id)}
            aria-label={t('admin.orders.printReceipt')}
          >
            <Printer size={16} strokeWidth={1.8} />
          </button>
        </Hint>
      )}
      {canPay && (
        <Modal
          isOpen={payOpen}
          onOpenChange={setPayOpen}
          placement='center'
          backdrop='opaque'
          classNames={{
            wrapper: 'p-2 sm:p-4',
            base: 'ui-popup !rounded-[24px] m-0 w-full max-w-sm',
            backdrop: 'bg-black/50',
          }}
        >
          <ModalContent>
            <ModalHeader className='text-lg font-semibold ink'>
              {t('admin.orders.changePayment')}
            </ModalHeader>
            <ModalBody className='pb-5'>
              <PaymentMethodCell
                wide
                orderId={id!}
                slug={(o as any).payment_method_slug}
                mobile={o.mobile}
                amount={Number(o.grand_total ?? 0)}
                orderNumber={label}
                onChanged={() => {
                  setPayOpen(false);
                  onChanged();
                }}
                onPaymentLink={(link) => onPaymentLink(o, link)}
              />
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </>
  );

  const open = canOpen ? () => onOpenDetail(id!) : undefined;
  // Controls inside a tappable row must not also open the order.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const payment = <MarkPaidControl order={o as any} onChanged={onChanged} trigger='badge' />;
  const customer = [o.full_name, o.mobile].filter(Boolean).join(' · ') || '—';
  const table = (o as any).table_name as string | undefined;
  const typeText = `${typeLabel(o.order_type)}${table ? ` · ${table}` : ''}`;

  // PC / tablet: one row of a table — everything about an order on one line.
  if (layout === 'row') {
    return (
      <tr
        className={`border-t border-line ${open ? 'cursor-pointer hover:bg-[var(--hover)]' : ''}`}
        onClick={open}
      >
        <td className='py-1.5 ps-4 pe-2 font-semibold whitespace-nowrap'>
          <span className='money'>{shortOrderLabel(o as any)}</span>
        </td>
        <td className='px-2 text-sm ink-2 whitespace-nowrap'>{typeText}</td>
        <td className='px-2 text-sm ink-2 whitespace-nowrap'>
          <span className='money'>{timeText}</span>
        </td>
        <td className='px-2 text-sm'>
          <div className='max-w-[18rem] truncate'>{customer}</div>
        </td>
        <td className='px-2 text-end font-semibold whitespace-nowrap'>
          <span className='money'>{money(o.grand_total as number)}</span>
        </td>
        <td className='px-2 whitespace-nowrap' onClick={stop}>
          {payment}
        </td>
        <td className='px-2 whitespace-nowrap'>
          <StatusBadge order={o} />
        </td>
        <td className='py-1.5 ps-2 pe-3' onClick={stop}>
          <div className='flex items-center justify-end gap-1'>
            {nextBtn}
            {tools}
          </div>
        </td>
      </tr>
    );
  }

  // Phone: a compact card — number, time and total; who; then status + actions.
  return (
    <div
      className={`ui-card p-3 ${open ? 'cursor-pointer' : ''}`}
      onClick={open}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
    >
      <div className='flex items-baseline gap-2'>
        <span className='font-semibold money'>{shortOrderLabel(o as any)}</span>
        <span className='min-w-0 truncate text-xs ink-2'>
          {typeText} · <span className='money'>{timeText}</span>
        </span>
        <span className='ms-auto font-semibold money'>{money(o.grand_total as number)}</span>
      </div>
      <div className='mt-0.5 truncate text-sm ink-2'>{customer}</div>
      <div className='mt-2 flex items-center gap-1.5' onClick={stop}>
        {payment}
        <StatusBadge order={o} />
        <div className='ms-auto flex items-center gap-1'>
          {nextBtn}
          {tools}
        </div>
      </div>
    </div>
  );
}

/** True while the window is at least `px` wide. */
function useMinWidth(px: number): boolean {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return ok;
}

export default function TodayOrdersReport() {
  const theme = useRootTheme();
  const { t, lang } = useI18n();
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

  // view filters, on the rows already loaded; kept for the session
  const [group, setGroup] = useSessionChoice<'all' | Group>(
    'orders.view.group',
    'all',
    ['all', 'live', 'done', 'cancelled']
  );
  const [paidView, setPaidView] = useSessionChoice<'all' | 'paid' | 'unpaid'>(
    'orders.view.paid',
    'all',
    ['all', 'paid', 'unpaid']
  );
  const [datesOpen, setDatesOpen] = useState(false);

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

  // Search + order type, then the two view filters. Each seg's counts apply
  // the other seg's choice, so the numbers match what a tap would show.
  const base = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (rows || [])
      .filter((r) => {
        if (type !== 'all' && String(r.order_type ?? '') !== type) return false;
        if (!qq) return true;
        const hay = `${r.reference_no ?? ''}|${r.number}|${r.status ?? ''}|${typeLabel(
          r.order_type
        )}|${r.full_name ?? ''}|${r.mobile ?? ''}`.toLowerCase();
        return hay.includes(qq);
      })
      .map((o) => ({ o, g: groupOf(o), paid: isPaidOrder(o) }));
  }, [rows, q, type, typeLabel]);

  const matchPaid = (paid: boolean) =>
    paidView === 'all' || (paidView === 'paid' ? paid : !paid);
  const matchGroup = (g: Group) => group === 'all' || group === g;

  const groupCounts = useMemo(() => {
    const c = { all: 0, live: 0, done: 0, cancelled: 0 };
    for (const x of base) {
      if (!matchPaid(x.paid)) continue;
      c.all++;
      c[x.g]++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, paidView]);
  const paidCounts = useMemo(() => {
    const c = { all: 0, paid: 0, unpaid: 0 };
    for (const x of base) {
      if (!matchGroup(x.g)) continue;
      c.all++;
      c[x.paid ? 'paid' : 'unpaid']++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, group]);

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

  // Live orders first, then done, then cancelled; newest first inside each.
  const sorted = useMemo(
    () =>
      base
        .filter((x) => matchGroup(x.g) && matchPaid(x.paid))
        .sort(
          (a, b) =>
            GROUP_RANK[a.g] - GROUP_RANK[b.g] ||
            bestUpdatedMs(b.o) - bestUpdatedMs(a.o)
        )
        .map((x) => x.o),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, group, paidView]
  );
  const [pageIndex, setPageIndex] = useState(0);
  const resetKey = `${q}|${type}|${fromDate}|${toDate}|${pageSize}|${group}|${paidView}`;
  useEffect(() => setPageIndex(0), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const renderCard = (o: Order) => (
    <TodayOrderCard
      key={o.id ? String(o.id) : o.number}
      o={o}
      layout={wide ? 'row' : 'card'}
      canChangeStatus={canChangeStatus}
      canViewDetail={canViewDetail}
      timeText={timeText(o)}
      onChanged={() => refreshRef.current()}
      onOpenDetail={setDetailId}
      onPrint={handlePrint}
      onShowQr={showPaymentQr}
      onPaymentLink={(order, { url, mobile, delivery }) => {
        toast({
          tone: 'success',
          title: t('admin.orders.payLinkSent'),
          message: t('admin.orders.payLinkDelivery', {
            sms: delivery?.sms?.sent ? t('common.yes') : t('common.no'),
            whatsapp: delivery?.whatsapp?.sent ? t('common.yes') : t('common.no'),
          }),
        });
        setQrOrder({
          url,
          mobile,
          amount: Number(order.grand_total ?? 0),
          label: order.reference_no || order.number,
          orderId: String(order.id),
        });
      }}
    />
  );

  // "04 Nov – 06 Nov" for the compact date button.
  const dayText = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return '—';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(
      lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB',
      { day: '2-digit', month: 'short' }
    );
  };
  const rangeText =
    fromDate && toDate && fromDate === toDate
      ? dayText(fromDate)
      : `${dayText(fromDate)} – ${dayText(toDate)}`;
  const viewFiltered = group !== 'all' || paidView !== 'all';
  // From 768px a table (one line per order); phones get compact cards.
  const wide = useMinWidth(768);

  const segBtn = (pressed: boolean, text: string, n: number, onClick: () => void, key: string) => (
    <button key={key} type='button' className='ui-seg-item gap-1.5' aria-pressed={pressed} onClick={onClick}>
      {text}
      {/* A plain number, not a black pill: quieter, same information. */}
      <span className={`money text-xs ${pressed ? 'ink-2' : 'ink-3'}`}>{n}</span>
    </button>
  );

  return (
    <div className='mx-auto w-full max-w-[110rem] p-3 sm:p-4'>
      {/* Title, then ONE toolbar row (wraps on narrow screens): search, type,
          dates, refresh, then the two view filters. The list is the page. */}
      <div className='mb-3 flex items-start gap-3'>
        <div className='min-w-0 flex-1'>
          <h1 className='text-xl font-semibold'>{t('admin.orders.title')}</h1>
          <div className='text-sm ink-2'>{t('admin.orders.subtitle')}</div>
        </div>
        <HelpButton />
      </div>

      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <Input
          value={q}
          onValueChange={setQ}
          placeholder={t('admin.orders.searchPlaceholder')}
          aria-label={t('admin.orders.searchPlaceholder')}
          isClearable
          onClear={() => setQ('')}
          startContent={<Search size={16} strokeWidth={1.8} className='ink-2' />}
          classNames={{
            base: 'min-w-0 basis-full sm:basis-auto sm:w-72',
            inputWrapper: 'ui-input pointer-coarse:min-h-11',
          }}
        />

        <Select
          aria-label={t('admin.orders.orderTypeFilter')}
          selectedKeys={[type]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const next = Array.from(keys)[0];
            if (next != null) setType(String(next) as any);
          }}
          className='w-32 min-w-0'
          classNames={selectClasses}
          size='sm'
        >
          <SelectItem key='all'>{t('admin.orders.allTypes')}</SelectItem>
          <SelectItem key='1'>{typeLabel(1)}</SelectItem>
          <SelectItem key='2'>{typeLabel(2)}</SelectItem>
          <SelectItem key='3'>{typeLabel(3)}</SelectItem>
        </Select>

        <Popover
          isOpen={datesOpen}
          onOpenChange={setDatesOpen}
          placement='bottom'
          classNames={{ content: 'ui-popup p-3' }}
        >
          <PopoverTrigger>
            <button
              type='button'
              className='ui-btn ui-btn-outline ui-btn-sm min-w-0 shrink'
              aria-label={t('admin.orders.view.dates')}
            >
              <CalendarDays size={16} strokeWidth={1.8} />
              <span className='money min-w-0 truncate'>{rangeText}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent>
            <div className='flex w-[min(19rem,calc(100vw-2rem))] flex-col gap-3'>
              <DatePicker
                label={t('admin.orders.fromDate')}
                labelPlacement='outside'
                aria-label={t('admin.orders.fromDate')}
                value={toCalendar(fromDate)}
                onChange={(v) => setFromDate(v ? v.toString() : '')}
                classNames={dateClasses}
              />
              <DatePicker
                label={t('admin.orders.toDate')}
                labelPlacement='outside'
                aria-label={t('admin.orders.toDate')}
                value={toCalendar(toDate)}
                minValue={toCalendar(fromDate) ?? undefined}
                onChange={(v) => setToDate(v ? v.toString() : '')}
                classNames={dateClasses}
              />
              <button
                type='button'
                className='ui-btn ui-btn-primary'
                disabled={loading}
                onClick={() => {
                  setDatesOpen(false);
                  void refresh();
                }}
              >
                {t('admin.orders.filter')}
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Search and the filters apply as you type; this only re-reads the
            till's database (a sync already does that on its own). */}
        <Hint content={t('admin.refresh')} placement='bottom'>
          <button
            type='button'
            className='ui-icon-btn'
            onClick={() => refresh()}
            disabled={loading}
            aria-label={t('admin.refresh')}
          >
            <RotateCw size={16} strokeWidth={1.8} className={loading ? 'animate-spin' : ''} />
          </button>
        </Hint>

        <span className='mx-1 hidden h-5 w-px bg-[var(--line-strong)] lg:block' aria-hidden />

        <div className='min-w-0 max-w-full overflow-x-auto chip-scroll'>
          <div className='ui-seg' role='group' aria-label={t('admin.orders.view.statusGroup')}>
            {(
              [
                ['all', t('common.all')],
                ['live', t('admin.orders.view.live')],
                ['done', t('admin.orders.view.done')],
                ['cancelled', t('status.cancelled')],
              ] as const
            ).map(([k, text]) => segBtn(group === k, text, groupCounts[k], () => setGroup(k), k))}
          </div>
        </div>
        <div className='min-w-0 max-w-full overflow-x-auto chip-scroll'>
          <div className='ui-seg' role='group' aria-label={t('admin.orders.view.paymentGroup')}>
            {(
              [
                ['all', t('common.all')],
                ['paid', t('pay.paid')],
                ['unpaid', t('pay.unpaid')],
              ] as const
            ).map(([k, text]) => segBtn(paidView === k, text, paidCounts[k], () => setPaidView(k), k))}
          </div>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className='py-12 text-center text-base ink-2'>{t('common.loading')}</div>
      ) : sorted.length === 0 ? (
        <div className='rounded-[20px] border border-dashed border-line-strong py-12 text-center text-base ink-2'>
          {q || type !== 'all' || viewFiltered
            ? t('admin.orders.noneFiltered')
            : t('admin.orders.noneToday')}
        </div>
      ) : (
        <>
          {wide ? (
            <div className='ui-card overflow-x-auto p-0'>
              <table className='w-full border-collapse text-start'>
                <thead>
                  <tr className='text-xs uppercase tracking-wide ink-2'>
                    <th className='py-2 ps-4 pe-2 text-start font-semibold'>{t('admin.rep.colOrderNo')}</th>
                    <th className='px-2 text-start font-semibold'>{t('admin.type')}</th>
                    <th className='px-2 text-start font-semibold'>{t('admin.orders.view.colTime')}</th>
                    <th className='px-2 text-start font-semibold'>{t('admin.orders.view.colCustomer')}</th>
                    <th className='px-2 text-end font-semibold'>{t('admin.orders.view.colTotal')}</th>
                    <th className='px-2 text-start font-semibold'>{t('admin.orders.view.paymentGroup')}</th>
                    <th className='px-2 text-start font-semibold'>{t('admin.status')}</th>
                    {/* Spare width goes here, so the order's facts stay together. */}
                    <th className='w-full pe-3 ps-2'>
                      <span className='sr-only'>{t('admin.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>{pageRows.map(renderCard)}</tbody>
              </table>
            </div>
          ) : (
            <div className='flex flex-col gap-2'>{pageRows.map(renderCard)}</div>
          )}
          <div className='mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2'>
            <div className='flex items-center gap-3'>
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
            <div className='flex items-center gap-2'>
              <span className='text-sm font-semibold ink-2'>{t('admin.rows')}</span>
              <Select
                aria-label={t('admin.orders.view.rows')}
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
