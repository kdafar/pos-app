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

type Row = { key: string; value: string; source: 'meta' | 'server' };

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

/* ---------- UI helpers ---------- */
const fieldCls =
  'h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-sm outline-none ' +
  'focus:ring-2 focus:ring-sky-500/40 placeholder:opacity-60';
const btnFlat = 'border border-white/10 rounded-lg px-3 h-10 hover:bg-white/10 disabled:opacity-50';

/* ---------- Security rules ---------- */
// Don’t render these keys at all (e.g., pairing codes)
const HIDE_KEYS = [/^pair(\.|_|-)?code$/i];

// Consider these sensitive; always masked + copy disabled
const SECRET_PAT = /(token|secret|password|passwd|api[_-]?key|private|signature|hash|salt)/i;

const shouldHideKey = (k: string) => HIDE_KEYS.some((r) => r.test(k));
const isSecretKey = (k: string) => SECRET_PAT.test(k);
const masked = (v: string) => (v ? '•'.repeat(Math.min(v.length, 16)) : '');

/* ---------- IPC helpers (tolerant to missing handlers) ---------- */
async function tryInvoke<T = any>(ch: string, ...args: any[]): Promise<T | null> {
  try { return await window.api.invoke(ch, ...args); } catch { return null; }
}

/* Preferred: expose an IPC that returns rows from local SQLite:
   'meta:list' => [{ key, value }]
   We’ll also fall back to a few common names if it isn’t wired yet. */
async function fetchMetaRows(): Promise<Row[]> {
  const candidates = ['meta:list', 'store:metaList', 'dev:dumpMeta'];
  for (const ch of candidates) {
    const res = await tryInvoke<{ key: string; value: string }[]>(ch);
    if (Array.isArray(res)) {
      return res
        .filter((r) => r && r.key && !shouldHideKey(r.key))
        .map((r) => ({ key: r.key, value: String(r.value ?? ''), source: 'meta' }));
    }
  }
  return []; // graceful empty if not available
}

/* Server settings (what you already had) */
async function fetchServerSettings(): Promise<Row[]> {
  const res =
    (await tryInvoke<{ key: string; value: string }[]>('settings:getAll')) ??
    (await tryInvoke<{ key: string; value: string }[]>('settings:listAll')) ??
    [];
  return res
    .filter((r) => r && r.key && !shouldHideKey(r.key))
    .map((r) => ({ key: r.key, value: String(r.value ?? ''), source: 'server' }));
}

export function SettingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  // filters
  const [q, setQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'meta' | 'server'>('all');

  // table
  const [sorting, setSorting] = useState<SortingState>([{ id: 'key', desc: false }]);
  const [pageSize, setPageSize] = useState<number>(25);

  const refresh = async () => {
    setLoading(true);
    try {
      const [meta, server] = await Promise.all([fetchMetaRows(), fetchServerSettings()]);
      // Merge: keep both; if same key exists twice with same value, prefer meta row first
      const merged: Row[] = [];
      const seen = new Set<string>();
      for (const r of [...meta, ...server]) {
        const sig = `${r.source}:${r.key}:${r.value}`;
        if (!seen.has(sig)) { merged.push(r); seen.add(sig); }
      }
      setRows(merged);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (!qq) return true;
      return `${r.key}|${r.value}|${r.source}`.toLowerCase().includes(qq);
    });
  }, [rows, q, sourceFilter]);

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'source',
      header: ({ column }) => (
        <button
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          title="Sort"
        >
          Source <span className="opacity-60">↕</span>
        </button>
      ),
      cell: (info) => {
        const s = info.getValue() as Row['source'];
        const cls =
          'inline-flex items-center px-2 py-0.5 rounded text-xs border ' +
          (s === 'meta'
            ? 'border-sky-400/40 text-sky-300'
            : 'border-amber-400/40 text-amber-300');
        return <span className={cls}>{s === 'meta' ? 'Meta (Local)' : 'Server'}</span>;
      },
    },
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
      cell: (info) => <span className="font-medium break-all">{info.getValue() as string}</span>,
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
      cell: ({ row }) => {
        const k = row.original.key;
        const v = row.original.value ?? '';
        const secret = isSecretKey(k);
        return (
          <div className="flex items-center gap-2">
            <span className="truncate max-w-[520px]">{secret ? masked(v) : v}</span>
            <Button
              size="sm"
              variant="flat"
              className="min-w-[64px]"
              onClick={() => navigator.clipboard.writeText(secret ? '' : v)}
              isDisabled={secret}
            >
              Copy
            </Button>
          </div>
        );
      },
    },
  ], []);

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

  useEffect(() => { table.setPageSize(pageSize); }, [pageSize]);
  useEffect(() => { table.setPageIndex(0); }, [q, sourceFilter]);

  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* Header / Toolbar */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-xl font-semibold">Settings (Read-only)</h3>
          <div className="text-sm opacity-70">
            Meta (local) + Server settings. Sensitive values are masked. Pairing codes are hidden.
          </div>
        </div>

        <div className="w-full md:w-auto grid grid-cols-1 sm:grid-cols-[minmax(260px,420px)_160px_120px] gap-2">
          <Input
            aria-label="Search"
            placeholder="Search key/value/source…"
            value={q}
            onChange={(e) => setQ((e.target as HTMLInputElement).value)}
            size="sm"
          />
          <select
            className={fieldCls}
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as any)}
            title="Filter by source"
          >
            <option value="all">All sources</option>
            <option value="meta">Meta (Local)</option>
            <option value="server">Server</option>
          </select>
          <Button variant="flat" onClick={refresh} isLoading={loading}>Refresh</Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm table-fixed">
          <thead className="bg-white/5 sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="p-2 border-b border-white/10 text-left select-none">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td className="p-6 opacity-70 text-center" colSpan={columns.length}>
                  No rows {q || sourceFilter !== 'all' ? 'match your filters.' : 'found.'}
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
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
        <div className="opacity-70">
          Page <strong>{table.getState().pagination.pageIndex + 1}</strong> of{' '}
          <strong>{table.getPageCount()}</strong> • <span>{filtered.length} rows</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="opacity-70">Rows</label>
          <select className={fieldCls} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={btnFlat} onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>« First</button>
          <button className={btnFlat} onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>‹ Prev</button>
          <button className={btnFlat} onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next ›</button>
          <button className={btnFlat} onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>Last »</button>
        </div>
      </div>

      {/* Read-only notice */}
      <div className="mt-6 text-xs opacity-70">
        This page is read-only for security. To change a value, update it in the appropriate layer
        (server admin or local device provisioning) and then refresh.
      </div>
    </div>
  );
}
