// src/renderer/pages/SettingsPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, Input, Select, SelectItem, Switch } from '@heroui/react';
import { Activity, AlertTriangle, Check, Copy, Download, Inbox, Lock, Monitor, Printer, RotateCw, Wrench } from 'lucide-react';
import {
  TEXT_SCALES,
  normalizeTextScale,
  saveTextScale,
  type TextScaleId,
} from '../theme/textScale';
import { LANGS, useI18n } from '../i18n';
import { DataTable } from '../components/DataTable';
import { Hint } from '../components/Hint';
import { errorLine as errLine } from '../utils/posError';
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
    const msg = errLine(e);
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

type PrinterInfo = { name: string; displayName: string; isDefault: boolean };
/** 0 = pin 2, 1 = pin 5. Shown to the shop as "Standard" / "Alternative". */
type DrawerConfig = {
  enabled: boolean;
  pin: 0 | 1;
  cashOnly: boolean;
  printerName: string;
};
type PrinterConfig = {
  printerName: string;
  showDialog: boolean;
  paperWidthMm: number;
  /** 0 = as long as the receipt (roll). Non-zero = fixed stock, e.g. a label. */
  paperHeightMm: number;
  /**
   * Print on the form the printer driver is set to, instead of a page size
   * computed from the receipt. The fix for blank paper: a thermal driver only
   * accepts its own short list of forms and silently discards anything else.
   */
  usePrinterDefaultPage: boolean;
  printers: PrinterInfo[];
  missing: boolean;
};

// 58mm and 80mm are the two roll widths thermal tills ship with, but the field
// takes any size: some sites print receipts on a label printer whose stock is
// whatever the driver was set up for, and a preset list cannot cover that.
const PAPER_PRESETS = [
  { label: '80 mm', w: 80, h: 0 },
  { label: '58 mm', w: 58, h: 0 },
  { label: '76 mm', w: 76, h: 0 },
  { label: 'A5', w: 148, h: 210 },
  { label: 'A4', w: 210, h: 297 },
  { label: 'Letter', w: 216, h: 279 },
];

type SectionId = 'till' | 'printing' | 'maintenance' | 'diagnostics';
const SECTION_IDS: SectionId[] = ['till', 'printing', 'maintenance', 'diagnostics'];

