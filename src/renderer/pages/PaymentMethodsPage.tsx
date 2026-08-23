import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Chip } from '@heroui/react';
import { useI18n } from '../i18n';
import { DataTable } from '../components/DataTable';
import { errorLine as errLine } from '../utils/posError';
import {
  DataState,
  FilterSelect,
  PageShell,
  SearchField,
} from '../components/PageShell';

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
  enabled?: boolean | number | string; // alternative keys (future-proof)
  status?: boolean | number | string;
  sort_order: number;
};

/**
 * The backend has expressed "active" as a boolean, an integer and a string
 * across different payloads, so this stays tolerant of all three rather than
 * showing a method as disabled because it arrived as "1" instead of 1.
 */
function parseBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'enabled', 'enable', 'active'].includes(s))
    return true;
  if (
    ['0', 'false', 'no', 'n', 'off', 'disabled', 'disable', 'inactive'].includes(
      s
    )
  )
    return false;
  const n = Number(s);
  return Number.isFinite(n) ? n !== 0 : false;
}

const isEnabled = (m: PaymentMethod) =>
  parseBool(m.is_active ?? m.enabled ?? m.status ?? false);

/**
 * Whether a method is live is the single thing this page exists to tell you —
 * a cashier hunting "why can't I take KNET" needs it at a glance. The old
 * version was a thin outlined chip in slate-400, which on a busy screen read as
 * disabled-looking regardless of state.
 */
function StatusChip({ active }: { active: any }) {
  const { t } = useI18n();
  const on = parseBool(active);
  return (
    <Chip
      size='sm'
      variant='flat'
      color={on ? 'success' : 'default'}
      className='font-semibold'
    >
      {on ? t('admin.enabled') : t('admin.disabled')}
    </Chip>
  );
}

export default function PaymentMethodsPage() {
  const { t, lang } = useI18n();

  const [data, setData] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] = useState<
    'all' | 'enabled' | 'disabled'
  >('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const methods = await window.api.invoke('payments:listMethods');
      setData(methods || []);
    } catch (e) {
      // Previously this failed silently and left an empty table, which looks
      // exactly like a shop with no payment methods configured.
      setError(errLine(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (data || []).filter((m) => {
      if (activeFilter !== 'all') {
        const want = activeFilter === 'enabled';
        if (isEnabled(m) !== want) return false;
      }
      if (!qq) return true;
      const hay =
        `${m.slug}|${m.name_en}|${m.name_ar}|${m.legacy_code ?? ''}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [data, q, activeFilter]);

  const columns = useMemo<ColumnDef<PaymentMethod, any>[]>(
    () => [
      {
        accessorKey: 'slug',
        header: () => t('admin.pay.slug'),
        size: 140,
        meta: { nowrap: true },
        cell: (info) => (
          <span className='font-mono text-xs' dir='ltr'>
            {info.getValue() as string}
          </span>
        ),
      },
      {
        id: 'name_block',
        header: () => t('admin.name'),
        size: 220,
        // Sort by whichever name the operator is actually reading.
        accessorFn: (row) =>
          (lang === 'ar' ? row.name_ar || row.name_en : row.name_en || row.name_ar) ||
          '',
        cell: ({ row }) => {
          const primary =
            (lang === 'ar' ? row.original.name_ar : row.original.name_en) || '';
          const secondary =
            (lang === 'ar' ? row.original.name_en : row.original.name_ar) || '';
          return (
            <div className='leading-tight'>
              <div className='font-semibold'>{primary || secondary || '—'}</div>
              {primary && secondary && (
                <div className='text-xs text-default-700'>{secondary}</div>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'legacy_code',
        header: () => t('admin.pay.legacyCode'),
        size: 130,
        meta: { nowrap: true },
        cell: (info) => (info.getValue() as string) || '—',
      },
      {
        id: 'status',
        header: () => t('admin.active'),
        size: 110,
        enableSorting: false,
        meta: { nowrap: true },
        cell: ({ row }) => (
          <StatusChip
            active={
              row.original.is_active ??
              row.original.enabled ??
              row.original.status
            }
          />
        ),
      },
    ],
    [t, lang]
  );

  const isFiltered = !!q || activeFilter !== 'all';

  return (
    <PageShell
      title={t('admin.pay.title')}
      subtitle={t('admin.pay.subtitle')}
      count={loading || error ? undefined : filtered.length}
      onRefresh={fetchData}
      refreshing={loading}
      filters={
        <>
          <SearchField
            value={q}
            onChange={setQ}
            placeholder={t('admin.pay.searchPlaceholder')}
          />
          <FilterSelect
            label={t('admin.active')}
            value={activeFilter}
            onChange={(v) => setActiveFilter(v as any)}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'enabled', label: t('admin.enabledOnly') },
              { value: 'disabled', label: t('admin.disabledOnly') },
            ]}
          />
        </>
      }
    >
      <DataState
        loading={loading}
        error={error}
        onRetry={fetchData}
        empty={filtered.length === 0}
        emptyTitle={
          isFiltered ? t('admin.pay.noneFiltered') : t('admin.pay.none')
        }
        emptyHint={isFiltered ? t('admin.clearFiltersHint') : undefined}
      >
        <DataTable
          data={filtered}
          columns={columns}
          initialSorting={[{ id: 'legacy_code', desc: false }]}
          getRowId={(r, i) => String(r.slug ?? i)}
        />
      </DataState>
    </PageShell>
  );
}
