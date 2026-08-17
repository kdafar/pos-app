import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, Chip, Input, Tab, Tabs } from '@heroui/react';
import { Clock, DollarSign, Moon, Printer, XCircle } from 'lucide-react';

import { useStore } from '../../src/store';
import { useI18n, useOrderTypeLabel } from '../../i18n';
import type { StringKey } from '../../i18n';
import { DataTable } from '../../components/DataTable';
import { DataState, PageShell, StatCard } from '../../components/PageShell';

type BackendOrderRow = {
  id: string;
  order_number: string;
  full_name: string;
  ts_ms: number;
  payment_method_id?: string;
  order_type: number;
  status: number | string;
  operational_status: 'inside' | 'outside';
  discount_amount?: number;
  discount_total?: number;
  delivery_fee?: number;
  grand_total: number;
};

type AggregateRow = { item: string; sold: number; total: number };
type PaymentRow = { id: string; name: string; total: number };
type OrderTypeRow = {
  order_type: number;
  label: string;
  count: number;
  total: number;
};

type FooterStats = {
  total_order: number;
  inside_hours_count: number;
  outside_hours_count: number;
  canceled_order_count: number;
  gross_sales_total: number;
  grand_total: number;
  discounts: number;
  delivery_fees: number;
  outside_hours_total: number;
  cancelled_total: number;
  date?: string;
};

type ReportData = {
  orders: BackendOrderRow[];
  aggregates?: AggregateRow[];
  payments: PaymentRow[];
  orderTypes: OrderTypeRow[];
  categories: AggregateRow[];
  footer: FooterStats;
  fromMs: number;
  toMs: number;
};

/** The closing report's own status vocabulary (not the server enum). */
const STATUS_KEY: Record<string, StringKey> = {
  '1': 'status.pending',
  '2': 'admin.rep.statusAccepted',
  '3': 'admin.srv.2', // Preparing — backend wording, kept verbatim
  '4': 'status.ready',
  '5': 'status.completed',
  '9': 'status.cancelled',
  '99': 'status.cancelled',
};

const CANCELLED_IDS: (number | string)[] = [9, 99, 'cancelled', 'canceled'];

const isCancelled = (o: BackendOrderRow) =>
  CANCELLED_IDS.includes(o.status) ||
  String(o.status).toLowerCase() === 'cancelled';

