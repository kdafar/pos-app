// src/renderer/pages/SettingsPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, Card, CardBody, Chip } from '@heroui/react';
import { AlertTriangle, Check, Copy, Download, Languages, Lock } from 'lucide-react';
import { LANGS, useI18n } from '../i18n';
import { DataTable } from '../components/DataTable';
import {
  DataState,
  FilterSelect,
  PageShell,
  SearchField,
} from '../components/PageShell';

type Row = { key: string; value: string; source: 'meta' | 'server' };

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

/* ---------- Security rules ---------- */
// Never rendered at all. The trailing anchor alone missed namespaced variants
// like `device.pair_code`, which is exactly how a pairing code reaches a screen
// anyone can photograph — so a separator prefix is allowed too.
const HIDE_KEYS = [/(^|[._-])pair(ing)?[._-]?code$/i];

// Rendered, but always masked and never copyable.
const SECRET_PAT =
  /(token|secret|password|passwd|api[_-]?key|private|signature|hash|salt)/i;

const shouldHideKey = (k: string) => HIDE_KEYS.some((r) => r.test(k));
const isSecretKey = (k: string) => SECRET_PAT.test(k);
const masked = (v: string) => (v ? '•'.repeat(Math.min(v.length, 16)) : '');

/* ---------- IPC ---------- */
/**
 * A channel that was never registered is a capability this build does not have;
 * a channel that threw is a fault. The old code could not tell them apart — it
 * caught everything and returned null — so a broken preload bridge, a locked
 * SQLite file and a feature that simply isn't wired all produced the same empty
 * table, and the page cheerfully reported "No rows found." on a till whose
 * settings were unreadable.
 */
const NOT_WIRED = /no handler registered|not implemented|unknown channel/i;

type Probe = { rows: { key: string; value: string }[] | null; error: string | null };

async function probe(channel: string): Promise<Probe> {
  try {
    const res = await window.api.invoke(channel);
    if (res == null) return { rows: null, error: null };
    if (!Array.isArray(res)) {
      // The previous version called .filter() straight on this, so a handler
      // answering with an object threw inside a promise nobody awaited.
      return { rows: null, error: `${channel}: unexpected response` };
    }
    return { rows: res, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? '');
    if (NOT_WIRED.test(msg)) return { rows: null, error: null };
    return { rows: null, error: `${channel}: ${msg}` };
  }
}

/** First channel that answers wins; anything that faults is reported. */
async function loadSource(
  channels: string[],
  source: Row['source']
): Promise<{ rows: Row[]; error: string | null }> {
  const faults: string[] = [];
  for (const channel of channels) {
    const { rows, error } = await probe(channel);
    if (error) {
      faults.push(error);
      continue;
    }
    if (rows) {
      return {
        rows: rows
          .filter((r) => r && r.key && !shouldHideKey(r.key))
          .map((r) => ({
            key: r.key,
            value: String(r.value ?? ''),
            source,
          })),
        error: null,
      };
    }
  }
  return { rows: [], error: faults.length ? faults.join(' · ') : null };
}

