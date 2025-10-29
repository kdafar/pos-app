import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../src/store';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';

// Types
interface Addon {
  id: string;
  group_id: string;
  name: string;
  name_ar: string;
  price: number;
}
interface AddonGroup {
  id: string;
  name: string;
  name_ar: string;
  is_required?: number | boolean;
  max_select?: number | null;
  addons_count?: number;
}

export function AddonsPage() {
  const { addonGroups = [], addons = [], actions } = useStore();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageSize, setPageSize] = useState<number>(25);

  // search
  const [q, setQ] = useState('');

  // initial load: groups + (all addons)
  useEffect(() => {
    actions.fetchInitialData(); // should load groups
  }, []);

  // load addons whenever group changes (null => all)
  useEffect(() => {
    actions.fetchAddons(selectedGroupId ?? null);
  }, [selectedGroupId]);

  // helpers
  const norm = (s: any) => String(s ?? '').toLowerCase();

  // client-side search filter
  const filteredAddons = useMemo(() => {
    if (!q.trim()) return addons;
    const qq = norm(q);
    return addons.filter(
      (a: Addon) => norm(a.name).includes(qq) || norm(a.name_ar).includes(qq)
    );
  }, [addons, q]);

  // column defs
  const columns = useMemo<ColumnDef<Addon>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Name
          <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'name_ar',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Arabic Name
          <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'price',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Price
          <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => {
        const v = Number(info.getValue() as number);
        return Number.isFinite(v) ? v.toFixed(3) : '0.000';
      },
      sortingFn: 'alphanumeric',
    },
    {
      accessorKey: 'group_id',
      header: 'Group',
      cell: (info) => {
        const gid = String(info.getValue() ?? '');
        const g = (addonGroups as AddonGroup[]).find((x) => String(x.id) === gid);
        return g ? `${g.name} / ${g.name_ar}` : gid;
      },
      enableSorting: false,
    },
  ], [addonGroups]);

  const table = useReactTable({
    data: filteredAddons as Addon[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  useEffect(() => {
    table.setPageSize(pageSize);
  }, [pageSize]);

  // reset page when search changes
  useEffect(() => {
    table.setPageIndex(0);
  }, [q, selectedGroupId]);

  return (
    <div style={{ margin: '24px', display: 'grid', gridTemplateColumns: '280px 1fr', gap: '24px' }}>
      {/* LEFT: groups */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Addon Groups</h3>
          <button
            className="text-sm px-2 py-1 rounded border border-white/10 hover:bg-white/5"
            onClick={() => setSelectedGroupId(null)}
            title="Show all addons"
          >
            Show All
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {addonGroups.map((group: AddonGroup) => {
            const isActive = selectedGroupId === group.id;
            return (
              <button
                key={group.id}
                className={`p-3 rounded-lg text-left border border-white/10 transition ${
                  isActive ? 'bg-blue-500/15 border-blue-500/30' : 'hover:bg-white/5'
                }`}
                onClick={() => setSelectedGroupId(String(group.id))}
              >
                <div className="font-medium">{group.name}</div>
                <div className="text-xs opacity-70">{group.name_ar}</div>
                <div className="mt-1 flex items-center gap-2 text-xs opacity-70">
                  {group.is_required ? <span>Required</span> : <span>Optional</span>}
                  {Number(group.max_select) > 0 && (
                    <span>• Max {group.max_select}</span>
                  )}
                  {Number(group.addons_count) >= 0 && (
                    <span>• {group.addons_count} items</span>
                  )}
                </div>
              </button>
            );
          })}
          {addonGroups.length === 0 && (
            <div className="text-sm opacity-70">No groups.</div>
          )}
        </div>
      </div>

      {/* RIGHT: addons table */}
      <div>
        <div className="flex items-end justify-between mb-4">
          <h3 className="text-lg font-semibold">
            {selectedGroupId ? 'Addons (Filtered)' : 'Addons (All)'}
          </h3>
          <div className="flex items-center gap-2">
            <input
              className="px-3 py-2 rounded-lg border border-white/10 bg-transparent"
              placeholder="Search addons (EN/AR)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <label className="text-sm opacity-70">Rows</label>
            <select
              className="px-2 py-2 rounded-lg border border-white/10 bg-transparent"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="p-2 border-b border-white/10">
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td className="p-4 opacity-70" colSpan={columns.length}>
                    No addons found.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 border-b border-white/10">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="opacity-70">
            Page <strong>{table.getState().pagination.pageIndex + 1}</strong> of{' '}
            <strong>{table.getPageCount()}</strong> •{' '}
            <span>{filteredAddons.length} addons</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              « First
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              ‹ Prev
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next ›
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 disabled:opacity-50"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              Last »
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
