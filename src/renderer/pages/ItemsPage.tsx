import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../src/store';
import type { ColumnDef } from '@tanstack/react-table';
import { Chip } from '@heroui/react';
import { useI18n } from '../i18n';
import { DataTable } from '../components/DataTable';
import {
  DataState,
  FilterSelect,
  PageShell,
  SearchField,
} from '../components/PageShell';
import { ItemDetailPanel } from './ItemDetailPanel';

interface Item {
  id: string;
  name: string;
  name_ar: string;
  barcode: string;
  price: number;
  is_outofstock: boolean;
  has_addons?: number | boolean;
  has_variations?: number | boolean;
  min_variation_price?: number | null;
}

export function ItemsPage() {
  const { items, actions } = useStore();
  const { t, money } = useI18n();

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [pageSize, setPageSize] = useState(25);

  const load = async () => {
    setLoading(true);
    try {
      await actions.refreshItems();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (items as unknown as Item[]).filter((it) => {
      if (stockFilter !== 'all') {
        const out = !!it.is_outofstock;
        if (stockFilter === 'out' ? !out : out) return false;
      }
      if (!qq) return true;
      return `${it.name}|${it.name_ar}|${it.barcode}`.toLowerCase().includes(qq);
    });
  }, [items, q, stockFilter]);

  const columns = useMemo<ColumnDef<Item, any>[]>(
    () => [
      {
        accessorKey: 'name',
        header: () => t('admin.nameEn'),
        size: 220,
        cell: (info) => (
          <span className='font-semibold'>{String(info.getValue() ?? '')}</span>
        ),
      },
      {
        accessorKey: 'name_ar',
        header: () => t('admin.nameAr'),
        size: 200,
        cell: (info) => String(info.getValue() ?? ''),
      },
      {
        accessorKey: 'barcode',
        header: () => t('admin.items.colBarcode'),
        size: 150,
        enableSorting: false,
        meta: { nowrap: true },
        cell: (info) => (
          <span className='font-mono text-xs' dir='ltr'>
            {String(info.getValue() ?? '') || '—'}
          </span>
        ),
      },
      {
        id: 'options',
        header: () => t('pos.options'),
        size: 150,
        enableSorting: false,
        meta: { nowrap: true },
        // Which items carry sizes or add-ons is exactly what the separate
        // Add-ons page existed to answer. As a column it answers it for every
        // item at once, rather than one selection at a time.
        cell: ({ row }) => {
          const v = !!row.original.has_variations;
          const a = !!row.original.has_addons;
          if (!v && !a) return <span className='text-default-700'>—</span>;
          return (
            <div className='flex items-center gap-1'>
              {v && (
                <Chip
                  size='sm'
                  variant='solid'
                  color='warning'
                  className='font-semibold'
                >
                  {t('pos.sizes')}
                </Chip>
              )}
              {a && (
                <Chip
                  size='sm'
                  variant='solid'
                  color='secondary'
                  className='font-semibold'
                >
                  {t('pos.addons')}
                </Chip>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'price',
        header: () => t('admin.items.colPrice'),
        size: 130,
        meta: { align: 'end', nowrap: true },
        cell: ({ row }) => {
          // An item priced by its sizes has no single price of its own, so it
          // shows the cheapest as a "from" rather than a bare 0.000 — which is
          // what the POS grid already does, and what the customer is quoted.
          const hasVar = !!row.original.has_variations;
          const min = Number(row.original.min_variation_price ?? 0);
          const base = Number(row.original.price ?? 0);
          const show = hasVar && min > 0 ? min : base;
          return (
            <span className='font-semibold whitespace-nowrap'>
              {hasVar && min > 0 && (
                <span className='text-default-700 font-normal me-1 text-xs'>
                  {t('pos.from')}
                </span>
              )}
              <span className='money'>{money(show)}</span>
            </span>
          );
        },
      },
      {
        accessorKey: 'is_outofstock',
        header: () => t('admin.items.colStock'),
        size: 130,
        meta: { nowrap: true },
        cell: (info) => {
          const out = !!info.getValue();
          return (
            <Chip
              size='sm'
              variant='solid'
              color={out ? 'danger' : 'success'}
              className='font-semibold'
            >
              {out ? t('admin.items.outOfStock') : t('admin.items.inStock')}
            </Chip>
          );
        },
        sortingFn: (a, b, id) =>
          (a.getValue<boolean>(id) ? 1 : 0) - (b.getValue<boolean>(id) ? 1 : 0),
      },
    ],
    [t, money]
  );

  const isFiltered = !!q || stockFilter !== 'all';

  return (
    <PageShell
      title={t('nav.items')}
      count={loading ? undefined : filtered.length}
      onRefresh={load}
      refreshing={loading}
      filters={
        <>
          <SearchField
            value={q}
            onChange={setQ}
            placeholder={t('pos.searchPlaceholder')}
          />
          <FilterSelect
            label={t('admin.items.colStock')}
            value={stockFilter}
            onChange={setStockFilter}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'in', label: t('admin.items.inStock') },
              { value: 'out', label: t('admin.items.outOfStock') },
            ]}
          />
        </>
      }
    >
      <DataState
        loading={loading}
        empty={filtered.length === 0}
        emptyTitle={t('pos.noItems')}
        emptyHint={isFiltered ? t('admin.clearFiltersHint') : undefined}
      >
        <DataTable
          data={filtered}
          columns={columns}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          initialSorting={[{ id: 'name', desc: false }]}
          getRowId={(r, i) => String(r.id ?? i)}
          expandLabel={t('admin.items.showOptions')}
          renderExpanded={(row) => (
            <ItemDetailPanel
              itemId={String(row.id)}
              hasVariations={!!row.has_variations}
              hasAddons={!!row.has_addons}
            />
          )}
        />
      </DataState>
    </PageShell>
  );
}
