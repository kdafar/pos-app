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
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/15 text-red-600 dark:text-red-400',
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
    <div className='max-w-3xl mx-auto p-4'>
      {/* Header */}
      <div className='mb-4'>
        <h3 className='text-xl font-semibold'>{t('update.title')}</h3>
        <div className='text-sm text-muted-foreground'>
          {t('update.subtitle')}
        </div>
      </div>

      {/* Version / last check */}
      <section className='mb-4 rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-4'>
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

      {/* Status */}
      <section
        className={`mb-4 rounded-xl border p-4 ${TONE_RING[view.tone]}`}
        aria-live='polite'
      >
        <div className='flex items-start gap-3'>
          <div
            className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
              TONE_ICON[view.tone]
            }`}
          >
            <view.Icon
              size={18}
              className={state.status === 'checking' ? 'animate-spin' : ''}
            />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='font-semibold'>{view.title}</div>
            {view.hint && (
              <div className='mt-0.5 text-sm text-muted-foreground'>
                {view.hint}
              </div>
            )}

            {/* Download progress */}
            {state.status === 'downloading' && (
              <div className='mt-3'>
                <div className='h-2 w-full rounded-full bg-muted overflow-hidden'>
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

      {/* Actions */}
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='flat'
          onClick={check}
          isLoading={busy || state.status === 'checking'}
          isDisabled={!canCheck}
          startContent={
            busy || state.status === 'checking' ? undefined : (
              <RefreshCw size={16} />
            )
          }
        >
          {t('update.checkNow')}
        </Button>

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

      <div className='mt-6 text-xs text-muted-foreground'>
        {t('update.autoNote')}
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
