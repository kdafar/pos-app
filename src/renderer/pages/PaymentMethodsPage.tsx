import { useEffect, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';
import { useI18n } from '../i18n';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

type PaymentMethod = {
  slug: string;
  name_en: string;
  name_ar: string;
  legacy_code: string | null;
  is_active?: boolean | number | string;
  enabled?: boolean | number | string;   // alternative keys (future-proof)
  status?: boolean | number | string;
  sort_order: number;
};

/* ================= UI + utils ================= */
const fieldCls =
  'h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-sm outline-none ' +
  'focus:ring-2 focus:ring-sky-500/40 placeholder:opacity-60';
const btnCls =
  'h-10 px-3 rounded-lg border border-white/10 text-sm hover:bg-white/10 transition ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

function parseBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  if (['1','true','yes','y','on','enabled','enable','active'].includes(s)) return true;
  if (['0','false','no','n','off','disabled','disable','inactive'].includes(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) ? n !== 0 : false;
}
const isEnabled = (m: PaymentMethod) =>
  parseBool(m.is_active ?? m.enabled ?? m.status ?? false);

function StatusChip({ active }: { active: any }) {
  const { t } = useI18n();
  const on = parseBool(active);
  const cls =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ' +
    (on ? 'border-emerald-400/40 text-emerald-300'
        : 'border-white/10 text-slate-400');
  return (
    <span className={cls}>{on ? t('admin.enabled') : t('admin.disabled')}</span>
  );
}

/* ================= Component ================= */
export default function PaymentMethodsPage() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);

  const [sorting, setSorting] = useState<SortingState>([
    { id: 'legacy_code', desc: false },
  ]);
  const [pageSize, setPageSize] = useState(25);

  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] =
    useState<'all' | 'enabled' | 'disabled'>('all');

  async function fetchData() {
    setLoading(true);
    try {
      const methods = await window.api.invoke('payments:listMethods');
      setData(methods || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (data || []).filter((m) => {
      if (activeFilter !== 'all') {
        const want = activeFilter === 'enabled';
        if (isEnabled(m) !== want) return false;
      }
      if (!qq) return true;
      const hay = `${m.slug}|${m.name_en}|${m.name_ar}|${m.legacy_code ?? ''}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [data, q, activeFilter]);

  const columns = useMemo<ColumnDef<PaymentMethod>[]>(() => [

    {
      accessorKey: 'slug',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          {t('admin.pay.slug')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      id: 'name_block',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          {t('admin.name')} <span className="opacity-60">↕</span>
        </button>
      ),
      // Sort by whichever name the operator is actually reading.
      accessorFn: (row) =>
        (lang === 'ar' ? row.name_ar || row.name_en : row.name_en || row.name_ar) || '',
      cell: ({ row }) => {
        const primary =
          (lang === 'ar' ? row.original.name_ar : row.original.name_en) || '';
        const secondary =
          (lang === 'ar' ? row.original.name_en : row.original.name_ar) || '';
        return (
          <div className="leading-tight">
            <div className="font-medium">{primary || secondary || '—'}</div>
            <div className="text-xs opacity-70">{primary ? secondary : ''}</div>
          </div>
        );
      },
    },
    {
      accessorKey: 'legacy_code',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          {t('admin.pay.legacyCode')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => (info.getValue() as string) || '—',
    },
    {
      id: 'status',
      header: () => t('admin.active'),
      cell: ({ row }) => <StatusChip active={row.original.is_active ?? row.original.enabled ?? row.original.status} />,
      enableSorting: false,
    },
  ], [t, lang]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  useEffect(() => { table.setPageSize(pageSize); }, [pageSize]);
  useEffect(() => { table.setPageIndex(0); }, [q, activeFilter]);

  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* Header + Toolbar */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.pay.title')}</h1>
          <div className="text-sm opacity-70">{t('admin.pay.subtitle')}</div>
        </div>

        {/* Responsive toolbar grid */}
        <div className="w-full md:w-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(260px,420px)_160px_110px_110px] gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('admin.pay.searchPlaceholder')}
            className={fieldCls + ' w-full'}
          />

          <select
            className={fieldCls}
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as any)}
            title={t('admin.pay.activeFilter')}
          >
            <option value="all">{t('common.all')}</option>
            <option value="enabled">{t('admin.enabledOnly')}</option>
            <option value="disabled">{t('admin.disabledOnly')}</option>
          </select>

          <button
            className={btnCls}
            onClick={fetchData}
            disabled={loading}
            title={t('admin.refresh')}
          >
            {loading ? t('admin.refreshing') : t('admin.refresh')}
          </button>

          <div className="flex items-center gap-2">
            <label className="text-sm opacity-70">{t('admin.rows')}</label>
            <select
              className={fieldCls}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-start table-fixed">
          <thead className="bg-white/5 sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="p-2 border-b border-white/10 text-start select-none"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {({ asc: ' 🔼', desc: ' 🔽' } as any)[h.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td className="p-6 opacity-70 text-center" colSpan={columns.length}>
                  {q || activeFilter !== 'all'
                    ? t('admin.pay.noneFiltered')
                    : t('admin.pay.none')}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const faded = !isEnabled(row.original);
                return (
                  <tr key={row.id} className={`border-b border-white/10 ${faded ? 'opacity-70' : ''} hover:bg-white/5`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 text-start">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
        <div className="opacity-70">
          {t('admin.pageOf', {
            page: table.getState().pagination.pageIndex + 1,
            pages: table.getPageCount(),
          })}{' '}
          • <span>{t('admin.pay.count', { n: filtered.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className={btnCls} onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
            {t('admin.first')}
          </button>
          <button className={btnCls} onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            {t('admin.prev')}
          </button>
          <button className={btnCls} onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            {t('admin.next')}
          </button>
          <button className={btnCls} onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
            {t('admin.last')}
          </button>
        </div>
      </div>
    </div>
  );
}
