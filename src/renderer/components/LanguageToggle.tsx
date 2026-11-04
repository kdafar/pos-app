// src/renderer/components/LanguageToggle.tsx
import { Languages } from 'lucide-react';
import { useI18n, LANGS } from '../i18n';
import { Hint } from './Hint';

/**
 * Two-state language switch. Deliberately a single visible control rather than
 * a dropdown buried in Settings — staff on a shared till swap language between
 * shifts, and cashiers should not need admin access to do it.
 */
export function LanguageToggle({
  compact = false,
  collapsed = false,
  row = false,
}: {
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
        className='ui-nav flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 text-sm'
      >
        <Languages size={18} strokeWidth={1.8} className='shrink-0' />
        <span className='truncate'>{other.label}</span>
      </button>
    );
  }

  if (collapsed) {
    const other = LANGS.find((l) => l.code !== lang) ?? LANGS[0];
    return (
      <Hint content={other.label} placement='bottom'>
        <button
          type='button'
          onClick={() => setLang(other.code)}
          // Label names the language you switch TO, so the button says what it
          // does rather than what is currently selected.
          aria-label={other.label}
          className='ui-icon-btn ui-icon-btn-outline mx-auto text-xs font-bold'
        >
          {other.code === 'ar' ? 'ع' : 'EN'}
        </button>
      </Hint>
    );
  }

  return (
    <div className='ui-seg'>
      {!compact && (
        <Languages size={14} strokeWidth={1.8} className='ms-1 me-1.5 ink-2' />
      )}
      {LANGS.map((l) => (
        <button
          key={l.code}
          type='button'
          lang={l.code}
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
          className='ui-seg-item'
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
