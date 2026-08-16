// src/renderer/i18n/index.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { strings, LANGS, type Lang, type StringKey } from './strings';

export type { Lang, StringKey };
export { LANGS };

type Ctx = {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  isRTL: boolean;
  setLang: (l: Lang) => void;
  /** Translate. Supports {placeholders}. */
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Pick the Arabic name when running in Arabic, falling back to English. */
  name: (row: any) => string;
  /** Format money the Kuwaiti way: 3 decimals, Latin numerals. */
  money: (n: unknown) => string;
};

const I18nContext = createContext<Ctx | null>(null);

const STORE_KEY = 'ui.lang';

function normalize(v: unknown): Lang {
  return v === 'ar' ? 'ar' : 'en';
}

function applyDocument(lang: Lang) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Read synchronously from localStorage so the first paint is already correct;
  // the persisted main-process value is reconciled just after.
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return normalize(localStorage.getItem(STORE_KEY));
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    applyDocument(lang);
  }, [lang]);

  // Reconcile with the value stored in the main process (survives reinstalls
  // of the renderer's localStorage and is shared with printing).
  useEffect(() => {
    (async () => {
      try {
        const stored = await (window as any).api?.invoke('store:get', STORE_KEY);
        if (stored === 'ar' || stored === 'en') {
          setLangState(stored);
          localStorage.setItem(STORE_KEY, stored);
        }
      } catch {
        /* offline / handler missing — keep the local value */
      }
    })();
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      /* ignore */
    }
    (window as any).api?.invoke('store:set', STORE_KEY, next).catch(() => {});
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      const entry = strings[key];
      let out: string = entry ? entry[lang] ?? entry.en : String(key);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return out;
    },
    [lang]
  );

  const name = useCallback(
    (row: any) => {
      if (!row) return '';
      if (lang === 'ar') {
        const ar = row.name_ar ?? row.nameAr ?? null;
        if (ar && String(ar).trim()) return String(ar);
      }
      return String(row.name ?? row.name_ar ?? '');
    },
    [lang]
  );

  // Kuwait uses Latin numerals on receipts and screens, so force en-US
  // formatting regardless of UI language — only the label flips to د.ك.
  const money = useCallback(
    (n: unknown) => Number(n ?? 0).toFixed(3),
    []
  );

  const value = useMemo<Ctx>(
    () => ({
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      isRTL: lang === 'ar',
      setLang,
      t,
      name,
      money,
    }),
    [lang, setLang, t, name, money]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fail soft: a component rendered outside the provider still shows English
    // rather than crashing the till.
    return {
      lang: 'en',
      dir: 'ltr',
      isRTL: false,
      setLang: () => {},
      t: (k) => (strings[k] ? strings[k].en : String(k)),
      name: (row: any) => String(row?.name ?? ''),
      money: (n: unknown) => Number(n ?? 0).toFixed(3),
    };
  }
  return ctx;
}

/** Order type → localized label, used in several places. */
export function useOrderTypeLabel() {
  const { t } = useI18n();
  return (type: number | string | null | undefined) => {
    switch (Number(type)) {
      case 1:
        return t('orderType.delivery');
      case 2:
        return t('orderType.pickup');
      case 3:
        return t('orderType.dinein');
      default:
        return t('orderType.order');
    }
  };
}

/**
 * Local order status → label. Server numeric codes still arrive as
 * "status 2" until the backend confirms the enum (docs/BACKEND-QUESTIONS.md §1),
 * so those are passed through untranslated rather than mislabelled.
 */
export function useStatusLabel() {
  const { t } = useI18n();
  return (status: string | null | undefined) => {
    const s = String(status ?? '').toLowerCase();
    const known: Record<string, StringKey> = {
      open: 'status.open',
      pending: 'status.pending',
      placed: 'status.placed',
      prepared: 'status.prepared',
      ready: 'status.ready',
      closed: 'status.closed',
      completed: 'status.completed',
      cancelled: 'status.cancelled',
      canceled: 'status.cancelled',
    };
    return known[s] ? t(known[s]) : status || t('status.unknown');
  };
}
