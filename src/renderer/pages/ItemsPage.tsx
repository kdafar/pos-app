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
import { useI18n } from '../i18n';

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
  const { t, money, isRTL } = useI18n();

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
          {t('admin.nameEn')} <ArrowUpDown className="inline h-4 w-4 opacity-60" />
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
          {t('admin.nameAr')} <ArrowUpDown className="inline h-4 w-4 opacity-60" />
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'barcode',
      header: () => t('admin.items.colBarcode'),
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
          {t('admin.items.colPrice')} <ArrowUpDown className="inline h-4 w-4 opacity-60" />
        </button>
      ),
      cell: (info) => {
        const v = info.getValue() as number;
        return <span className="money">{money(v)}</span>;
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
          {t('admin.items.colStock')} <ArrowUpDown className="inline h-4 w-4 opacity-60" />
        </button>
      ),
      cell: (info) =>
        (info.getValue() as boolean)
          ? t('admin.items.outOfStock')
          : t('admin.items.inStock'),
      sortingFn: (rowA, rowB, id) => {
        // In-stock first (false < true)
        const a = rowA.getValue<boolean>(id) ? 1 : 0;
        const b = rowB.getValue<boolean>(id) ? 1 : 0;
        return a - b;
      },
    },
  ], [t, money]);

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
        <h3 className="text-xl font-semibold">{t('admin.items.title')}</h3>
        <div className="flex items-center gap-3">
          <Input
            aria-label={t('common.search')}
            placeholder={t('admin.items.searchPlaceholder')}
            value={q}
            onChange={(e) => actions.setQ(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter') && actions.refreshItems()}
            style={{ minWidth: 300 }}
          />
          <Button onClick={() => actions.refreshItems()}>{t('common.search')}</Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-default-200 overflow-hidden">
        <table className="w-full text-start">
          <thead className="bg-default-100">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="p-3 border-b border-default-200 text-start">
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
                <td colSpan={columns.length} className="p-6 text-center text-sm font-medium text-default-600">
                  {t('admin.noData')}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-default-100">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-3 border-b border-default-200 text-start">
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
        <div className="text-sm font-medium text-default-600">
          {t('admin.pageOf', {
            page: table.getState().pagination.pageIndex + 1,
            pages: table.getPageCount(),
          })}{' '}
          • <span>{t('admin.items.count', { n: items.length })}</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-default-600">{t('admin.rowsPerPage')}</label>
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
            aria-label={t('admin.firstPage')}
          >
            {isRTL ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </Button>
          <Button
            isIconOnly
            onPress={() => table.previousPage()}
            isDisabled={!table.getCanPreviousPage()}
            aria-label={t('admin.prevPage')}
          >
            {isRTL ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
          <Button
            isIconOnly
            onPress={() => table.nextPage()}
            isDisabled={!table.getCanNextPage()}
            aria-label={t('admin.nextPage')}
          >
            {isRTL ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </Button>
          <Button
            isIconOnly
            onPress={() => table.setPageIndex(table.getPageCount() - 1)}
            isDisabled={!table.getCanNextPage()}
            aria-label={t('admin.lastPage')}
          >
            {isRTL ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
