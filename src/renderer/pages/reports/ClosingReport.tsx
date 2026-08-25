import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, Chip, Input, Tab, Tabs } from '@heroui/react';
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Moon,
  Printer,
  XCircle,
} from 'lucide-react';

import { useStore } from '../../src/store';
import { useI18n, useOrderTypeLabel } from '../../i18n';
import type { StringKey } from '../../i18n';
import { DataTable } from '../../components/DataTable';
import { DataState, PageShell, StatCard } from '../../components/PageShell';

import { errorLine as errLine } from '../../utils/posError';
type BackendOrderRow = {
  id: string;
  order_number: string;
  full_name: string;
  ts_ms: number;
  payment_method_id?: string;
  payment_method_slug?: string;
  reference_no?: string;
  order_type: number;
  status: number | string;
  operational_status: 'inside' | 'outside';
  /** Which bucket the footer put this row in. */
  counted?: 'sale' | 'cancelled' | 'uncounted';
  /** Only on `uncounted` rows — the two have different fixes. */
  uncounted_reason?: 'no_total' | 'not_placed';
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
  /** Rows in the table below that are neither a sale nor a cancellation. */
  uncounted_order_count?: number;
  /** Rows in the table below, so the cards can be reconciled against it. */
  listed_order_count?: number;
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

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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

  // Was a hardcoded admin-tier role list. Choosing which day a closing
  // report covers is a reporting action, so it asks for the reporting
  // permission — which also makes it configurable per role instead of
  // needing a code change to let a bookkeeper look at last Tuesday.
  const canEditRange = !!user?.permissions?.includes('reports.export');

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
        setError(errLine(e));
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

  const applyPreset = async (preset: 'today' | 'yesterday' | 'last7' | 'month') => {
    const end = new Date();
    const start = new Date(end);
    if (preset === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (preset === 'last7') start.setDate(start.getDate() - 6);
    else if (preset === 'month') start.setDate(1);
    const from = toLocalInput(start.getTime());
    const to = toLocalInput(end.getTime());
    setFromStr(from);
    setToStr(to);
    const range = await window.api.invoke('report:operationalWindow', { fromDate: from, toDate: to });
    await loadReport({ from: Number(range.fromMs), to: Number(range.toMs) });
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
          const skipped = row.original.counted === 'uncounted';
          return (
            <div className='flex flex-col items-start gap-1'>
              <Chip
                size='sm'
                variant='flat'
                color={isCancelled(row.original) ? 'danger' : 'default'}
                className='font-semibold'
              >
                {label}
              </Chip>
              {/* Says why this row is highlighted, right where the reader is
                  already looking. A highlight with no reason just moves the
                  question from "which ones" to "why those". */}
              {skipped && (
                <span className='text-[13px] font-semibold text-warning'>
                  {t(
                    row.original.uncounted_reason === 'no_total'
                      ? 'admin.rep.notCountedNoTotal'
                      : 'admin.rep.notCountedOpen'
                  )}
                </span>
              )}
            </div>
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

  const exportExcel = async () => {
    if (!data || !f) return;
    let title = t('admin.rep.tabDaily');
    let headers: string[];
    let rows: unknown[][];
    let widths: number[];
    const sync = (await window.api.invoke('sync:status').catch(() => null)) as { branch_name?: string } | null;
    const branchName = sync?.branch_name || 'All Branches';
    if (activeTab === 'orders') {
      headers = ['#', t('admin.rep.colClient'), t('admin.rep.colDate'), 'Reference', 'Branch', 'Sales Channel', 'Payment Type', t('admin.type'), t('admin.status'), t('admin.rep.colOpStatus'), t('admin.rep.colDiscount'), 'Delivery charge', t('common.total')];
      widths = [6, 22, 20, 16, 22, 15, 16, 14, 15, 16, 13, 13, 14];
      rows = data.orders.map((o, index) => [
        index + 1, o.full_name, fmtDateTime(o.ts_ms), o.reference_no || o.order_number,
        branchName, 'POS', o.payment_method_slug || o.payment_method_id || '',
        Number(o.order_type) === 4 ? t('admin.rep.orderTypeDriveThru') : orderTypeLabel(o.order_type),
        STATUS_KEY[String(o.status)] ? t(STATUS_KEY[String(o.status)]) : String(o.status),
        o.operational_status === 'inside' ? t('admin.rep.inside') : t('admin.rep.outside'),
        Number(o.discount_total ?? o.discount_amount ?? 0), Number(o.delivery_fee ?? 0), Number(o.grand_total ?? 0),
      ]);
    } else {
      const tab = TABS.find((item) => item.key === activeTab) ?? TABS[0];
      title = tab.title;
      headers = [tab.colName, t('admin.rep.colCountSold'), t('admin.rep.colTotalAmount')];
      widths = [32, 16, 18];
      rows = tab.rows.map((item) => [
        tab.orderTypes && item.order_type != null ? orderTypeLabel(item.order_type) : item.item || item.name || item.label || t('admin.rep.unknown'),
        Number(item.sold ?? item.count ?? 0), Number(item.total ?? 0),
      ]);
    }
    const metadata = [
      ['Branch', branchName], ['Date range', `${fromStr} - ${toStr}`],
      ['Generated at', fmtDateTime(Date.now())], ['Generated by', user?.name || user?.role || 'POS User'],
    ];
    const totals: unknown[][] = activeTab === 'orders' ? [
      [t('admin.rep.grossSales'), f.gross_sales_total], [t('admin.rep.discounts'), -f.discounts],
      [t('admin.rep.deliveryFees'), f.delivery_fees], [t('admin.rep.netTotal'), f.grand_total],
    ] : [];
    const rawBrand = getComputedStyle(document.documentElement).getPropertyValue('--heroui-primary-500').trim();
    let brand = '2563EB';
    const hsl = rawBrand.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    if (hsl) {
      const h = Number(hsl[1]) / 360, s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100;
      const hue = (p: number, q: number, value: number) => { let v = value; if (v < 0) v += 1; if (v > 1) v -= 1; if (v < 1 / 6) return p + (q - p) * 6 * v; if (v < 1 / 2) return q; if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6; return p; };
      const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const rgb = s === 0 ? [l, l, l] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
      brand = rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    const stamp = fromStr.replace(/-/g, '') + (toStr !== fromStr ? `_to_${toStr.replace(/-/g, '')}` : '');
    await window.api.invoke('reports:saveExcel', {
      filename: `${title.replace(/[^a-z0-9]+/gi, '_')}_${stamp}.xlsx`, title,
      metadata, headers, rows, totals, widths, brand, rtl: lang === 'ar',
    });
  };

  const openPrintPreview = async () => {
    if (!data || !f) return;
    const sync = (await window.api.invoke('sync:status').catch(() => null)) as
      | { branch_name?: string }
      | null;
    const branchName = sync?.branch_name || 'All Branches';
    const generatedBy = user?.name || user?.role || 'POS User';
    const configuredPrimary = getComputedStyle(document.documentElement)
      .getPropertyValue('--heroui-primary-500')
      .trim();
    const brandColor = /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(configuredPrimary)
      ? `hsl(${configuredPrimary})`
      : '#2563eb';
    const reportFont =
      lang === 'ar'
        ? '"Tajawal","Noto Naskh Arabic","Segoe UI",Tahoma,Arial,sans-serif'
        : '"Poppins","Segoe UI",Arial,sans-serif';
    const statusLabel = (status: number | string) => {
      const key = STATUS_KEY[String(status)];
      return key ? t(key) : String(status);
    };
    const rows = data.orders
      .map((o, index) => `<tr class="${isCancelled(o) ? 'cancelled' : o.operational_status === 'outside' ? 'outside' : ''}">
        <td class="num">${index + 1}</td><td>${esc(o.full_name || '—')}</td>
        <td class="nowrap">${esc(fmtDateTime(o.ts_ms))}</td>
        <td class="nowrap">${esc(o.reference_no || o.order_number)}</td><td>${esc(branchName)}</td>
        <td><span class="channel-mark">POS</span><small>Main Counter POS</small></td>
        <td>${esc(o.payment_method_slug || o.payment_method_id || '—')}</td>
        <td class="nowrap">${esc(Number(o.order_type) === 4 ? t('admin.rep.orderTypeDriveThru') : orderTypeLabel(o.order_type))}</td>
        <td class="nowrap">${esc(statusLabel(o.status))}</td>
        <td class="nowrap"><span class="op ${o.operational_status}">${esc(o.operational_status === 'inside' ? t('admin.rep.inside') : t('admin.rep.outside'))}</span></td>
        <td class="num">${esc(fmt(o.discount_total ?? o.discount_amount ?? 0))}</td>
        <td class="num">${esc(fmt(o.delivery_fee ?? 0))}</td>
        <td class="num strong">${esc(fmt(o.grand_total))}</td></tr>`)
      .join('');
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    const html = `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(t('admin.rep.title'))}</title><style>
      :root{--ink:#101828;--soft:#475467;--line:#b8c7d1;--brand:${brandColor};--danger:#b42318;--warn:#b54708;--ok:#027a48}*{box-sizing:border-box}
      body{margin:0;padding:18px;background:#eef1f4;color:var(--ink);font:10px/1.35 ${reportFont}}.toolbar,.sheet{max-width:1480px;margin:auto}.toolbar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:10px;position:sticky;top:0;padding:8px;background:#eef1f4}.toolbar button{padding:8px 18px;border:1px solid var(--brand);border-radius:4px;background:var(--brand);color:white;font:600 12px ${reportFont};cursor:pointer}.toolbar .secondary{background:white;color:var(--ink);border-color:var(--line)}
      .sheet{background:white;padding:18px 22px 24px;box-shadow:0 1px 4px #10182820}.masthead{display:flex;justify-content:space-between;gap:24px;padding-bottom:12px;border-bottom:3px solid var(--brand)}h1{margin:0;color:var(--brand);font-size:21px}.range,.org{margin:3px 0;color:#173d6b}.org{font-weight:700;color:#111;font-size:13px}.meta{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin:14px 0 16px}.k{font-size:9px;text-transform:uppercase;color:#536779}.v{font-weight:600}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:10px}.tile{padding:10px 12px;border:1px solid var(--line);border-inline-start:3px solid var(--brand);border-radius:5px}.tile.ok{border-inline-start-color:#00864b}.tile.warn{border-inline-start-color:#d97706}.tile.danger{border-inline-start-color:#dc2626}.tile .v{font-size:18px;margin-top:5px}.channels{display:flex;margin:0 0 16px}.channel-box{padding:6px 12px;border:1px solid var(--line);border-radius:5px;font-weight:700}.channel-mark{display:inline-block;background:#071c2b;color:white;border-radius:3px;padding:1px 5px;font-weight:700}small{display:block;color:#475467;font-size:7px;margin-top:1px}
      table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:4px 5px;border:1px solid var(--line);vertical-align:top}th{background:var(--brand);color:#fff;text-align:start;white-space:nowrap;font-weight:700}tbody tr:nth-child(even){background:#f7f9fa}tr.cancelled{background:#fef3f2!important}tr.outside{background:#eff8ff!important}.nowrap{white-space:nowrap}.num{text-align:end;white-space:nowrap}.strong{font-weight:700}.op{font-weight:700}.op.inside{color:#00864b}.op.outside{color:#b54708}.totals{width:100%;margin:0}.totals div{display:flex;justify-content:flex-end;gap:35px;padding:4px 8px;border:1px solid var(--line);border-top:0}.totals span{min-width:170px;text-align:end;font-weight:600}.totals b{min-width:95px;text-align:end}.totals div:last-child{background:#ecfdf3;font-size:11px;font-weight:700}.foot{margin-top:16px;padding-top:8px;border-top:1px solid #eaecf0;color:var(--soft);font-size:8px}
      @media print{@page{size:A4 landscape;margin:10mm}body{padding:0;background:#fff}.no-print{display:none!important}.sheet{max-width:none;padding:0;box-shadow:none;border-radius:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}table{font-size:9px}th,td{padding:3px 5px}thead{display:table-header-group}tr,td,th{break-inside:avoid}.masthead,.meta,.tiles{break-inside:avoid}}
    </style></head><body><div class="toolbar no-print"><button onclick="location.href='majestic-print://print'">${esc(t('admin.rep.print'))}</button><button class="secondary" onclick="window.close()">Close</button></div><main class="sheet">
      <header class="masthead"><div><h1>Daily Report</h1><p class="range">Sales Report For ${esc(f.date || `${fromStr} To ${toStr}`)}</p></div><p class="org">${esc(branchName)}</p></header>
      <section class="meta"><div><div class="k">Branch</div><div class="v">${esc(branchName)}</div></div><div><div class="k">Sales channel</div><div class="v">All</div></div><div><div class="k">Total orders</div><div class="v">${f.total_order}</div></div><div><div class="k">Generated at</div><div class="v">${esc(fmtDateTime(Date.now()))}</div></div><div><div class="k">Generated by</div><div class="v">${esc(generatedBy)}</div></div></section>
      <section class="tiles"><div class="tile ok"><div class="k">${esc(t('admin.rep.cardInside'))}</div><div class="v">${f.inside_hours_count}</div></div><div class="tile warn"><div class="k">${esc(t('admin.rep.cardOutside'))}</div><div class="v">${f.outside_hours_count}</div></div><div class="tile danger"><div class="k">${esc(t('admin.rep.cardCancelled'))}</div><div class="v">${f.canceled_order_count}</div></div><div class="tile"><div class="k">${esc(t('admin.rep.cardEarning'))}</div><div class="v">${esc(fmt(f.grand_total))}</div></div></section>
      <section class="channels"><div class="channel-box">POS · ${f.total_order} Orders · ${esc(fmt(f.grand_total))} · 1 terminal</div></section>
      <table><thead><tr><th>#</th><th>${esc(t('admin.rep.colClient'))}</th><th>${esc(t('admin.rep.colDate'))}</th><th>Reference</th><th>Branch</th><th>Sales Channel</th><th>Payment Type</th><th>${esc(t('admin.type'))}</th><th>${esc(t('admin.status'))}</th><th>${esc(t('admin.rep.colOpStatus'))}</th><th>${esc(t('admin.rep.colDiscount'))}</th><th>Delivery charge</th><th>${esc(t('common.total'))}</th></tr></thead><tbody>${rows}</tbody></table>
      <section class="totals"><div><span>${esc(t('admin.rep.grossSales'))}</span><b>${esc(fmt(f.gross_sales_total))}</b></div><div><span>${esc(t('admin.rep.discounts'))}</span><b>- ${esc(fmt(f.discounts))}</b></div><div><span>${esc(t('admin.rep.deliveryFees'))}</span><b>${esc(fmt(f.delivery_fees))}</b></div><div><span>${esc(t('admin.rep.netTotal'))}</span><b>${esc(fmt(f.grand_total))}</b></div></section>
      <p class="foot">Majestic POS · ${esc(fmtDateTime(Date.now()))}</p></main></body></html>`;
    await window.api.invoke('reports:openPreview', html);
  };

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
        <div className='flex gap-2 no-print'>
          <Button color='success' variant='flat' startContent={<FileSpreadsheet size={16} />} onPress={exportExcel}>Excel</Button>
          <Button variant='flat' startContent={<Printer size={16} />} onPress={async () => {
            try { await openPrintPreview(); }
            catch (error) { console.error('Unable to open print preview:', error); window.alert('Unable to open the print preview. Please try again.'); }
          }}>{t('admin.rep.print')}</Button>
        </div>
      }
      filters={
        canEditRange ? (
          <div className='flex flex-wrap items-end gap-2 no-print'>
            <div className='flex flex-wrap gap-1'>
              <Button size='sm' variant='bordered' onPress={() => applyPreset('today')}>Today</Button>
              <Button size='sm' variant='bordered' onPress={() => applyPreset('yesterday')}>Yesterday</Button>
              <Button size='sm' variant='bordered' onPress={() => applyPreset('last7')}>Last 7 days</Button>
              <Button size='sm' variant='bordered' onPress={() => applyPreset('month')}>This month</Button>
            </div>
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

          {/* The cards used to be silently short of the table beneath them:
              an open ticket or an order with no total was printed as a row but
              counted in no card, so 29 + 1 + 1 sat under a table of 37 with
              nothing to explain the gap. */}
          {!!f?.uncounted_order_count && (
            <div className='flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5'>
              <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0 text-warning' />
              <div className='text-[15px] font-medium text-default-700'>
                {t('admin.rep.uncounted', {
                  n: f.uncounted_order_count,
                  total: f.listed_order_count ?? 0,
                })}
              </div>
            </div>
          )}

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
                  // A marker plus a faint wash, not a solid fill: these rows
                  // still have to be read, and a tint heavy enough to spot at a
                  // glance is heavy enough to bury its own text in one theme or
                  // the other.
                  rowClassName={(r) =>
                    r.counted === 'uncounted'
                      ? 'bg-warning/10 border-s-4 border-s-warning'
                      : ''
                  }
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
