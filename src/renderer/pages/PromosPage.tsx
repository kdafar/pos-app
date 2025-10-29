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

// IPC type (optional)
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
  active: boolean | number; // some DBs return 0/1
};

// ---- utils ----
const toBool = (v: any) => (typeof v === 'boolean' ? v : !!Number(v));
const fmtMoney = (n: number | null | undefined) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '0.000';

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s; // show raw if invalid
  // Kuwait-style readable
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const valueLabel = (type: Promo['type'], value: number) =>
  type === 'percent' || type === 'percentage'
    ? `${Number(value) || 0}%`
    : fmtMoney(value);

// Active window state based on dates (ignores the "active" toggle)
const timeWindowState = (p: Promo): 'active-now' | 'upcoming' | 'expired' | 'any' => {
  const now = Date.now();
  const start = p.start_at ? new Date(p.start_at).getTime() : -Infinity;
  const end = p.end_at ? new Date(p.end_at).getTime() : Infinity;

  if (now < start) return 'upcoming';
  if (now > end) return 'expired';
  return 'active-now';
};

function StatusBadge({ promo }: { promo: Promo }) {
  const enabled = toBool(promo.active);
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

export default function PromosPage() {
  const [data, setData] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(false);

  // table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageSize, setPageSize] = useState(25);

  // filters
  const [q, setQ] = useState(''); // global search
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [timeFilter, setTimeFilter] = useState<'any' | 'active' | 'upcoming' | 'expired'>('any');
  const [typeFilter, setTypeFilter] = useState<'all' | 'percent' | 'amount'>('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const promos = await window.api.invoke('catalog:listPromos');
        setData(promos || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // client-side filtering + search
  const filtered = useMemo(() => {
    const norm = (s: any) => String(s ?? '').toLowerCase();
    const qq = norm(q);

    return (data || []).filter((p) => {
      if (enabledFilter !== 'all') {
        const want = enabledFilter === 'enabled';
        if (toBool(p.active) !== want) return false;
      }

      if (timeFilter !== 'any') {
        const state = timeWindowState(p);
        if (
          (timeFilter === 'active' && state !== 'active-now') ||
          (timeFilter === 'upcoming' && state !== 'upcoming') ||
          (timeFilter === 'expired' && state !== 'expired')
        ) {
          return false;
        }
      }

      if (typeFilter !== 'all') {
        const isPercent = p.type === 'percent' || p.type === 'percentage';
        if (typeFilter === 'percent' && !isPercent) return false;
        if (typeFilter === 'amount' && isPercent) return false;
      }

      if (!qq) return true;

      // global search: code/type/value/min_total/max_discount/dates
      const hay =
        `${p.code}|${p.type}|${p.value}|${p.min_total}|${p.max_discount}|${p.start_at}|${p.end_at}`.toLowerCase();

      return hay.includes(qq);
    });
  }, [data, q, enabledFilter, timeFilter, typeFilter]);

  // columns
  const columns = useMemo<ColumnDef<Promo>[]>(() => {
    return [
      {
        accessorKey: 'code',
        header: ({ column }) => (
          <button
            className="inline-flex items-center gap-1 font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            title="Sort"
          >
            Code <span className="opacity-60">↕</span>
          </button>
        ),
        cell: (info) => info.getValue() as string,
      },
      {
        id: 'display_type',
        header: ({ column }) => (
          <button
            className="inline-flex items-center gap-1 font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            title="Sort"
          >
            Type <span className="opacity-60">↕</span>
          </button>
        ),
        accessorFn: (row) =>
          row.type === 'percent' || row.type === 'percentage' ? 'Percent' : 'Amount',
        cell: (info) => info.getValue() as string,
      },
      {
        id: 'display_value',
        header: ({ column }) => (
          <button
            className="inline-flex items-center gap-1 font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            title="Sort"
          >
            Value <span className="opacity-60">↕</span>
          </button>
        ),
        accessorFn: (row) => valueLabel(row.type, row.value),
        sortingFn: (a, b, _colId) => {
          // sort numerically regardless of label
          const av =
            a.original.type === 'percent' || a.original.type === 'percentage'
              ? Number(a.original.value)
              : Number(a.original.value);
          const bv =
            b.original.type === 'percent' || b.original.type === 'percentage'
              ? Number(b.original.value)
              : Number(b.original.value);
          return av - bv;
        },
        cell: (info) => info.getValue() as string,
      },
      {
        accessorKey: 'min_total',
        header: ({ column }) => (
          <button
            className="inline-flex items-center gap-1 font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            title="Sort"
          >
            Min Total <span className="opacity-60">↕</span>
          </button>
        ),
        cell: (info) => fmtMoney(info.getValue() as number),
      },
      {
        accessorKey: 'max_discount',
        header: ({ column }) => (
          <button
            className="inline-flex items-center gap-1 font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            title="Sort"
          >
            Max Discount <span className="opacity-60">↕</span>
          </button>
        ),
        cell: (info) =>
          info.getValue() == null ? '—' : fmtMoney(info.getValue() as number),
      },
      {
        accessorKey: 'start_at',
        header: 'Starts',
        cell: (info) => fmtDate(info.getValue() as string | null),
      },
      {
        accessorKey: 'end_at',
        header: 'Ends',
        cell: (info) => fmtDate(info.getValue() as string | null),
      },
      {
        id: 'effective_status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge promo={row.original} />,
        enableSorting: false,
      },
    ] as ColumnDef<Promo>[];
  }, []);

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

  useEffect(() => {
    table.setPageSize(pageSize);
  }, [pageSize]);

  // reset page when filters/search change
  useEffect(() => {
    table.setPageIndex(0);
  }, [q, enabledFilter, timeFilter, typeFilter]);

  return (
    <div className="p-4">
      {/* Top bar */}
      <div className="flex flex-wrap gap-3 items-end justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Promos</h1>
          <div className="text-sm opacity-70">
            Sort, search, and filter by status/type/date window
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code/type/value…"
            className="p-2 border rounded min-w-[260px] bg-transparent"
          />
          <select
            className="p-2 border rounded bg-transparent"
            value={enabledFilter}
            onChange={(e) => setEnabledFilter(e.target.value as any)}
            title="Enabled/Disabled filter"
          >
            <option value="all">All</option>
            <option value="enabled">Enabled only</option>
            <option value="disabled">Disabled only</option>
          </select>
          <select
            className="p-2 border rounded bg-transparent"
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as any)}
            title="Time window filter"
          >
            <option value="any">Any time</option>
            <option value="active">Active now</option>
            <option value="upcoming">Upcoming</option>
            <option value="expired">Expired</option>
          </select>
          <select
            className="p-2 border rounded bg-transparent"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            title="Type filter"
          >
            <option value="all">All types</option>
            <option value="percent">Percent</option>
            <option value="amount">Amount</option>
          </select>
          <button
            className="p-2 border rounded bg-transparent disabled:opacity-50"
            onClick={async () => {
              setLoading(true);
              try {
                const promos = await window.api.invoke('catalog:listPromos');
                setData(promos || []);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            title="Refresh"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>

          <label className="ml-3 text-sm opacity-70">Rows</label>
          <select
            className="p-2 border rounded bg-transparent"
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
                    {{
                      asc: ' 🔼',
                      desc: ' 🔽',
                    }[h.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td className="p-4 opacity-70" colSpan={columns.length}>
                  No promos match your search/filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const state = timeWindowState(row.original);
                const enabled = toBool(row.original.active);
                const faded = !enabled || state === 'expired';
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-white/10 ${
                      faded ? 'opacity-70' : ''
                    } hover:bg-white/5`}
                  >
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
      <div className="mt-3 flex items-center justify-between text-sm">
        <div className="opacity-70">
          Page <strong>{table.getState().pagination.pageIndex + 1}</strong> of{' '}
          <strong>{table.getPageCount()}</strong> •{' '}
          <span>{filtered.length} promos</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            « First
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            ‹ Prev
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next ›
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            Last »
          </button>
        </div>
      </div>
    </div>
  );
}
