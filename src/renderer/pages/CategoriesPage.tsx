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
import { useI18n } from '../i18n';

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
  const { t, name: localName } = useI18n();
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
    { accessorKey: 'position', header: () => '#', cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name',     header: () => t('admin.nameEn'), cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name_ar',  header: () => t('admin.nameAr'), cell: (info) => String(info.getValue() ?? '') },
    {
      accessorKey: 'visible',
      header: () => t('admin.cats.visible'),
      cell: (info) => (toBool(info.getValue()) ? '✅' : '—'),
    },
  ], [t]);

  const catTable = useReactTable({
    data: filteredCats,
    columns: catColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  // ------- Subcategories table -------
  const subsColumns = useMemo<ColumnDef<Subcategory>[]>(() => [
    { accessorKey: 'position', header: () => '#', cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name',     header: () => t('admin.nameEn'), cell: (info) => String(info.getValue() ?? '') },
    { accessorKey: 'name_ar',  header: () => t('admin.nameAr'), cell: (info) => String(info.getValue() ?? '') },
    {
      accessorKey: 'visible',
      header: () => t('admin.cats.visible'),
      cell: (info) => (toBool(info.getValue()) ? '✅' : '—'),
    },
    {
      accessorKey: 'category_id',
      header: () => t('admin.subs.category'),
      cell: (info) => {
        const id = String(info.getValue() ?? '');
        const c = (cats ?? []).find((x) => String(x.id) === id);
        return c ? `${c.name} / ${c.name_ar}` : id;
      },
      enableSorting: false,
    },
  ], [cats, t]);

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
          <h3 className="text-lg font-semibold">{t('admin.cats.title')}</h3>
          <span className="muted">{t('admin.readOnly')}</span>
        </div>

        {/* Categories search & filter */}
        <div className="flex items-center gap-3 mb-3">
          <input
            className="px-3 py-2 rounded-lg border border-default-200 bg-transparent"
            placeholder={t('admin.cats.searchPlaceholder')}
            value={catSearch}
            onChange={(e) => setCatSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <select
            className="ui-field"
            value={catVisFilter}
            onChange={(e) => setCatVisFilter(e.target.value as any)}
          >
            <option value="all">{t('common.all')}</option>
            <option value="visible">{t('admin.cats.visibleOnly')}</option>
            <option value="hidden">{t('admin.cats.hiddenOnly')}</option>
          </select>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-700/60">
          <table className="w-full text-start text-sm">
            <thead className="bg-slate-900/40">
              {catTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="p-2 border-b border-slate-700/60 text-start">
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
                      isSelected ? 'bg-blue-500/10' : 'hover:bg-default-100'
                    }`}
                    onClick={() => setSelectedCatId(String(row.original.id))}
                    title={t('admin.cats.clickHint')}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 text-start">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {filteredCats.length === 0 && (
                <tr>
                  <td className="p-3 muted" colSpan={catColumns.length}>
                    {t('admin.cats.none')}
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
              ? <>{t('admin.cats.selected')}:&nbsp;<strong>{localName(selectedCat)}</strong></>
              : <span className="text-default-600">{t('admin.cats.noneSelected')}</span>}
          </div>
          <button
            type="button"
            onClick={() => setSelectedCatId(null)}
            className="px-3 py-1.5 rounded-lg border border-default-200 hover:bg-default-100 text-sm"
          >
            {t('admin.cats.showAllSubs')}
          </button>
        </div>
      </div>

      {/* Subcategories */}
      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">
            {t('admin.subs.title')}{' '}
            {selectedCat ? `— ${localName(selectedCat)}` : t('admin.subs.all')}
          </h3>
          <div className="flex items-center gap-3 text-sm">
            {/* Subcategories search & filter */}
            <input
              className="px-3 py-2 rounded-lg border border-default-200 bg-transparent"
              placeholder={t('admin.subs.searchPlaceholder')}
              value={subsSearch}
              onChange={(e) => setSubsSearch(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <select
              className="ui-field"
              value={subsVisFilter}
              onChange={(e) => setSubsVisFilter(e.target.value as any)}
            >
              <option value="all">{t('common.all')}</option>
              <option value="visible">{t('admin.cats.visibleOnly')}</option>
              <option value="hidden">{t('admin.cats.hiddenOnly')}</option>
            </select>

            <label className="opacity-70 ms-4">{t('admin.rows')}</label>
            <select
              className="ui-field"
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
          <table className="w-full text-start text-sm">
            <thead className="bg-slate-900/40">
              {subsTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="p-2 border-b border-slate-700/60 text-start">
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
                    {t('admin.subs.none')}
                  </td>
                </tr>
              ) : (
                subsTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800/60 hover:bg-default-100">
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

        {/* Simple pagination controls */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="text-default-600">
            {t('admin.pageOf', {
              page: subsTable.getState().pagination.pageIndex + 1,
              pages: subsTable.getPageCount(),
            })}{' '}
            • <span>{t('admin.subs.count', { n: filteredSubcats.length })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded border border-default-200 disabled:opacity-50"
              onClick={() => subsTable.setPageIndex(0)}
              disabled={!subsTable.getCanPreviousPage()}
            >
              {t('admin.first')}
            </button>
            <button
              className="px-2 py-1 rounded border border-default-200 disabled:opacity-50"
              onClick={() => subsTable.previousPage()}
              disabled={!subsTable.getCanPreviousPage()}
            >
              {t('admin.prev')}
            </button>
            <button
              className="px-2 py-1 rounded border border-default-200 disabled:opacity-50"
              onClick={() => subsTable.nextPage()}
              disabled={!subsTable.getCanNextPage()}
            >
              {t('admin.next')}
            </button>
            <button
              className="px-2 py-1 rounded border border-default-200 disabled:opacity-50"
              onClick={() => subsTable.setPageIndex(subsTable.getPageCount() - 1)}
              disabled={!subsTable.getCanNextPage()}
            >
              {t('admin.last')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
