import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';
import { Printer } from 'lucide-react';

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
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${cls}`}
    >
      {s || '—'}
    </span>
  );
};

const fmtMoney3 = (n?: number | null) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '0.000';

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

  // ---- tiny UI helpers so all fields/buttons look identical (dark & light) ----
  const fieldCls =
    'h-10 px-3 rounded-lg bg-white/5 dark:bg-white/5 border border-white/10 ' +
    'text-sm outline-none focus:ring-2 focus:ring-sky-500/40 placeholder:opacity-60';
  const btnCls =
    'h-10 px-3 rounded-lg border border-white/10 text-sm hover:bg-white/10 transition ' +
    'disabled:opacity-50 disabled:cursor-not-allowed';

  // small button style for row actions
  const rowBtnCls =
    'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/15 ' +
    'text-xs hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed';

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
  }, [rows, q, type]);

  const handlePrint = useCallback(
    async (orderId?: string) => {
      try {
        if (!isAdmin) {
          alert('Only admin users are allowed to print this report.');
          return;
        }

        if (!orderId) {
          alert('Cannot print: order ID is missing.');
          return;
        }
        await window.api.invoke('orders:print', orderId);
      } catch (e) {
        console.error('orders:print failed', e);
        alert('Failed to print this order.');
      }
    },
    [isAdmin]
  );

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        accessorKey: 'number',
        header: ({ column }) => (
          <button
            className='font-medium inline-flex items-center gap-1'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Number <span className='opacity-60'>↕</span>
          </button>
        ),
        cell: (info) => info.getValue() as string,
        size: 150,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge s={row.original.status} />,
        enableSorting: false,
        size: 120,
      },
      {
        accessorKey: 'order_type',
        header: ({ column }) => (
          <button
            className='font-medium inline-flex items-center gap-1'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Type <span className='opacity-60'>↕</span>
          </button>
        ),
        cell: ({ row }) => typeLabel(row.original.order_type),
        sortingFn: 'alphanumeric',
        size: 120,
      },
      {
        id: 'customer',
        header: 'Customer',
        cell: ({ row }) => (
          <div className='leading-tight'>
            <div className='font-medium'>{row.original.full_name || '—'}</div>
            <div className='text-xs opacity-70'>
              {row.original.mobile || ''}
            </div>
          </div>
        ),
        enableSorting: false,
        size: 260,
      },
      {
        accessorKey: 'grand_total',
        header: ({ column }) => (
          <button
            className='font-medium inline-flex items-center gap-1'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Total <span className='opacity-60'>↕</span>
          </button>
        ),
        cell: (info) => (
          <span className='font-semibold'>
            {fmtMoney3(info.getValue() as number)}
          </span>
        ),
        sortingFn: 'alphanumeric',
        size: 120,
      },
      {
        id: 'updated_at',
        header: ({ column }) => (
          <button
            className='font-medium inline-flex items-center gap-1'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Updated <span className='opacity-60'>↕</span>
          </button>
        ),
        accessorFn: (row) => bestUpdatedMs(row),
        cell: ({ row }) => {
          const ms = bestUpdatedMs(row.original);
          return ms ? new Date(ms).toLocaleString() : '—';
        },
        sortingFn: 'basic',
        size: 200,
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        size: 120,
        cell: ({ row }) =>
          isAdmin ? (
            <button
              className={rowBtnCls}
              onClick={() => handlePrint(row.original.id)}
              title='Print receipt'
            >
              <Printer size={14} />
              <span>Print</span>
            </button>
          ) : null,
      },
    ],
    [handlePrint, isAdmin]
  ); // keep in sync with admin state

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
  }, [pageSize, table]);

  useEffect(() => {
    table.setPageIndex(0);
  }, [q, type, table]);

  return (
    <div className='max-w-7xl mx-auto p-4'>
      {/* Header + Toolbar */}
      <div className='mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>Today’s Orders</h1>
          <div className='text-sm opacity-70'>
            All statuses for the current day
          </div>
        </div>

        {/* Toolbar */}
        <div className='w-full md:w-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(260px,420px)_140px_110px_110px] gap-2'>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Search number / name / mobile / status…'
            className={fieldCls + ' w-full'}
          />

          <select
            className={fieldCls + ' w-full'}
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            title='Order type'
          >
            <option value='all'>All types</option>
            <option value='1'>Delivery</option>
            <option value='2'>Pickup</option>
            <option value='3'>Dine-in</option>
          </select>

          <button
            className={btnCls + ' w-full'}
            onClick={refresh}
            disabled={loading}
            title='Refresh'
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>

          <div className='flex items-center gap-2 w-full'>
            <label className='text-sm opacity-70'>Rows</label>
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

      {/* Table */}
      <div className='overflow-auto rounded-xl border border-white/10'>
        <table className='w-full text-left table-fixed'>
          <thead className='bg-white/5 sticky top-0 z-10'>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() !== 150 ? undefined : 150 }}
                    className='p-2 border-b border-white/10 text-left select-none'
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {({ asc: ' 🔼', desc: ' 🔽' } as any)[
                      h.column.getIsSorted() as string
                    ] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  className='p-6 opacity-70 text-center'
                  colSpan={columns.length}
                >
                  No orders{' '}
                  {q !== '' || type !== 'all'
                    ? 'match your filters.'
                    : 'for today.'}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className='border-b border-white/10 hover:bg-white/5'
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className='p-2 align-top'>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className='mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm'>
        <div className='opacity-70'>
          Page <strong>{table.getState().pagination.pageIndex + 1}</strong> of{' '}
          <strong>{table.getPageCount()}</strong> •{' '}
          <span>{filtered.length} orders</span>
        </div>
        <div className='flex items-center gap-2'>
          <button
            className={btnCls}
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            « First
          </button>
          <button
            className={btnCls}
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            ‹ Prev
          </button>
          <button
            className={btnCls}
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next ›
          </button>
          <button
            className={btnCls}
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
