// src/renderer/pages/UpdatePage.tsx
//
// The operator-facing side of the auto-updater. The main process already
// checks, downloads and applies on quit (src/main/updater.ts); this screen
// makes that visible and gives the operator the two decisions that are
// genuinely theirs: check now, and restart now instead of at closing time.

import { useMemo } from 'react';
import { Button } from '@heroui/react';
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Rocket,
  ShieldCheck,
  Wifi,
  Power,
  Clock3,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useUpdate, type UpdateState } from '../hooks/useUpdate';
import { useToast } from '../components/ToastProvider';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_RING: Record<Tone, string> = {
  neutral: 'border-border',
  info: 'border-sky-500/40',
  success: 'border-emerald-500/40',
  warning: 'border-amber-500/40',
  danger: 'border-red-500/40',
};

const TONE_ICON: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

function formatBytes(n: number): string {
  if (!n || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // Sizes are numerals + Latin units; they read the same in both languages.
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function UpdatePage() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirmDialog();
  const { state, currentVersion, lastCheckedAt, busy, check, install } =
    useUpdate();

  const view = useMemo(() => describe(state, t), [state, t]);

  const lastCheckedText = useMemo(() => {
    if (!lastCheckedAt) return t('update.never');
    return new Date(lastCheckedAt).toLocaleString();
  }, [lastCheckedAt, t]);

  const readyVersion = state.status === 'ready' ? state.version : null;
  const stage = ['available', 'downloading'].includes(state.status)
    ? 2
    : state.status === 'ready'
    ? 3
    : 1;
  // A check while downloading or installing would be ignored by main anyway.
  const canCheck =
    !busy &&
    state.status !== 'checking' &&
    state.status !== 'downloading' &&
    state.status !== 'disabled';

  const onInstall = async () => {
    if (!readyVersion) return;
    const ok = await confirm({
      title: t('update.confirmInstallTitle'),
      message: t('update.confirmInstallMessage', { v: readyVersion }),
      confirmLabel: t('update.installNow'),
      // Restarting mid-shift loses whatever is on screen — treat it as destructive.
      tone: 'danger',
    });
    if (!ok) return;

    // On success the app quits, so only the refusal path ever gets here.
    const res = await install();
    if (!res?.ok) {
      toast({ tone: 'warning', title: t('update.installRefused') });
    }
  };

  return (
    <div className='max-w-5xl mx-auto p-4 md:p-6 space-y-5'>
      {/* Header */}
      <header className='rounded-2xl border border-default-200 bg-content1 p-5 md:p-7 shadow-sm'>
        <div className='relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between'>
          <div className='max-w-2xl'>
            <div className='mb-2 inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-600 dark:text-sky-300'>
              <ShieldCheck size={14} /> {t('update.safeBadge')}
            </div>
            <h1 className='text-2xl md:text-3xl font-bold'>{t('update.title')}</h1>
            <p className='mt-2 text-sm md:text-base text-default-600'>{t('update.subtitle')}</p>
          </div>
          <Button color={state.status === 'error' ? 'primary' : 'default'} variant={state.status === 'error' ? 'solid' : 'flat'} onPress={check} isLoading={busy || state.status === 'checking'} isDisabled={!canCheck} startContent={busy || state.status === 'checking' ? undefined : <RefreshCw size={17} />}>
            {state.status === 'error' ? t('update.tryAgain') : t('update.checkNow')}
          </Button>
        </div>
      </header>

      {/* Version / last check */}
      <section className='rounded-2xl border border-default-200 bg-content1 p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm'>
        <div>
          <div className='text-[10px] uppercase tracking-[0.18em] text-muted-foreground'>
            {t('update.installedVersion')}
          </div>
          {/* Versions are identifiers — always Latin, always LTR. */}
          <div className='font-mono text-lg font-semibold' dir='ltr'>
            v{currentVersion || '—'}
          </div>
        </div>

        <div className='text-end'>
          <div className='text-[10px] uppercase tracking-[0.18em] text-muted-foreground'>
            {t('update.lastChecked')}
          </div>
          <div className='text-sm'>{lastCheckedText}</div>
        </div>
      </section>

      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]'>
      <main className='space-y-5'>
      {/* Status */}
      <section
        className={`rounded-2xl border bg-content1 p-5 md:p-6 shadow-sm ${TONE_RING[view.tone]}`}
        aria-live='polite'
      >
        <div className='flex items-start gap-3'>
          <div
            className={`shrink-0 h-12 w-12 rounded-xl flex items-center justify-center ${
              TONE_ICON[view.tone]
            }`}
          >
            <view.Icon
              size={22}
              className={state.status === 'checking' ? 'animate-spin' : ''}
            />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='text-lg font-bold'>{view.title}</div>
            {view.hint && (
              <div className='mt-0.5 text-sm text-muted-foreground'>
                {view.hint}
              </div>
            )}

            {/* Download progress */}
            {state.status === 'downloading' && (
              <div className='mt-3'>
                <div className='h-3 w-full rounded-full bg-default-100 overflow-hidden'>
                  <div
                    className='h-full bg-sky-500 transition-[width] duration-300'
                    style={{
                      width: `${Math.min(100, Math.max(0, state.percent))}%`,
                    }}
                  />
                </div>
                <div className='mt-1 text-xs text-muted-foreground font-mono' dir='ltr'>
                  {state.percent}%
                </div>
              </div>
            )}

            {/* Raw error text from the network stack — never translated. */}
            {state.status === 'error' && (
              <pre
                className='mt-3 max-h-32 overflow-auto rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap break-all'
                dir='ltr'
              >
                {state.message}
              </pre>
            )}

            {/* Release notes */}
            {view.notes && (
              <div className='mt-3'>
                <div className='text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1'>
                  {t('update.releaseNotes')}
                </div>
                <pre className='max-h-48 overflow-auto rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap'>
                  {view.notes}
                </pre>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className='rounded-2xl border border-default-200 bg-content1 p-5 shadow-sm'>
        <h2 className='font-bold'>{t('update.howItWorks')}</h2>
        <div className='mt-4 grid gap-3 sm:grid-cols-3'>
          {[
            [1, RefreshCw, t('update.stepCheck'), t('update.stepCheckHelp')],
            [2, Download, t('update.stepDownload'), t('update.stepDownloadHelp')],
            [3, Rocket, t('update.stepInstall'), t('update.stepInstallHelp')],
          ].map(([n, Icon, title, help]: any) => (
            <div key={n} className={`rounded-xl border p-3 ${stage >= n ? 'border-sky-500/40 bg-sky-500/5' : 'border-default-200'}`}>
              <div className='flex items-center gap-2'>
                <div className={`grid h-8 w-8 place-items-center rounded-full ${stage >= n ? 'bg-sky-500 text-white' : 'bg-default-100 text-default-500'}`}><Icon size={15} /></div>
                <span className='font-semibold'>{title}</span>
              </div>
              <p className='mt-2 text-xs leading-5 text-default-600'>{help}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Actions */}
      <div className='flex flex-wrap items-center gap-2'>
        {readyVersion && (
          <Button
            color='primary'
            onClick={onInstall}
            startContent={<Rocket size={16} />}
          >
            {t('update.installNow')}
          </Button>
        )}
      </div>
      </main>
      <aside className='space-y-4'>
        <section className='rounded-2xl border border-default-200 bg-content1 p-5 shadow-sm'>
          <h2 className='font-bold'>{t('update.beforeRestart')}</h2>
          <div className='mt-4 space-y-4'>
            {[[Wifi, t('update.helpInternet')], [Clock3, t('update.helpOrders')], [Power, t('update.helpPower')]].map(([Icon, text]: any) => (
              <div key={text} className='flex gap-3 text-sm text-default-600'><Icon className='mt-0.5 shrink-0 text-sky-500' size={18} /><span>{text}</span></div>
            ))}
          </div>
        </section>
        <section className='rounded-2xl border border-default-200 bg-default-50 p-4'>
          <div className='text-xs leading-5 text-default-600'>{t('update.autoNote')}</div>
        </section>
      </aside>
      </div>
    </div>
  );
}

/** Everything the card renders, derived from one state. Kept out of the
 *  component so each status has exactly one description. */
function describe(
  state: UpdateState,
  t: (k: any, vars?: Record<string, string | number>) => string
): { tone: Tone; Icon: typeof RefreshCw; title: string; hint?: string; notes?: string } {
  switch (state.status) {
    case 'checking':
      return {
        tone: 'info',
        Icon: RefreshCw,
        title: t('update.checkingTitle'),
      };

    case 'available':
      return {
        tone: 'info',
        Icon: Download,
        title: t('update.availableTitle', { v: state.version }),
        hint: t('update.availableHint'),
        notes: state.notes,
      };

    case 'downloading':
      return {
        tone: 'info',
        Icon: Download,
        title: t('update.downloadingTitle'),
        hint: state.total
          ? t('update.downloadingHint', {
              done: formatBytes(state.transferred),
              total: formatBytes(state.total),
              speed: formatBytes(state.bytesPerSecond),
            })
          : undefined,
      };

    case 'ready':
      return {
        tone: 'success',
        Icon: CheckCircle2,
        title: t('update.readyTitle', { v: state.version }),
        hint: t('update.readyHint'),
        notes: state.notes,
      };

    case 'none':
      return {
        tone: 'success',
        Icon: CheckCircle2,
        title: t('update.noneTitle'),
        hint: t('update.noneHint'),
      };

    case 'error':
      return {
        tone: 'danger',
        Icon: AlertTriangle,
        title: t('update.errorTitle'),
        hint: t('update.errorHint'),
      };

    case 'disabled':
      return {
        tone: 'warning',
        Icon: Ban,
        title: t('update.disabledTitle'),
        hint: t(`update.disabled.${state.reason}` as any),
      };

    case 'idle':
    default:
      return {
        tone: 'neutral',
        Icon: RefreshCw,
        title: t('update.idleTitle'),
        hint: t('update.idleHint'),
      };
  }
}

export default UpdatePage;
