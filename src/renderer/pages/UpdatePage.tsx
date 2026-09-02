// src/renderer/pages/UpdatePage.tsx
//
// The operator-facing side of the auto-updater. The main process already
// checks, downloads and applies on quit (src/main/updater.ts); this screen
// makes that visible and gives the operator the two decisions that are
// genuinely theirs: check now, and restart now instead of at closing time.
//
// Built from the same pieces as every other admin screen — PageShell for the
// frame, Card/CardBody for sections — rather than the hand-rolled header and
// rounded-2xl panels this page grew on its own. It also drops the tinted
// surfaces (`bg-primary/10`, `bg-success/15`) it used to signal state with:
// per StatCard, the accent is a border and an icon on a neutral surface, so a
// status reads at a glance instead of washing out at arm's length.

import { useMemo, type ReactNode } from 'react';
import { Button, Card, CardBody, Chip } from '@heroui/react';
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

/**
 * One accent per tone, as a border and an icon colour.
 *
 * Never a fill: a tinted panel is the thing that made this page unreadable on
 * the dark theme, and a status the operator has to lean in to read is a status
 * they will miss.
 */
const TONE: Record<Tone, { border: string; icon: string }> = {
  neutral: { border: 'border-s-default-300', icon: 'text-default-700' },
  info: { border: 'border-s-primary', icon: 'text-primary' },
  success: { border: 'border-s-success', icon: 'text-success' },
  warning: { border: 'border-s-warning', icon: 'text-warning' },
  danger: { border: 'border-s-danger', icon: 'text-danger' },
};

/** Section heading, one size, so the page has a single visual rhythm. */
function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className='text-base font-bold text-foreground'>{children}</h2>;
}