/** A section heading that is also the scroll target for the section list. */
function SectionHeading({ id, label }: { id: string; label: string }) {
  return (
    <h2
      id={`settings-${id}`}
      className='scroll-mt-16 lg:scroll-mt-4 pt-2 text-xs font-semibold uppercase tracking-wide ink-2 first:pt-0'
    >
      {label}
    </h2>
  );
}

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  // Already applied at startup (main.tsx); read it back from <html>.
  const [textScale, setTextScale] = useState<TextScaleId>(() =>
    normalizeTextScale(document.documentElement.dataset.textScale)
  );
  // Which section the list highlights; follows the scroll.
  const [section, setSection] = useState<SectionId>('till');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** One source failed while the other answered — data is real but incomplete. */
  const [partial, setPartial] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoResult, setLogoResult] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);
  const [payFixBusy, setPayFixBusy] = useState(false);
  const [payFixResult, setPayFixResult] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);

  /* ---------- receipt printer ----------
     A till that prints to the wrong device looks identical to a till that
     does not print at all, and until this existed nothing on screen showed
     which printer receipts were being sent to. */
  const [printerCfg, setPrinterCfg] = useState<PrinterConfig | null>(null);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerResult, setPrinterResult] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);
  // Held as text while being typed. Saving on every keystroke would write
  // "1" on the way to "105" and reject it, so the value is committed on blur.
  const [widthDraft, setWidthDraft] = useState('80');
  const [heightDraft, setHeightDraft] = useState('0');

  /* ---------- cash drawer ----------
     The drawer is opened by the receipt printer, so it is configured here and
     inherits whatever printer is selected above. */
  const [drawerCfg, setDrawerCfg] = useState<DrawerConfig | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [drawerResult, setDrawerResult] = useState<
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
      setError(errLine(e));
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
        message: errLine(e),
      });
    } finally {
      setLogoBusy(false);
    }
  }, [t]);

  /**
   * Orders that reached this till before the sync feeds read the payment method
   * carry none, and print as "Unknown" on the closing report. Nothing local can
   * recover them — the server holds the only copy — so this asks it, one order
   * at a time, and writes only the two empty columns.
   */
  const backfillPayments = useCallback(async () => {
    setPayFixBusy(true);
    setPayFixResult(null);
    try {
      const r = (await window.api.invoke('sync:backfillPaymentMethods')) as {
        scanned: number;
        updated: number;
        unresolved: number;
        splitTender: number;
        linesAdded: number;
        notOnServer: number;
      };
      const message = t('settings.payFixDone', {
        updated: r.updated,
        scanned: r.scanned,
        unresolved: r.unresolved,
      });
      // An order settled with two methods is credited whole to the first one.
      // Rare enough not to model yet, common enough that nobody should find
      // out from a wrong total months later.
      const parts = [message];
      if (r.notOnServer)
        parts.push(t('settings.payFixNotOnServer', { count: r.notOnServer }));
      if (r.linesAdded)
        parts.push(t('settings.payFixLines', { count: r.linesAdded }));
      if (r.splitTender)
        parts.push(t('settings.payFixSplit', { count: r.splitTender }));
      setPayFixResult({ kind: 'success', message: parts.join(' ') });
    } catch (e) {
      setPayFixResult({ kind: 'error', message: errLine(e) });
    } finally {
      setPayFixBusy(false);
    }
  }, [t]);

  const loadPrinters = useCallback(async () => {
    try {
      const cfg = (await window.api.invoke('print:getConfig')) as PrinterConfig;
      setPrinterCfg(cfg);
      setWidthDraft(String(cfg.paperWidthMm ?? 80));
      setHeightDraft(String(cfg.paperHeightMm ?? 0));
    } catch (e) {
      // A printer list that cannot be read is not the same as no printers, and
      // saying "no printers installed" here would send the shop looking at the
      // hardware instead of the app.
      setPrinterResult({ kind: 'error', message: errLine(e) });
    }
  }, []);

  const loadDrawer = useCallback(async () => {
    try {
      const cfg = (await window.api.invoke('drawer:getConfig')) as DrawerConfig;
      setDrawerCfg(cfg);
    } catch {
      // An older main process has no drawer channels. The card simply does not
      // render rather than showing an error for a feature that is not there.
      setDrawerCfg(null);
    }
  }, []);

  useEffect(() => {
    loadPrinters();
    loadDrawer();
  }, [loadPrinters, loadDrawer]);

  const savePrinter = useCallback(
    async (
      patch: Partial<
        Pick<
          PrinterConfig,
          | 'printerName'
          | 'showDialog'
          | 'paperWidthMm'
          | 'paperHeightMm'
          | 'usePrinterDefaultPage'
        >
      >
    ) => {
      setPrinterBusy(true);
      setPrinterResult(null);
      try {
        const cfg = (await window.api.invoke(
          'print:setConfig',
          patch
        )) as PrinterConfig;
        // The handler answers with what was actually stored, so the screen
        // shows the saved state rather than the requested one.
        setPrinterCfg((prev) => (prev ? { ...prev, ...cfg, missing: false } : prev));
        setPrinterResult({ kind: 'success', message: t('settings.printerSaved') });
        // The drawer opens through whichever printer is selected here, and it
        // holds its own copy of that name. Without this the drawer card keeps
        // showing the previous printer — and its test button stays disabled —
        // until Settings is closed and reopened.
        loadDrawer();
      } catch (e) {
        setPrinterResult({ kind: 'error', message: errLine(e) });
        // Put the control back on the stored value rather than leaving it
        // showing a choice that was refused.
        loadPrinters();
      } finally {
        setPrinterBusy(false);
      }
    },
    [t, loadPrinters, loadDrawer]
  );

  const commitPaper = useCallback(() => {
    const w = Number(widthDraft);
    const h = Number(heightDraft);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    if (
      w === printerCfg?.paperWidthMm &&
      h === (printerCfg?.paperHeightMm ?? 0)
    ) {
      return; // nothing changed — do not write, do not flash a toast
    }
    void savePrinter({ paperWidthMm: w, paperHeightMm: h });
  }, [widthDraft, heightDraft, printerCfg, savePrinter]);

  const testPrint = useCallback(async () => {
    setPrinterBusy(true);
    setPrinterResult(null);
    try {
      await window.api.invoke('print:test');
      setPrinterResult({
        kind: 'success',
        message: t('settings.printTestSent'),
      });
    } catch (e) {
      setPrinterResult({ kind: 'error', message: errLine(e) });
    } finally {
      setPrinterBusy(false);
    }
  }, [t]);

  const saveDrawer = useCallback(
    async (patch: Partial<Pick<DrawerConfig, 'enabled' | 'pin' | 'cashOnly'>>) => {
      setDrawerBusy(true);
      setDrawerResult(null);
      try {
        const cfg = (await window.api.invoke(
          'drawer:setConfig',
          patch
        )) as DrawerConfig;
        setDrawerCfg((prev) => (prev ? { ...prev, ...cfg } : prev));
        setDrawerResult({ kind: 'success', message: t('settings.drawerSaved') });
      } catch (e) {
        setDrawerResult({ kind: 'error', message: errLine(e) });
        loadDrawer();
      } finally {
        setDrawerBusy(false);
      }
    },
    [t, loadDrawer]
  );

  const testDrawer = useCallback(async () => {
    setDrawerBusy(true);
    setDrawerResult(null);
    try {
      await window.api.invoke('drawer:open');
      setDrawerResult({
        kind: 'success',
        message: t('settings.drawerTestSent'),
      });
    } catch (e) {
      setDrawerResult({ kind: 'error', message: errLine(e) });
    } finally {
      setDrawerBusy(false);
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
            <span className={`ui-chip ${s === 'meta' ? 'ui-chip-gray' : 'ui-chip-amber'}`}>
              {s === 'meta' ? t('settings.sourceMeta') : t('settings.sourceServer')}
            </span>
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
                <Lock size={15} strokeWidth={1.8} className='mt-1 shrink-0 text-warning' />
              )}
              {/* Stored values are URLs, ids and tokens — keep them LTR. */}
              <Hint content={secret ? t('admin.settings.secretHidden') : v} placement='top'>
                <span
                  className='block max-w-[34rem] break-all font-mono ink'
                  dir='ltr'
                >
                  {secret ? masked(v) : v || '—'}
                </span>
              </Hint>
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
            <Hint
              content={
                secret
                  ? t('admin.settings.secretHidden')
                  : t('admin.settings.copyValue')
              }
              placement='top'
            >
              <Button
                variant='bordered'
                color={done ? 'success' : 'default'}
                className='border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                onPress={() => copyValue(row.original)}
                isDisabled={secret || !row.original.value}
                startContent={
                  done ? <Check size={16} strokeWidth={1.8} /> : <Copy size={16} strokeWidth={1.8} />
                }
                aria-label={t('admin.settings.copyValue')}
              >
                {done ? t('admin.settings.copied') : t('settings.copy')}
              </Button>
            </Hint>
          );
        },
      },
    ],
    [t, copied, copyValue]
  );

  const isFiltered = !!q.trim() || sourceFilter !== 'all';

  const cardBtn =
    'font-semibold border border-[var(--line-strong)] bg-[var(--surface)]';
  const selectClasses = { trigger: 'ui-input' };

  const printerOptions = [
    // Keeping the default as an explicit option matters: a shop whose only
    // printer is the till printer should not be made to pin a device name that
    // Windows may rename.
    { value: '', label: t('settings.printerSystemDefault') },
    ...(printerCfg?.printers ?? []).map((pr) => ({
      value: pr.name,
      label: pr.isDefault ? `${pr.displayName} ★` : pr.displayName,
    })),
  ];
  const pinOptions = [
    { value: '0', label: t('settings.drawerPin2') },
    { value: '1', label: t('settings.drawerPin5') },
  ];

  const sections: { id: SectionId; label: string; icon: ReactNode }[] = [
    { id: 'till', label: t('settings.secThisTill'), icon: <Monitor size={20} strokeWidth={1.8} /> },
    { id: 'printing', label: t('settings.secPrinting'), icon: <Printer size={20} strokeWidth={1.8} /> },
    { id: 'maintenance', label: t('settings.secMaintenance'), icon: <Wrench size={20} strokeWidth={1.8} /> },
    { id: 'diagnostics', label: t('settings.secDiagnostics'), icon: <Activity size={20} strokeWidth={1.8} /> },
  ];

  const sectionLabel = (id: SectionId) => sections.find((x) => x.id === id)?.label ?? '';

  // One page, every section on it: the list jumps to a section and the
  // highlight follows the scroll, so no section is ever a near-empty page.
  // While a jump is scrolling, the highlight stays on the picked section.
  const jumpingUntil = useRef(0);
  const pickSection = (id: SectionId) => {
    setSection(id);
    jumpingUntil.current = Date.now() + 900;
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Highlight the last section whose heading has reached the top area; at the
  // very bottom of the page, the last section (it may never reach the top).
  useEffect(() => {
    const onScroll = (e: Event) => {
      if (Date.now() < jumpingUntil.current) return;
      const scroller = e.target instanceof HTMLElement ? e.target : null;
      if (!scroller || !scroller.querySelector('#settings-till')) return;
      let current: SectionId = SECTION_IDS[0];
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      if (atBottom) current = SECTION_IDS[SECTION_IDS.length - 1];
      else
        for (const id of SECTION_IDS) {
          const el = document.getElementById(`settings-${id}`);
          if (el && el.getBoundingClientRect().top <= 160) current = id;
        }
      setSection(current);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  // Phones: keep the highlighted chip visible in the sideways switcher.
  useEffect(() => {
    document
      .querySelector(`[data-settings-chip='${section}']`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [section]);

  return (
    <PageShell title={t('settings.pageTitle')} subtitle={t('settings.pageSubtitle')}>
      <div className='flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6'>
        {/* < lg: a switcher that scrolls sideways; >= lg: a sticky side list. */}
        <div className='sticky top-0 z-10 -mx-1 min-w-0 max-w-full overflow-x-auto chip-scroll bg-canvas px-1 py-1 lg:hidden'>
          <div className='ui-seg' role='group' aria-label={t('settings.pageTitle')}>
            {sections.map((s) => (
              <button
                key={s.id}
                type='button'
                className='ui-seg-item gap-2'
                data-settings-chip={s.id}
                aria-pressed={section === s.id}
                onClick={() => pickSection(s.id)}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <nav
          aria-label={t('settings.pageTitle')}
          className='sticky top-4 hidden w-56 shrink-0 flex-col gap-1 lg:flex'
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type='button'
              className='ui-nav flex min-h-11 w-full items-center gap-2.5 px-3 text-start text-sm'
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => pickSection(s.id)}
            >
              {s.icon}
              <span className='min-w-0 truncate'>{s.label}</span>
            </button>
          ))}
        </nav>

        <div className='flex min-w-0 flex-1 flex-col gap-4'>
          <SectionHeading id='till' label={sectionLabel('till')} />
          {(
            <SettingsCard>
              {/* Language lives here rather than behind a menu: shifts hand the
                  till over mid-service and the switch has to be findable in one
                  look. */}
              <SettingRow label={t('nav.language')} hint={t('settings.languageHint')}>
                <div className='max-w-full overflow-x-auto chip-scroll'>
                  <div className='ui-seg' role='group' aria-label={t('nav.language')}>
                    {LANGS.map((l) => (
                      <button
                        key={l.code}
                        type='button'
                        className='ui-seg-item'
                        aria-pressed={l.code === lang}
                        onClick={() => setLang(l.code)}
                      >
                        <span lang={l.code}>{l.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </SettingRow>
              {/* Text size is a per-till comfort setting: a small tablet or a
                  far-away screen needs it changed by whoever is on shift. */}
              <SettingRow label={t('settings.textSize')} hint={t('settings.textSizeHint')}>
                <div className='max-w-full overflow-x-auto chip-scroll'>
                  <div className='ui-seg' role='group' aria-label={t('settings.textSize')}>
                    {TEXT_SCALES.map((s) => (
                      <button
                        key={s.id}
                        type='button'
                        className='ui-seg-item'
                        aria-pressed={s.id === textScale}
                        onClick={() => {
                          setTextScale(s.id);
                          void saveTextScale(s.id);
                        }}
                      >
                        {t(`settings.textSize.${s.id}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </SettingRow>
            </SettingsCard>
          )}

          <SectionHeading id='printing' label={sectionLabel('printing')} />
          {(
            <>
              {/* Receipt printer. This is the one setting on the page that is
                  written rather than displayed: which printer a till uses is
                  only knowable on the till. */}
              <SettingsCard
                icon={<Printer size={20} strokeWidth={1.8} />}
                title={t('settings.printer')}
                hint={t('settings.printerHint')}
              >
                {printerCfg && printerCfg.printers.length === 0 ? (
                  <div className='py-4'>
                    <div className='ui-notice items-center text-sm'>
                      <AlertTriangle size={18} strokeWidth={1.8} className='shrink-0 text-warning' />
                      {t('settings.printerNone')}
                    </div>
                  </div>
                ) : (
                  <>
                    {printerCfg?.missing && (
                      <div className='py-4'>
                        <div className='ui-notice text-sm'>
                          <AlertTriangle size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 text-warning' />
                          <span>{t('settings.printerMissing')}</span>
                        </div>
                      </div>
                    )}

                    <SettingRow label={t('settings.printerSelect')}>
                      <Select
                        aria-label={t('settings.printerSelect')}
                        classNames={selectClasses}
                        className='w-full sm:w-72'
                        selectedKeys={[printerCfg?.printerName ?? '']}
                        onSelectionChange={(keys) => {
                          const next = Array.from(keys)[0];
                          if (next != null) void savePrinter({ printerName: String(next) });
                        }}
                      >
                        {printerOptions.map((o) => (
                          <SelectItem key={o.value}>{o.label}</SelectItem>
                        ))}
                      </Select>
                    </SettingRow>

                    <SettingRow stack>
                      <div className='flex flex-wrap items-start gap-3'>
                        <Input
                          type='number'
                          label={t('settings.paperWidth')}
                          labelPlacement='outside'
                          value={widthDraft}
                          onValueChange={setWidthDraft}
                          onBlur={commitPaper}
                          endContent={<span className='text-sm ink-2'>mm</span>}
                          classNames={{ inputWrapper: 'ui-input' }}
                          className='w-40'
                          min={10}
                          max={210}
                        />
                        <Input
                          type='number'
                          label={t('settings.paperHeight')}
                          labelPlacement='outside'
                          value={heightDraft}
                          onValueChange={setHeightDraft}
                          onBlur={commitPaper}
                          endContent={<span className='text-sm ink-2'>mm</span>}
                          classNames={{ inputWrapper: 'ui-input' }}
                          className='w-40'
                          min={0}
                          max={2000}
                          description={t('settings.paperHeightHint')}
                        />
                      </div>
                      <div className='max-w-full overflow-x-auto chip-scroll'>
                        <div className='ui-seg' role='group' aria-label={t('settings.paperWidth')}>
                          {PAPER_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              type='button'
                              className='ui-seg-item'
                              aria-pressed={
                                Number(widthDraft) === preset.w &&
                                Number(heightDraft) === preset.h
                              }
                              onClick={() => {
                                setWidthDraft(String(preset.w));
                                setHeightDraft(String(preset.h));
                                void savePrinter({
                                  paperWidthMm: preset.w,
                                  paperHeightMm: preset.h,
                                });
                              }}
                            >
                              {/* Sizes are Latin units: keep "80 mm" in that order in Arabic too. */}
                              <bdi dir='ltr'>{preset.label}</bdi>
                            </button>
                          ))}
                        </div>
                      </div>
                    </SettingRow>

                    <SettingRow
                      label={t('settings.printerDefaultPage')}
                      hint={t('settings.printerDefaultPageHint')}
                    >
                      <Switch
                        aria-label={t('settings.printerDefaultPage')}
                        isSelected={!!printerCfg?.usePrinterDefaultPage}
                        onValueChange={(v) => void savePrinter({ usePrinterDefaultPage: v })}
                        isDisabled={printerBusy}
                      />
                    </SettingRow>

                    <SettingRow
                      label={t('settings.printDialog')}
                      hint={t('settings.printDialogHint')}
                    >
                      <Switch
                        aria-label={t('settings.printDialog')}
                        isSelected={!!printerCfg?.showDialog}
                        onValueChange={(v) => void savePrinter({ showDialog: v })}
                        isDisabled={printerBusy}
                      />
                    </SettingRow>

                    <SettingRow label={t('settings.printTest')}>
                      <Button
                        variant='bordered'
                        onPress={testPrint}
                        isLoading={printerBusy}
                        startContent={!printerBusy ? <Printer size={18} strokeWidth={1.8} /> : undefined}
                        className={cardBtn}
                      >
                        {t('settings.printTest')}
                      </Button>
                    </SettingRow>
                  </>
                )}

                {printerResult && (
                  <div className='py-4'>
                    <ResultNotice result={printerResult} />
                  </div>
                )}
              </SettingsCard>

              {/* Cash drawer. Only rendered when the main process offers the
                  channels, so an older build shows nothing rather than a dead
                  card. It sits under the printer because the printer opens it —
                  the wording says so, since a shop that does not know that will
                  unplug the wrong cable when it stops working. */}
              {drawerCfg && (
                <SettingsCard
                  icon={<Inbox size={20} strokeWidth={1.8} />}
                  title={t('settings.drawer')}
                  hint={t('settings.drawerHint')}
                >
                  <div className='flex flex-col gap-3 py-4'>
                    {/* The one failure this cannot detect for the shop: a TSPL
                        label printer, or a thermal printer with the wrong
                        driver, accepts the RAW job and prints gibberish while
                        the drawer never moves. Say so up front. */}
                    <div className='ui-notice text-sm'>
                      <AlertTriangle size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 text-warning' />
                      <span>{t('settings.drawerCompatWarning')}</span>
                    </div>

                    {drawerCfg.printerName ? (
                      <p className='text-sm ink-2'>
                        {t('settings.drawerVia')}:{' '}
                        <span className='font-semibold ink'>{drawerCfg.printerName}</span>
                      </p>
                    ) : (
                      <div className='ui-notice text-sm'>
                        <AlertTriangle size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 text-warning' />
                        <span>{t('settings.drawerNoPrinter')}</span>
                      </div>
                    )}
                  </div>

                  <SettingRow
                    label={t('settings.drawerEnable')}
                    hint={t('settings.drawerEnableHint')}
                  >
                    <Switch
                      aria-label={t('settings.drawerEnable')}
                      isSelected={drawerCfg.enabled}
                      onValueChange={(v) => void saveDrawer({ enabled: v })}
                      isDisabled={drawerBusy}
                    />
                  </SettingRow>

                  <SettingRow
                    label={t('settings.drawerCashOnly')}
                    hint={t('settings.drawerCashOnlyHint')}
                  >
                    <Switch
                      aria-label={t('settings.drawerCashOnly')}
                      isSelected={drawerCfg.cashOnly}
                      onValueChange={(v) => void saveDrawer({ cashOnly: v })}
                      isDisabled={drawerBusy || !drawerCfg.enabled}
                    />
                  </SettingRow>

                  <SettingRow label={t('settings.drawerPin')} hint={t('settings.drawerPinHint')}>
                    <Select
                      aria-label={t('settings.drawerPin')}
                      classNames={selectClasses}
                      className='w-full sm:w-72'
                      selectedKeys={[String(drawerCfg.pin)]}
                      onSelectionChange={(keys) => {
                        const next = Array.from(keys)[0];
                        if (next != null) void saveDrawer({ pin: String(next) === '1' ? 1 : 0 });
                      }}
                    >
                      {pinOptions.map((o) => (
                        <SelectItem key={o.value}>{o.label}</SelectItem>
                      ))}
                    </Select>
                  </SettingRow>

                  <SettingRow label={t('settings.drawerTest')}>
                    <Button
                      variant='bordered'
                      onPress={testDrawer}
                      isLoading={drawerBusy}
                      isDisabled={!drawerCfg.printerName}
                      startContent={!drawerBusy ? <Inbox size={18} strokeWidth={1.8} /> : undefined}
                      className={cardBtn}
                    >
                      {t('settings.drawerTest')}
                    </Button>
                  </SettingRow>

                  {drawerResult && (
                    <div className='py-4'>
                      <ResultNotice result={drawerResult} />
                    </div>
                  )}
                </SettingsCard>
              )}
            </>
          )}

          <SectionHeading id='maintenance' label={sectionLabel('maintenance')} />
          {(
            <SettingsCard>
              <SettingRow label={t('settings.invoiceLogo')} hint={t('settings.invoiceLogoHint')}>
                <Button
                  variant='bordered'
                  onPress={fetchLogo}
                  isLoading={logoBusy}
                  startContent={!logoBusy ? <Download size={18} strokeWidth={1.8} /> : undefined}
                  className={cardBtn}
                >
                  {t('settings.fetchLogo')}
                </Button>
              </SettingRow>
              {logoResult && (
                <div className='pb-4'>
                  <ResultNotice result={logoResult} />
                </div>
              )}
              <SettingRow label={t('settings.payFixTitle')} hint={t('settings.payFixHint')}>
                <Button
                  variant='bordered'
                  onPress={backfillPayments}
                  isLoading={payFixBusy}
                  startContent={!payFixBusy ? <Download size={18} strokeWidth={1.8} /> : undefined}
                  className={cardBtn}
                >
                  {t('settings.payFixRun')}
                </Button>
              </SettingRow>
              {payFixResult && (
                <div className='pb-4'>
                  <ResultNotice result={payFixResult} />
                </div>
              )}
            </SettingsCard>
          )}

          <SectionHeading id='diagnostics' label={sectionLabel('diagnostics')} />
          {(
            <>
              <div className='ui-notice items-center text-sm'>
                <Lock size={18} strokeWidth={1.8} className='shrink-0 text-warning' />
                <span className='min-w-0'>{t('settings.readOnlyNotice')}</span>
              </div>

              <div className='flex min-w-0 flex-wrap items-center gap-2'>
                <span className='ui-chip ui-chip-amber'>{t('admin.readOnly')}</span>
                {!loading && !error && (
                  <span className='ui-count money'>{filtered.length}</span>
                )}
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
                <Hint content={t('admin.refresh')} placement='bottom'>
                  <Button
                    isIconOnly
                    variant='bordered'
                    onPress={refresh}
                    isLoading={loading}
                    aria-label={t('admin.refresh')}
                    className='ms-auto border border-[var(--line-strong)] bg-[var(--surface)]'
                  >
                    {!loading && <RotateCw size={20} strokeWidth={1.8} />}
                  </Button>
                </Hint>
              </div>

              {/* One source answered and the other faulted. The rows below are
                  real but incomplete, so say so instead of letting a half-loaded
                  page pass for the whole picture. */}
              {partial && !error && (
                <div className='ui-notice flex-wrap items-center gap-3 p-3'>
                  <AlertTriangle size={20} strokeWidth={1.8} className='shrink-0 text-warning' />
                  <div className='min-w-0 flex-1'>
                    <div className='text-sm font-semibold ink'>
                      {t('admin.settings.partialLoad')}
                    </div>
                    <div className='mt-0.5 break-words text-sm ink-2'>{partial}</div>
                  </div>
                  <Button
                    variant='bordered'
                    className='border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                    onPress={refresh}
                  >
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
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/* ---------- layout helpers ---------- */

/** A card of setting rows; an optional header names a group of related rows. */
function SettingsCard({
  icon,
  title,
  hint,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className='ui-card min-w-0 px-4 sm:px-5'>
      {title && (
        <header className='pt-4 sm:pt-5'>
          <h2 className='flex items-center gap-2 text-base font-semibold ink'>
            {icon}
            {title}
          </h2>
          {hint && <p className='mt-0.5 text-sm ink-2'>{hint}</p>}
        </header>
      )}
      <div className='divide-y divide-[var(--line)]'>{children}</div>
    </section>
  );
}

/** Label + hint on the start side, control on the end (below it when narrow). */
function SettingRow({
  label,
  hint,
  stack,
  children,
}: {
  label?: string;
  hint?: string;
  /** Full-width control with no label column (e.g. paper size). */
  stack?: boolean;
  children: ReactNode;
}) {
  if (stack) {
    return <div className='flex min-w-0 flex-col gap-3 py-4'>{children}</div>;
  }
  return (
    <div className='flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6'>
      <div className='min-w-0 sm:max-w-[60%]'>
        <div className='text-sm font-semibold ink'>{label}</div>
        {hint && <p className='mt-0.5 text-sm ink-2'>{hint}</p>}
      </div>
      <div className='min-w-0 sm:shrink-0'>{children}</div>
    </div>
  );
}

function ResultNotice({
  result,
}: {
  result: { kind: 'success' | 'error'; message: string };
}) {
  const ok = result.kind === 'success';
  return (
    <div className='ui-notice text-sm' role='status'>
      {ok ? (
        <Check size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 text-success' />
      ) : (
        <AlertTriangle size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 text-danger' />
      )}
      <span className='min-w-0 break-words font-semibold ink'>{result.message}</span>
    </div>
  );
}
