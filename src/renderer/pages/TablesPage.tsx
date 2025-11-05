import { useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

type TableRow = {
  id: string | number;
  number: number;
  label: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved';
  branch_id: number;
};

const columnHelper = createColumnHelper<TableRow>();

/* ---------- helpers (same safe mapping as before) ---------- */
const toInt = (v: any, fallback = 0) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
};
const deriveNumber = (t: any) => {
  if (t.number != null) return toInt(t.number);
  if (t.table_no != null) return toInt(t.table_no);
  const src = String(t.label ?? t.name ?? '');
  const m = src.match(/\d+/);
  return m ? toInt(m[0]) : 0;
};
const deriveStatus = (t: any): TableRow['status'] => {
  const s = String(t.status ?? '').toLowerCase();
  if (['available', 'free', 'vacant', 'open', 'idle', 'empty'].includes(s)) return 'available';
  if (['reserved', 'hold', 'booked', 'blocked'].includes(s)) return 'reserved';
  if (['occupied', 'busy', 'taken', 'in_use'].includes(s)) return 'occupied';
  if (typeof t.is_available === 'boolean') return t.is_available ? 'available' : 'occupied';
  if (typeof t.is_available === 'number') return t.is_available === 1 ? 'available' : 'occupied';
  if (typeof t.available === 'boolean') return t.available ? 'available' : 'occupied';
  if (t.current_order_id != null || t.order_id != null) return 'occupied';
  return 'available';
};
const normalize = (t: any): TableRow => ({
  id: t.id ?? t.table_id ?? t.uuid ?? String(Math.random()),
  number: deriveNumber(t),
  label: String(t.label ?? t.name ?? `Table ${deriveNumber(t) || ''}`).trim(),
  capacity: toInt(t.capacity ?? t.seats ?? t.covers ?? 0),
  status: deriveStatus(t),
  branch_id: toInt(t.branch_id ?? t.location_id ?? 0),
});

/* ---------- columns (read-only) ---------- */
const columns = [
  columnHelper.accessor('number', { header: 'Number' }),
  columnHelper.accessor('label', { header: 'Label' }),
  columnHelper.accessor('capacity', { header: 'Capacity' }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: info => {
      const s = info.getValue();
      const cls =
        s === 'available'
          ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
          : s === 'reserved'
          ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
          : 'bg-rose-500/15 text-rose-600 border-rose-500/30';
      const label = s === 'available' ? 'Available' : s === 'reserved' ? 'Reserved' : 'Occupied';
      return <span className={`px-2 py-1 rounded-md text-xs border ${cls}`}>{label}</span>;
    },
  }),
  columnHelper.accessor('branch_id', { header: 'Branch ID' }),
];

/* ---------- page ---------- */
function TablesPage() {
  const [rows, setRows] = useState<TableRow[]>([]);
  const [filterQ, setFilterQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TableRow['status']>('all');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const raw = await window.api.invoke('tables:list'); // read-only pull
      setRows((raw ?? []).map(normalize));
    } catch (e) {
      console.error('Failed to load tables:', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = filterQ.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(r.number).includes(q) ||
        r.label.toLowerCase().includes(q) ||
        String(r.capacity).includes(q) ||
        String(r.branch_id).includes(q)
      );
    });
  }, [rows, filterQ, statusFilter]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { globalFilter: filterQ },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-4">
      {/* Toolbar (read-only) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-2xl font-bold mr-auto">Tables</h1>

        <span className="px-2 py-1 text-xs rounded-md border bg-white/60 backdrop-blur dark:bg-white/5 dark:border-white/10 text-slate-600 dark:text-slate-300">
          Read-only • synced from server
        </span>

        <div className="inline-flex rounded-lg border bg-white/70 backdrop-blur dark:bg-white/5 dark:border-white/10">
          {(['all', 'available', 'occupied', 'reserved'] as const).map(k => (
            <button
              key={k}
              onClick={() => setStatusFilter(k)}
              className={`px-3 py-1.5 text-sm rounded-md ${
                statusFilter === k
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        <input
          className="px-3 py-2 rounded-lg border bg-white/70 backdrop-blur dark:bg-white/5 dark:border-white/10"
          placeholder="Search…"
          value={filterQ}
          onChange={e => setFilterQ(e.target.value)}
        />

        <button
          onClick={load}
          className="px-3 py-2 rounded-lg bg-slate-900 text-white dark:bg-slate-800 hover:opacity-90"
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/70 backdrop-blur border-b">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(h => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
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
          <tbody className="divide-y divide-slate-100 dark:divide-white/10">
            {table.getRowModel().rows.map((row, i) => (
              <tr key={row.id} className={i % 2 ? 'bg-slate-50/50 dark:bg-white/5' : ''}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-4 py-3 text-slate-800 dark:text-slate-200">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                  No tables found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TablesPage;

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}
