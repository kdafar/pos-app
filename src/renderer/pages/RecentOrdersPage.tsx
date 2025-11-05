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

// IPC typing (optional)
declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

type Order = {
  id?: string;
  number: string;
  status: string | null;
  order_type: number | null; // 1 delivery, 2 pickup, 3 dine-in
  full_name?: string | null;
  mobile?: string | null;
  grand_total: number | null;
  updated_at?: number | null; // ms epoch preferred
  opened_at?: number | null;  // fallback (ms)
  created_at?: string | null; // fallback (ISO)
};

const typeLabel = (t?: number | null) =>
  t === 1 ? 'Delivery' : t === 2 ? 'Pickup' : t === 3 ? 'Dine-in' : '—';

const StatusBadge = ({ s }: { s?: string | null }) => {
  const k = String(s ?? '').toLowerCase();
  const map: Record<string, string> = {
    open: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    prepared: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    closed: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    cancelled: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  const cls = map[k] ?? 'bg-white/5 text-slate-300 border-white/10';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${cls}`}>
      {s || '—'}
    </span>
  );
};

const fmtMoney3 = (n?: number | null) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '0.000';

const bestUpdatedMs = (row: Order) => {
  // Prefer updated_at (ms), else opened_at (ms), else created_at (ISO -> ms)
  if (row.updated_at && Number(row.updated_at) > 0) return Number(row.updated_at);
  if (row.opened_at && Number(row.opened_at) > 0) return Number(row.opened_at);
  if (row.created_at) {
    const x = Date.parse(row.created_at);
    if (!Number.isNaN(x)) return x;
  }
  return 0;
};

export default function RecentOrdersPage() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  // filters
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | '1' | '2' | '3'>('all');

  // table state
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'updated_at', desc: true },
  ]);
  const [pageSize, setPageSize] = useState(25);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await window.api.invoke('orders:listOpen');
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
      const hay = `${r.number}|${r.status ?? ''}|${typeLabel(r.order_type)}|${r.full_name ?? ''}|${r.mobile ?? ''}`
        .toLowerCase();
      return hay.includes(qq);
    });
  }, [rows, q, type]);

  const columns = useMemo<ColumnDef<Order>[]>(() => [
    {
      accessorKey: 'number',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Number <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge s={row.original.status} />,
      enableSorting: false,
    },
    {
      accessorKey: 'order_type',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Type <span className="opacity-60">↕</span>
        </button>
      ),
      cell: ({ row }) => typeLabel(row.original.order_type),
      sortingFn: 'alphanumeric',
    },
    {
      id: 'customer',
      header: 'Customer',
      cell: ({ row }) => (
        <div className="leading-tight">
          <div className="font-medium">{row.original.full_name || '—'}</div>
          <div className="text-xs opacity-70">{row.original.mobile || ''}</div>
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'grand_total',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Total <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => <span className="font-semibold">{fmtMoney3(info.getValue() as number)}</span>,
      sortingFn: 'alphanumeric',
    },
    {
      accessorKey: 'updated_at',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Updated <span className="opacity-60">↕</span>
        </button>
      ),
      // For stable numeric sorting, provide a numeric accessor
      accessorFn: (row) => bestUpdatedMs(row),
      cell: ({ row }) => {
        const ms = bestUpdatedMs(row.original);
        return ms ? new Date(ms).toLocaleString() : '—';
      },
      sortingFn: 'basic',
    },
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

  useEffect(() => {
    table.setPageSize(pageSize);
  }, [pageSize]);

  // reset to first page on filter changes
  useEffect(() => {
    table.setPageIndex(0);
  }, [q, type]);

  return (
    <div className="p-4">
      {/* Top bar */}
      <div className="flex flex-wrap gap-3 items-end justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Recent Orders</h1>
          <div className="text-sm opacity-70">Open/active orders</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search number / name / mobile / status…"
            className="p-2 border rounded bg-transparent min-w-[260px]"
          />
          <select
            className="ui-field"
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            title="Order type"
          >
            <option value="all">All types</option>
            <option value="1">Delivery</option>
            <option value="2">Pickup</option>
            <option value="3">Dine-in</option>
          </select>

          <button
            className="p-2 border rounded bg-transparent disabled:opacity-50"
            onClick={refresh}
            disabled={loading}
            title="Refresh"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>

          <label className="ml-3 text-sm opacity-70">Rows</label>
          <select
            className="ui-field"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {[10, 25, 50, 100].map((s) => (
              <option key={s} value={s}>{s}</option>
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
                  No orders {q !== '' || type !== 'all' ? 'match your filters.' : 'found.'}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-white/10 hover:bg-white/5">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between text-sm">
        <div className="opacity-70">
          Page <strong>{table.getState().pagination.pageIndex + 1}</strong> of{' '}
          <strong>{table.getPageCount()}</strong> •{' '}
          <span>{filtered.length} orders</span>
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
