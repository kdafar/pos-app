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

type PaymentMethod = {
  slug: string;
  name_en: string;
  name_ar: string;
  legacy_code: string | null;
  is_active: boolean | number;
  sort_order: number;
};

const toBool = (v: any) => (typeof v === 'boolean' ? v : !!Number(v));

function StatusChip({ active }: { active: boolean | number }) {
  const on = toBool(active);
  const cls =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ' +
    (on
      ? 'border-emerald-400/40 text-emerald-300'
      : 'border-white/10 text-slate-400');
  return <span className={cls}>{on ? 'Enabled' : 'Disabled'}</span>;
}

export default function PaymentMethodsPage() {
  const [data, setData] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);

  // table state
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'sort_order', desc: false },
  ]);
  const [pageSize, setPageSize] = useState(25);

  // filters
  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] =
    useState<'all' | 'enabled' | 'disabled'>('all');

  const fetchData = async () => {
    setLoading(true);
    try {
      const methods = await window.api.invoke('payments:listMethods');
      setData(methods || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    const norm = (s: any) => String(s ?? '').toLowerCase();
    const qq = norm(q);

    return (data || []).filter((m) => {
      if (activeFilter !== 'all') {
        const want = activeFilter === 'enabled';
        if (toBool(m.is_active) !== want) return false;
      }
      if (!qq) return true;
      const hay = `${m.slug}|${m.name_en}|${m.name_ar}|${m.legacy_code ?? ''}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [data, q, activeFilter]);

  const columns = useMemo<ColumnDef<PaymentMethod>[]>(() => [
    {
      accessorKey: 'sort_order',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Sort <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'slug',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Slug <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'name_en',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Name (EN) <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'name_ar',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Name (AR) <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'legacy_code',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Legacy Code <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => (info.getValue() as string) ?? '—',
    },
    {
      id: 'status',
      header: 'Active',
      cell: ({ row }) => <StatusChip active={row.original.is_active} />,
      enableSorting: false,
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

  useEffect(() => {
    table.setPageIndex(0);
  }, [q, activeFilter]);

  return (
    <div className="p-4">
      {/* Top bar */}
      <div className="flex flex-wrap gap-3 items-end justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Payment Methods</h1>
          <div className="text-sm opacity-70">Search, filter, sort, paginate</div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search slug/name/legacy…"
            className="p-2 border rounded min-w-[260px] bg-transparent"
          />
          <select
            className="ui-field"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as any)}
            title="Active filter"
          >
            <option value="all">All</option>
            <option value="enabled">Enabled only</option>
            <option value="disabled">Disabled only</option>
          </select>
          <button
            className="p-2 border rounded bg-transparent disabled:opacity-50"
            onClick={fetchData}
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
                  No methods {q || activeFilter !== 'all' ? 'match your search/filters.' : 'found.'}
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
          <span>{filtered.length} methods</span>
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
