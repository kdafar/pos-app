import React, { useEffect, useState } from 'react';
import {
  Printer,
  RefreshCcw,
  Clock,
  Moon,
  XCircle,
  DollarSign,
} from 'lucide-react';

import { useThemeTokens } from '../../hooks/useThemeTokens';
import { useStore } from '../../src/store';

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

type AggregateRow = {
  item: string;
  sold: number;
  total: number;
};

type PaymentRow = {
  id: string;
  name: string;
  total: number;
};

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

const ORDER_TYPES: Record<number, string> = {
  1: 'Delivery',
  2: 'Takeaway',
  3: 'Dine-in',
  4: 'Drive-thru',
};

const STATUS_MAP: Record<any, string> = {
  1: 'Pending',
  2: 'Accepted',
  3: 'Preparing',
  4: 'Ready',
  5: 'Completed',
  9: 'Cancelled',
  99: 'Cancelled',
};

const CANCELLED_IDS = [9, 99, 'cancelled', 'canceled'];

const fmt = (n: number | undefined | null) => (Number(n) || 0).toFixed(3);

function toLocalInput(ms: number) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string) {
  if (!s) return NaN;
  const d = new Date(s);
  return d.getTime();
}

export default function ClosingReport() {
  const { theme } = useThemeTokens();

  // 1. Get User Data
  const user = useStore((s: any) => s.currentUser);
  const fetchWhoAmI = useStore((s: any) => s.actions.fetchWhoAmI);

  // 2. Fetch user if missing
  useEffect(() => {
    if (!user) {
      fetchWhoAmI();
    }
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Strict Permission Logic
  const rawRole = String(user?.role || '')
    .toLowerCase()
    .trim();
  const ALLOWED_ROLES = [
    'admin',
    'manager',
    'owner',
    'superadmin',
    'super admin',
  ];

  const isAdminUser =
    !!user && // Must be logged in
    ALLOWED_ROLES.includes(rawRole); // Must have permission

  // final flag used in component
  const canEditRange = isAdminUser;
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<0 | 1 | 2 | 3 | 5>(0);
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [data, setData] = useState<ReportData | null>(null);

  const isDark =
    theme === 'dark' ||
    theme === 'night' ||
    String(theme || '')
      .toLowerCase()
      .includes('dark');

  const cardBase = isDark
    ? 'bg-slate-800 border-slate-700'
    : 'bg-white border-gray-200';
  const textMain = isDark ? 'text-slate-100' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const pageBg = isDark ? 'bg-slate-950' : 'bg-slate-50';

  const loadReport = async (opts?: { from?: number; to?: number }) => {
    setLoading(true);
    try {
      const resp = (await window.api.invoke(
        'report:sales:preview',
        opts
      )) as ReportData;

      if (resp) {
        setData(resp);
        if (!fromStr && resp.fromMs) setFromStr(toLocalInput(resp.fromMs));
        if (!toStr && resp.toMs) setToStr(toLocalInput(resp.toMs));
      }
    } catch (e) {
      console.error('Report load failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (!canEditRange) {
      loadReport();
      return;
    }

    const f = fromLocalInput(fromStr);
    const t = fromLocalInput(toStr);
    loadReport({
      from: isNaN(f) ? undefined : f,
      to: isNaN(t) ? undefined : t,
    });
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getRowClass = (order: BackendOrderRow) => {
    const s = String(order.status).toLowerCase();
    if (CANCELLED_IDS.includes(order.status) || s === 'cancelled') {
      return isDark ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-900';
    }
    if (order.operational_status === 'outside') {
      return isDark
        ? 'bg-blue-900/30 text-blue-200'
        : 'bg-blue-50 text-blue-900';
    }
    return 'border-b border-gray-100 dark:border-gray-700';
  };

  const renderDailyTable = () => (
    <div className='overflow-x-auto'>
      <table className='w-full text-sm text-left'>
        <thead
          className={`text-xs uppercase ${
            isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <tr>
            <th className='px-4 py-3'>#</th>
            <th className='px-4 py-3'>Client</th>
            <th className='px-4 py-3'>Date</th>
            <th className='px-4 py-3'>Order #</th>
            <th className='px-4 py-3'>Type</th>
            <th className='px-4 py-3'>Status</th>
            <th className='px-4 py-3'>Op. Status</th>
            <th className='px-4 py-3 text-right'>Discount</th>
            <th className='px-4 py-3 text-right'>Total</th>
          </tr>
        </thead>
        <tbody>
          {data?.orders.map((order, idx) => (
            <tr key={order.id} className={getRowClass(order)}>
              <td className='px-4 py-3'>{idx + 1}</td>
              <td className='px-4 py-3 font-medium'>
                {order.full_name || '-'}
              </td>
              <td className='px-4 py-3 whitespace-nowrap'>
                {new Date(order.ts_ms).toLocaleString()}
              </td>
              <td className='px-4 py-3'>{order.order_number}</td>
              <td className='px-4 py-3'>
                {ORDER_TYPES[order.order_type] || order.order_type}
              </td>
              <td className='px-4 py-3'>
                {STATUS_MAP[order.status] || order.status}
              </td>
              <td className='px-4 py-3'>
                {order.operational_status === 'inside' ? (
                  <span className='px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'>
                    Inside
                  </span>
                ) : (
                  <span className='px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'>
                    Outside
                  </span>
                )}
              </td>
              <td className='px-4 py-3 text-right'>
                {fmt(order.discount_total ?? order.discount_amount ?? 0)}
              </td>
              <td className='px-4 py-3 text-right font-bold'>
                {fmt(order.grand_total)}
              </td>
            </tr>
          ))}
          {!data?.orders?.length && (
            <tr>
              <td colSpan={9} className='p-8 text-center opacity-50'>
                No orders found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderAggregateTable = (rows: any[], colName: string) => (
    <div className='overflow-x-auto max-w-4xl mx-auto'>
      <table className='w-full text-sm text-left'>
        <thead
          className={`text-xs uppercase ${
            isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <tr>
            <th className='px-4 py-3'>{colName}</th>
            <th className='px-4 py-3 text-right'>Count / Sold</th>
            <th className='px-4 py-3 text-right'>Total Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              className='border-b border-gray-100 dark:border-gray-700'
            >
              <td className='px-4 py-3 font-medium'>
                {row.item || row.name || row.label || 'Unknown'}
              </td>
              <td className='px-4 py-3 text-right'>
                {row.sold ?? row.count ?? 0}
              </td>
              <td className='px-4 py-3 text-right font-bold'>
                {fmt(row.total)}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={3} className='p-8 text-center opacity-50'>
                No data available
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const dateInputClass = `px-3 py-2 rounded border bg-transparent border-gray-300 dark:border-gray-600 w-48 ${
    !canEditRange ? 'opacity-60 cursor-not-allowed' : ''
  }`;

  return (
    <div className={`p-4 md:p-6 space-y-6 ${textMain} min-h-screen ${pageBg}`}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { -webkit-print-color-adjust: exact; }
        }
      `}</style>

      {/* Header */}
      <header className='no-print flex flex-col md:flex-row justify-between items-start md:items-center gap-4'>
        <div>
          <h1 className='text-2xl font-bold'>Sales Reports</h1>
          <p className={`text-sm ${textMuted}`}>
            {data?.footer.date || 'Loading...'}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2'
          >
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => window.print()}
            className='px-4 py-2 bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-white rounded-lg hover:opacity-80 flex items-center gap-2'
          >
            <Printer size={16} /> Print
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div className={`no-print p-4 rounded-xl border ${cardBase} shadow-sm`}>
        <div className='flex flex-col xl:flex-row gap-4 justify-between'>
          <div className='flex flex-col sm:flex-row gap-3 items-end'>
            <div>
              <label className='text-xs font-semibold mb-1 block'>
                Start Date
              </label>
              <input
                type='datetime-local'
                value={fromStr}
                onChange={(e) => {
                  if (!canEditRange) return;
                  setFromStr(e.target.value);
                }}
                readOnly={!canEditRange}
                className={dateInputClass}
              />
            </div>
            <div>
              <label className='text-xs font-semibold mb-1 block'>
                End Date
              </label>
              <input
                type='datetime-local'
                value={toStr}
                onChange={(e) => {
                  if (!canEditRange) return;
                  setToStr(e.target.value);
                }}
                readOnly={!canEditRange}
                className={dateInputClass}
              />
            </div>
          </div>

          <div className='flex flex-wrap gap-2'>
            <button
              onClick={() => setActiveTab(0)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 0
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 hover:bg-gray-200'
              }`}
            >
              Daily Report
            </button>
            <button
              onClick={() => setActiveTab(1)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 1
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 hover:bg-gray-200'
              }`}
            >
              By Item
            </button>
            <button
              onClick={() => setActiveTab(5)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 5
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 hover:bg-gray-200'
              }`}
            >
              By Category
            </button>
            <button
              onClick={() => setActiveTab(2)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 2
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 hover:bg-gray-200'
              }`}
            >
              By Payment
            </button>
            <button
              onClick={() => setActiveTab(3)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 3
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 hover:bg-gray-200'
              }`}
            >
              By Order Type
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6'>
        <div className='relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 p-6 text-white shadow-lg'>
          <div className='flex justify-between items-start z-10 relative'>
            <div>
              <h3 className='text-sm font-medium opacity-90 mb-1'>
                Orders Inside Hours
              </h3>
              <h2 className='text-3xl font-bold'>
                {data?.footer.inside_hours_count || 0}
              </h2>
            </div>
            <Clock className='opacity-40' size={32} />
          </div>
        </div>

        <div className='relative overflow-hidden rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 p-6 text-white shadow-lg'>
          <div className='flex justify-between items-start z-10 relative'>
            <div>
              <h3 className='text-sm font-medium opacity-90 mb-1'>
                Orders Outside Hours
              </h3>
              <h2 className='text-3xl font-bold'>
                {data?.footer.outside_hours_count || 0}
              </h2>
            </div>
            <Moon className='opacity-40' size={32} />
          </div>
        </div>

        <div className='relative overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 to-red-500 p-6 text-white shadow-lg'>
          <div className='flex justify-between items-start z-10 relative'>
            <div>
              <h3 className='text-sm font-medium opacity-90 mb-1'>
                Cancelled Orders
              </h3>
              <h2 className='text-3xl font-bold'>
                {data?.footer.canceled_order_count || 0}
              </h2>
            </div>
            <XCircle className='opacity-40' size={32} />
          </div>
        </div>

        <div className='relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 p-6 text-white shadow-lg'>
          <div className='flex justify-between items-start z-10 relative'>
            <div>
              <h3 className='text-sm font-medium opacity-90 mb-1'>
                Total Earning
              </h3>
              <h2 className='text-3xl font-bold'>
                {fmt(data?.footer.grand_total)}
              </h2>
            </div>
            <DollarSign className='opacity-40' size={32} />
          </div>
        </div>
      </div>

      {/* Main Content: tab tables */}
      <div
        className={`border rounded-xl shadow-sm overflow-hidden ${cardBase}`}
      >
        {activeTab === 0 && renderDailyTable()}
        {activeTab === 1 &&
          renderAggregateTable(data?.aggregates || [], 'Item')}
        {activeTab === 5 &&
          renderAggregateTable(data?.categories || [], 'Category')}
        {activeTab === 2 &&
          renderAggregateTable(data?.payments || [], 'Payment Method')}
        {activeTab === 3 &&
          renderAggregateTable(data?.orderTypes || [], 'Order Type')}
      </div>

      {/* ALWAYS-VISIBLE FOOTER TOTALS (like online report) */}
      {data?.footer && (
        <div
          className={`border rounded-xl shadow-sm overflow-hidden ${cardBase}`}
        >
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <tbody>
                <tr className={isDark ? 'bg-slate-900/40' : 'bg-gray-50'}>
                  <td className='px-4 py-3 font-semibold text-right'>
                    Gross Sales Total
                  </td>
                  <td className='px-4 py-3 font-semibold text-right'>
                    {fmt(data.footer.gross_sales_total)}
                  </td>
                </tr>
                <tr>
                  <td className='px-4 py-3 font-semibold text-right'>
                    Discounts
                  </td>
                  <td className='px-4 py-3 font-semibold text-right text-red-500'>
                    - {fmt(data.footer.discounts)}
                  </td>
                </tr>
                <tr>
                  <td className='px-4 py-3 font-semibold text-right'>
                    Delivery fees
                  </td>
                  <td className='px-4 py-3 font-semibold text-right'>
                    {fmt(data.footer.delivery_fees)}
                  </td>
                </tr>
                <tr className={isDark ? 'bg-blue-900/30' : 'bg-blue-100'}>
                  <td className='px-4 py-3 font-semibold text-right'>
                    Total (Grand Total of All Sales) (Net Sales)
                  </td>
                  <td className='px-4 py-3 font-semibold text-right'>
                    {fmt(data.footer.grand_total)}
                  </td>
                </tr>

                <tr>
                  <td className='px-4 py-3 text-right italic text-sm'>
                    Outside Hours Sales Total (Informational)
                  </td>
                  <td className='px-4 py-3 text-right font-semibold'>
                    {fmt(data.footer.outside_hours_total)}
                  </td>
                </tr>
                <tr>
                  <td className='px-4 py-3 text-right italic text-sm'>
                    Cancelled Orders Total (From Inside Hours) (Informational)
                  </td>
                  <td className='px-4 py-3 text-right font-semibold text-red-500'>
                    - {fmt(data.footer.cancelled_total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}
