// src/renderer/pages/UpdatePage.tsx
//
// The operator-facing side of the auto-updater. The main process already
// checks, downloads and applies on quit (src/main/updater.ts); this screen
// makes that visible and gives the operator the two decisions that are
// genuinely theirs: check now, and restart now instead of at closing time.
//
// One panel, three questions: which version is this, is it current, what do
// I tap. The single relevant action sits next to the version; the status line
// says where things stand (with a progress bar while downloading); the
// pre-restart checklist appears only when a restart is the next step, and
// release notes only when there is a new version. Everything else is one
// quiet line under the panel.

import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Rocket,
  Power,
  Clock3,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useUpdate, type UpdateState } from '../hooks/useUpdate';
import { useToast } from '../components/ToastProvider';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { PageShell } from '../components/PageShell';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Status icon colour per tone (fixed status colours, design system). */
const DOT: Record<Tone, string> = {
  neutral: 'ink-3',
  info: 'text-[var(--st-blue)]',
  success: 'text-[var(--st-green)]',
  warning: 'text-[var(--st-amber)]',
  danger: 'text-[var(--st-red)]',
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

  const checking = busy || state.status === 'checking';

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

  // Shown only when an update is ready, so the download is already done:
  // "keep the internet connected" no longer applies.
  const tips: [typeof Clock3, string][] = [
    [Clock3, t('update.helpOrders')],
    [Power, t('update.helpPower')],
  ];
  const tone: Tone = state.status === 'ready' ? 'warning' : view.tone;
  const [showError, setShowError] = useState(false);

  return (
    <PageShell title={t('update.title')} subtitle={t('update.subtitle')}>
      {/* One panel: which version, is it current, the one thing to do. */}
      <div className='ui-card w-full max-w-2xl min-w-0 overflow-hidden'>
        {/* Version + the one action */}
        <div className='flex flex-wrap items-center gap-4 p-4 sm:p-5'>
          <div className='grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-[var(--brand)] text-[var(--brand-ink)]'>
            <Rocket size={22} strokeWidth={1.8} />
          </div>
          <div className='min-w-0 flex-1'>
            <div className='text-xs font-semibold ink-2'>
              {t('update.installedVersion')}
            </div>
            {/* Versions are identifiers: always Latin, always LTR. */}
            <div className='text-2xl font-bold ink money' dir='ltr'>
              v{currentVersion || '—'}
            </div>
          </div>
          <div className='flex w-full flex-wrap gap-2 sm:w-auto'>
            {readyVersion ? (
              <Button
                color='primary'
                size='lg'
                className='w-full font-semibold sm:w-auto'
                onPress={onInstall}
                startContent={<Rocket size={16} />}
              >
                {t('update.installNow')}
              </Button>
            ) : state.status !== 'disabled' ? (
              <Button
                size='lg'
                color={state.status === 'error' ? 'primary' : 'default'}
                variant={state.status === 'error' ? 'solid' : 'bordered'}
                className={`w-full font-semibold sm:w-auto ${
                  state.status === 'error'
                    ? ''
                    : 'border border-[var(--line-strong)] bg-[var(--surface)]'
                }`}
                onPress={check}
                isLoading={checking}
                isDisabled={!canCheck}
                startContent={checking ? undefined : <RefreshCw size={17} />}
              >
                {state.status === 'error' ? t('update.tryAgain') : t('update.checkNow')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Status */}
        <div className='border-t border-line p-4 sm:p-5' aria-live='polite'>
          <div className='flex min-w-0 items-start gap-3'>
            <view.Icon
              size={20}
              strokeWidth={1.8}
              className={`mt-0.5 shrink-0 ${DOT[tone]} ${
                state.status === 'checking' ? 'animate-spin' : ''
              }`}
            />
            <div className='min-w-0 flex-1'>
              <div className='font-semibold ink'>{view.title}</div>
              {view.hint && <div className='mt-0.5 text-sm ink-2'>{view.hint}</div>}
              <div className='mt-1 text-xs ink-3'>
                {t('update.lastChecked')}: {lastCheckedText}
              </div>
            </div>
          </div>

          {state.status === 'downloading' && (
            <div className='mt-3 flex items-center gap-3'>
              <div
                className='h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--hover)]'
                role='progressbar'
                aria-valuenow={state.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className='h-full bg-[var(--brand)] transition-[width] duration-300'
                  style={{ width: `${Math.min(100, Math.max(0, state.percent))}%` }}
                />
              </div>
              <span className='text-sm font-semibold ink money' dir='ltr'>
                {state.percent}%
              </span>
            </div>
          )}

          {/* Raw error text from the network stack is never translated, so it
              stays folded away unless someone asks for it. */}
          {state.status === 'error' && (
            <div className='mt-3'>
              <button
                type='button'
                className='ui-btn ui-btn-ghost ui-btn-sm'
                onClick={() => setShowError((v) => !v)}
                aria-expanded={showError}
              >
                {showError ? t('error.hideDetails') : t('error.details')}
              </button>
              {showError && (
                <pre
                  className='mt-2 max-h-32 overflow-auto rounded-[11px] border border-line bg-surface-2 p-2 text-xs whitespace-pre-wrap break-all'
                  dir='ltr'
                >
                  {state.message}
                </pre>
              )}
            </div>
          )}

          {/* The checklist only matters when a restart is the next step. */}
          {readyVersion && (
            <div className='ui-notice mt-3 flex-col'>
              <div className='flex items-center gap-2 font-semibold'>
                <AlertTriangle size={16} strokeWidth={1.8} className='text-[var(--st-amber)]' />
                {t('update.beforeRestart')}
              </div>
              <ul className='mt-1 space-y-1.5'>
                {tips.map(([Icon, text]) => (
                  <li key={text} className='flex min-w-0 gap-2 text-sm ink'>
                    <Icon className='mt-0.5 shrink-0 ink-2' strokeWidth={1.8} size={16} />
                    <span className='min-w-0'>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {view.notes && (
          <div className='border-t border-line p-4 sm:p-5'>
            <div className='mb-2 text-xs font-semibold uppercase tracking-wide ink-2'>
              {t('update.releaseNotes')}
            </div>
            <pre className='max-h-56 overflow-auto text-sm ink whitespace-pre-wrap font-[inherit]'>
              {view.notes}
            </pre>
          </div>
        )}
      </div>

      <p className='mt-3 max-w-2xl px-1 text-xs ink-2'>{t('update.autoNote')}</p>
    </PageShell>
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
        tone: 'neutral',
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
