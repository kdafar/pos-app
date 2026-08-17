import { useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { useToast } from '../components/ToastProvider'; // adjust path if needed
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n';

type TableRow = {
  id: string | number;
  number: number;
  label: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved';
  branch_id: number;
  current_order_id?: string | number | null; // ⬅️ needed for clearTable
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
  if (['available', 'free', 'vacant', 'open', 'idle', 'empty'].includes(s))
    return 'available';
  if (['reserved', 'hold', 'booked', 'blocked'].includes(s)) return 'reserved';
  if (['occupied', 'busy', 'taken', 'in_use'].includes(s)) return 'occupied';
  if (typeof t.is_available === 'boolean')
    return t.is_available ? 'available' : 'occupied';
  if (typeof t.is_available === 'number')
    return t.is_available === 1 ? 'available' : 'occupied';
  if (typeof t.available === 'boolean')
    return t.available ? 'available' : 'occupied';
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
  // ⬇️ try our best to capture any order id the API might send
  current_order_id:
    t.current_order_id ?? t.order_id ?? t.orderId ?? t.currentOrderId ?? null,
});

/** Status → localized label key. Kept as a map so the filter pills and the
 *  table badge can never drift apart. */
const STATUS_KEY: Record<TableRow['status'], StringKey> = {
  available: 'admin.tables.available',
  occupied: 'admin.tables.occupied',
  reserved: 'admin.tables.reserved',
};

/* ---------- base columns (read-only) ---------- */
const makeBaseColumns = (t: (k: StringKey) => string) => [
  columnHelper.accessor('number', { header: () => t('admin.tables.number') }),
  columnHelper.accessor('label', { header: () => t('admin.tables.label') }),
  columnHelper.accessor('capacity', {
    header: () => t('admin.tables.capacity'),
  }),
  columnHelper.accessor('status', {
    header: () => t('admin.status'),
    cell: (info) => {
      const s = info.getValue();
      const cls =
        s === 'available'
          ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
          : s === 'reserved'
          ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
          : 'bg-rose-500/15 text-rose-600 border-rose-500/30';
      return (
        <span className={`px-2 py-1 rounded-md text-xs border ${cls}`}>
          {t(STATUS_KEY[s] ?? 'admin.tables.occupied')}
        </span>
      );
    },
  }),
  columnHelper.accessor('branch_id', {
    header: () => t('admin.tables.branchId'),
  }),
];

function TablesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<TableRow[]>([]);
  const [filterQ, setFilterQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TableRow['status']>(
    'all'
  );
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const toast = useToast();

  const confirm = useConfirmDialog();

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

  // Detect admin (only admins see "Clear table" buttons)
  useEffect(() => {
    (async () => {
      try {
        const status = await window.api.invoke('auth:status'); // adjust channel if needed
        const role =
          status?.current_user?.role ??
          status?.user?.role ??
          status?.role ??
          status?.current_user?.user_type;

        const slug = String(role || '').toLowerCase();
        if (
          ['admin', 'owner', 'super_admin', 'superadmin', 's'].includes(slug)
        ) {
          setIsAdmin(true);
        }
      } catch (e) {
        console.warn(
          'auth:status failed, tables stay read-only for this user',
          e
        );
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = filterQ.trim().toLowerCase();
    return rows.filter((r) => {
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

  // Admin-only clear action
  const handleClearTable = async (row: TableRow) => {
    if (!isAdmin) return;

    const ok = await confirm({
      title: t('admin.tables.clearTitle', { label: row.label }),
      message: (
        <div className='space-y-1 text-sm'>
          <p>{t('admin.tables.clearBody')}</p>
          <p className='text-xs text-slate-500'>
            {t('admin.tables.clearHint')}
          </p>
        </div>
      ),
      confirmLabel: t('admin.tables.clear'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });

    if (!ok) return;

    try {
      await window.api.invoke('orders:clearTable', {
        table_id: row.id,
        order_id: row.current_order_id ?? null, // may be null
      });
    } catch (e) {
      console.error('orders:clearTable failed', e);
      toast({
        tone: 'danger',
        title: t('admin.tables.clearFailed'),
        message: t('admin.supportHint'),
      });
      return;
    }

    await load();
  };

  // Build columns, with Actions only for admins
  const columns = useMemo(
    () =>
      isAdmin
        ? [
            ...makeBaseColumns(t),
            columnHelper.display({
              id: 'actions',
              header: () => t('admin.actions'),
              cell: (info) => {
                const row = info.row.original;

                // ⬅️ was requiring current_order_id; now only check status
                const canClear = row.status !== 'available';

                if (!canClear) return null;

                return (
                  <button
                    type='button'
                    onClick={() => handleClearTable(row)}
                    className='px-3 py-1.5 rounded-md text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50'
                  >
                    {t('admin.tables.clear')}
                  </button>
                );
              },
            }),
          ]
        : makeBaseColumns(t),
    [isAdmin, t]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { globalFilter: filterQ },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className='p-4'>
      {/* Toolbar */}
      <div className='flex flex-wrap items-center gap-2 mb-4'>
        <h1 className='text-2xl font-bold me-auto'>{t('admin.tables.title')}</h1>

        <span className='px-2 py-1 text-xs rounded-md border bg-white/60 backdrop-blur dark:bg-white/5 dark:border-white/10 text-slate-600 dark:text-slate-300'>
          {isAdmin
            ? t('admin.tables.adminHint')
            : t('admin.tables.readOnlyHint')}
        </span>

        <div className='inline-flex rounded-lg border bg-white/70 backdrop-blur dark:bg-white/5 dark:border-white/10'>
          {(['all', 'available', 'occupied', 'reserved'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setStatusFilter(k)}
              className={`px-3 py-1.5 text-sm rounded-md ${
                statusFilter === k
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-default-200'
              }`}
            >
              {k === 'all' ? t('common.all') : t(STATUS_KEY[k])}
            </button>
          ))}
        </div>

        <input
          className='px-3 py-2 rounded-lg border bg-white/70 backdrop-blur dark:bg-white/5 dark:border-white/10'
          placeholder={t('admin.tables.searchPlaceholder')}
          value={filterQ}
          onChange={(e) => setFilterQ(e.target.value)}
        />

        <button
          onClick={load}
          className='px-3 py-2 rounded-lg bg-slate-900 text-white dark:bg-slate-800 hover:opacity-90'
          disabled={loading}
        >
          {loading ? t('admin.refreshing') : t('admin.refresh')}
        </button>
      </div>

      {/* Table */}
      <div className='rounded-lg border overflow-hidden'>
        <table className='min-w-full text-sm'>
          <thead className='sticky top-0 bg-slate-50 dark:bg-slate-900/70 backdrop-blur border-b'>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className='px-4 py-3 text-start font-semibold text-slate-600 dark:text-slate-300 cursor-pointer'
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {(
                      {
                        asc: ' 🔼',
                        desc: ' 🔽',
                      } as any
                    )[h.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className='divide-y divide-slate-100 dark:divide-white/10'>
            {table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                className={i % 2 ? 'bg-slate-50/50 dark:bg-white/5' : ''}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className='px-4 py-3 text-start text-slate-800 dark:text-slate-200'
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className='px-4 py-10 text-center text-slate-500 dark:text-slate-400'
                >
                  {t('admin.tables.none')}
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
