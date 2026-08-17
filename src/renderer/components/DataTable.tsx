// src/renderer/components/DataTable.tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Button, Select, SelectItem } from '@heroui/react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { useI18n } from '../i18n';

/**
 * The one table in the app.
 *
 * Nine pages each hand-rolled their own <table>, which is how Today's Orders
 * ended up with `table-fixed` and columns narrower than their content: cells do
 * not clip under a fixed layout, they overflow into the next column and steal
 * its clicks. A button there is unreachable while looking perfectly normal.
 *
 * Structural rules that prevent that class of bug are baked in rather than left
 * to each page:
 *   - `table-auto`, so a column can never be narrower than its content
 *   - horizontal scrolling on the wrapper, never on the page body
 *   - `min-width` per column instead of a fixed width, so content wins
 *   - logical properties throughout, so RTL mirrors without extra work
 *
 * Reading rules, because this is scanned across a counter rather than studied:
 *   - rows are tall enough to hit with a finger and to separate at a glance
 *   - every other row is tinted, which is what lets the eye track a value
 *     across a wide table without losing its line
 *   - the header is sticky, high-contrast and stays legible over scrolled rows
 *   - numbers align to the end, so magnitudes line up by digit
 *
 * No `theme` prop: every colour here is a semantic token, so both themes are
 * correct from one definition.
 */
export type DataTableProps<T> = {
  data: T[];
  columns: ColumnDef<T, any>[];
  loading?: boolean;
  /** Rendered when there are no rows and we are not loading. */
  empty?: ReactNode;
  initialSorting?: SortingState;
  pageSize?: number;
  onPageSizeChange?: (n: number) => void;
  /** Stable row key. Falls back to the row index. */
  getRowId?: (row: T, index: number) => string;
  /** Optional row click — ignored when the click originated on a control. */
  onRowClick?: (row: T) => void;
};

export function DataTable<T>({
  data,
  columns,
  loading = false,
  empty,
  initialSorting = [],
  pageSize = 25,
  onPageSizeChange,
  getRowId,
  onRowClick,
}: DataTableProps<T>) {
  const { t } = useI18n();
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [size, setSize] = useState(pageSize);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: getRowId ? (row, index) => getRowId(row as T, index) : undefined,
  });

  useEffect(() => {
    table.setPageSize(size);
  }, [size, table]);

  const rows = table.getRowModel().rows;
  const total = data.length;
  const pageCount = table.getPageCount() || 1;
  const pageIndex = table.getState().pagination.pageIndex;
  const colCount = table.getAllColumns().length;

  const pageSizes = useMemo(() => [10, 25, 50, 100], []);

  return (
    <div className='flex flex-col gap-3 min-w-0'>
      {/* The ONLY horizontal scroller. Wide tables scroll here, never the page. */}
      <div className='overflow-x-auto rounded-lg border border-default-200 bg-content1'>
        <table className='w-full table-auto border-collapse text-sm'>
          <thead className='sticky top-0 z-10 bg-default-100'>
            <tr>
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                const meta = (header.column.columnDef.meta ?? {}) as any;
                const alignEnd = meta.align === 'end';
                return (
                  <th
                    key={header.id}
                    style={{ minWidth: header.column.columnDef.size }}
                    className={`px-3 py-3 font-bold text-foreground whitespace-nowrap
                      border-b-2 border-default-300
                      ${alignEnd ? 'text-end' : 'text-start'}`}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      // The whole header is the hit target, not just the arrow.
                      <button
                        type='button'
                        onClick={header.column.getToggleSortingHandler()}
                        className={`inline-flex items-center gap-1.5 hover:text-primary transition-colors
                          ${alignEnd ? 'flex-row-reverse' : ''}`}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {dir === 'asc' ? (
                          <ChevronUp size={14} className='text-primary' />
                        ) : dir === 'desc' ? (
                          <ChevronDown size={14} className='text-primary' />
                        ) : (
                          <ChevronsUpDown
                            size={14}
                            className='text-default-400'
                          />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={colCount}
                  className='px-3 py-12 text-center text-base font-medium text-default-600'
                >
                  {t('common.loading')}
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  className='px-3 py-12 text-center text-base font-medium text-default-600'
                >
                  {empty ?? t('pos.noItems')}
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={row.id}
                  onClick={(e) => {
                    // A click on a control inside a cell is that control's, not
                    // the row's — otherwise selects and buttons fight the row.
                    const el = e.target as HTMLElement;
                    if (el.closest('button,select,input,a,label')) return;
                    onRowClick?.(row.original as T);
                  }}
                  className={`border-b border-default-200 transition-colors
                    ${i % 2 === 1 ? 'bg-default-50' : ''}
                    hover:bg-primary-50
                    ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef.meta ?? {}) as any;
                    return (
                      <td
                        key={cell.id}
                        className={`px-3 py-3 align-middle text-foreground
                          ${meta.nowrap ? 'whitespace-nowrap' : ''}
                          ${meta.align === 'end' ? 'text-end' : 'text-start'}`}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination — hidden entirely when everything already fits. */}
      {(total > size || pageCount > 1) && (
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm'>
          <div className='font-medium text-default-600'>
            {t('table.pageOf', { page: pageIndex + 1, pages: pageCount })} ·{' '}
            <span className='money'>{total}</span>
          </div>

          <div className='flex items-center gap-2 flex-wrap'>
            <Select
              size='sm'
              aria-label={t('table.rows')}
              selectedKeys={[String(size)]}
              onSelectionChange={(keys) => {
                const n = Number(Array.from(keys)[0]);
                if (!Number.isFinite(n)) return;
                setSize(n);
                onPageSizeChange?.(n);
              }}
              className='w-24'
            >
              {pageSizes.map((n) => (
                <SelectItem key={String(n)}>{String(n)}</SelectItem>
              ))}
            </Select>

            <Button
              size='sm'
              variant='flat'
              onPress={() => table.setPageIndex(0)}
              isDisabled={!table.getCanPreviousPage()}
            >
              «
            </Button>
            <Button
              size='sm'
              variant='flat'
              onPress={() => table.previousPage()}
              isDisabled={!table.getCanPreviousPage()}
            >
              ‹
            </Button>
            <Button
              size='sm'
              variant='flat'
              onPress={() => table.nextPage()}
              isDisabled={!table.getCanNextPage()}
            >
              ›
            </Button>
            <Button
              size='sm'
              variant='flat'
              onPress={() => table.setPageIndex(pageCount - 1)}
              isDisabled={!table.getCanNextPage()}
            >
              »
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
