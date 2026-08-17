import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Chip } from '@heroui/react';
import { ChevronRight, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { DataTable } from '../components/DataTable';
import { DataState, PageShell, SearchField } from '../components/PageShell';

type StateRow = {
  id?: string | number;
  name: string;
  name_ar: string;
  is_active?: boolean | number | string;
};

type CityRow = {
  id?: string | number;
  name: string;
  name_ar: string;
  state_id: string | number;
  min_order: number;
  delivery_fee: number;
  is_active?: boolean | number | string;
};

type BlockRow = {
  id?: string | number;
  name: string;
  name_ar: string;
  city_id: string | number;
  is_active?: boolean | number | string;
};

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

function ActiveChip({ value }: { value: any }) {
  const { t } = useI18n();
  const on = parseBool(value);
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

/** A section heading that states what it is filtered by, and lets you clear it. */
function SectionHeading({
  title,
  filterLabel,
  onClearFilter,
  clearTitle,
}: {
  title: string;
  filterLabel?: string | null;
  onClearFilter?: () => void;
  clearTitle: string;
}) {
  return (
    <h2 className='text-lg font-bold text-foreground flex items-center gap-2 min-w-0'>
      <span className='truncate'>{title}</span>
      {filterLabel && (
        <Chip
          color='primary'
          variant='flat'
          className='font-semibold'
          endContent={
            <button
              type='button'
              onClick={onClearFilter}
              aria-label={clearTitle}
              title={clearTitle}
              className='ms-0.5'
            >
              <X size={14} />
            </button>
          }
        >
          {filterLabel}
        </Chip>
      )}
    </h2>
  );
}

export default function LocationsPage() {
  const { t, name: localName, money } = useI18n();

  const [states, setStates] = useState<StateRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qStates, setQStates] = useState('');
  const [qCities, setQCities] = useState('');
  const [qBlocks, setQBlocks] = useState('');

  // Geography is a hierarchy, so the page reads as one: picking a state narrows
  // the cities, picking a city narrows the blocks. Previously the state filter
  // was a dropdown repeated in two places and blocks could not be narrowed to a
  // city at all — with hundreds of blocks that made the third table unusable.
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statesData, citiesData, blocksData] = await Promise.all([
        // Admin is the one caller that wants disabled areas: a disabled area
        // is exactly what someone is looking for when they ask why an address
        // cannot be selected on the till.
        window.api.invoke('geo:listStates', { includeInactive: true }),
        window.api.invoke('geo:listCities', { includeInactive: true }),
        window.api.invoke('geo:listBlocks', { includeInactive: true }),
      ]);
      setStates(statesData || []);
      setCities(citiesData || []);
      setBlocks(blocksData || []);
    } catch (e) {
      // Was swallowed: three empty tables look like a branch with no delivery
      // areas configured, which is a very different problem to report.
      setError(e instanceof Error ? e.message : String(e ?? ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statesById = useMemo(() => {
    const m = new Map<string, StateRow>();
    for (const s of states) if (s.id != null) m.set(String(s.id), s);
    return m;
  }, [states]);

  const citiesById = useMemo(() => {
    const m = new Map<string, CityRow>();
    for (const c of cities) if (c.id != null) m.set(String(c.id), c);
    return m;
  }, [cities]);

  const filteredStates = useMemo(() => {
    const q = qStates.trim().toLowerCase();
    return (states || []).filter((s) =>
      !q ? true : `${s.name}|${s.name_ar}`.toLowerCase().includes(q)
    );
  }, [states, qStates]);

  const filteredCities = useMemo(() => {
    const q = qCities.trim().toLowerCase();
    return (cities || []).filter((c) => {
      if (selectedState && String(c.state_id) !== selectedState) return false;
      if (!q) return true;
      const stateName = statesById.get(String(c.state_id))?.name ?? '';
      return `${c.name}|${c.name_ar}|${stateName}`.toLowerCase().includes(q);
    });
  }, [cities, qCities, selectedState, statesById]);

  const filteredBlocks = useMemo(() => {
    const q = qBlocks.trim().toLowerCase();
    return (blocks || []).filter((b) => {
      if (selectedCity && String(b.city_id) !== selectedCity) return false;
      if (selectedState) {
        const city = citiesById.get(String(b.city_id));
        if (!city || String(city.state_id) !== selectedState) return false;
      }
      if (!q) return true;
      const city = citiesById.get(String(b.city_id));
      const cityName = city?.name ?? '';
      const stateName = city
        ? statesById.get(String(city.state_id))?.name ?? ''
        : '';
      return `${b.name}|${b.name_ar}|${cityName}|${stateName}`
        .toLowerCase()
        .includes(q);
    });
  }, [blocks, qBlocks, selectedState, selectedCity, citiesById, statesById]);

  const nameCols = <T extends { name: string; name_ar: string }>() =>
    [
      {
        accessorKey: 'name',
        header: () => t('admin.nameEn'),
        size: 180,
        cell: (info: any) => (
          <span className='font-semibold'>{String(info.getValue() ?? '')}</span>
        ),
      },
      {
        accessorKey: 'name_ar',
        header: () => t('admin.nameAr'),
        size: 180,
        cell: (info: any) => String(info.getValue() ?? ''),
      },
    ] as ColumnDef<T, any>[];

  const stateCols = useMemo<ColumnDef<StateRow, any>[]>(
    () => [
      ...nameCols<StateRow>(),
      {
        id: 'cityCount',
        header: () => t('admin.loc.cities'),
        size: 100,
        enableSorting: false,
        meta: { align: 'end', nowrap: true },
        // A state with no cities cannot be delivered to; that is worth seeing
        // from the list rather than by selecting it and finding it empty.
        cell: ({ row }) => {
          const n = cities.filter(
            (c) => String(c.state_id) === String(row.original.id)
          ).length;
          return (
            <span
              className={`money font-semibold ${
                n === 0 ? 'text-warning' : ''
              }`}
            >
              {n}
            </span>
          );
        },
      },
      {
        id: 'active',
        header: () => t('admin.active'),
        size: 110,
        enableSorting: false,
        meta: { nowrap: true },
        cell: ({ row }) => <ActiveChip value={row.original.is_active} />,
      },
    ],
    [t, cities]
  );

  const cityCols = useMemo<ColumnDef<CityRow, any>[]>(
    () => [
      ...nameCols<CityRow>(),
      {
        id: 'state',
        header: () => t('admin.loc.state'),
        size: 150,
        accessorFn: (row) => statesById.get(String(row.state_id))?.name ?? '',
        cell: ({ row }) => {
          const s = statesById.get(String(row.original.state_id));
          return s ? localName(s) : '—';
        },
      },
      {
        accessorKey: 'min_order',
        header: () => t('admin.loc.minOrder'),
        size: 120,
        meta: { align: 'end', nowrap: true },
        cell: (info) => (
          <span className='money'>{money(info.getValue() as number)}</span>
        ),
      },
      {
        accessorKey: 'delivery_fee',
        header: () => t('admin.loc.deliveryFee'),
        size: 130,
        meta: { align: 'end', nowrap: true },
        // This is the number the till charges when no manual fee is set, so it
        // is the one column on this page an order actually depends on.
        cell: (info) => (
          <span className='money font-semibold'>
            {money(info.getValue() as number)}
          </span>
        ),
      },
      {
        id: 'active',
        header: () => t('admin.active'),
        size: 110,
        enableSorting: false,
        meta: { nowrap: true },
        cell: ({ row }) => <ActiveChip value={row.original.is_active} />,
      },
    ],
    [t, money, statesById, localName]
  );

  const blockCols = useMemo<ColumnDef<BlockRow, any>[]>(
    () => [
      ...nameCols<BlockRow>(),
      {
        id: 'city',
        header: () => t('admin.loc.city'),
        size: 150,
        accessorFn: (row) => citiesById.get(String(row.city_id))?.name ?? '',
        cell: ({ row }) => {
          const c = citiesById.get(String(row.original.city_id));
          return c ? localName(c) : '—';
        },
      },
      {
        id: 'active',
        header: () => t('admin.active'),
        size: 110,
        enableSorting: false,
        meta: { nowrap: true },
        cell: ({ row }) => <ActiveChip value={row.original.is_active} />,
      },
    ],
    [t, citiesById, localName]
  );

  const selectedStateRow = selectedState
    ? statesById.get(selectedState)
    : null;
  const selectedCityRow = selectedCity ? citiesById.get(selectedCity) : null;

  return (
    <PageShell
      title={t('admin.loc.title')}
      subtitle={t('admin.loc.subtitle')}
      onRefresh={refresh}
      refreshing={loading}
    >
      <DataState loading={loading} error={error} onRetry={refresh}>
        <div className='space-y-6'>
          {/* Breadcrumb of the current drill-down, so the two filters below are
              never a mystery. */}
          {(selectedStateRow || selectedCityRow) && (
            <div className='flex items-center gap-1.5 text-sm font-medium text-default-700 flex-wrap'>
              <button
                type='button'
                onClick={() => {
                  setSelectedState(null);
                  setSelectedCity(null);
                }}
                className='hover:text-primary transition-colors'
              >
                {t('admin.loc.allStates')}
              </button>
              {selectedStateRow && (
                <>
                  <ChevronRight size={14} className='rtl:-scale-x-100' />
                  <button
                    type='button'
                    onClick={() => setSelectedCity(null)}
                    className='text-foreground font-semibold hover:text-primary transition-colors'
                  >
                    {localName(selectedStateRow)}
                  </button>
                </>
              )}
              {selectedCityRow && (
                <>
                  <ChevronRight size={14} className='rtl:-scale-x-100' />
                  <span className='text-foreground font-semibold'>
                    {localName(selectedCityRow)}
                  </span>
                </>
              )}
            </div>
          )}

          {/* States */}
          <section className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <SectionHeading
                title={t('admin.loc.states')}
                clearTitle={t('admin.loc.allStates')}
              />
              <SearchField
                value={qStates}
                onChange={setQStates}
                placeholder={t('admin.loc.searchStates')}
              />
            </div>
            <DataState
              empty={filteredStates.length === 0}
              emptyTitle={t('admin.loc.noStates')}
            >
              <DataTable
                data={filteredStates}
                columns={stateCols}
                initialSorting={[{ id: 'name', desc: false }]}
                getRowId={(r, i) => String(r.id ?? i)}
                selectedRowId={selectedState}
                onRowClick={(row) => {
                  const id = String(row.id);
                  setSelectedState((prev) => (prev === id ? null : id));
                  setSelectedCity(null); // a city under the old state is meaningless
                }}
              />
            </DataState>
          </section>

          {/* Cities */}
          <section className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <SectionHeading
                title={t('admin.loc.cities')}
                filterLabel={
                  selectedStateRow ? localName(selectedStateRow) : null
                }
                onClearFilter={() => {
                  setSelectedState(null);
                  setSelectedCity(null);
                }}
                clearTitle={t('admin.loc.allStates')}
              />
              <SearchField
                value={qCities}
                onChange={setQCities}
                placeholder={t('admin.loc.searchCities')}
              />
            </div>
            <DataState
              empty={filteredCities.length === 0}
              emptyTitle={t('admin.loc.noCities')}
            >
              <DataTable
                data={filteredCities}
                columns={cityCols}
                initialSorting={[{ id: 'name', desc: false }]}
                getRowId={(r, i) => String(r.id ?? i)}
                selectedRowId={selectedCity}
                onRowClick={(row) => {
                  const id = String(row.id);
                  setSelectedCity((prev) => (prev === id ? null : id));
                }}
              />
            </DataState>
          </section>

          {/* Blocks */}
          <section className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <SectionHeading
                title={t('admin.loc.blocks')}
                filterLabel={
                  selectedCityRow
                    ? localName(selectedCityRow)
                    : selectedStateRow
                    ? localName(selectedStateRow)
                    : null
                }
                onClearFilter={() => setSelectedCity(null)}
                clearTitle={t('admin.loc.allStates')}
              />
              <SearchField
                value={qBlocks}
                onChange={setQBlocks}
                placeholder={t('admin.loc.searchBlocks')}
              />
            </div>
            <DataState
              empty={filteredBlocks.length === 0}
              emptyTitle={t('admin.loc.noBlocks')}
            >
              <DataTable
                data={filteredBlocks}
                columns={blockCols}
                initialSorting={[{ id: 'name', desc: false }]}
                getRowId={(r, i) => String(r.id ?? i)}
              />
            </DataState>
          </section>
        </div>
      </DataState>
    </PageShell>
  );
}
