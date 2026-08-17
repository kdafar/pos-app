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
import { useI18n } from '../i18n';

/**
 * The one table in the app.
 *
 * Nine pages each hand-rolled their own <table>, which is how Today's Orders
 * ended up with `table-fixed` and columns narrower than their content: cells do
 * not clip under a fixed layout, they overflow into the next column and steal
 * its clicks. A button there is unreachable while looking perfectly normal.
 *
 * The rules that prevent that class of bug are baked in here rather than left
 * to each page:
 *   - `table-auto`, so a column can never be narrower than its content
 *   - horizontal scrolling on the wrapper, never on the page body
 *   - `min-width` per column instead of a fixed width, so content wins
 *   - row actions pinned to the end and non-shrinking
 *   - logical properties throughout, so RTL mirrors without extra work
 */
export type DataTableProps<T> = {
  data: T[];
  columns: ColumnDef<T, any>[];
  theme?: 'light' | 'dark';
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
  theme = 'light',
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

  const dark = theme === 'dark';
  const border = 'border-default-200';
  const headBg = dark ? 'bg-slate-800/90' : 'bg-gray-50';
  const rowHover = 'hover:bg-default-100';
  const muted = 'text-default-500';
  const ctl = `h-9 px-3 rounded-lg border text-sm transition disabled:opacity-40
    disabled:cursor-not-allowed ${
      'bg-default-100 border-default-200 hover:bg-default-200 text-foreground'
    }`;

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: getRowId
      ? (row, index) => getRowId(row as T, index)
      : undefined,
  });

  useEffect(() => {
    table.setPageSize(size);
  }, [size, table]);

  const rows = table.getRowModel().rows;
  const total = data.length;
  const pageCount = table.getPageCount() || 1;
  const pageIndex = table.getState().pagination.pageIndex;

  const pageSizes = useMemo(() => [10, 25, 50, 100], []);

  return (
    <div className='flex flex-col gap-3 min-w-0'>
      {/* The ONLY horizontal scroller. Wide tables scroll here, never the page. */}
      <div className={`overflow-x-auto rounded-xl border ${border}`}>
        <table className='w-full table-auto border-collapse text-sm'>
          <thead className={`${headBg} sticky top-0 z-10`}>
            <tr>
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                const meta = (header.column.columnDef.meta ?? {}) as any;
                return (
                  <th
                    key={header.id}
                    style={{ minWidth: header.column.columnDef.size }}
                    className={`px-3 py-2.5 text-start font-medium border-b ${border}
                      whitespace-nowrap ${meta.align === 'end' ? 'text-end' : ''}`}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type='button'
                        onClick={header.column.getToggleSortingHandler()}
                        className='inline-flex items-center gap-1 hover:opacity-80'
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        <span className={`text-[10px] ${muted}`}>
                          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
                        </span>
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
                  colSpan={table.getAllColumns().length}
                  className={`px-3 py-10 text-center ${muted}`}
                >
                  {t('common.loading')}
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.getAllColumns().length}
                  className={`px-3 py-10 text-center ${muted}`}
                >
                  {empty ?? t('pos.noItems')}
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={(e) => {
                    // A click on a control inside a cell is that control's, not
                    // the row's — otherwise selects and buttons fight the row.
                    const el = e.target as HTMLElement;
                    if (el.closest('button,select,input,a,label')) return;
                    onRowClick?.(row.original as T);
                  }}
                  className={`border-b ${border} ${rowHover} ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef.meta ?? {}) as any;
                    return (
                      <td
                        key={cell.id}
                        className={`px-3 py-2 align-middle ${
                          meta.nowrap ? 'whitespace-nowrap' : ''
                        } ${meta.align === 'end' ? 'text-end' : 'text-start'}`}
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

      {/* Pagination */}
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm'>
        <div className={muted}>
          {t('table.pageOf', { page: pageIndex + 1, pages: pageCount })} ·{' '}
          <span className='money'>{total}</span>
        </div>

        <div className='flex items-center gap-2 flex-wrap'>
          <label className={`text-xs ${muted}`}>{t('table.rows')}</label>
          <select
            value={size}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSize(n);
              onPageSizeChange?.(n);
            }}
            className={ctl}
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <button
            className={ctl}
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            «
          </button>
          <button
            className={ctl}
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            ‹
          </button>
          <button
            className={ctl}
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            ›
          </button>
          <button
            className={ctl}
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
