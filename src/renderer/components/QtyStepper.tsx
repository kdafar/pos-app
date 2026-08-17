// src/renderer/components/QtyStepper.tsx
import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';


export function clampQty(n: number, min: number, max?: number | null): number {
  if (!Number.isFinite(n)) return min;
  let v = Math.trunc(n);
  if (v < min) v = min;
  if (max != null && max >= min && v > max) v = max;
  return v;
}

/**
 * Quantity control shared by the cart lines and the item-options picker:
 * +/- for quick taps, plus a directly editable field so a cashier can type
 * "12" instead of pressing + eleven times.
 *
 * The field keeps its own draft string while focused so the value is parsed
 * and clamped on commit (blur / Enter), never mid-keystroke — otherwise
 * deleting the last digit of "12" would snap straight back to the minimum.
 *
 * Inputs are marked data-no-scan so the global barcode listener ignores
 * digits typed here.
 */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max,
  label,
  size = 'sm',
  disabled = false,
  decHint,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number | null;
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Tooltip for the minus button when it is at the floor. */
  decHint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const btnSize = size === 'md' ? 'w-8 h-8' : 'w-7 h-7';
  const inputSize = size === 'md' ? 'w-12 h-8 text-base' : 'w-10 h-7 text-sm';

  const btn = `${btnSize} rounded-md flex items-center justify-center font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${
    'bg-default-200 hover:bg-default-300 text-foreground'
  }`;

  const commit = (raw: string) => {
    setDraft(null);
    const parsed = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
    const next = clampQty(Number.isNaN(parsed) ? min : parsed, min, max);
    if (next !== value) onChange(next);
  };

  const atMax = max != null && value >= max;
  const atMin = value <= min;

  return (
    <div
      className='flex items-center gap-1.5 shrink-0'
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type='button'
        aria-label={`Decrease ${label}`}
        className={btn}
        disabled={disabled || atMin}
        title={atMin ? decHint : undefined}
        onClick={() => onChange(clampQty(value - 1, min, max))}
      >
        <Minus size={14} />
      </button>

      <input
        type='text'
        inputMode='numeric'
        data-no-scan='true'
        aria-label={label}
        disabled={disabled}
        value={draft ?? String(value)}
        onFocus={(e) => {
          setDraft(String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          const el = e.target as HTMLInputElement;
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(el.value);
            el.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            el.blur();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setDraft(null);
            onChange(clampQty(value + 1, min, max));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setDraft(null);
            onChange(clampQty(value - 1, min, max));
          }
        }}
        className={`${inputSize} text-center font-semibold tabular-nums rounded-md outline-none transition disabled:opacity-50
          ${
            'bg-default-200 text-foreground border border-default-200 focus:border-primary'
          }`}
      />

      <button
        type='button'
        aria-label={`Increase ${label}`}
        className={btn}
        disabled={disabled || atMax}
        title={atMax ? 'Limit reached' : undefined}
        onClick={() => onChange(clampQty(value + 1, min, max))}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
