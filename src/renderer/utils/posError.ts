// src/renderer/utils/posError.ts
//
// The only function that turns a code into something a person reads.
//
// Look the code up, pick the language, interpolate the parameters, and hand
// back the severity that decides which component renders it. Nothing else in
// the renderer reads `err.message` — that is how "Error invoking remote method
// 'orders:complete'…" reached a cashier in the first place.

import { useCallback } from 'react';
import { toPosError, type PosErrorPayload } from '../../shared/errors';
import {
  ERROR_CATALOG,
  interpolate,
  type PosErrorCode,
  type Severity,
} from '../../shared/errorCatalog';
import { useI18n } from '../i18n';

export type DescribedError = {
  code: string;
  /** Decides the component: modal, toast, field message or quiet badge. */
  severity: Severity;
  title: string;
  message: string;
  /** Whether a "Try again" button can help. */
  retryable: boolean;
  /** Form field this belongs to, when the thrower named one. */
  field?: string;
  /** Untranslated original. Shown only behind "details", never by default. */
  detail?: string;
};

export function isKnownCode(code: string): code is PosErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code);
}

/**
 * Describe an error in the given language. A plain function as well as a hook,
 * so an error boundary or a logger can use it too.
 */
export function describeError(err: unknown, lang: 'en' | 'ar'): DescribedError {
  const payload: PosErrorPayload = toPosError(err);
  const known = isKnownCode(payload.code)
    ? ERROR_CATALOG[payload.code]
    : ERROR_CATALOG.POS_UNKNOWN;

  const copy = known[lang];
  const rendered = interpolate(copy.body, payload.params);

  // A row whose body is nothing but a placeholder ({detail}) and that arrived
  // without it filled would render literally. Fall back to the sentence the
  // thrower supplied rather than showing "{detail}" to a cashier.
  const message = /^\{\w+\}$/.test(rendered.trim()) ? payload.fallback : rendered;

  // The raw text is the only clue anyone will have for an unmapped code, so it
  // is kept — but behind a disclosure, never in the sentence itself.
  const unmapped = !isKnownCode(payload.code) || payload.code === 'POS_UNKNOWN';
  const detail =
    unmapped && payload.fallback && payload.fallback !== message
      ? payload.fallback
      : undefined;

  return {
    code: payload.code,
    severity: known.severity,
    title: interpolate(copy.title, payload.params),
    message,
    retryable: known.retry,
    field: payload.field,
    detail,
  };
}

/** React-side entry point: describes errors in the language currently on screen. */
export function usePosError() {
  const { lang } = useI18n();
  return useCallback((err: unknown) => describeError(err, lang), [lang]);
}

/** Copy for a code we raise directly, with no error object in hand. */
export function copyFor(
  code: PosErrorCode,
  lang: 'en' | 'ar',
  params?: Record<string, unknown>
) {
  const entry = ERROR_CATALOG[code];
  return {
    title: interpolate(entry[lang].title, params),
    body: interpolate(entry[lang].body, params),
    severity: entry.severity,
    retryable: entry.retry,
  };
}

/**
 * The language currently on screen, read off the document rather than out of a
 * hook. I18nProvider stamps it there on every change, which lets `errorLine`
 * be an ordinary function — usable from a catch block anywhere, including the
 * several pages that define more than one component in a file.
 */
function currentLang(): 'en' | 'ar' {
  return typeof document !== 'undefined' && document.documentElement.lang === 'ar'
    ? 'ar'
    : 'en';
}

/**
 * One line for a surface that only has room for one — a login form, a pairing
 * screen, an inline row under a control. Title plus body, because either alone
 * loses half the meaning ("Too many attempts" without the wait, or "Wait 30
 * seconds" without the reason).
 */
export function errorLine(err: unknown, lang: 'en' | 'ar' = currentLang()): string {
  const d = describeError(err, lang);
  return d.message.startsWith(d.title) ? d.message : `${d.title} — ${d.message}`;
}

/** Hook form, for components that re-render on a language change. */
export function useErrorLine() {
  const { lang } = useI18n();
  return useCallback((err: unknown) => errorLine(err, lang), [lang]);
}
