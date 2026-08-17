// src/renderer/components/LanguageToggle.tsx
import { Languages } from 'lucide-react';
import { useI18n, LANGS } from '../i18n';

/**
 * Two-state language switch. Deliberately a single visible control rather than
 * a dropdown buried in Settings — staff on a shared till swap language between
 * shifts, and cashiers should not need admin access to do it.
 */
export function LanguageToggle({
  theme = 'light',
  compact = false,
  collapsed = false,
  row = false,
}: {
  theme?: 'light' | 'dark';
  compact?: boolean;
  /** Single square button — for a collapsed sidebar with no room for two. */
  collapsed?: boolean;
  /** Full-width sidebar row that reads like the nav entries around it. */
  row?: boolean;
}) {
  const { lang, setLang } = useI18n();

  /**
   * In the sidebar the segmented control was a heading plus a bordered box
   * holding a globe and both language names — three elements and two rows of
   * chrome to express one binary choice, sitting directly above nav rows it
   * matched in neither shape nor height.
   *
   * A single row naming the language you switch TO says the same thing: the
   * button states its action rather than its current state, which is also why
   * the current language never needs a highlight here.
   */
  if (row) {
    const other = LANGS.find((l) => l.code !== lang) ?? LANGS[0];
    return (
      <button
        type='button'
        onClick={() => setLang(other.code)}
        lang={other.code}
        title={other.label}
        className='flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm
          font-medium text-muted-foreground transition-colors
          hover:text-foreground hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
      >
        <Languages size={18} strokeWidth={1.9} className='shrink-0' />
        <span className='truncate'>{other.label}</span>
      </button>
    );
  }

  if (collapsed) {
    const other = LANGS.find((l) => l.code !== lang) ?? LANGS[0];
    return (
      <button
        type='button'
        onClick={() => setLang(other.code)}
        // Label names the language you switch TO, so the button says what it
        // does rather than what is currently selected.
        title={other.label}
        aria-label={other.label}
        className={`w-10 h-10 mx-auto flex items-center justify-center rounded-xl
          text-xs font-bold transition-colors
          ${
            theme === 'dark'
              ? 'bg-white/5 text-slate-200 hover:bg-white/10'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
      >
        {other.code === 'ar' ? 'ع' : 'EN'}
      </button>
    );
  }

  const shell =
    theme === 'dark'
      ? 'bg-white/5 border-white/10'
      : 'bg-gray-100 border-gray-300';
  const active =
    theme === 'dark'
      ? 'bg-blue-600 text-white shadow'
      : 'bg-blue-600 text-white shadow';
  const idle =
    theme === 'dark'
      ? 'text-slate-300 hover:text-white'
      : 'text-gray-700 hover:text-gray-900';

  return (
    <div className={`inline-flex items-center rounded-lg border p-1 ${shell}`}>
      {!compact && (
        <Languages
          size={14}
          className={`ms-1 me-1.5 ${
            theme === 'dark' ? 'text-slate-400' : 'text-gray-500'
          }`}
        />
      )}
      {LANGS.map((l) => (
        <button
          key={l.code}
          type='button'
          lang={l.code}
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
            lang === l.code ? active : idle
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
