import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../src/store'; // adjust if your path differs
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';

type Category = {
  id: string | number;
  position: number;
  name: string;
  name_ar: string;
  visible: boolean | number;
};

type Subcategory = {
  id: string | number;
  category_id: string | number;
  position: number;
  name: string;
  name_ar: string;
  visible: boolean | number;
};

// (Only if you don't already have this global declaration)
declare global {
  interface Window {
    api?: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

export function CategoriesPage() {
  const cats = useStore((s) => s.cats) as Category[] | undefined;
  const fetchInitialData = useStore((s) => s.actions.fetchInitialData);

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [subcats, setSubcats] = useState<Subcategory[]>([]);

  // search + filter state
  const [catSearch, setCatSearch] = useState('');
  const [catVisFilter, setCatVisFilter] = useState<'all' | 'visible' | 'hidden'>('all');

  const [subsSearch, setSubsSearch] = useState('');
  const [subsVisFilter, setSubsVisFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [subsSorting, setSubsSorting] = useState<SortingState>([]);
  const [subsPageSize, setSubsPageSize] = useState<number>(25);

  // Initial load (categories + any other data your store fetches)
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Load subcategories when the selected category changes
  useEffect(() => {
    const load = async () => {
      try {
        const res: Subcategory[] =
          (await window.api?.invoke(
            'catalog:listSubcategories',
            selectedCatId || null
          )) || [];
        setSubcats(res);
      } catch (e) {
        console.error('Failed to load subcategories', e);
        setSubcats([]);
      }
    };
    load();
  }, [selectedCatId]);

  // helpers
  const norm = (s: any) => String(s ?? '').toLowerCase();

  const toBool = (v: any) => {
    if (typeof v === 'boolean') return v;
    const n = Number(v);
    return !!n;
  };

  // ------- Filtered datasets -------
  const filteredCats = useMemo(() => {
    let arr = (cats ?? []).slice();
    if (catSearch.trim()) {
      const q = norm(catSearch);
      arr = arr.filter(
        (c) => norm(c.name).includes(q) || norm(c.name_ar).includes(q)
      );
    }
    if (catVisFilter !== 'all') {
      const want = catVisFilter === 'visible';
      arr = arr.filter((c) => toBool(c.visible) === want);
    }
    // sort by position then name for UX
    arr.sort((a, b) =>
      a.position === b.position
        ? norm(a.name).localeCompare(norm(b.name))
        : a.position - b.position
    );
    return arr;
  }, [cats, catSearch, catVisFilter]);

  const filteredSubcats = useMemo(() => {
    let arr = subcats.slice();
    if (subsSearch.trim()) {
      const q = norm(subsSearch);
      arr = arr.filter(
        (s) => norm(s.name).includes(q) || norm(s.name_ar).includes(q)
      );
    }
    if (subsVisFilter !== 'all') {
      const want = subsVisFilter === 'visible';
      arr = arr.filter((s) => toBool(s.visible) === want);
    }
    // basic natural ordering first; TanStack sorting still applies afterwards
    arr.sort((a, b) =>
      a.position === b.position
        ? norm(a.name).localeCompare(norm(b.name))
        : a.position - b.position
    );
    return arr;
  }, [subcats, subsSearch, subsVisFilter]);

  // ------- Categories table -------
  const catColumns = useMemo<ColumnDef<Category>[]>(() => [
    { accessorKey: 'position', header: '#', cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name',     header: 'Name (EN)', cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name_ar',  header: 'Name (AR)', cell: (info) => String(info.getValue() ?? '') },
    {
      accessorKey: 'visible',
      header: 'Visible',
      cell: (info) => (toBool(info.getValue()) ? '✅' : '—'),
    },
  ], []);

  const catTable = useReactTable({
    data: filteredCats,
    columns: catColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  // ------- Subcategories table -------
  const subsColumns = useMemo<ColumnDef<Subcategory>[]>(() => [
    { accessorKey: 'position', header: '#', cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name',     header: 'Name (EN)', cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name_ar',  header: 'Name (AR)', cell: (info) => String(info.getValue() ?? '') },
    {
      accessorKey: 'visible',
      header: 'Visible',
      cell: (info) => (toBool(info.getValue()) ? '✅' : '—'),
    },
    {
      accessorKey: 'category_id',
      header: 'Category',
      cell: (info) => {
        const id = String(info.getValue() ?? '');
        const c = (cats ?? []).find((x) => String(x.id) === id);
        return c ? `${c.name} / ${c.name_ar}` : id;
      },
      enableSorting: false,
    },
  ], [cats]);

  const subsTable = useReactTable({
    data: filteredSubcats,
    columns: subsColumns,
    state: { sorting: subsSorting },
    onSortingChange: setSubsSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: subsPageSize } },
  });

  useEffect(() => {
    subsTable.setPageSize(subsPageSize);
  }, [subsPageSize]);

  // Reset subcat page when filters/search/selectedCat change
  useEffect(() => {
    subsTable.setPageIndex(0);
  }, [subsSearch, subsVisFilter, selectedCatId]);

  const selectedCat =
    selectedCatId && cats ? cats.find((c) => String(c.id) === String(selectedCatId)) : null;

  return (
    <div style={{ margin: 24 }}>
      {/* Categories */}
      <div className="card" style={{ marginBottom: 24, padding: 24 }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Categories</h3>
          <span className="muted">Read-only</span>
        </div>

        {/* Categories search & filter */}
        <div className="flex items-center gap-3 mb-3">
          <input
            className="px-3 py-2 rounded-lg border border-white/10 bg-transparent"
            placeholder="Search categories (EN/AR)…"
            value={catSearch}
            onChange={(e) => setCatSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <select
            className="px-2 py-2 rounded-lg border border-white/10 bg-transparent"
            value={catVisFilter}
            onChange={(e) => setCatVisFilter(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="visible">Visible only</option>
            <option value="hidden">Hidden only</option>
          </select>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-700/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/40">
              {catTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="p-2 border-b border-slate-700/60">
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {catTable.getRowModel().rows.map((row) => {
                const isSelected = String(selectedCatId) === String(row.original.id);
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-800/60 cursor-pointer ${
                      isSelected ? 'bg-blue-500/10' : 'hover:bg-white/5'
                    }`}
                    onClick={() => setSelectedCatId(String(row.original.id))}
                    title="Click to view subcategories"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {filteredCats.length === 0 && (
                <tr>
                  <td className="p-3 muted" colSpan={catColumns.length}>
                    No categories match your search/filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Controls */}
        <div className="mt-3 flex items-center gap-8">
          <div className="text-sm">
            {selectedCat
              ? <>Selected:&nbsp;<strong>{selectedCat.name}</strong>&nbsp;(&nbsp;{selectedCat.name_ar}&nbsp;)</>
              : <span className="opacity-70">No category selected</span>}
          </div>
          <button
            type="button"
            onClick={() => setSelectedCatId(null)}
            className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-sm"
          >
            Show all subcategories
          </button>
        </div>
      </div>

      {/* Subcategories */}
      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">
            Subcategories {selectedCat ? `— ${selectedCat.name}` : '(All)'}
          </h3>
          <div className="flex items-center gap-3 text-sm">
            {/* Subcategories search & filter */}
            <input
              className="px-3 py-2 rounded-lg border border-white/10 bg-transparent"
              placeholder="Search subcategories (EN/AR)…"
              value={subsSearch}
              onChange={(e) => setSubsSearch(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <select
              className="px-2 py-2 rounded-lg border border-white/10 bg-transparent"
              value={subsVisFilter}
              onChange={(e) => setSubsVisFilter(e.target.value as any)}
            >
              <option value="all">All</option>
              <option value="visible">Visible only</option>
              <option value="hidden">Hidden only</option>
            </select>

            <label className="opacity-70 ml-4">Rows</label>
            <select
              className="px-2 py-2 rounded-lg border border-white/10 bg-transparent"
              value={subsPageSize}
              onChange={(e) => setSubsPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-700/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/40">
              {subsTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="p-2 border-b border-slate-700/60">
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {subsTable.getRowModel().rows.length === 0 ? (
                <tr>
                  <td className="p-3 muted" colSpan={subsColumns.length}>
                    No subcategories match your search/filters.
                  </td>
                </tr>
              ) : (
                subsTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800/60 hover:bg-white/5">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Simple pagination controls */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="opacity-70">
            Page <strong>{subsTable.getState().pagination.pageIndex + 1}</strong> of{' '}
            <strong>{subsTable.getPageCount()}</strong> •{' '}
            <span>{filteredSubcats.length} subcategories</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => subsTable.setPageIndex(0)}
              disabled={!subsTable.getCanPreviousPage()}
            >
              « First
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => subsTable.previousPage()}
              disabled={!subsTable.getCanPreviousPage()}
            >
              ‹ Prev
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => subsTable.nextPage()}
              disabled={!subsTable.getCanNextPage()}
            >
              Next ›
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => subsTable.setPageIndex(subsTable.getPageCount() - 1)}
              disabled={!subsTable.getCanNextPage()}
            >
              Last »
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
