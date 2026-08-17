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
import { useI18n } from '../i18n';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

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

/* ========== UI helpers ========== */
const fieldCls =
  'h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-sm outline-none ' +
  'focus:ring-2 focus:ring-sky-500/40 placeholder:opacity-60';
const btnCls =
  'h-10 px-3 rounded-lg border border-white/10 text-sm hover:bg-white/10 transition ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

function parseBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'enabled', 'enable', 'active'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'disabled', 'disable', 'inactive'].includes(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) ? n !== 0 : false;
}

export default function LocationsPage() {
  const { t, name: localName, money } = useI18n();
  // data
  const [states, setStates] = useState<StateRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(false);

  // filters — States
  const [qStates, setQStates] = useState('');
  const [stateSorting, setStateSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [statePageSize, setStatePageSize] = useState(25);

  // filters — Cities
  const [qCities, setQCities] = useState('');
  const [selectedState, setSelectedState] = useState<string | number | 'all'>('all');
  const [minOrder, setMinOrder] = useState<number | ''>('');
  const [maxDeliveryFee, setMaxDeliveryFee] = useState<number | ''>('');
  const [citySorting, setCitySorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [cityPageSize, setCityPageSize] = useState(25);

  // filters — Blocks
  const [qBlocks, setQBlocks] = useState('');
  const [blockSorting, setBlockSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [blockPageSize, setBlockPageSize] = useState(25);

  const refresh = async () => {
    setLoading(true);
    try {
      const [statesData, citiesData, blocksData] = await Promise.all([
        window.api.invoke('geo:listStates'),
        window.api.invoke('geo:listCities'),
        window.api.invoke('geo:listBlocks'),
      ]);
      setStates(statesData || []);
      setCities(citiesData || []);
      setBlocks(blocksData || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

const statesById = useMemo(() => {
  const m = new Map<string, StateRow>();
  for (const s of states) {
    if (s.id != null) m.set(String(s.id), s);
  }
  return m;
}, [states]);

const citiesById = useMemo(() => {
  const m = new Map<string, CityRow>();
  for (const c of cities) if (c.id != null) m.set(String(c.id), c);
  return m;
}, [cities]);


  /* ===== filtered data ===== */
  const filteredStates = useMemo(() => {
    const q = qStates.trim().toLowerCase();
    return (states || []).filter((s) =>
      !q ? true : `${s.name}|${s.name_ar}`.toLowerCase().includes(q)
    );
  }, [states, qStates]);

  const filteredCities = useMemo(() => {
    const q = qCities.trim().toLowerCase();
    return (cities || []).filter((c) => {
      if (selectedState !== 'all' && String(c.state_id) !== String(selectedState)) return false;
      if (minOrder !== '' && Number(c.min_order) < Number(minOrder)) return false;
      if (maxDeliveryFee !== '' && Number(c.delivery_fee) > Number(maxDeliveryFee)) return false;
      if (!q) return true;
      const stateName =
  statesById.get(String(c.state_id))?.name ?? '';
      return `${c.name}|${c.name_ar}|${stateName}`.toLowerCase().includes(q);
    });
  }, [cities, qCities, selectedState, minOrder, maxDeliveryFee, statesById]);

  const filteredBlocks = useMemo(() => {
    const q = qBlocks.trim().toLowerCase();
    return (blocks || []).filter((b) => {
      // respect selectedState filter via the block's city
      if (selectedState !== 'all') {
        const city = citiesById.get(String(b.city_id));
        if (!city || String(city.state_id) !== String(selectedState)) return false;
      }
      if (!q) return true;

      const cityName = citiesById.get(String(b.city_id))?.name ?? '';
const stateName = (() => {
  const city = citiesById.get(String(b.city_id));
  if (!city) return '';
  return statesById.get(String(city.state_id))?.name ?? '';
})();
      return `${b.name}|${b.name_ar}|${cityName}|${stateName}`.toLowerCase().includes(q);
    });
  }, [blocks, qBlocks, selectedState, citiesById, statesById]);

  /* ===== columns ===== */
  const stateCols = useMemo<ColumnDef<StateRow>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.nameEn')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'name_ar',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.nameAr')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      id: 'active',
      header: () => t('admin.active'),
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${
            parseBool(row.original.is_active ?? 1)
              ? 'border-emerald-400/40 text-emerald-300'
              : 'border-white/10 text-slate-300'
          }`}
        >
          {parseBool(row.original.is_active ?? 1) ? t('admin.yes') : t('admin.no')}
        </span>
      ),
    },
  ], [t]);

  const cityCols = useMemo<ColumnDef<CityRow>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.nameEn')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'name_ar',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.nameAr')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      id: 'state',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.loc.state')} <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => {
        const st = statesById.get(String(row.state_id));
        return st ? localName(st) : String(row.state_id);
      },
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'min_order',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.loc.minOrder')} <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => Number(row.min_order || 0),
      cell: (info) => <span className="money">{money(info.getValue() as number)}</span>,
    },
    {
      accessorKey: 'delivery_fee',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.loc.deliveryFee')} <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => Number(row.delivery_fee || 0),
      cell: (info) => <span className="money">{money(info.getValue() as number)}</span>,
    },
    {
      id: 'active',
      header: () => t('admin.active'),
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${
            parseBool(row.original.is_active ?? 1)
              ? 'border-emerald-400/40 text-emerald-300'
              : 'border-white/10 text-slate-300'
          }`}
        >
          {parseBool(row.original.is_active ?? 1) ? t('admin.yes') : t('admin.no')}
        </span>
      ),
    },
  ], [statesById, t, money, localName]);

  const blockCols = useMemo<ColumnDef<BlockRow>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.nameEn')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'name_ar',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.nameAr')} <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      id: 'city',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.loc.city')} <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => {
        const city = citiesById.get(row.city_id);
        return city ? localName(city) : String(row.city_id);
      },
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      id: 'state',
      header: ({ column }) => (
        <button
          className="font-medium inline-flex items-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          {t('admin.loc.state')} <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => {
        const city = citiesById.get(row.city_id);
        if (!city) return '';
        const st = statesById.get(city.state_id);
        return st ? localName(st) : '';
      },
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      id: 'active',
      header: () => t('admin.active'),
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${
            parseBool(row.original.is_active ?? 1)
              ? 'border-emerald-400/40 text-emerald-300'
              : 'border-white/10 text-slate-300'
          }`}
        >
          {parseBool(row.original.is_active ?? 1) ? t('admin.yes') : t('admin.no')}
        </span>
      ),
    },
  ], [citiesById, statesById, t, localName]);

  /* ===== tables ===== */
  const statesTable = useReactTable({
    data: filteredStates,
    columns: stateCols,
    state: { sorting: stateSorting },
    onSortingChange: setStateSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: statePageSize } },
  });

  const citiesTable = useReactTable({
    data: filteredCities,
    columns: cityCols,
    state: { sorting: citySorting },
    onSortingChange: setCitySorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: cityPageSize } },
  });

  const blocksTable = useReactTable({
    data: filteredBlocks,
    columns: blockCols,
    state: { sorting: blockSorting },
    onSortingChange: setBlockSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: blockPageSize } },
  });

  useEffect(() => {
    statesTable.setPageSize(statePageSize);
  }, [statePageSize]);

  useEffect(() => {
    citiesTable.setPageSize(cityPageSize);
  }, [cityPageSize]);

  useEffect(() => {
    blocksTable.setPageSize(blockPageSize);
  }, [blockPageSize]);

  useEffect(() => {
    statesTable.setPageIndex(0);
  }, [qStates]);

  useEffect(() => {
    citiesTable.setPageIndex(0);
  }, [qCities, selectedState, minOrder, maxDeliveryFee]);

  useEffect(() => {
    blocksTable.setPageIndex(0);
  }, [qBlocks, selectedState]);

  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* Header + Refresh */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.loc.title')}</h1>
          <div className="text-sm font-medium text-default-600">{t('admin.loc.subtitle')}</div>
        </div>
        <button className={btnCls} onClick={refresh} disabled={loading}>
          {loading ? t('admin.refreshing') : t('admin.refresh')}
        </button>
      </div>

      {/* STATES */}
      <section className="mb-8">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-lg font-semibold">{t('admin.loc.states')}</h2>

          <div className="w-full sm:w-auto grid grid-cols-1 sm:grid-cols-[minmax(220px,360px)_auto] gap-2">
            <input
              value={qStates}
              onChange={(e) => setQStates(e.target.value)}
              placeholder={t('admin.loc.searchStates')}
              className={fieldCls + ' w-full'}
            />
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-default-600">{t('admin.rows')}</label>
              <select
                className={fieldCls}
                value={statePageSize}
                onChange={(e) => setStatePageSize(Number(e.target.value))}
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

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-start table-fixed">
            <thead className="bg-white/5 sticky top-0 z-10">
              {statesTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="p-2 border-b border-white/10 text-start select-none"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {({ asc: ' 🔼', desc: ' 🔽' } as any)[h.column.getIsSorted() as string] ?? null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {statesTable.getRowModel().rows.length === 0 ? (
                <tr>
                  <td className="p-6 opacity-70 text-center" colSpan={stateCols.length}>
                    {t('admin.loc.noStates')}
                  </td>
                </tr>
              ) : (
                statesTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/10 hover:bg-white/5">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 text-start">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
          <div className="text-default-600">
            {t('admin.pageOf', {
              page: statesTable.getState().pagination.pageIndex + 1,
              pages: statesTable.getPageCount(),
            })}{' '}
            • <span>{t('admin.loc.statesCount', { n: filteredStates.length })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={btnCls}
              onClick={() => statesTable.setPageIndex(0)}
              disabled={!statesTable.getCanPreviousPage()}
            >
              {t('admin.first')}
            </button>
            <button
              className={btnCls}
              onClick={() => statesTable.previousPage()}
              disabled={!statesTable.getCanPreviousPage()}
            >
              {t('admin.prev')}
            </button>
            <button
              className={btnCls}
              onClick={() => statesTable.nextPage()}
              disabled={!statesTable.getCanNextPage()}
            >
              {t('admin.next')}
            </button>
            <button
              className={btnCls}
              onClick={() => statesTable.setPageIndex(statesTable.getPageCount() - 1)}
              disabled={!statesTable.getCanNextPage()}
            >
              {t('admin.last')}
            </button>
          </div>
        </div>
      </section>

      {/* CITIES */}
      <section className="mb-8">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="text-lg font-semibold">{t('admin.loc.cities')}</h2>

          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,360px)_180px_140px_160px_auto] gap-2">
            <input
              value={qCities}
              onChange={(e) => setQCities(e.target.value)}
              placeholder={t('admin.loc.searchCities')}
              className={fieldCls + ' w-full'}
            />

            <select
              className={fieldCls}
              value={String(selectedState)}
              onChange={(e) =>
                setSelectedState(e.target.value === 'all' ? 'all' : e.target.value)
              }
              title={t('admin.loc.filterByState')}
            >
              <option value="all">{t('admin.loc.allStates')}</option>
              {states.map((s) => (
                <option key={String(s.id ?? s.name)} value={String(s.id ?? '')}>
                  {localName(s)}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={0}
              value={minOrder}
              onChange={(e) =>
                setMinOrder(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder={t('admin.loc.minOrderFilter')}
              className={fieldCls + ' w-full'}
            />
            <input
              type="number"
              min={0}
              value={maxDeliveryFee}
              onChange={(e) =>
                setMaxDeliveryFee(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder={t('admin.loc.deliveryFeeFilter')}
              className={fieldCls + ' w-full'}
            />

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-default-600">{t('admin.rows')}</label>
              <select
                className={fieldCls}
                value={cityPageSize}
                onChange={(e) => setCityPageSize(Number(e.target.value))}
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

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-start table-fixed">
            <thead className="bg-white/5 sticky top-0 z-10">
              {citiesTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="p-2 border-b border-white/10 text-start select-none"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {({ asc: ' 🔼', desc: ' 🔽' } as any)[h.column.getIsSorted() as string] ??
                        null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {citiesTable.getRowModel().rows.length === 0 ? (
                <tr>
                  <td className="p-6 opacity-70 text-center" colSpan={cityCols.length}>
                    {t('admin.loc.noCities')}
                  </td>
                </tr>
              ) : (
                citiesTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/10 hover:bg-white/5">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 text-start">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
          <div className="text-default-600">
            {t('admin.pageOf', {
              page: citiesTable.getState().pagination.pageIndex + 1,
              pages: citiesTable.getPageCount(),
            })}{' '}
            • <span>{t('admin.loc.citiesCount', { n: filteredCities.length })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={btnCls}
              onClick={() => citiesTable.setPageIndex(0)}
              disabled={!citiesTable.getCanPreviousPage()}
            >
              {t('admin.first')}
            </button>
            <button
              className={btnCls}
              onClick={() => citiesTable.previousPage()}
              disabled={!citiesTable.getCanPreviousPage()}
            >
              {t('admin.prev')}
            </button>
            <button
              className={btnCls}
              onClick={() => citiesTable.nextPage()}
              disabled={!citiesTable.getCanNextPage()}
            >
              {t('admin.next')}
            </button>
            <button
              className={btnCls}
              onClick={() => citiesTable.setPageIndex(citiesTable.getPageCount() - 1)}
              disabled={!citiesTable.getCanNextPage()}
            >
              {t('admin.last')}
            </button>
          </div>
        </div>
      </section>

      {/* BLOCKS */}
      <section>
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="text-lg font-semibold">{t('admin.loc.blocks')}</h2>

          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,360px)_auto_auto] gap-2">
            <input
              value={qBlocks}
              onChange={(e) => setQBlocks(e.target.value)}
              placeholder={t('admin.loc.searchBlocks')}
              className={fieldCls + ' w-full'}
            />

            {/* Reuse selectedState filter for blocks as well */}
            <select
              className={fieldCls}
              value={String(selectedState)}
              onChange={(e) =>
                setSelectedState(e.target.value === 'all' ? 'all' : e.target.value)
              }
              title={t('admin.loc.filterBlocksByState')}
            >
              <option value="all">{t('admin.loc.allStates')}</option>
              {states.map((s) => (
                <option key={String(s.id ?? s.name)} value={String(s.id ?? '')}>
                  {localName(s)}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-default-600">{t('admin.rows')}</label>
              <select
                className={fieldCls}
                value={blockPageSize}
                onChange={(e) => setBlockPageSize(Number(e.target.value))}
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

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-start table-fixed">
            <thead className="bg-white/5 sticky top-0 z-10">
              {blocksTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="p-2 border-b border-white/10 text-start select-none"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {({ asc: ' 🔼', desc: ' 🔽' } as any)[h.column.getIsSorted() as string] ??
                        null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {blocksTable.getRowModel().rows.length === 0 ? (
                <tr>
                  <td className="p-6 opacity-70 text-center" colSpan={blockCols.length}>
                    {t('admin.loc.noBlocks')}
                  </td>
                </tr>
              ) : (
                blocksTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/10 hover:bg-white/5">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 text-start">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
          <div className="text-default-600">
            {t('admin.pageOf', {
              page: blocksTable.getState().pagination.pageIndex + 1,
              pages: blocksTable.getPageCount(),
            })}{' '}
            • <span>{t('admin.loc.blocksCount', { n: filteredBlocks.length })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={btnCls}
              onClick={() => blocksTable.setPageIndex(0)}
              disabled={!blocksTable.getCanPreviousPage()}
            >
              {t('admin.first')}
            </button>
            <button
              className={btnCls}
              onClick={() => blocksTable.previousPage()}
              disabled={!blocksTable.getCanPreviousPage()}
            >
              {t('admin.prev')}
            </button>
            <button
              className={btnCls}
              onClick={() => blocksTable.nextPage()}
              disabled={!blocksTable.getCanNextPage()}
            >
              {t('admin.next')}
            </button>
            <button
              className={btnCls}
              onClick={() =>
                blocksTable.setPageIndex(blocksTable.getPageCount() - 1)
              }
              disabled={!blocksTable.getCanNextPage()}
            >
              {t('admin.last')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
