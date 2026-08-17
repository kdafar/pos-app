import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, Chip } from '@heroui/react';
import { Eraser } from 'lucide-react';

import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { useToast } from '../components/ToastProvider';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n';
import { DataTable } from '../components/DataTable';
import {
  DataState,
  FilterSelect,
  PageShell,
  SearchField,
} from '../components/PageShell';

type TableStatus = 'available' | 'occupied' | 'reserved';

type TableRow = {
  id: string | number;
  number: number;
  label: string;
  capacity: number;
  status: TableStatus;
  branch_id: number;
  current_order_id?: string | number | null; // needed for clearTable
};

/* ---------- normalisation ----------
   The tables endpoint has shipped several shapes over time, so every field is
   derived defensively rather than read directly. */
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

const deriveStatus = (t: any): TableStatus => {
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

const normalize = (t: any, index: number): TableRow => ({
  // Math.random() previously stood in for a missing id, which changes on every
  // render — React keys and row identity both depend on this being stable.
  id: t.id ?? t.table_id ?? t.uuid ?? `row-${index}`,
  number: deriveNumber(t),
  label: String(t.label ?? t.name ?? `Table ${deriveNumber(t) || ''}`).trim(),
  capacity: toInt(t.capacity ?? t.seats ?? t.covers ?? 0),
  status: deriveStatus(t),
  branch_id: toInt(t.branch_id ?? t.location_id ?? 0),
  current_order_id:
    t.current_order_id ?? t.order_id ?? t.orderId ?? t.currentOrderId ?? null,
});

/** One map so the filter and the badge can never drift apart. */
const STATUS_KEY: Record<TableStatus, StringKey> = {
  available: 'admin.tables.available',
  occupied: 'admin.tables.occupied',
  reserved: 'admin.tables.reserved',
};

const STATUS_COLOR: Record<TableStatus, 'success' | 'warning' | 'danger'> = {
  available: 'success',
  reserved: 'warning',
  occupied: 'danger',
};

export default function TablesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirmDialog();

  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [filterQ, setFilterQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await window.api.invoke('tables:list'); // read-only pull
      setRows((raw ?? []).map(normalize));
    } catch (e) {
      // Was a console.error plus an empty list, which reads as "this branch has
      // no tables" — a very different thing from "the list failed to load".
      setError(e instanceof Error ? e.message : String(e ?? ''));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Only admins get the clear action.
  useEffect(() => {
    (async () => {
      try {
        const status = await window.api.invoke('auth:status');
        const role =
          status?.current_user?.role ??
          status?.user?.role ??
          status?.role ??
          status?.current_user?.user_type;
        const slug = String(role || '').toLowerCase();
        if (['admin', 'owner', 'super_admin', 'superadmin', 's'].includes(slug))
          setIsAdmin(true);
      } catch (e) {
        console.warn('auth:status failed, tables stay read-only', e);
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

  const handleClearTable = useCallback(
    async (row: TableRow) => {
      if (!isAdmin) return;

      const ok = await confirm({
        title: t('admin.tables.clearTitle', { label: row.label }),
        message: (
          <div className='space-y-1 text-sm'>
            <p>{t('admin.tables.clearBody')}</p>
            <p className='text-xs text-default-700'>
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
          order_id: row.current_order_id ?? null,
        });
      } catch (e) {
        console.error('orders:clearTable failed', e);
        toast({
          tone: 'danger',
          title: t('admin.tables.clearFailed'),
          // The actual reason, rather than a generic "contact support" — the
          // person reading this is usually the one who can fix it.
          message:
            (e instanceof Error ? e.message : String(e ?? '')) ||
            t('admin.supportHint'),
        });
        return;
      }
      await load();
    },
    [isAdmin, confirm, t, toast, load]
  );

  const columns = useMemo<ColumnDef<TableRow, any>[]>(() => {
    const base: ColumnDef<TableRow, any>[] = [
      {
        accessorKey: 'number',
        header: () => t('admin.tables.number'),
        size: 90,
        meta: { align: 'end', nowrap: true },
        cell: (info) => (
          <span className='money font-semibold'>{String(info.getValue())}</span>
        ),
      },
      {
        accessorKey: 'label',
        header: () => t('admin.tables.label'),
        size: 180,
        cell: (info) => (
          <span className='font-semibold'>{String(info.getValue() ?? '')}</span>
        ),
      },
      {
        accessorKey: 'capacity',
        header: () => t('admin.tables.capacity'),
        size: 110,
        meta: { align: 'end', nowrap: true },
        cell: (info) => <span className='money'>{String(info.getValue())}</span>,
      },
      {
        accessorKey: 'status',
        header: () => t('admin.status'),
        size: 130,
        meta: { nowrap: true },
        cell: (info) => {
          const s = info.getValue() as TableStatus;
          return (
            <Chip
              size='sm'
              variant='flat'
              color={STATUS_COLOR[s] ?? 'default'}
              className='font-semibold'
            >
              {t(STATUS_KEY[s] ?? 'admin.tables.occupied')}
            </Chip>
          );
        },
      },
      {
        accessorKey: 'branch_id',
        header: () => t('admin.tables.branchId'),
        size: 110,
        meta: { align: 'end', nowrap: true },
        cell: (info) => <span className='money'>{String(info.getValue())}</span>,
      },
    ];

    if (!isAdmin) return base;

    return [
      ...base,
      {
        id: 'actions',
        header: () => t('admin.actions'),
        size: 130,
        enableSorting: false,
        meta: { nowrap: true },
        cell: ({ row }) =>
          // An available table has nothing to clear.
          row.original.status === 'available' ? null : (
            <Button
              size='sm'
              color='danger'
              variant='flat'
              startContent={<Eraser size={15} />}
              onPress={() => handleClearTable(row.original)}
            >
              {t('admin.tables.clear')}
            </Button>
          ),
      },
    ];
  }, [isAdmin, t, handleClearTable]);

  const isFiltered = !!filterQ || statusFilter !== 'all';

  return (
    <PageShell
      title={t('admin.tables.title')}
      count={loading || error ? undefined : filtered.length}
      onRefresh={load}
      refreshing={loading}
      filters={
        <>
          <SearchField
            value={filterQ}
            onChange={setFilterQ}
            placeholder={t('admin.tables.searchPlaceholder')}
          />
          <FilterSelect
            label={t('admin.status')}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'available', label: t('admin.tables.available') },
              { value: 'occupied', label: t('admin.tables.occupied') },
              { value: 'reserved', label: t('admin.tables.reserved') },
            ]}
          />
        </>
      }
    >
      <DataState
        loading={loading}
        error={error}
        onRetry={load}
        empty={filtered.length === 0}
        emptyTitle={t('admin.tables.none')}
        emptyHint={isFiltered ? t('admin.clearFiltersHint') : undefined}
      >
        <DataTable
          data={filtered}
          columns={columns}
          initialSorting={[{ id: 'number', desc: false }]}
          getRowId={(r, i) => String(r.id ?? i)}
        />
      </DataState>
    </PageShell>
  );
}