const META_CHANNELS = ['meta:list', 'store:metaList', 'dev:dumpMeta'];
const SERVER_CHANNELS = ['settings:getAll', 'settings:listAll'];

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** One source failed while the other answered — data is real but incomplete. */
  const [partial, setPartial] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoResult, setLogoResult] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);

  const [q, setQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'meta' | 'server'>(
    'all'
  );

  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPartial(null);
    try {
      const [meta, server] = await Promise.all([
        loadSource(META_CHANNELS, 'meta'),
        loadSource(SERVER_CHANNELS, 'server'),
      ]);

      const faults = [meta.error, server.error].filter(Boolean) as string[];
      const merged: Row[] = [];
      const seen = new Set<string>();
      for (const r of [...meta.rows, ...server.rows]) {
        const sig = `${r.source}:${r.key}:${r.value}`;
        if (!seen.has(sig)) {
          merged.push(r);
          seen.add(sig);
        }
      }

      // Nothing loaded and something faulted: that is a failure, and it must not
      // be dressed up as an empty settings store.
      if (faults.length && merged.length === 0) {
        setRows([]);
        setError(faults.join(' · '));
        return;
      }

      setRows(merged);
      setPartial(faults.length ? faults.join(' · ') : null);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e ?? ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fetchLogo = useCallback(async () => {
    setLogoBusy(true);
    setLogoResult(null);
    try {
      await window.api.invoke('settings:fetchLogo');
      setLogoResult({ kind: 'success', message: t('settings.logoFetched') });
    } catch (e) {
      setLogoResult({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e ?? ''),
      });
    } finally {
      setLogoBusy(false);
    }
  }, [t]);

  const copyValue = useCallback((row: Row) => {
    const id = `${row.source}:${row.key}`;
    // Rejects when the document is not focused or the clipboard is blocked —
    // in that case the button simply never claims success.
    navigator.clipboard
      .writeText(row.value)
      .then(() => {
        setCopied(id);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (!qq) return true;
      return `${r.key}|${r.value}|${r.source}`.toLowerCase().includes(qq);
    });
  }, [rows, q, sourceFilter]);

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      {
        accessorKey: 'source',
        header: () => t('settings.colSource'),
        size: 130,
        meta: { nowrap: true },
        cell: (info) => {
          const s = info.getValue() as Row['source'];
          return (
            <Chip
              size='sm'
              variant='flat'
              color={s === 'meta' ? 'primary' : 'warning'}
              className='font-semibold'
            >
              {s === 'meta' ? t('settings.sourceMeta') : t('settings.sourceServer')}
            </Chip>
          );
        },
      },
      {
        accessorKey: 'key',
        header: () => t('settings.colKey'),
        size: 240,
        // Setting keys are identifiers — always Latin, always LTR.
        cell: (info) => (
          <span className='font-mono font-semibold break-all' dir='ltr'>
            {info.getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: 'value',
        header: () => t('settings.colValue'),
        size: 340,
        cell: ({ row }) => {
          const secret = isSecretKey(row.original.key);
          const v = row.original.value ?? '';
          return (
            <div className='flex items-start gap-2'>
              {secret && (
                <Lock size={15} className='mt-1 shrink-0 text-warning' />
              )}
              {/* Stored values are URLs, ids and tokens — keep them LTR. */}
              <span
                className='block max-w-[34rem] break-all font-mono text-foreground'
                dir='ltr'
                title={secret ? t('admin.settings.secretHidden') : v}
              >
                {secret ? masked(v) : v || '—'}
              </span>
            </div>
          );
        },
      },
      {
        id: 'copy',
        header: () => t('admin.actions'),
        size: 130,
        enableSorting: false,
        meta: { nowrap: true },
        cell: ({ row }) => {
          const secret = isSecretKey(row.original.key);
          const id = `${row.original.source}:${row.original.key}`;
          const done = copied === id;
          return (
            <Button
              variant='flat'
              color={done ? 'success' : 'default'}
              onPress={() => copyValue(row.original)}
              isDisabled={secret || !row.original.value}
              startContent={
                done ? <Check size={16} /> : <Copy size={16} />
              }
              title={
                secret
                  ? t('admin.settings.secretHidden')
                  : t('admin.settings.copyValue')
              }
              aria-label={t('admin.settings.copyValue')}
            >
              {done ? t('admin.settings.copied') : t('settings.copy')}
            </Button>
          );
        },
      },
    ],
    [t, copied, copyValue]
  );

  const isFiltered = !!q.trim() || sourceFilter !== 'all';

  return (
    <PageShell
      title={t('settings.title')}
      subtitle={t('settings.subtitle')}
      count={loading || error ? undefined : filtered.length}
      onRefresh={refresh}
      refreshing={loading}
      primaryAction={
        <Chip color='warning' variant='flat' className='font-semibold'>
          {t('admin.readOnly')}
        </Chip>
      }
      filters={
        <>
          <SearchField
            value={q}
            onChange={setQ}
            placeholder={t('settings.searchPlaceholder')}
          />
          <FilterSelect
            label={t('settings.filterBySource')}
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as typeof sourceFilter)}
            options={[
              { value: 'all', label: t('settings.allSources') },
              { value: 'meta', label: t('settings.sourceMeta') },
              { value: 'server', label: t('settings.sourceServer') },
            ]}
          />
        </>
      }
    >
      {/* Language lives here rather than behind a menu: shifts hand the till
          over mid-service and the switch has to be findable in one look. */}
      <Card shadow='none' className='mb-4 border border-default-200 bg-content1'>
        <CardBody className='gap-3'>
          <div>
            <h2 className='text-base font-bold text-foreground'>
              {t('nav.language')}
            </h2>
            <p className='mt-0.5 text-sm font-medium text-default-700'>
              {t('settings.languageHint')}
            </p>
          </div>
          <div className='flex flex-wrap gap-2'>
            {LANGS.map((l) => {
              const current = l.code === lang;
              return (
                <Button
                  key={l.code}
                  color={current ? 'primary' : 'default'}
                  variant={current ? 'solid' : 'flat'}
                  onPress={() => setLang(l.code)}
                  startContent={
                    current ? <Check size={18} /> : <Languages size={18} />
                  }
                  className='font-semibold'
                >
                  <span lang={l.code}>{l.label}</span>
                </Button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card shadow='none' className='mb-4 border border-default-200 bg-content1'>
        <CardBody className='gap-3'>
          <div>
            <h2 className='text-base font-bold text-foreground'>
              {t('settings.invoiceLogo')}
            </h2>
            <p className='mt-0.5 text-sm font-medium text-default-700'>
              {t('settings.invoiceLogoHint')}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            <Button
              color='primary'
              variant='flat'
              onPress={fetchLogo}
              isLoading={logoBusy}
              startContent={!logoBusy ? <Download size={18} /> : undefined}
              className='font-semibold'
            >
              {t('settings.fetchLogo')}
            </Button>
            {logoResult && (
              <span
                className={`text-sm font-semibold ${
                  logoResult.kind === 'success' ? 'text-success' : 'text-danger'
                }`}
              >
                {logoResult.message}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* One source answered and the other faulted. The rows below are real but
          incomplete, so this says so instead of letting a half-loaded page pass
          for the whole picture. */}
      {partial && !error && (
        <div className='mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning bg-content1 p-3'>
          <AlertTriangle size={20} className='shrink-0 text-warning' />
          <div className='min-w-0 flex-1'>
            <div className='text-sm font-bold text-warning'>
              {t('admin.settings.partialLoad')}
            </div>
            <div className='mt-0.5 break-words text-sm font-medium text-default-700'>
              {partial}
            </div>
          </div>
          <Button color='warning' variant='flat' onPress={refresh}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <DataState
        loading={loading}
        error={error}
        onRetry={refresh}
        empty={filtered.length === 0}
        emptyTitle={
          isFiltered ? t('settings.noRowsFiltered') : t('settings.noRowsFound')
        }
        emptyHint={isFiltered ? t('admin.clearFiltersHint') : undefined}
      >
        <DataTable
          data={filtered}
          columns={columns}
          initialSorting={[{ id: 'key', desc: false }]}
          getRowId={(r, i) => `${r.source}:${r.key}:${i}`}
        />
      </DataState>

      <div className='mt-6 text-sm font-medium text-default-700'>
        {t('settings.readOnlyNotice')}
      </div>
    </PageShell>
  );
}
