import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Printer, QrCode, Eye } from 'lucide-react';
import { Chip } from '@heroui/react';
import { PaymentBadge } from '../components/PaymentBadge';
import { OrderStatusCell } from './OrderStatusCell';
import { useToast } from '../components/ToastProvider'; // adjust path if needed
import { PaymentMethodCell } from './PaymentMethodCell';
import { OrderDetailModal } from './OrderDetailModal';
import { DataTable } from '../components/DataTable';
import { PaymentLinkModal } from './pos/components/PaymentLinkModal';
import { useRootTheme } from './pos/useRootTheme';
import { useI18n, useOrderTypeLabel, useStatusLabel } from '../i18n';
import type { StringKey } from '../i18n';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

type Order = {
  id?: string;
  number: string;
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

// 👇 same flexible user type as Layout (covers is_admin, role, type)
type PosUser = {
  id: string | number;
  name?: string;
  role?: string;
  type?: string;
  is_admin?: boolean | number;
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
 * Status tone per server status code.
 *
 * These were hardcoded dark-theme classes — text-primary and friends on a
 * /15 tint. Pale-300 ink is built to sit on a dark surface; on the light theme
 * it renders near-white on near-white, which is how "Open" and "Picked up"
 * became unreadable the moment light became the default.
 *
 * HeroUI colours instead: one name per meaning, and the library picks the
 * right ink and tint for whichever theme is active.
 */
type Tone = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

const SERVER_STATUS_TONE: Record<number, Tone> = {
  0: 'default', // pending
  1: 'primary', // accepted
  2: 'warning', // preparing
  3: 'warning', // out for delivery / ready
  4: 'success', // delivered / picked up
  5: 'danger', // cancelled
  6: 'danger', // rejected
  7: 'warning', // on hold
  8: 'danger', // failed
  9: 'danger', // refunded
};

const LOCAL_STATUS_TONE: Record<string, Tone> = {
  open: 'primary',
  prepared: 'warning',
  completed: 'success',
  closed: 'default',
  cancelled: 'danger',
};

const StatusBadge = ({ order }: { order: Order }) => {
  const statusLabel = useStatusLabel();
  const serverLabel = useServerStatusLabel();

  const code = Number(order.status_code);
  const hasCode = Number.isFinite(code) && order.status_code != null;
  const k = String(order.status ?? '').toLowerCase();

  const tone: Tone = hasCode
    ? SERVER_STATUS_TONE[code] ?? 'default'
    : LOCAL_STATUS_TONE[k] ?? 'default';

  const label = hasCode
    ? serverLabel(code, order.order_type)
    : order.status
    ? statusLabel(order.status)
    : null;

  return (
    <Chip size='sm' color={tone} variant='flat' className='font-semibold'>
      {label || '—'}
    </Chip>
  );
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

function getTodayRangeMs() {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
  return { start_ms: start, end_ms: end };
}

export default function TodayOrdersReport() {
  const theme = useRootTheme();
  const { t, money, lang } = useI18n();
  const typeLabel = useOrderTypeLabel();
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  // filters
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | '1' | '2' | '3'>('all');

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
        console.error('orders:paymentLink:get failed', e);
        const raw = e instanceof Error ? e.message : String(e ?? '');
        toast({
          tone: 'danger',
          title: t('admin.orders.noPayLink'),
          message:
            raw
              .replace(/^Error invoking remote method '[^']*':\s*/i, '')
              .replace(/^(Error|TypeError):\s*/i, '')
              .trim() || t('admin.supportHint'),
        });
      }
    },
    [t, toast]
  );

  // ---- tiny UI helpers so all fields/buttons look identical (dark & light) ----
  const fieldCls =
    'h-10 px-3 rounded-lg bg-default-100 border border-default-200 ' +
    'text-sm outline-none focus:ring-2 focus:ring-sky-500/40 placeholder:opacity-60';
  const btnCls =
    'h-10 px-3 rounded-lg border border-default-200 text-sm hover:bg-default-200 transition ' +
    'disabled:opacity-50 disabled:cursor-not-allowed';

  // small button style for row actions
  const rowBtnCls =
    'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-default-200 ' +
    'text-xs hover:bg-default-200 disabled:opacity-50 disabled:cursor-not-allowed';

  /* ---------------- Auth: who am I? (mirror Layout logic) ---------------- */
  const [user, setUser] = useState<PosUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await window.api.invoke('auth:whoami');
        setUser(u || null);
      } catch {
        // dev/unpaired: same behavior as Layout – default to admin
        setUser(null);
      }
    })();
  }, []);

  const isAdmin = useMemo(() => {
    // same as Layout: if unknown → treat as admin (safe for dev)
    if (!user) return true;
    if (user.is_admin === true || user.is_admin === 1) return true;

    const role = String(user.role ?? user.type ?? '').toLowerCase();
    if (role === 'admin' || role === 'manager' || role === 'owner') return true;

    return false;
  }, [user]);

  const refresh = async () => {
    setLoading(true);
    try {
      const { start_ms, end_ms } = getTodayRangeMs();

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
      setRows(list || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (type !== 'all' && String(r.order_type ?? '') !== type) return false;
      if (!qq) return true;
      const hay = `${r.number}|${r.status ?? ''}|${typeLabel(r.order_type)}|${
        r.full_name ?? ''
      }|${r.mobile ?? ''}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [rows, q, type, typeLabel]);

  const handlePrint = useCallback(
    async (orderId?: string) => {
      try {
        if (!isAdmin) {
          toast({
            tone: 'danger',
            title: t('admin.orders.printAdminOnly'),
            message: t('admin.supportHint'),
          });
          return;
        }

        if (!orderId) {
          toast({
            tone: 'danger',
            title: t('admin.orders.printNoId'),
            message: t('admin.supportHint'),
          });
          return;
        }
        await window.api.invoke('orders:print', orderId);
      } catch (e) {
        console.error('orders:print failed', e);
        // Show what actually went wrong (no printer, lookup-only order, …)
        // rather than a generic failure the cashier cannot act on.
        const raw = e instanceof Error ? e.message : String(e ?? '');
        const detail = raw
          .replace(/^Error invoking remote method '[^']*':\s*/i, '')
          .replace(/^(Error|TypeError):\s*/i, '')
          .trim();
        toast({
          tone: 'danger',
          title: t('admin.orders.printFailed'),
          message: detail || t('admin.supportHint'),
        });
      }
    },
    [isAdmin, t]
  );

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        accessorKey: 'number',
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
            disabled={!isAdmin}
            onChanged={refresh}
          />
        ),
      },
      {
        id: 'paid',
        header: () => t('admin.orders.paid'),
        size: 105,
        enableSorting: false,
        meta: { nowrap: true, className: 'hidden xl:table-cell' },
        // The till creates payment links and then never surfaced the outcome,
        // so a cashier handing over food had no way to tell whether the
        // customer had actually paid.
        cell: ({ row }) => <PaymentBadge order={row.original as any} />,
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
            <div className='text-xs font-medium text-default-700'>
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
        meta: { nowrap: true, className: 'hidden 2xl:table-cell' },
      },
      {
        id: 'actions',
        header: () => t('admin.actions'),
        enableSorting: false,
        // Wide enough for three buttons. Under `table-fixed` an undersized
        // column does not clip — it overflows and overlaps its neighbour.
        size: 110,
        cell: ({ row }) =>
          isAdmin ? (
            <div className='flex items-center gap-1.5 overflow-hidden'>
              {row.original.id && (
                <button
                  className={rowBtnCls}
                  onClick={() => setDetailId(String(row.original.id))}
                  title={t('admin.orders.viewDetail')}
                >
                  <Eye size={14} />
                </button>
              )}
              <button
                className={rowBtnCls}
                onClick={() => handlePrint(row.original.id)}
                title={t('admin.orders.printReceipt')}
              >
                <Printer size={14} />
              </button>
              {(row.original as any).payment_link_url && row.original.id && (
                <button
                  className={rowBtnCls}
                  onClick={() => showPaymentQr(String(row.original.id))}
                  title={t('admin.orders.showQr')}
                >
                  <QrCode size={14} />
                </button>
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
          isAdmin && row.original.id ? (
            <PaymentMethodCell
              orderId={String(row.original.id)}
              slug={(row.original as any).payment_method_slug}
              onChanged={refresh}
            />
          ) : (
            <span className='text-default-700'>
              {(row.original as any).payment_method_slug || '—'}
            </span>
          ),
      },
    ],
    [handlePrint, showPaymentQr, isAdmin, t, money, lang, typeLabel, theme]
  ); // keep in sync with admin state



  return (
    <div className='mx-auto w-full max-w-[110rem] p-3 sm:p-4'>
      {/* Header + Toolbar */}
      <div className='mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>{t('admin.orders.title')}</h1>
          <div className='text-sm font-medium text-default-700'>
            {t('admin.orders.subtitle')}
          </div>
        </div>

        {/* Toolbar */}
        <div className='w-full md:w-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(260px,420px)_140px_110px_110px] gap-2'>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('admin.orders.searchPlaceholder')}
            className={fieldCls + ' w-full'}
          />

          <select
            className={fieldCls + ' w-full'}
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            title={t('admin.orders.orderTypeFilter')}
          >
            <option value='all'>{t('admin.orders.allTypes')}</option>
            <option value='1'>{typeLabel(1)}</option>
            <option value='2'>{typeLabel(2)}</option>
            <option value='3'>{typeLabel(3)}</option>
          </select>

          <button
            className={btnCls + ' w-full'}
            onClick={refresh}
            disabled={loading}
            title={t('admin.refresh')}
          >
            {loading ? t('admin.refreshing') : t('admin.refresh')}
          </button>

          <div className='flex items-center gap-2 w-full'>
            <label className='text-sm font-medium text-default-700'>{t('admin.rows')}</label>
            <select
              className={fieldCls + ' w-full'}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={loading}
        initialSorting={[{ id: 'updated_at', desc: true }]}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        getRowId={(r, i) => String((r as any).id ?? i)}
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
