// src/renderer/pages/UpdatePage.tsx
//
// The operator-facing side of the auto-updater. The main process already
// checks, downloads and applies on quit (src/main/updater.ts); this screen
// makes that visible and gives the operator the two decisions that are
// genuinely theirs: check now, and restart now instead of at closing time.
//
// One story: "where am I, what should I do". A single hero card carries the
// state (icon, solid status chip, title, hint, progress) and the one relevant
// action; installed version / last checked sit inside it. Below: what's new,
// a three-step stepper with the current step highlighted, and a short
// pre-restart checklist. No tinted fills — status is a solid chip, the icon
// sits in a neutral circle.

import { useMemo, type ReactNode } from 'react';
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
import { PageShell } from '../components/PageShell';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Chip colour per tone: a solid status chip, white text (design system). */
const CHIP: Record<Tone, string> = {
  neutral: 'ui-chip-gray',
  info: 'ui-chip-blue',
  success: 'ui-chip-green',
  warning: 'ui-chip-amber',
  danger: 'ui-chip-red',
};

/** Section heading: small uppercase label, per the design system. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className='text-xs font-semibold uppercase tracking-wide ink-2'>
      {children}
    </h2>
  );
}

/** A label above a value. */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className='text-xs font-semibold uppercase tracking-wide ink-2'>
      {children}
    </div>
  );
}

