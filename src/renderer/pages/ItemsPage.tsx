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
import { Input, Button } from '@heroui/react';
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface Item {
  id: string;
  name: string;
  name_ar: string;
  barcode: string;
  price: number;
  is_outofstock: boolean;
}

export function ItemsPage() {
  const { items, q, actions } = useStore();

  useEffect(() => {
    actions.refreshItems();
  }, []);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageSize, setPageSize] = useState<number>(25);

  const columns = useMemo<ColumnDef<Item>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Name <ArrowUpDown className="inline h-4 w-4 opacity-60" />
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
        >
          Arabic Name <ArrowUpDown className="inline h-4 w-4 opacity-60" />
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'barcode',
      header: 'Barcode',
      cell: (info) => info.getValue() as string,
      enableSorting: false,
    },
    {
      accessorKey: 'price',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Price <ArrowUpDown className="inline h-4 w-4 opacity-60" />
        </button>
      ),
      cell: (info) => {
        const v = info.getValue() as number;
        return v?.toFixed(3);
      },
      sortingFn: 'alphanumeric',
    },
    {
      accessorKey: 'is_outofstock',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Stock <ArrowUpDown className="inline h-4 w-4 opacity-60" />
        </button>
      ),
      cell: (info) => ((info.getValue() as boolean) ? 'Out of Stock' : 'In Stock'),
      sortingFn: (rowA, rowB, id) => {
        // In-stock first (false < true)
        const a = rowA.getValue<boolean>(id) ? 1 : 0;
        const b = rowB.getValue<boolean>(id) ? 1 : 0;
        return a - b;
      },
    },
  ], []);

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageIndex: 0, pageSize },
    },
  });

  // keep pageSize state in sync with table
  useEffect(() => {
    table.setPageSize(pageSize);
  }, [pageSize]);

  return (
    <div style={{ margin: '24px' }}>
      {/* Toolbar */}
      <div className="flex items-end justify-between mb-5">
        <h3 className="text-xl font-semibold">Items</h3>
        <div className="flex items-center gap-3">
          <Input
            aria-label="Search"
            placeholder="Search items..."
            value={q}
            onChange={(e) => actions.setQ(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter') && actions.refreshItems()}
            style={{ minWidth: 300 }}
          />
          <Button onClick={() => actions.refreshItems()}>Search</Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-white/5">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="p-3 border-b border-white/10">
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
                <td colSpan={columns.length} className="p-6 text-center text-sm opacity-70">
                  No data
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-white/5">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-3 border-b border-white/10">
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
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-sm opacity-70">
          Page <strong>{table.getState().pagination.pageIndex + 1}</strong> of{' '}
          <strong>{table.getPageCount()}</strong> •{' '}
          <span>{items.length} items</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Rows per page</label>
          <select
            className="ui-field"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {[10, 25, 50, 100].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <Button
            isIconOnly
            onPress={() => table.setPageIndex(0)}
            isDisabled={!table.getCanPreviousPage()}
            aria-label="First page"
          >
            <ChevronsLeft size={16} />
          </Button>
          <Button
            isIconOnly
            onPress={() => table.previousPage()}
            isDisabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            isIconOnly
            onPress={() => table.nextPage()}
            isDisabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            isIconOnly
            onPress={() => table.setPageIndex(table.getPageCount() - 1)}
            isDisabled={!table.getCanNextPage()}
            aria-label="Last page"
          >
            <ChevronsRight size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
