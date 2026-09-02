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

type Promo = {
  code: string;
  type: 'percent' | 'percentage' | 'amount' | string;
  value: number;
  min_total: number | null;
  max_discount: number | null;
  start_at: string | null;
  end_at: string | null;
  active?: boolean | number | string; // may be many shapes
  enabled?: boolean | number | string; // alt keys we might receive
  is_active?: boolean | number | string;
  status?: boolean | number | string; // sometimes used as a toggle
};

/**
 * "Enabled" has arrived as a boolean, an integer and a string across payloads,
 * so this stays tolerant rather than showing a live promo as switched off
 * because it came through as "1" instead of 1.
 */
function parseBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
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

function isEnabled(p: Promo): boolean {
  return parseBool(p.active ?? p.enabled ?? p.is_active ?? p.status);
}

/** Arabic month names, Latin digits — Kuwait never prints Arabic-Indic numerals. */
const fmtDate = (s: string | null, lang: 'en' | 'ar' = 'en') => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isPercent = (type: Promo['type']) =>
  type === 'percent' || type === 'percentage';

type WindowState = 'active-now' | 'upcoming' | 'expired';

const timeWindowState = (p: Promo): WindowState => {
  const now = Date.now();
  const start = p.start_at ? new Date(p.start_at).getTime() : -Infinity;
  const end = p.end_at ? new Date(p.end_at).getTime() : Infinity;
  if (now < start) return 'upcoming';
  if (now > end) return 'expired';
  return 'active-now';
};

/**
 * A promocode only works if it is enabled *and* inside its window, so both
 * facts collapse into one badge. Reading them from separate columns is how
 * "the code doesn't work" becomes a support call about a code that is switched
 * on but does not start until next week.
 */
function StatusBadge({ promo }: { promo: Promo }) {
  const { t } = useI18n();
  const enabled = isEnabled(promo);
  const windowState = timeWindowState(promo);

  const { label, color } = !enabled
    ? { label: t('admin.disabled'), color: 'default' as const }
    : windowState === 'active-now'
    ? { label: t('admin.promos.statusActive'), color: 'success' as const }
    : windowState === 'upcoming'
    ? { label: t('admin.promos.upcoming'), color: 'warning' as const }
    : { label: t('admin.promos.expired'), color: 'danger' as const };

  return (
    <Chip size='sm' variant='solid' color={color} className='font-semibold'>
      {label}
    </Chip>
  );
}

