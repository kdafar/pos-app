import { useMemo, useState, useEffect } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getFilteredRowModel,
  getSortedRowModel,
} from '@tanstack/react-table';

type Table = {
  number: number;
  label: string;
  capacity: number;
  is_available: boolean;
  branch_id: number;
};

const columnHelper = createColumnHelper<Table>();

const columns = [
  columnHelper.accessor('number', { header: 'Number' }),
  columnHelper.accessor('label', { header: 'Label' }),
  columnHelper.accessor('capacity', { header: 'Capacity' }),
  columnHelper.accessor('is_available', { header: 'Available', cell: info => (info.getValue() ? '✅' : '—') }),
  columnHelper.accessor('branch_id', { header: 'Branch ID' }),
];

function GlobalFilter({ filter, setFilter }) {
  return (
    <input
      value={filter || ''}
      onChange={e => setFilter(e.target.value)}
      placeholder={`Search...`}
      className="p-2 border rounded"
    />
  );
}

function TablesPage() {
  const [data, setData] = useState<Table[]>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      const tables = await window.api.invoke('tables:listAvailable');
      setData(tables);
    };
    fetchData();
  }, []);

  const table = useReactTable({
    data,
    columns,
    state: {
      globalFilter,
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Tables</h1>
        <GlobalFilter
          filter={globalFilter}
          setFilter={setGlobalFilter}
        />
      </div>
      <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} onClick={header.column.getToggleSortingHandler()} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{
                      asc: ' 🔼',
                      desc: ' 🔽',
                    }[header.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {table.getRowModel().rows.map(row => (
              <tr key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-6 py-4 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TablesPage;