import React, { useEffect, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';
import { Button, Input } from '@heroui/react';

// Type
interface Setting {
  key: string;
  value: string;
}

// (optional) global type for window.api
declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(false);

  // create form state
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageSize, setPageSize] = useState<number>(25);

  // search filter
  const [q, setQ] = useState('');

  // per-row edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<string>('');

  // per-row reveal/mask state
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const result = await window.api.invoke('settings:getAll');
      // result is expected: [{ key, value }, ...]
      setSettings(result ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveNew = async () => {
    if (!newKey.trim()) return;
    await window.api.invoke('settings:set', newKey.trim(), newValue ?? '');
    setNewKey('');
    setNewValue('');
    fetchSettings();
  };

  const handleRowSave = async (k: string) => {
    await window.api.invoke('settings:set', k, draftValue ?? '');
    setEditingKey(null);
    setDraftValue('');
    fetchSettings();
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setDraftValue('');
  };

  // helpers
  const isSecretKey = (k: string) =>
    /(token|secret|password|passwd|key|api_key|private)/i.test(k);

  const masked = (v: string) => (v ? '•'.repeat(Math.min(v.length, 12)) : '');

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return settings;
    return settings.filter(
      (s) =>
        s.key.toLowerCase().includes(qq) ||
        (s.value ?? '').toLowerCase().includes(qq)
    );
  }, [settings, q]);

  const columns = useMemo<ColumnDef<Setting>[]>(() => [
    {
      accessorKey: 'key',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Key <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => info.getValue() as string,
    },
    {
      accessorKey: 'value',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Value <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => {
        const row = info.row.original;
        const k = row.key;
        const v = row.value ?? '';
        const editing = editingKey === k;

        if (editing) {
          return (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Edit value"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRowSave(k);
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                className="w-full"
              />
              <Button size="sm" onClick={() => handleRowSave(k)}>Save</Button>
              <Button size="sm" variant="flat" onClick={handleCancelEdit}>
                Cancel
              </Button>
            </div>
          );
        }

        const secret = isSecretKey(k);
        const show = reveal[k] || !secret;
        return (
          <div className="flex items-center gap-3">
            <span className="truncate">
              {show ? v : masked(v)}
            </span>
            {secret && (
              <Button
                size="sm"
                variant="flat"
                onClick={() => setReveal((r) => ({ ...r, [k]: !r[k] }))}
              >
                {show ? 'Hide' : 'Show'}
              </Button>
            )}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const k = row.original.key;
        const v = row.original.value ?? '';
        const editing = editingKey === k;
        return (
          <div className="flex items-center gap-2">
            {!editing ? (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingKey(k);
                    setDraftValue(v);
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  onClick={() => navigator.clipboard.writeText(v || '')}
                >
                  Copy
                </Button>
              </>
            ) : null}
          </div>
        );
      },
      enableSorting: false,
    },
  ], [editingKey, draftValue, reveal]);

  const table = useReactTable({
    data: filtered,
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

  useEffect(() => {
    table.setPageIndex(0); // reset page on search
  }, [q]);

  return (
    <div style={{ margin: '24px' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-semibold">Settings</h3>
          <div className="muted text-sm">Manage device and server config (local KV)</div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Search settings"
            placeholder="Search by key or value…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            style={{ minWidth: 280 }}
          />
          <Button variant="flat" onClick={fetchSettings} isLoading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
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
                  No settings {q ? 'match your search.' : 'found.'}
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
          <span>{filtered.length} settings</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="opacity-70">Rows</label>
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
            size="sm"
            variant="flat"
            onPress={() => table.setPageIndex(0)}
            isDisabled={!table.getCanPreviousPage()}
          >
            « First
          </Button>
          <Button
            size="sm"
            variant="flat"
            onPress={() => table.previousPage()}
            isDisabled={!table.getCanPreviousPage()}
          >
            ‹ Prev
          </Button>
          <Button
            size="sm"
            variant="flat"
            onPress={() => table.nextPage()}
            isDisabled={!table.getCanNextPage()}
          >
            Next ›
          </Button>
          <Button
            size="sm"
            variant="flat"
            onPress={() => table.setPageIndex(table.getPageCount() - 1)}
            isDisabled={!table.getCanNextPage()}
          >
            Last »
          </Button>
        </div>
      </div>

      {/* Create / Update */}
      <div className="mt-6 flex items-end gap-12">
        <div className="flex-1">
          <div className="mb-2 text-sm font-medium">Add / Update Setting</div>
          <div className="flex items-center gap-3">
            <Input
              type="text"
              placeholder="key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <Input
              type="text"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{ flex: 2 }}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
            />
            <Button onClick={handleSaveNew}>Save</Button>
          </div>
          <div className="mt-2 text-xs opacity-70">
            Tip: Click <em>Edit</em> in the table to update an existing key.
            Sensitive keys are masked — use “Show” to reveal before copying.
          </div>
        </div>
      </div>
    </div>
  );
}