export default function PromosPage() {
  const { t, money, lang } = useI18n();

  const [data, setData] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(25);

  const [q, setQ] = useState('');
  const [enabledFilter, setEnabledFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('any');
  const [typeFilter, setTypeFilter] = useState('all');

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const promos = await window.api.invoke('catalog:listPromos');
      setData(promos || []);
    } catch (e) {
      // Was swallowed, leaving an empty table indistinguishable from a shop
      // that simply has no promocodes configured.
      setError(errLine(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromos();
  }, [fetchPromos]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    // The filter value and the model's own name differ for one case, so map
    // rather than compare strings that only mostly line up.
    const wantedWindow: Record<string, WindowState> = {
      active: 'active-now',
      upcoming: 'upcoming',
      expired: 'expired',
    };

    return (data || []).filter((p) => {
      if (enabledFilter !== 'all') {
        if (isEnabled(p) !== (enabledFilter === 'enabled')) return false;
      }
      if (typeFilter !== 'all') {
        if (typeFilter === 'percent' && !isPercent(p.type)) return false;
        if (typeFilter === 'amount' && isPercent(p.type)) return false;
      }
      if (timeFilter !== 'any') {
        if (timeWindowState(p) !== wantedWindow[timeFilter]) return false;
      }
      if (!qq) return true;
      const hay =
        `${p.code}|${p.type}|${p.value}|${p.min_total}|${p.max_discount}|${p.start_at}|${p.end_at}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [data, q, enabledFilter, timeFilter, typeFilter]);

  const columns = useMemo<ColumnDef<Promo, any>[]>(
    () => [
      {
        accessorKey: 'code',
        header: () => t('admin.promos.code'),
        size: 140,
        meta: { nowrap: true },
        cell: (info) => (
          // The code is what a cashier types, so it anchors the row.
          <span className='font-mono font-semibold' dir='ltr'>
            {info.getValue() as string}
          </span>
        ),
      },
      {
        id: 'display_type',
        header: () => t('admin.type'),
        size: 110,
        meta: { nowrap: true },
        accessorFn: (row) => (isPercent(row.type) ? 'Percent' : 'Amount'),
        cell: (info) =>
          info.getValue() === 'Percent'
            ? t('admin.promos.percent')
            : t('admin.promos.amount'),
      },
      {
        id: 'display_value',
        header: () => t('admin.promos.value'),
        size: 100,
        meta: { align: 'end', nowrap: true },
        // Sort on the number, not the formatted string, or "9%" outranks "10%".
        accessorFn: (row) => Number(row.value) || 0,
        cell: ({ row }) => (
          <span className='money font-semibold'>
            {isPercent(row.original.type)
              ? `${Number(row.original.value) || 0}%`
              : money(row.original.value)}
          </span>
        ),
      },
      {
        accessorKey: 'min_total',
        header: () => t('admin.promos.minTotal'),
        size: 120,
        meta: { align: 'end', nowrap: true },
        cell: (info) => (
          <span className='money'>{money(info.getValue() as number)}</span>
        ),
      },
      {
        accessorKey: 'max_discount',
        header: () => t('admin.promos.maxDiscount'),
        size: 130,
        meta: { align: 'end', nowrap: true },
        cell: (info) =>
          info.getValue() == null ? (
            '—'
          ) : (
            <span className='money'>{money(info.getValue() as number)}</span>
          ),
      },
      {
        accessorKey: 'start_at',
        header: () => t('admin.promos.starts'),
        size: 160,
        meta: { nowrap: true },
        cell: (i) => (
          <span className='money'>
            {fmtDate(i.getValue() as string | null, lang)}
          </span>
        ),
      },
      {
        accessorKey: 'end_at',
        header: () => t('admin.promos.ends'),
        size: 160,
        meta: { nowrap: true },
        cell: (i) => (
          <span className='money'>
            {fmtDate(i.getValue() as string | null, lang)}
          </span>
        ),
      },
      {
        id: 'effective_status',
        header: () => t('admin.status'),
        size: 120,
        enableSorting: false,
        meta: { nowrap: true },
        cell: ({ row }) => <StatusBadge promo={row.original} />,
      },
    ],
    [t, money, lang]
  );

  const isFiltered =
    !!q ||
    enabledFilter !== 'all' ||
    timeFilter !== 'any' ||
    typeFilter !== 'all';

  return (
    <PageShell
      title={t('admin.promos.title')}
      subtitle={t('admin.promos.subtitle')}
      count={loading || error ? undefined : filtered.length}
      onRefresh={fetchPromos}
      refreshing={loading}
      filters={
        <>
          <SearchField
            value={q}
            onChange={setQ}
            placeholder={t('admin.promos.searchPlaceholder')}
          />
          <FilterSelect
            label={t('admin.status')}
            value={enabledFilter}
            onChange={setEnabledFilter}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'enabled', label: t('admin.enabledOnly') },
              { value: 'disabled', label: t('admin.disabledOnly') },
            ]}
          />
          <FilterSelect
            label={t('admin.promos.starts')}
            value={timeFilter}
            onChange={setTimeFilter}
            options={[
              { value: 'any', label: t('admin.promos.anyTime') },
              { value: 'active', label: t('admin.promos.activeNow') },
              { value: 'upcoming', label: t('admin.promos.upcoming') },
              { value: 'expired', label: t('admin.promos.expired') },
            ]}
          />
          <FilterSelect
            label={t('admin.type')}
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: t('admin.promos.allTypes') },
              { value: 'percent', label: t('admin.promos.percent') },
              { value: 'amount', label: t('admin.promos.amount') },
            ]}
          />
        </>
      }
    >
      <DataState
        loading={loading}
        error={error}
        onRetry={fetchPromos}
        empty={filtered.length === 0}
        emptyTitle={t('admin.promos.none')}
        emptyHint={isFiltered ? t('admin.clearFiltersHint') : undefined}
      >
        <DataTable
          data={filtered}
          columns={columns}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          initialSorting={[{ id: 'code', desc: false }]}
          getRowId={(r, i) => String(r.code ?? i)}
        />
      </DataState>
    </PageShell>
  );
}
