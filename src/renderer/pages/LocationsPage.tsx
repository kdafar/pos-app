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

type StateRow = {
  id?: string | number;
  name: string;
  name_ar: string;
  is_active?: boolean | number; // may be missing if backend filters by is_active=1
};

type CityRow = {
  id?: string | number;
  name: string;
  name_ar: string;
  state_id: string | number;
  min_order: number;
  delivery_fee: number;
  is_active?: boolean | number;
};

const toBool = (v: any) => (typeof v === 'boolean' ? v : !!Number(v));
const money3 = (n?: number) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '0.000';

export default function LocationsPage() {
  // data
  const [states, setStates] = useState<StateRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(false);

  // filters — States
  const [qStates, setQStates] = useState('');
  const [stateSorting, setStateSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [statePageSize, setStatePageSize] = useState(25);

  // filters — Cities
  const [qCities, setQCities] = useState('');
  const [selectedState, setSelectedState] = useState<string | number | 'all'>(
    'all'
  );
  const [minOrder, setMinOrder] = useState<number | ''>('');
  const [maxDeliveryFee, setMaxDeliveryFee] = useState<number | ''>('');
  const [citySorting, setCitySorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [cityPageSize, setCityPageSize] = useState(25);

  const refresh = async () => {
    setLoading(true);
    try {
      const [statesData, citiesData] = await Promise.all([
        window.api.invoke('geo:listStates'),
        window.api.invoke('geo:listCities'),
      ]);
      setStates(statesData || []);
      setCities(citiesData || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const statesById = useMemo(() => {
    const m = new Map<string | number, StateRow>();
    for (const s of states) {
      if (s.id != null) m.set(s.id, s);
    }
    return m;
  }, [states]);

  // --- States filtered data
  const filteredStates = useMemo(() => {
    const q = qStates.trim().toLowerCase();
    return (states || []).filter((s) => {
      if (!q) return true;
      return `${s.name}|${s.name_ar}`.toLowerCase().includes(q);
    });
  }, [states, qStates]);

  // --- Cities filtered data
  const filteredCities = useMemo(() => {
    const q = qCities.trim().toLowerCase();
    return (cities || []).filter((c) => {
      if (selectedState !== 'all' && String(c.state_id) !== String(selectedState)) return false;
      if (minOrder !== '' && Number(c.min_order) < Number(minOrder)) return false;
      if (maxDeliveryFee !== '' && Number(c.delivery_fee) > Number(maxDeliveryFee)) return false;
      if (!q) return true;
      const stateName = statesById.get(c.state_id)?.name ?? '';
      return `${c.name}|${c.name_ar}|${stateName}`.toLowerCase().includes(q);
    });
  }, [cities, qCities, selectedState, minOrder, maxDeliveryFee, statesById]);

  // --- Columns: States
  const stateCols = useMemo<ColumnDef<StateRow>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Name (EN) <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'name_ar',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Name (AR) <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      id: 'active',
      header: 'Active',
      enableSorting: false,
      cell: ({ row }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${toBool(row.original.is_active ?? 1)
          ? 'border-emerald-400/40 text-emerald-300'
          : 'border-white/10 text-slate-300'
        }`}>
          {toBool(row.original.is_active ?? 1) ? 'Yes' : 'No'}
        </span>
      ),
    },
  ], []);

  // --- Columns: Cities
  const cityCols = useMemo<ColumnDef<CityRow>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Name (EN) <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'name_ar',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Name (AR) <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      id: 'state',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          State <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => statesById.get(row.state_id)?.name ?? String(row.state_id),
      cell: (info) => String(info.getValue() ?? ''),
    },
    {
      accessorKey: 'min_order',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Min Order <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => Number(row.min_order || 0),
      cell: (info) => money3(info.getValue() as number),
    },
    {
      accessorKey: 'delivery_fee',
      header: ({ column }) => (
        <button className="font-medium inline-flex items-center gap-1"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Delivery Fee <span className="opacity-60">↕</span>
        </button>
      ),
      accessorFn: (row) => Number(row.delivery_fee || 0),
      cell: (info) => money3(info.getValue() as number),
    },
    {
      id: 'active',
      header: 'Active',
      enableSorting: false,
      cell: ({ row }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${toBool(row.original.is_active ?? 1)
          ? 'border-emerald-400/40 text-emerald-300'
          : 'border-white/10 text-slate-300'
        }`}>
          {toBool(row.original.is_active ?? 1) ? 'Yes' : 'No'}
        </span>
      ),
    },
  ], [statesById]);

  // --- Tables
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

  useEffect(() => { statesTable.setPageSize(statePageSize); }, [statePageSize]);
  useEffect(() => { citiesTable.setPageSize(cityPageSize); }, [cityPageSize]);

  useEffect(() => { statesTable.setPageIndex(0); }, [qStates]);
  useEffect(() => { citiesTable.setPageIndex(0); }, [qCities, selectedState, minOrder, maxDeliveryFee]);

  return (
    <div className="p-4">
      <div className="flex items-end justify-between mb-4 gap-3">
        <div>
          <h1 className="text-2xl font-bold">Locations</h1>
          <div className="text-sm opacity-70">States & Cities</div>
        </div>
        <button
          className="p-2 border rounded bg-transparent disabled:opacity-50"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* STATES */}
      <section className="mb-8">
        <div className="flex flex-wrap gap-2 items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">States</h2>
          <div className="flex items-center gap-2">
            <input
              value={qStates}
              onChange={(e) => setQStates(e.target.value)}
              placeholder="Search states…"
              className="p-2 border rounded bg-transparent min-w-[220px]"
            />
            <label className="ml-3 text-sm opacity-70">Rows</label>
            <select
              className="ui-field"
              value={statePageSize}
              onChange={(e) => setStatePageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-left">
            <thead className="bg-white/5">
              {statesTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      onClick={h.column.getToggleSortingHandler()}
                      className="p-2 border-b border-white/10 cursor-pointer select-none"
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
              {statesTable.getRowModel().rows.length === 0 ? (
                <tr><td className="p-4 opacity-70" colSpan={stateCols.length}>No states found.</td></tr>
              ) : statesTable.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-white/10 hover:bg-white/5">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="opacity-70">
            Page <strong>{statesTable.getState().pagination.pageIndex + 1}</strong> of{' '}
            <strong>{statesTable.getPageCount()}</strong> •{' '}
            <span>{filteredStates.length} states</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => statesTable.setPageIndex(0)}
                    disabled={!statesTable.getCanPreviousPage()}>
              « First
            </button>
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => statesTable.previousPage()}
                    disabled={!statesTable.getCanPreviousPage()}>
              ‹ Prev
            </button>
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => statesTable.nextPage()}
                    disabled={!statesTable.getCanNextPage()}>
              Next ›
            </button>
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => statesTable.setPageIndex(statesTable.getPageCount() - 1)}
                    disabled={!statesTable.getCanNextPage()}>
              Last »
            </button>
          </div>
        </div>
      </section>

      {/* CITIES */}
      <section>
        <div className="flex flex-wrap gap-2 items-end justify-between mb-3">
          <h2 className="text-lg font-semibold">Cities</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={qCities}
              onChange={(e) => setQCities(e.target.value)}
              placeholder="Search cities/state…"
              className="p-2 border rounded bg-transparent min-w-[220px]"
            />

            <select
              className="ui-field"
              value={String(selectedState)}
              onChange={(e) =>
                setSelectedState(e.target.value === 'all' ? 'all' : e.target.value)
              }
              title="Filter by state"
            >
              <option value="all">All states</option>
              {states.map((s) => (
                <option key={String(s.id ?? s.name)} value={String(s.id ?? '')}>
                  {s.name}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={0}
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Min order ≥"
              className="p-2 border rounded bg-transparent w-[140px]"
            />
            <input
              type="number"
              min={0}
              value={maxDeliveryFee}
              onChange={(e) => setMaxDeliveryFee(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Delivery fee ≤"
              className="p-2 border rounded bg-transparent w-[160px]"
            />

            <label className="ml-3 text-sm opacity-70">Rows</label>
            <select
              className="ui-field"
              value={cityPageSize}
              onChange={(e) => setCityPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-left">
            <thead className="bg-white/5">
              {citiesTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      onClick={h.column.getToggleSortingHandler()}
                      className="p-2 border-b border-white/10 cursor-pointer select-none"
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
              {citiesTable.getRowModel().rows.length === 0 ? (
                <tr><td className="p-4 opacity-70" colSpan={cityCols.length}>No cities match your filters.</td></tr>
              ) : citiesTable.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-white/10 hover:bg-white/5">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="opacity-70">
            Page <strong>{citiesTable.getState().pagination.pageIndex + 1}</strong> of{' '}
            <strong>{citiesTable.getPageCount()}</strong> •{' '}
            <span>{filteredCities.length} cities</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => citiesTable.setPageIndex(0)}
                    disabled={!citiesTable.getCanPreviousPage()}>
              « First
            </button>
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => citiesTable.previousPage()}
                    disabled={!citiesTable.getCanPreviousPage()}>
              ‹ Prev
            </button>
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => citiesTable.nextPage()}
                    disabled={!citiesTable.getCanNextPage()}>
              Next ›
            </button>
            <button className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
                    onClick={() => citiesTable.setPageIndex(citiesTable.getPageCount() - 1)}
                    disabled={!citiesTable.getCanNextPage()}>
              Last »
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