function toLocalInput(ms: number) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ClosingReport() {
  const { t, money, lang } = useI18n();
  const orderTypeLabel = useOrderTypeLabel();

  const fmt = (n: number | undefined | null) => money(n);
  const fmtDateTime = (ms: number) =>
    new Date(ms).toLocaleString(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB');

  const user = useStore((s: any) => s.currentUser);
  const fetchWhoAmI = useStore((s: any) => s.actions.fetchWhoAmI);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('orders');
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [data, setData] = useState<ReportData | null>(null);

  const ALLOWED_ROLES = [
    'admin',
    'manager',
    'owner',
    'superadmin',
    'super admin',
  ];
  const canEditRange =
    !!user &&
    ALLOWED_ROLES.includes(String(user?.role || '').toLowerCase().trim());

  const loadReport = useCallback(
    async (opts?: { from?: number; to?: number }) => {
      setLoading(true);
      setError(null);
      try {
        const resp = (await window.api.invoke(
          'report:sales:preview',
          opts
        )) as ReportData;
        if (resp) {
          setData(resp);
          setFromStr((prev) => prev || (resp.fromMs ? toLocalInput(resp.fromMs) : ''));
          setToStr((prev) => prev || (resp.toMs ? toLocalInput(resp.toMs) : ''));
        }
      } catch (e) {
        // A closing report that fails silently and shows zeroes is worse than
        // one that shows nothing: the totals get written down as the day's take.
        setError(e instanceof Error ? e.message : String(e ?? ''));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!user) fetchWhoAmI();
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    if (!canEditRange) return loadReport();
    const range = await window.api.invoke('report:operationalWindow', {
      fromDate: fromStr,
      toDate: toStr,
    });
    loadReport({ from: Number(range.fromMs), to: Number(range.toMs) });
  };

  /* ---------------- columns ---------------- */

  const orderCols = useMemo<ColumnDef<BackendOrderRow, any>[]>(
    () => [
      {
        accessorKey: 'order_number',
        header: () => t('admin.rep.colOrderNo'),
        size: 150,
        meta: { nowrap: true },
        cell: (info) => (
          <span className='font-mono font-semibold' dir='ltr'>
            {String(info.getValue() ?? '')}
          </span>
        ),
      },
      {
        accessorKey: 'full_name',
        header: () => t('admin.rep.colClient'),
        size: 180,
        cell: (info) => String(info.getValue() ?? '') || '—',
      },
      {
        accessorKey: 'ts_ms',
        header: () => t('admin.rep.colDate'),
        size: 165,
        meta: { nowrap: true },
        cell: (info) => (
          <span className='money'>{fmtDateTime(info.getValue() as number)}</span>
        ),
      },
      {
        accessorKey: 'order_type',
        header: () => t('admin.type'),
        size: 120,
        meta: { nowrap: true },
        cell: (info) =>
          Number(info.getValue()) === 4
            ? t('admin.rep.orderTypeDriveThru')
            : orderTypeLabel(info.getValue() as number),
      },
      {
        accessorKey: 'status',
        header: () => t('admin.status'),
        size: 130,
        meta: { nowrap: true },
        cell: ({ row }) => {
          const s = String(row.original.status);
          const label = STATUS_KEY[s] ? t(STATUS_KEY[s]) : s;
          // Cancelled orders were a red row wash. That coloured the whole line
          // including its money, which reads as "these numbers are wrong"
          // rather than "this order was cancelled".
          return (
            <Chip
              size='sm'
              variant='flat'
              color={isCancelled(row.original) ? 'danger' : 'default'}
              className='font-semibold'
            >
              {label}
            </Chip>
          );
        },
      },
      {
        accessorKey: 'operational_status',
        header: () => t('admin.rep.colOpStatus'),
        size: 120,
        meta: { nowrap: true },
        cell: (info) => {
          const inside = info.getValue() === 'inside';
          return (
            <Chip
              size='sm'
              variant='flat'
              color={inside ? 'success' : 'warning'}
              className='font-semibold'
            >
              {inside ? t('admin.rep.inside') : t('admin.rep.outside')}
            </Chip>
          );
        },
      },
      {
        id: 'discount',
        header: () => t('admin.rep.colDiscount'),
        size: 120,
        meta: { align: 'end', nowrap: true },
        accessorFn: (row) => row.discount_total ?? row.discount_amount ?? 0,
        cell: (info) => (
          <span className='money'>{fmt(info.getValue() as number)}</span>
        ),
      },
      {
        accessorKey: 'grand_total',
        header: () => t('common.total'),
        size: 130,
        meta: { align: 'end', nowrap: true },
        cell: (info) => (
          <span className='money font-bold'>
            {fmt(info.getValue() as number)}
          </span>
        ),
      },
    ],
    [t, orderTypeLabel, lang] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Item / category / payment / order-type all share this shape. */
  const aggregateCols = useCallback(
    (colName: string, localizeOrderType = false): ColumnDef<any, any>[] => [
      {
        id: 'label',
        header: () => colName,
        size: 260,
        accessorFn: (row) =>
          localizeOrderType && row.order_type != null
            ? String(row.order_type)
            : row.item || row.name || row.label || '',
        cell: ({ row }) => (
          <span className='font-semibold'>
            {localizeOrderType && row.original.order_type != null
              ? Number(row.original.order_type) === 4
                ? t('admin.rep.orderTypeDriveThru')
                : orderTypeLabel(row.original.order_type)
              : (lang === 'ar' && row.original.name_ar) ||
                row.original.item ||
                row.original.name ||
                row.original.label ||
                t('admin.rep.unknown')}
          </span>
        ),
      },
      {
        id: 'sold',
        header: () => t('admin.rep.colCountSold'),
        size: 130,
        meta: { align: 'end', nowrap: true },
        accessorFn: (row) => Number(row.sold ?? row.count ?? 0),
        cell: (info) => (
          <span className='money'>{String(info.getValue() ?? 0)}</span>
        ),
      },
      {
        accessorKey: 'total',
        header: () => t('admin.rep.colTotalAmount'),
        size: 150,
        meta: { align: 'end', nowrap: true },
        cell: (info) => (
          <span className='money font-bold'>
            {fmt(info.getValue() as number)}
          </span>
        ),
      },
    ],
    [t, orderTypeLabel, lang] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const TABS: {
    key: string;
    title: string;
    rows: any[];
    colName: string;
    orderTypes?: boolean;
  }[] = [
    {
      key: 'items',
      title: t('admin.rep.tabItem'),
      rows: data?.aggregates || [],
      colName: t('admin.rep.colItem'),
    },
    {
      key: 'categories',
      title: t('admin.rep.tabCategory'),
      rows: data?.categories || [],
      colName: t('admin.rep.colCategory'),
    },
    {
      key: 'payments',
      title: t('admin.rep.tabPayment'),
      rows: data?.payments || [],
      colName: t('admin.rep.colPaymentMethod'),
    },
    {
      key: 'orderTypes',
      title: t('admin.rep.tabOrderType'),
      rows: data?.orderTypes || [],
      colName: t('admin.rep.colOrderType'),
      orderTypes: true,
    },
  ];

  const f = data?.footer;

  /** One row of the settlement summary. */
  const Total = ({
    label,
    value,
    tone,
    strong,
    negative,
  }: {
    label: string;
    value: number | undefined;
    tone?: 'danger' | 'primary';
    strong?: boolean;
    negative?: boolean;
  }) => (
    <div
      className={`flex items-center justify-between gap-4 px-4 py-2.5 ${
        strong ? 'bg-default-100 font-bold text-base' : 'font-medium'
      }`}
    >
      <span className={strong ? 'text-foreground' : 'text-default-700'}>
        {label}
      </span>
      <span
        className={`money whitespace-nowrap ${
          tone === 'danger' ? 'text-danger' : 'text-foreground'
        } ${strong ? 'text-lg' : ''}`}
      >
        {negative ? '- ' : ''}
        {fmt(value)}
      </span>
    </div>
  );

  return (
    <PageShell
      title={t('admin.rep.title')}
      subtitle={f?.date || undefined}
      onRefresh={handleRefresh}
      refreshing={loading}
      primaryAction={
        <Button
          variant='flat'
          startContent={<Printer size={16} />}
          onPress={() => window.print()}
          className='no-print'
        >
          {t('admin.rep.print')}
        </Button>
      }
      filters={
        canEditRange ? (
          <div className='flex flex-wrap items-end gap-2 no-print'>
            <Input
              type='date'
              label={t('admin.rep.startDate')}
              labelPlacement='outside'
              value={fromStr}
              onValueChange={setFromStr}
              className='w-56'
            />
            <Input
              type='date'
              label={t('admin.rep.endDate')}
              labelPlacement='outside'
              value={toStr}
              onValueChange={setToStr}
              className='w-56'
            />
            <Button color='primary' onPress={handleRefresh} isLoading={loading}>
              {t('admin.refresh')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <DataState loading={loading} error={error} onRetry={() => loadReport()}>
        <div className='space-y-5'>
          {/* Headline figures */}
          <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4'>
            <StatCard
              label={t('admin.rep.cardInside')}
              value={f?.inside_hours_count || 0}
              icon={Clock}
              tone='primary'
            />
            <StatCard
              label={t('admin.rep.cardOutside')}
              value={f?.outside_hours_count || 0}
              icon={Moon}
            />
            <StatCard
              label={t('admin.rep.cardCancelled')}
              value={f?.canceled_order_count || 0}
              icon={XCircle}
              tone='danger'
            />
            <StatCard
              label={t('admin.rep.cardEarning')}
              value={fmt(f?.grand_total)}
              icon={DollarSign}
              tone='success'
            />
          </div>

          {/* Orders and breakdowns */}
          <Tabs
            aria-label={t('admin.rep.title')}
            selectedKey={activeTab}
            onSelectionChange={(k) => setActiveTab(String(k))}
            className='no-print'
          >
            <Tab key='orders' title={t('admin.rep.tabDaily')}>
              <DataState
                empty={!data?.orders?.length}
                emptyTitle={t('admin.rep.noOrders')}
              >
                <DataTable
                  data={data?.orders || []}
                  columns={orderCols}
                  initialSorting={[{ id: 'ts_ms', desc: true }]}
                  getRowId={(r, i) => String(r.id ?? i)}
                />
              </DataState>
            </Tab>

            {TABS.map((tab) => (
              <Tab key={tab.key} title={tab.title}>
                <DataState
                  empty={tab.rows.length === 0}
                  emptyTitle={t('admin.rep.noRows')}
                >
                  <DataTable
                    data={tab.rows}
                    columns={aggregateCols(tab.colName, tab.orderTypes)}
                    initialSorting={[{ id: 'total', desc: true }]}
                    getRowId={(_r, i) => String(i)}
                  />
                </DataState>
              </Tab>
            ))}
          </Tabs>

          {/* Settlement — always visible, and the reason the page exists */}
          {f && (
            <div className='rounded-lg border border-default-200 bg-content1 overflow-hidden divide-y divide-default-200 max-w-xl ms-auto'>
              <Total label={t('admin.rep.grossSales')} value={f.gross_sales_total} />
              <Total
                label={t('admin.rep.discounts')}
                value={f.discounts}
                tone='danger'
                negative
              />
              <Total
                label={t('admin.rep.deliveryFees')}
                value={f.delivery_fees}
              />
              <Total
                label={t('admin.rep.netTotal')}
                value={f.grand_total}
                strong
              />
              <Total
                label={t('admin.rep.outsideTotal')}
                value={f.outside_hours_total}
              />
              <Total
                label={t('admin.rep.cancelledTotal')}
                value={f.cancelled_total}
                tone='danger'
                negative
              />
            </div>
          )}
        </div>
      </DataState>
    </PageShell>
  );
}
