// src/renderer/components/ToastProvider.tsx
//
// Where a code becomes pixels.
//
// The catalogue's severity picks the component, and nothing else does:
//
//   blocker → centred modal, dimmed backdrop, explicit dismissal. Work stops.
//   toast   → bottom-centre card, auto-dismiss, optional retry.
//   inline  → not here. Field errors live in FormIssues.tsx, under the control.
//   info    → quiet toast. Queues, progress, confirmations. Never red.
//
// Sizes below are floors, not suggestions: a till is read at 60–80 cm, in a
// hurry, sometimes by someone not wearing their reading glasses. Body text is
// 18px, titles 22px, and the blocker runs a step up because Arabic renders
// visually smaller at the same pixel size.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { Button } from '@heroui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useI18n } from '../i18n';
import { describeError } from '../utils/posError';
import { decodePosError } from '../../shared/errors';
import type { Severity } from '../../shared/errorCatalog';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Info,
  AlertCircle,
  AlertOctagon,
  RotateCw,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';

/** Legacy tone names, still used by the non-error call sites. */
type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export type ToastOptions = {
  title?: string;
  message?: ReactNode;
  tone?: ToastTone;
  durationMs?: number;
  /** Adds a "Try again" button that runs this and dismisses the toast. */
  onRetry?: () => void | Promise<void>;
  /** Untranslated original, tucked behind a disclosure for support calls. */
  detail?: string;
  /** Catalogue code, shown next to the details for support calls. */
  code?: string;
};

type ToastInternal = ToastOptions & {
  id: number;
  /** How many times this same toast fired before it was dismissed. */
  count: number;
  durationMs: number;
  dedupeKey: string;
};

type Blocker = {
  title: string;
  message: string;
  code: string;
  detail?: string;
  onRetry?: () => void | Promise<void>;
};

export type ToastFn = ((options: ToastOptions) => void) & {
  /**
   * The one call sites should reach for. Takes whatever was thrown, translates
   * it, and routes it by severity — no component formats `err.message` itself.
   */
  error: (
    err: unknown,
    opts?: { title?: string; onRetry?: () => void | Promise<void>; durationMs?: number }
  ) => void;
  success: (title: string, message?: ReactNode) => void;
};

const ToastContext = createContext<ToastFn | null>(null);

/** Keyframes for the dismiss countdown, kept next to the only thing using them. */
const POS_TOAST_KEYFRAMES = `
@keyframes posToastCountdown { from { width: 100% } to { width: 0% } }
@media (prefers-reduced-motion: reduce) {
  @keyframes posToastCountdown { from { width: 100% } to { width: 100% } }
}
`;

/**
 * A cashier reads this across a counter, sometimes over a shoulder. Failures
 * sit long enough to be read twice; a confirmation does not need to.
 */
const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  danger: 8000,
};

