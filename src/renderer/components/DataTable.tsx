// src/renderer/components/DataTable.tsx
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react';
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
  /**
   * Marks the current row when clicking one filters something else on the page.
   * Without it a master-detail table gives no feedback: the list below changes
   * and nothing says which row caused it.
   */
  selectedRowId?: string | null;
  /**
   * Detail rendered beneath a row when it is expanded.
   *
   * Detail that belongs to a row belongs *under* that row: a separate page
   * showing the same list again, so you can pick one and read its detail
   * elsewhere, makes you hold the row in your head while you travel to it.
   */
  renderExpanded?: (row: T) => ReactNode;
  /** Label for the expand control, since a caret alone says nothing. */
  expandLabel?: string;
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
  selectedRowId = null,
  renderExpanded,
  expandLabel,
}: DataTableProps<T>) {
  const { t } = useI18n();
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [size, setSize] = useState(pageSize);
  const [expanded, setExpanded] = useState<string | null>(null);

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
  const colCount = table.getAllColumns().length + (renderExpanded ? 1 : 0);

  const pageSizes = useMemo(() => [10, 25, 50, 100], []);

  return (
    <div className='flex flex-col gap-3 min-w-0'>
      {/* The ONLY horizontal scroller. Wide tables scroll here, never the page. */}
      <div className='overflow-x-auto rounded-lg border border-default-200 bg-content1'>
        <table className='w-full table-auto border-collapse text-sm'>
          <thead className='sticky top-0 z-10 bg-default-100'>
            <tr>
              {renderExpanded && (
                <th className='w-10 border-b-2 border-default-300' />
              )}
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
                      ${alignEnd ? 'text-end' : 'text-start'}
                      ${meta.className ?? ''}`}
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
                  className='px-3 py-12 text-center text-base font-medium text-default-700'
                >
                  {t('common.loading')}
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  className='px-3 py-12 text-center text-base font-medium text-default-700'
                >
                  {empty ?? t('pos.noItems')}
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, i) => (
                <Fragment key={row.id}>
                <tr
                  onClick={(e) => {
                    // A click on a control inside a cell is that control's, not
                    // the row's — otherwise selects and buttons fight the row.
                    const el = e.target as HTMLElement;
                    if (el.closest('button,select,input,a,label')) return;
                    onRowClick?.(row.original as T);
                  }}
                  aria-selected={
                    selectedRowId != null ? row.id === selectedRowId : undefined
                  }
                  className={`border-b border-default-200 transition-colors
                    ${
                      row.id === selectedRowId
                        ? // A border-inline-start marker rather than a fill: a
                          // tinted row has to stay legible in both themes, and
                          // a light tint on a dark table hides its own text.
                          'bg-default-200 border-s-4 border-s-primary font-semibold'
                        : i % 2 === 1
                        ? 'bg-default-50'
                        : ''
                    }
                    hover:bg-default-200
                    ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {renderExpanded && (
                    <td className='ps-2 pe-0 py-3 align-middle w-10'>
                      <button
                        type='button'
                        aria-expanded={expanded === row.id}
                        aria-label={expandLabel ?? t('table.expandRow')}
                        title={expandLabel ?? t('table.expandRow')}
                        onClick={() =>
                          setExpanded((prev) =>
                            prev === row.id ? null : row.id
                          )
                        }
                        className='p-1 rounded-md text-default-700 hover:text-primary hover:bg-default-200 transition-colors'
                      >
                        <ChevronRight
                          size={16}
                          className={`transition-transform rtl:-scale-x-100 ${
                            expanded === row.id ? 'rotate-90' : ''
                          }`}
                        />
                      </button>
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef.meta ?? {}) as any;
                    return (
                      <td
                        key={cell.id}
                        className={`px-3 py-3 align-middle text-foreground
                          ${meta.nowrap ? 'whitespace-nowrap' : ''}
                          ${meta.align === 'end' ? 'text-end' : 'text-start'}
                          ${meta.className ?? ''}`}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    );
                  })}
                  </tr>
                  {renderExpanded && expanded === row.id && (
                    <tr key={row.id + ':detail'} className='border-b border-default-200'>
                      <td colSpan={colCount} className='p-0'>
                        <div className='bg-default-50 px-4 py-3 border-s-4 border-s-primary'>
                          {renderExpanded(row.original as T)}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination — hidden entirely when everything already fits. */}
      {(total > size || pageCount > 1) && (
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm'>
          <div className='font-medium text-default-700'>
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
