import { useMemo, useState, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

type Promo = {
  code: string;
  type: 'percent' | 'percentage' | 'amount' | string;
  value: number;
  min_total: number | null;
  max_discount: number | null;
  start_at: string | null;
  end_at: string | null;
  active?: boolean | number | string;   // may be many shapes
  enabled?: boolean | number | string;  // alt keys we might receive
  is_active?: boolean | number | string;
  status?: boolean | number | string;   // sometimes used as a toggle
};

/* ================= Utils ================= */
const fieldCls =
  'h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-sm outline-none ' +
  'focus:ring-2 focus:ring-sky-500/40 placeholder:opacity-60';
const btnCls =
  'h-10 px-3 rounded-lg border border-white/10 text-sm hover:bg-white/10 transition ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

function parseBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (['1','true','yes','y','on','enabled','enable','active'].includes(s)) return true;
  if (['0','false','no','n','off','disabled','disable','inactive'].includes(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) ? n !== 0 : false;
}

function isEnabled(p: Promo): boolean {
  // prefer explicit "active", fall back to other common keys
  const raw = p.active ?? p.enabled ?? p.is_active ?? p.status;
  return parseBool(raw);
}

const fmtMoney = (n: number | null | undefined) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '0.000';

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

const valueLabel = (type: Promo['type'], value: number) =>
  type === 'percent' || type === 'percentage' ? `${Number(value) || 0}%` : fmtMoney(value);

const timeWindowState = (p: Promo): 'active-now' | 'upcoming' | 'expired' => {
  const now = Date.now();
  const start = p.start_at ? new Date(p.start_at).getTime() : -Infinity;
  const end = p.end_at ? new Date(p.end_at).getTime() : Infinity;
  if (now < start) return 'upcoming';
  if (now > end) return 'expired';
  return 'active-now';
};

function StatusBadge({ promo }: { promo: Promo }) {
  const enabled = isEnabled(promo);
  const windowState = timeWindowState(promo);

  let label = '';
  let cls = 'px-2 py-0.5 rounded text-xs border';
  if (!enabled) {
    label = 'Disabled';
    cls += ' border-white/10 text-slate-400';
  } else if (windowState === 'active-now') {
    label = 'Active';
    cls += ' border-emerald-400/40 text-emerald-300';
  } else if (windowState === 'upcoming') {
    label = 'Upcoming';
    cls += ' border-amber-400/40 text-amber-300';
  } else {
    label = 'Expired';
    cls += ' border-rose-400/40 text-rose-300';
  }
  return <span className={cls}>{label}</span>;
}

/* ================= Component ================= */
export default function PromosPage() {
  const [data, setData] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(false);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageSize, setPageSize] = useState(25);

  const [q, setQ] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [timeFilter, setTimeFilter] = useState<'any' | 'active' | 'upcoming' | 'expired'>('any');
  const [typeFilter, setTypeFilter] = useState<'all' | 'percent' | 'amount'>('all');

  async function fetchPromos() {
    setLoading(true);
    try {
      const promos = await window.api.invoke('catalog:listPromos');
      setData(promos || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchPromos(); }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return (data || []).filter((p) => {
      if (enabledFilter !== 'all') {
        const want = enabledFilter === 'enabled';
        if (isEnabled(p) !== want) return false;
      }
      if (typeFilter !== 'all') {
        const isPercent = p.type === 'percent' || p.type === 'percentage';
        if (typeFilter === 'percent' && !isPercent) return false;
        if (typeFilter === 'amount' && isPercent) return false;
      }
      if (timeFilter !== 'any') {
        const state = timeWindowState(p);
        if (timeFilter === 'active' && state !== 'active-now') return false;
        if (timeFilter === 'upcoming' && state !== 'upcoming') return false;
        if (timeFilter === 'expired' && state !== 'expired') return false;
      }
      if (!qq) return true;
      const hay = `${p.code}|${p.type}|${p.value}|${p.min_total}|${p.max_discount}|${p.start_at}|${p.end_at}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [data, q, enabledFilter, timeFilter, typeFilter]);

  const columns = useMemo<ColumnDef<Promo>[]>(() => [
    {
      accessorKey: 'code',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Code <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      id: 'display_type',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Type <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => (row.type === 'percent' || row.type === 'percentage') ? 'Percent' : 'Amount',
      cell: (info) => info.getValue() as string,
    },
    {
      id: 'display_value',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Value <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => valueLabel(row.type, row.value),
      sortingFn: (a, b) => Number(a.original.value) - Number(b.original.value),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'min_total',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Min Total <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => fmtMoney(info.getValue() as number),
    },
    {
      accessorKey: 'max_discount',
      header: ({ column }) => (
        <button className="inline-flex items-center gap-1 font-medium"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Max Discount <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => (info.getValue() == null ? '—' : fmtMoney(info.getValue() as number)),
    },
    { accessorKey: 'start_at', header: 'Starts', cell: (i) => fmtDate(i.getValue() as string | null) },
    { accessorKey: 'end_at',   header: 'Ends',   cell: (i) => fmtDate(i.getValue() as string | null) },
    { id: 'effective_status',  header: 'Status', cell: ({ row }) => <StatusBadge promo={row.original} />, enableSorting: false },
  ], []);

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
  useEffect(() => { table.setPageIndex(0); }, [q, enabledFilter, timeFilter, typeFilter]);

  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* Header + Toolbar */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Promos</h1>
          <div className="text-sm opacity-70">Sort, search, and filter by status/type/date window</div>
        </div>

        <div className="w-full md:w-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(260px,420px)_160px_160px_160px_110px] gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code/type/value..."
            className={fieldCls + ' w-full'}
          />

          <select className={fieldCls} value={enabledFilter} onChange={(e) => setEnabledFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="enabled">Enabled only</option>
            <option value="disabled">Disabled only</option>
          </select>

          <select className={fieldCls} value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as any)}>
            <option value="any">Any time</option>
            <option value="active">Active now</option>
            <option value="upcoming">Upcoming</option>
            <option value="expired">Expired</option>
          </select>

          <select className={fieldCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
            <option value="all">All types</option>
            <option value="percent">Percent</option>
            <option value="amount">Amount</option>
          </select>

          <button className={btnCls} onClick={fetchPromos} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>

          <div className="flex items-center gap-2">
            <label className="text-sm opacity-70">Rows</label>
            <select className={fieldCls} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-left">
          <thead className="bg-white/5">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className="p-2 border-b border-white/10 text-left cursor-pointer select-none"
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
                  No promos match your search/filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const faded = !isEnabled(row.original) || timeWindowState(row.original) === 'expired';
                return (
                  <tr key={row.id} className={`border-b border-white/10 ${faded ? 'opacity-70' : ''} hover:bg-white/5`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2">
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
          Page <strong>{table.getState().pagination.pageIndex + 1}</strong> of <strong>{table.getPageCount()}</strong> • <span>{filtered.length} promos</span>
        </div>
        <div className="flex items-center gap-2">
          <button className={btnCls} onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>« First</button>
          <button className={btnCls} onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>‹ Prev</button>
          <button className={btnCls} onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next ›</button>
          <button className={btnCls} onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>Last »</button>
        </div>
      </div>
    </div>
  );
}