/** "1. Check" -> "Check": the chip wants the word, not the step number. */
const stripStepNo = (s: string) => s.replace(/^[\d٠-٩]+\.\s*/, '');

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

  const steps: [number, typeof RefreshCw, string, string][] = [
    [1, RefreshCw, t('update.stepCheck'), t('update.stepCheckHelp')],
    [2, Download, t('update.stepDownload'), t('update.stepDownloadHelp')],
    [3, Rocket, t('update.stepInstall'), t('update.stepInstallHelp')],
  ];

  const tips: [typeof Wifi, string][] = [
    [Wifi, t('update.helpInternet')],
    [Clock3, t('update.helpOrders')],
    [Power, t('update.helpPower')],
  ];

  // Short status word for the chip, from text the app already has. Error and
  // disabled have no short word, so their chip carries the icon alone.
  const chipText =
    state.status === 'idle' || state.status === 'checking'
      ? stripStepNo(t('update.stepCheck'))
      : state.status === 'available' || state.status === 'downloading'
      ? stripStepNo(t('update.stepDownload'))
      : state.status === 'ready'
      ? t('update.badgeReady')
      : // "Up to date" has no short word either; "Safe automatic updates"
        // says something else, so this chip is the icon alone (title below).
        null;
  const tone: Tone = state.status === 'ready' ? 'warning' : view.tone;

  const checkButton = (
    <Button
      size='lg'
      color={state.status === 'error' ? 'primary' : 'default'}
      variant={
        state.status === 'error' ? 'solid' : readyVersion ? 'light' : 'bordered'
      }
      className={`font-semibold ${
        state.status === 'error' || readyVersion
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
  );

  return (
    <PageShell title={t('update.title')} subtitle={t('update.subtitle')}>
      <div className='mx-auto w-full max-w-4xl space-y-4 min-w-0'>
        {/* Hero: where am I, and the one thing to do about it. */}
        <div className='ui-card min-w-0'>
          <div className='p-4 sm:p-6' aria-live='polite'>
            <div className='flex flex-col items-start gap-4 sm:flex-row min-w-0'>
              <div className='grid h-14 w-14 shrink-0 place-items-center rounded-full border border-line bg-surface-2'>
                <view.Icon
                  size={28}
                  strokeWidth={1.8}
                  className={`ink ${
                    state.status === 'checking' ? 'animate-spin' : ''
                  }`}
                />
              </div>

              <div className='min-w-0 flex-1'>
                <span
                  className={`ui-chip ${CHIP[tone]}`}
                  aria-label={chipText ? undefined : view.title}
                >
                  <view.Icon size={14} strokeWidth={1.8} />
                  {chipText}
                </span>
                <div className='mt-2 text-xl font-bold ink'>{view.title}</div>
                {view.hint && (
                  <div className='mt-1 max-w-prose text-sm ink-2'>
                    {view.hint}
                  </div>
                )}

                {state.status === 'downloading' && (
                  <div className='mt-4'>
                    <div
                      className='h-3 w-full overflow-hidden rounded-full bg-[var(--hover)]'
                      role='progressbar'
                      aria-valuenow={state.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className='h-full bg-primary transition-[width] duration-300'
                        style={{
                          width: `${Math.min(100, Math.max(0, state.percent))}%`,
                        }}
                      />
                    </div>
                    <div
                      className='mt-1 text-sm font-semibold ink money'
                      dir='ltr'
                    >
                      {state.percent}%
                    </div>
                  </div>
                )}

                {/* Raw error text from the network stack — never translated. */}
                {state.status === 'error' && (
                  <pre
                    className='mt-3 max-h-32 overflow-auto rounded-[11px] border border-line bg-surface-2 p-2 text-xs whitespace-pre-wrap break-all'
                    dir='ltr'
                  >
                    {state.message}
                  </pre>
                )}

                <div className='mt-4 flex flex-wrap items-center gap-2'>
                  {/* The restart decision belongs with the status that prompts it. */}
                  {readyVersion && (
                    <Button
                      color='primary'
                      size='lg'
                      className='w-full font-semibold sm:w-auto'
                      onPress={onInstall}
                      startContent={<Rocket size={16} />}
                    >
                      {t('update.installNow')}
                    </Button>
                  )}
                  {checkButton}
                </div>
              </div>
            </div>
          </div>

          <div className='grid min-w-0 gap-3 border-t border-line p-4 sm:grid-cols-2 sm:px-6'>
            <div className='min-w-0'>
              <FieldLabel>{t('update.installedVersion')}</FieldLabel>
              {/* Versions are identifiers — always Latin, always LTR. */}
              <div
                className='mt-0.5 truncate font-mono text-base font-bold ink'
                dir='ltr'
              >
                v{currentVersion || '—'}
              </div>
            </div>
            <div className='min-w-0'>
              <FieldLabel>{t('update.lastChecked')}</FieldLabel>
              <div className='mt-0.5 text-base font-semibold ink'>
                {lastCheckedText}
              </div>
            </div>
          </div>
        </div>

        {view.notes && (
          <div className='ui-card min-w-0'>
            <div className='flex flex-col gap-2 p-4 sm:p-5'>
              <SectionTitle>{t('update.releaseNotes')}</SectionTitle>
              <pre className='max-h-56 overflow-auto rounded-[11px] border border-line bg-surface-2 p-3 text-sm whitespace-pre-wrap'>
                {view.notes}
              </pre>
            </div>
          </div>
        )}

        <div className='ui-card min-w-0'>
          <div className='flex flex-col gap-3 p-4 sm:p-5'>
            <SectionTitle>{t('update.howItWorks')}</SectionTitle>
            <ol className='grid min-w-0 gap-3 sm:grid-cols-3'>
              {steps.map(([n, Icon, title, help]) => {
                const current = stage === n;
                const past = stage > n;
                return (
                  <li
                    key={n}
                    aria-current={current ? 'step' : undefined}
                    className={`min-w-0 rounded-[16px] border p-3 ${
                      current ? 'border-primary' : 'border-line'
                    }`}
                  >
                    <div className='flex min-w-0 items-center gap-2'>
                      <div
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                          current
                            ? 'bg-primary text-primary-foreground'
                            : past
                            ? 'bg-[var(--ink)] text-[var(--surface)]'
                            : 'bg-[var(--hover)] ink-2'
                        }`}
                      >
                        <Icon size={15} strokeWidth={1.8} />
                      </div>
                      <span
                        className={`truncate font-semibold ${
                          current || past ? 'ink' : 'ink-2'
                        }`}
                      >
                        {title}
                      </span>
                    </div>
                    <p className='mt-2 text-sm leading-5 ink-2'>{help}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className='ui-card min-w-0'>
          <div className='flex flex-col gap-3 p-4 sm:p-5'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <SectionTitle>{t('update.beforeRestart')}</SectionTitle>
              <span className='ui-chip ui-chip-green'>
                <ShieldCheck size={14} strokeWidth={1.8} />
                {t('update.safeBadge')}
              </span>
            </div>
            <ul className='space-y-2'>
              {tips.map(([Icon, text]) => (
                <li key={text} className='flex min-w-0 gap-3 text-sm ink'>
                  <Icon
                    className='mt-0.5 shrink-0 ink-2'
                    strokeWidth={1.8}
                    size={18}
                  />
                  <span className='min-w-0'>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className='max-w-prose px-1 text-xs ink-2'>{t('update.autoNote')}</p>
      </div>
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