/**
 * A label above a value. Was `text-[10px]` with wide letter-spacing, which is
 * unreadable across a counter — the shared StatCard label size instead.
 */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className='text-sm font-semibold text-default-700'>{children}</div>
  );
}

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

  return (
    <PageShell
      title={t('update.title')}
      subtitle={t('update.subtitle')}
      primaryAction={
        <Button
          color={state.status === 'error' ? 'primary' : 'default'}
          variant={state.status === 'error' ? 'solid' : 'flat'}
          onPress={check}
          isLoading={checking}
          isDisabled={!canCheck}
          startContent={checking ? undefined : <RefreshCw size={17} />}
        >
          {state.status === 'error' ? t('update.tryAgain') : t('update.checkNow')}
        </Button>
      }
    >
      <div className='space-y-4 min-w-0'>
        {/* Status — the reason the page exists, so it leads. */}
        <Card
          shadow='none'
          className={`border border-default-200 border-s-4 ${TONE[view.tone].border} bg-content1`}
        >
          <CardBody className='gap-0' aria-live='polite'>
            {/* Wraps on a narrow till: the icon and text stop being a row
                before the title has to hyphenate. */}
            <div className='flex items-start gap-3 min-w-0'>
              <view.Icon
                size={26}
                className={`shrink-0 mt-0.5 ${TONE[view.tone].icon} ${
                  state.status === 'checking' ? 'animate-spin' : ''
                }`}
              />

              <div className='min-w-0 flex-1'>
                <div className='text-lg font-bold text-foreground'>
                  {view.title}
                </div>
                {view.hint && (
                  <div className='mt-0.5 text-sm text-default-700'>
                    {view.hint}
                  </div>
                )}

                {state.status === 'downloading' && (
                  <div className='mt-3'>
                    <div
                      className='h-3 w-full rounded-full bg-default-200 overflow-hidden'
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
                      className='mt-1 text-sm font-semibold text-default-700 money'
                      dir='ltr'
                    >
                      {state.percent}%
                    </div>
                  </div>
                )}

                {/* Raw error text from the network stack — never translated. */}
                {state.status === 'error' && (
                  <pre
                    className='mt-3 max-h-32 overflow-auto rounded-lg border border-default-200 bg-default-100 p-2 text-xs whitespace-pre-wrap break-all'
                    dir='ltr'
                  >
                    {state.message}
                  </pre>
                )}

                {view.notes && (
                  <div className='mt-3'>
                    <FieldLabel>{t('update.releaseNotes')}</FieldLabel>
                    <pre className='mt-1 max-h-48 overflow-auto rounded-lg border border-default-200 bg-default-100 p-2 text-xs whitespace-pre-wrap'>
                      {view.notes}
                    </pre>
                  </div>
                )}

                {/* The restart decision belongs with the status that prompts
                    it, not stranded at the bottom of the page. */}
                {readyVersion && (
                  <Button
                    color='primary'
                    className='mt-4 w-full sm:w-auto'
                    onPress={onInstall}
                    startContent={<Rocket size={16} />}
                  >
                    {t('update.installNow')}
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Facts. Two up from the smallest breakpoint — they are short. */}
        <div className='grid gap-4 sm:grid-cols-2 min-w-0'>
          <Card
            shadow='none'
            className='border border-default-200 bg-content1 min-w-0'
          >
            <CardBody className='gap-1'>
              <FieldLabel>{t('update.installedVersion')}</FieldLabel>
              {/* Versions are identifiers — always Latin, always LTR. */}
              <div
                className='font-mono text-xl font-bold text-foreground truncate'
                dir='ltr'
              >
                v{currentVersion || '—'}
              </div>
            </CardBody>
          </Card>

          <Card
            shadow='none'
            className='border border-default-200 bg-content1 min-w-0'
          >
            <CardBody className='gap-1'>
              <FieldLabel>{t('update.lastChecked')}</FieldLabel>
              <div className='text-base font-semibold text-foreground'>
                {lastCheckedText}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* The two explainers sit side by side only once there is genuinely
            room for two columns of prose. */}
        <div className='grid gap-4 xl:grid-cols-2 min-w-0'>
          <Card
            shadow='none'
            className='border border-default-200 bg-content1 min-w-0'
          >
            <CardBody className='gap-4'>
              <SectionTitle>{t('update.howItWorks')}</SectionTitle>

              <div className='grid gap-3 sm:grid-cols-3 xl:grid-cols-1 min-w-0'>
                {steps.map(([n, Icon, title, help]) => {
                  const done = stage >= n;
                  return (
                    <div
                      key={n}
                      className={`rounded-lg border p-3 min-w-0 ${
                        done ? 'border-primary' : 'border-default-200'
                      }`}
                    >
                      <div className='flex items-center gap-2 min-w-0'>
                        <div
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                            done
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-default-200 text-default-700'
                          }`}
                        >
                          <Icon size={15} />
                        </div>
                        <span className='font-semibold text-foreground truncate'>
                          {title}
                        </span>
                      </div>
                      <p className='mt-2 text-sm leading-5 text-default-700'>
                        {help}
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          <Card
            shadow='none'
            className='border border-default-200 bg-content1 min-w-0'
          >
            <CardBody className='gap-4'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <SectionTitle>{t('update.beforeRestart')}</SectionTitle>
                <Chip
                  size='sm'
                  color='primary'
                  variant='solid'
                  className='font-semibold'
                  startContent={<ShieldCheck size={14} />}
                >
                  {t('update.safeBadge')}
                </Chip>
              </div>

              <div className='space-y-3'>
                {tips.map(([Icon, text]) => (
                  <div
                    key={text}
                    className='flex gap-3 text-sm text-default-700 min-w-0'
                  >
                    <Icon
                      className='mt-0.5 shrink-0 text-primary'
                      size={18}
                    />
                    <span className='min-w-0'>{text}</span>
                  </div>
                ))}
              </div>

              <p className='text-sm leading-5 text-default-700 border-t border-default-200 pt-3'>
                {t('update.autoNote')}
              </p>
            </CardBody>
          </Card>
        </div>
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
