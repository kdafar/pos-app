// src/renderer/components/FormIssues.tsx
//
// Validation that happens before anything is sent.
//
// The old flow let the cashier press Place Order, waited for the main process
// to refuse, and then dropped a raw English sentence on screen. Nothing pointed
// at the field that was wrong, and there was no way to tell "you forgot
// something" apart from "the till is broken".
//
// So: the same rules run in the form, every failure names the field it belongs
// to, and the summary can walk the cashier straight to it.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { ERROR_CATALOG, interpolate } from '../../shared/errorCatalog';
import type { PosErrorCode } from '../../shared/errorCatalog';

export type FormIssue = {
  code: PosErrorCode;
  /** Matches a `data-field="…"` wrapper in the form, so we can jump to it. */
  field: string;
  /** Interpolation values for the code's message. */
  params?: Record<string, string | number>;
};

/**
 * Runs `validate` on demand and keeps whatever it found.
 *
 * `check()` returns true when the form is clean, so a submit handler reads as
 * `if (!issues.check()) return;` — no ordering trap where validation runs but
 * the result is ignored.
 */
export function useFormIssues(validate: () => FormIssue[]) {
  const [issues, setIssues] = useState<FormIssue[]>([]);
  // Bumped on every failed attempt so the summary re-plays its nudge even when
  // the list of problems has not changed — pressing Place Order twice with the
  // same field empty should visibly do something both times.
  const [attempt, setAttempt] = useState(0);
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const check = useCallback(() => {
    const found = validateRef.current();
    setIssues(found);
    setAttempt((n) => n + 1);
    return found.length === 0;
  }, []);

  /** Re-run only if something is already showing, so a clean form stays quiet. */
  const refresh = useCallback(() => {
    setIssues((prev) => (prev.length ? validateRef.current() : prev));
  }, []);

  const clear = useCallback(() => setIssues([]), []);

  const has = useCallback(
    (field: string) => issues.some((i) => i.field === field),
    [issues]
  );

  const codeFor = useCallback(
    (field: string) => issues.find((i) => i.field === field),
    [issues]
  );

  return { issues, attempt, check, refresh, clear, has, codeFor, setIssues };
}

/** Move the cashier's eye and keyboard to the field a summary row points at. */
export function focusField(root: HTMLElement | Document | null, field: string) {
  const scope = root ?? document;
  const wrap = scope.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (!wrap) return;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const input = wrap.querySelector<HTMLElement>(
    'input:not([type="hidden"]), textarea, select, button'
  );
  window.setTimeout(() => input?.focus(), 220);
}

/** Border/ring classes for an input that is currently flagged. */
export function fieldRing(invalid: boolean): string {
  return invalid
    ? 'border-danger ring-2 ring-danger/30 focus:ring-danger/40'
    : '';
}

/**
 * The one-line message under a flagged field. Kept short — the summary at the
 * top carries the fuller explanation.
 */
export function FieldError({ issue }: { issue?: FormIssue }) {
  const { lang } = useI18n();
  return (
    <AnimatePresence initial={false}>
      {issue && (
        <motion.div
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: -4 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className='overflow-hidden'
        >
          {/* 18px floor. The icon carries the state as well as the colour. */}
          <div className='mt-1.5 flex items-start gap-1.5 text-[16px] font-semibold text-danger'>
            <AlertTriangle className='mt-[3px] h-4 w-4 shrink-0' />
            <span>{interpolate(ERROR_CATALOG[issue.code][lang].body, issue.params)}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A floating card over the form, not a band inside it.
 *
 * It started as a banner in the document flow above the scroll area. That was
 * wrong twice: it pushed the fields down and then got clipped by the form's own
 * `min-h-0` scroller, so on a one-issue order the cashier saw a huge red block
 * with its own text cut in half.
 *
 * It is also deliberately terse. The field itself carries the explanation —
 * this card only says how many are left and takes you to them, so the two are
 * not shouting the same sentence at each other.
 */
export function ValidationSummary({
  issues,
  attempt,
  onFocusField,
  onDismiss,
  extraAction,
}: {
  issues: FormIssue[];
  /** Increments on each failed submit; drives the nudge animation. */
  attempt: number;
  onFocusField?: (field: string) => void;
  onDismiss?: () => void;
  /** Per-field escape hatch, e.g. a "Choose table" button for the table rule. */
  extraAction?: (issue: FormIssue) => ReactNode;
}) {
  const { t, lang, isRTL } = useI18n();
  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  return (
    <AnimatePresence initial={false}>
      {issues.length > 0 && (
        <motion.div
          // Absolute, so it floats over the fields instead of resizing them.
          // The parent form is the positioning context.
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className='pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4'
        >
          <motion.div
            // Re-keyed per attempt so the nudge replays on every rejected press.
            key={attempt}
            initial={{ x: 0 }}
            // ±6px, 3 cycles, 300ms. The shake means "look here".
            animate={{ x: [0, -6, 6, -6, 6, -6, 6, 0] }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className='pointer-events-auto w-full max-w-[34rem] rounded-xl border border-danger/50
              bg-content1 p-3.5 shadow-2xl ring-1 ring-danger/10'
            role='alert'
            aria-live='assertive'
          >
            <div className='flex items-center gap-2.5'>
              <span className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger'>
                <AlertTriangle className='h-5 w-5' />
              </span>
              <div className='min-w-0 flex-1'>
                <div className='text-[17px] font-bold leading-tight text-danger'>
                  {issues.length === 1
                    ? t('error.oneLeft')
                    : t('error.manyLeft', { count: issues.length })}
                </div>
                <div className='text-[14px] font-medium leading-tight text-default-700'>
                  {t('error.fixToContinue')}
                </div>
              </div>
              {onDismiss && (
                <button
                  type='button'
                  onClick={onDismiss}
                  aria-label={t('toast.dismiss')}
                  className='grid h-8 w-8 shrink-0 place-items-center rounded-lg text-default-700 hover:bg-default-100 hover:text-foreground'
                >
                  <X className='h-4 w-4' />
                </button>
              )}
            </div>

            <ul className='mt-2.5 space-y-1.5'>
              {issues.map((issue) => (
                <motion.li
                  key={`${issue.field}:${issue.code}`}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className='flex items-center gap-2 rounded-lg bg-default-100 px-3 py-1.5'
                >
                  {/* Title only. The message under the control says the rest. */}
                  <span className='min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground'>
                    {interpolate(ERROR_CATALOG[issue.code][lang].title, issue.params)}
                  </span>
                  {extraAction?.(issue)}
                  {onFocusField && (
                    <button
                      type='button'
                      onClick={() => onFocusField(issue.field)}
                      className='inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[14px] font-semibold text-danger hover:bg-danger/10'
                    >
                      {t('error.goToField')}
                      <Arrow className='h-3.5 w-3.5' />
                    </button>
                  )}
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
