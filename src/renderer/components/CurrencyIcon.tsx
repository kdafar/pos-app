// The shop's own currency, drawn where an icon would go (stat cards).
//
// Read from the synced settings (general.currency_en / general.currency_ar,
// "KD" / "د.ك" on Kuwaiti shops) rather than a dollar glyph, which no
// customer of this till uses.
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

const cache: Record<string, string> = {};

/** The shop's currency label in the current language ("KD" / "د.ك"). */
export function useCurrency(): string {
  const { lang } = useI18n();
  const key = lang === 'ar' ? 'general.currency_ar' : 'general.currency_en';
  const fallback = lang === 'ar' ? 'د.ك' : 'KD';
  const [label, setLabel] = useState(cache[key] ?? fallback);

  useEffect(() => {
    let alive = true;
    window.api
      .invoke('settings:get', key)
      .then((v: unknown) => {
        const s = String(v ?? '').trim();
        if (s) cache[key] = s;
        if (alive) setLabel(s || fallback);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, fallback]);

  return label;
}

export function CurrencyIcon({
  size = 26,
  className = '',
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const label = useCurrency();
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center font-bold leading-none ${className}`}
      style={{ minWidth: size, height: size, fontSize: Math.round(size * 0.62) }}
    >
      {label}
    </span>
  );
}

/** The currency as a small suffix after an amount. */
export function Cur({ label }: { label: string }) {
  return <span className='ms-1 text-[0.75em] font-medium ink-3'>{label}</span>;
}