/** Catalogue severity → the tone the card is painted in. */
const TONE_FOR_SEVERITY: Record<Severity, ToastTone> = {
  blocker: 'danger',
  toast: 'danger',
  inline: 'warning',
  info: 'info',
};

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  const { lang } = useI18n();

  // Safe fallback if the provider is missing (e.g. a different root / window).
  const noop = useMemo<ToastFn>(() => {
    const warn = (...args: unknown[]) => {
      if ((import.meta as any)?.env?.MODE === 'development') {
        console.warn('[ToastProvider] useToast called outside ToastProvider.', ...args);
      }
    };
    const fn = ((o: ToastOptions) => warn(o)) as ToastFn;
    fn.error = (err) => {
      // Still say something useful in the console rather than swallowing it.
      console.error('[toast.error outside provider]', describeError(err, lang), err);
    };
    fn.success = (title) => warn(title);
    return fn;
  }, [lang]);

  return ctx ?? noop;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t, lang, isRTL } = useI18n();
  const [toasts, setToasts] = useState<ToastInternal[]>([]);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [paused, setPaused] = useState(false);

  // Timers live outside state so pausing does not re-render the stack.
  const timers = useRef(new Map<number, { handle: number; endsAt: number; left: number }>());
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    const entry = timers.current.get(id);
    if (entry) {
      window.clearTimeout(entry.handle);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => {
      const prev = timers.current.get(id);
      if (prev) window.clearTimeout(prev.handle);
      if (ms <= 0) return;
      const handle = window.setTimeout(() => remove(id), ms);
      timers.current.set(id, { handle, endsAt: Date.now() + ms, left: ms });
    },
    [remove]
  );

  // Hovering the stack freezes every countdown — a cashier reaching for the
  // "Try again" button should not have the toast vanish from under the cursor.
  useEffect(() => {
    if (paused) {
      for (const [id, entry] of timers.current) {
        window.clearTimeout(entry.handle);
        timers.current.set(id, { ...entry, left: Math.max(400, entry.endsAt - Date.now()) });
      }
      return;
    }
    for (const [id, entry] of timers.current) schedule(id, entry.left);
  }, [paused, schedule]);

  const show = useCallback(
    (opts: ToastOptions) => {
      const tone: ToastTone = opts.tone ?? 'info';
      const durationMs = opts.durationMs ?? DEFAULT_DURATION[tone];
      const dedupeKey = [
        tone,
        opts.code ?? '',
        opts.title ?? '',
        typeof opts.message === 'string' ? opts.message : '',
      ].join('|');

      setToasts((prev) => {
        // The same failure fired twice (a double-tap on Place Order) should read
        // as "×2", not as two stacked copies of the same paragraph.
        const existing = prev.find((x) => x.dedupeKey === dedupeKey);
        if (existing) {
          schedule(existing.id, durationMs);
          return prev.map((x) =>
            x.id === existing.id ? { ...x, count: x.count + 1, ...opts, durationMs } : x
          );
        }

        const id = nextId.current++;
        schedule(id, durationMs);
        const next: ToastInternal = { ...opts, tone, id, count: 1, durationMs, dedupeKey };
        // Three at once already covers the counter; older ones drop off so the
        // stack never walks off the edge of a 1024-tall till screen.
        return [...prev, next].slice(-3);
      });
    },
    [schedule]
  );

  const api = useMemo<ToastFn>(() => {
    const fn = ((opts: ToastOptions) => show(opts)) as ToastFn;

    fn.error = (err, o = {}) => {
      const d = describeError(err, lang);
      // The raw thing stays in the console for whoever debugs this later; the
      // screen only ever gets the translated version.
      console.error(`[${d.code}]`, err);

      if (d.severity === 'blocker') {
        setBlocker({
          title: o.title ?? d.title,
          message: d.message,
          code: d.code,
          detail: d.detail,
          onRetry: d.retryable ? o.onRetry : undefined,
        });
        return;
      }

      show({
        tone: TONE_FOR_SEVERITY[d.severity],
        title: o.title ?? d.title,
        message: d.message,
        detail: d.detail,
        code: d.code,
        durationMs: o.durationMs,
        onRetry: d.retryable ? o.onRetry : undefined,
      });
    };

    fn.success = (title, message) => show({ tone: 'success', title, message });

    return fn;
  }, [show, lang]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const entry of map.values()) window.clearTimeout(entry.handle);
      map.clear();
    };
  }, []);

  /*
   * Safety net for a handler that refused inside a promise nobody awaited.
   * Before, those failed in total silence: the button did nothing and the
   * cashier pressed it again.
   *
   * Deliberately narrow — only rejections carrying one of our own codes are
   * surfaced. Anything else (an aborted fetch, a library's internal rejection)
   * is left alone, so the net catches real refusals without becoming noise.
   */
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: any = event.reason;
      const raw =
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
      if (!raw || !decodePosError(raw)) return;
      event.preventDefault();
      api.error(reason);
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}

      <style>{POS_TOAST_KEYFRAMES}</style>

      {/* Bottom-centre, clear of the edge and above a numpad. */}
      <div
        className='pointer-events-none fixed inset-x-0 bottom-6 z-[9999] flex flex-col items-center gap-3 px-4'
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastCard
              key={toast.id}
              toast={toast}
              paused={paused}
              t={t}
              onDismiss={() => remove(toast.id)}
            />
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {blocker && (
          <BlockerDialog
            blocker={blocker}
            isRTL={isRTL}
            t={t}
            onClose={() => setBlocker(null)}
          />
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
}

const TONE_STYLES: Record<
  ToastTone,
  { icon: ReactNode; chip: string; accent: string; bar: string }
> = {
  success: {
    icon: <CheckCircle2 className='h-6 w-6' />,
    chip: 'bg-success/15 text-success',
    accent: 'border-s-success',
    bar: 'bg-success',
  },
  warning: {
    icon: <AlertTriangle className='h-6 w-6' />,
    chip: 'bg-warning/15 text-warning',
    accent: 'border-s-warning',
    bar: 'bg-warning',
  },
  danger: {
    icon: <AlertCircle className='h-6 w-6' />,
    chip: 'bg-danger/15 text-danger',
    accent: 'border-s-danger',
    bar: 'bg-danger',
  },
  info: {
    icon: <Info className='h-6 w-6' />,
    chip: 'bg-primary/15 text-primary',
    accent: 'border-s-primary',
    bar: 'bg-primary',
  },
};

function ToastCard({
  toast,
  paused,
  t,
  onDismiss,
}: {
  toast: ToastInternal;
  paused: boolean;
  t: (key: any, vars?: Record<string, string | number>) => string;
  onDismiss: () => void;
}) {
  const tone = toast.tone ?? 'info';
  const style = TONE_STYLES[tone];
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDetail = async () => {
    const text = [toast.code, toast.title, toast.detail].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the text is on screen anyway */
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.14 } }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-auto w-full max-w-[560px] sm:min-w-[420px]
        overflow-hidden rounded-xl border border-default-200 border-s-4 ${style.accent}
        bg-content1 shadow-2xl`}
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
    >
      <div className='flex items-start gap-3 p-4'>
        {/* The icon carries the state as well as the colour — a good part of
            any shop's staff cannot rely on red-versus-amber alone. */}
        <span
          className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${style.chip}`}
        >
          {style.icon}
        </span>

        <div className='min-w-0 flex-1'>
          {toast.title && (
            <div className='flex items-center gap-2'>
              {/* Title says what happened; the body says what to do next. */}
              <span className='text-[22px] font-bold leading-snug text-foreground'>
                {toast.title}
              </span>
              {toast.count > 1 && (
                <span className='rounded-full bg-default-200 px-2 py-0.5 text-base font-bold text-default-700'>
                  {t('error.repeated', { count: toast.count })}
                </span>
              )}
            </div>
          )}

          {toast.message && (
            // 18px floor, dark neutral rather than red — small red text on a
            // light background is the least readable thing on a till.
            <div className='mt-1 break-words text-[18px] font-medium leading-relaxed text-default-700'>
              {toast.message}
            </div>
          )}

          {(toast.onRetry || toast.detail) && (
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              {toast.onRetry && (
                <Button
                  size='lg'
                  variant='flat'
                  color={tone === 'danger' ? 'danger' : 'primary'}
                  className='h-12 text-base font-semibold'
                  startContent={<RotateCw className='h-5 w-5' />}
                  onPress={() => {
                    onDismiss();
                    void toast.onRetry?.();
                  }}
                >
                  {t('common.retry')}
                </Button>
              )}
              {toast.detail && (
                <Button
                  size='sm'
                  variant='light'
                  className='h-11 text-base text-default-600'
                  endContent={
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${showDetail ? 'rotate-180' : ''}`}
                    />
                  }
                  onPress={() => setShowDetail((v) => !v)}
                >
                  {showDetail ? t('error.hideDetails') : t('error.details')}
                </Button>
              )}
            </div>
          )}

          <AnimatePresence initial={false}>
            {showDetail && toast.detail && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className='overflow-hidden'
              >
                <div className='mt-2 rounded-lg bg-default-100 p-2.5'>
                  {toast.code && (
                    <div className='mb-1 text-base font-bold tracking-wide text-default-500'>
                      {t('error.code')}: {toast.code}
                    </div>
                  )}
                  {/* dir=ltr: the raw text is English, and mirroring it in an
                      Arabic UI makes it unreadable to whoever is on the phone
                      to support. */}
                  <div dir='ltr' className='break-words text-start text-base text-default-600'>
                    {toast.detail}
                  </div>
                  <Button
                    size='sm'
                    variant='light'
                    className='mt-1 h-11 text-base text-default-600'
                    startContent={
                      copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />
                    }
                    onPress={copyDetail}
                  >
                    {copied ? t('error.copied') : t('error.copy')}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Button
          isIconOnly
          variant='light'
          size='md'
          radius='full'
          className='h-11 w-11 shrink-0'
          aria-label={t('toast.dismiss')}
          onPress={onDismiss}
        >
          <X className='h-5 w-5 text-default-600' />
        </Button>
      </div>

      {/* Countdown. A CSS animation rather than a motion tween, because pausing
          is then a single property — the bar freezes exactly when the dismiss
          timer does, instead of drifting out of step with it. */}
      {toast.durationMs > 0 && (
        <div className='h-1 w-full bg-default-100'>
          <div
            className={`h-full ${style.bar} opacity-60`}
            style={{
              animation: `posToastCountdown ${toast.durationMs}ms linear forwards`,
              animationPlayState: paused ? 'paused' : 'running',
            }}
          />
        </div>
      )}
    </motion.div>
  );
}

/**
 * Severity `blocker`: the till cannot carry on until someone does something
 * about it — a locked device, a revoked pairing, a user with no branch. It
 * takes the screen, and it does not dismiss itself.
 */
function BlockerDialog({
  blocker,
  isRTL,
  t,
  onClose,
}: {
  blocker: Blocker;
  isRTL: boolean;
  t: (key: any, vars?: Record<string, string | number>) => string;
  onClose: () => void;
}) {
  return (
    <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4'>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className='absolute inset-0 bg-black/60'
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className='relative w-full max-w-[560px] rounded-2xl border border-danger/40 bg-content1 p-8 shadow-2xl'
        role='alertdialog'
        aria-modal='true'
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <span className='mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-danger/15 text-danger'>
          <AlertOctagon className='h-8 w-8' />
        </span>

        {/* Arabic renders visually smaller at the same size, so the title runs
            a step up from the toast's 22px. */}
        <h2 className='text-[24px] font-bold leading-snug text-foreground'>{blocker.title}</h2>
        <p className='mt-2 text-[18px] font-medium leading-relaxed text-default-700'>
          {blocker.message}
        </p>

        <div className='mt-6 flex flex-wrap items-center gap-3'>
          <Button
            color='danger'
            size='lg'
            className='h-12 min-w-[8rem] text-base font-semibold'
            onPress={onClose}
          >
            {t('common.ok')}
          </Button>
          {blocker.onRetry && (
            <Button
              variant='flat'
              size='lg'
              className='h-12 text-base font-semibold'
              startContent={<RotateCw className='h-5 w-5' />}
              onPress={() => {
                onClose();
                void blocker.onRetry?.();
              }}
            >
              {t('common.retry')}
            </Button>
          )}
        </div>

        <div className='mt-5 text-base text-default-500'>
          {t('error.code')}: <span dir='ltr'>{blocker.code}</span>
        </div>
      </motion.div>
    </div>
  );
}
