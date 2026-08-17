// src/renderer/pages/pos/components/DeliveryFeeRow.tsx
import { useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useI18n } from '../../../i18n';

/**
 * The delivery charge line, editable in place.
 *
 * The fee used to come only from the city table, which does not survive contact
 * with a real shop: a driver quotes a price for an out-of-area address, a
 * manager waives the charge for a complaint, a regular collects their own
 * order. None of that was expressible, so the cashier's only option was to fake
 * it through the discount field — which then lands in the wrong accounting
 * bucket at closing.
 *
 * Three states rather than a plain number, because 0 is ambiguous: "no charge"
 * is a decision, "not set" is not. See `orders:setDeliveryFee`.
 */
export function DeliveryFeeRow({
  orderId,
  value,
  isManual,
  isWaived,
  editable = true,
  onChanged,
}: {
  orderId: string;
  value: number;
  isManual?: boolean;
  isWaived?: boolean;
  editable?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const { t, money } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(String(value ?? 0));
  }, [value, editing]);
  const muted = 'text-default-700';

  const apply = async (mode: 'auto' | 'manual' | 'none', amount?: number) => {
    setBusy(true);
    setError(null);
    try {
      await window.api.invoke('orders:setDeliveryFee', orderId, {
        mode,
        amount,
      });
      setEditing(false);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e ?? ''));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const n = Number(draft.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      setError(t('cart.deliveryFeeInvalid'));
      return;
    }
    // Typing 0 by hand means "no charge" — the same decision as the button.
    apply(n === 0 ? 'none' : 'manual', n);
  };

  const btn = `h-8 px-2 rounded-md text-xs font-medium transition disabled:opacity-40 ${
    'bg-default-200 hover:bg-default-300 text-foreground'
  }`;

  if (editing) {
    return (
      <div className='space-y-1.5 py-1'>
        <div className='flex items-center gap-2'>
          <span className={`text-[13px] ${muted} flex-1 min-w-0 truncate`}>
            {t('cart.deliveryFee')}
          </span>
          <input
            autoFocus
            type='number'
            inputMode='decimal'
            // Kuwait prices in 250-fils units, so the spinner moves a quarter
            // dinar per click. At 0.001 it took 250 clicks to cover the same
            // ground, and delivery is quoted in quarters, never in fils.
            // Typing is unaffected — step only drives the arrows — so an odd
            // amount like 1.750 can still be entered directly.
            step='0.25'
            min='0'
            dir='ltr'
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            className={`money w-24 h-8 px-2 rounded-md text-sm text-end outline-none
              focus:ring-2 focus:ring-blue-500/40 ${
                'bg-default-200 border border-default-200 text-foreground'
              }`}
          />
          <button
            type='button'
            onClick={save}
            disabled={busy}
            title={t('common.save')}
            className={`${btn} text-success dark:text-emerald-300`}
          >
            <Check size={15} />
          </button>
          <button
            type='button'
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={busy}
            title={t('common.cancel')}
            className={btn}
          >
            <X size={15} />
          </button>
        </div>

        <div className='flex items-center gap-2 flex-wrap'>
          <button
            type='button'
            onClick={() => apply('none')}
            disabled={busy}
            className={btn}
          >
            {t('cart.noDeliveryCharge')}
          </button>
          <button
            type='button'
            onClick={() => apply('auto')}
            disabled={busy}
            className={btn}
          >
            {t('cart.deliveryFeeAuto')}
          </button>
        </div>

        {error && (
          <div className='text-[11px] text-rose-500 leading-snug'>{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className='flex items-center gap-2 py-0.5'>
      <span className={`text-[13px] ${muted} flex-1 min-w-0 truncate`}>
        {t('cart.deliveryFee')}
        {isWaived && (
          <span className='ms-1 text-[10px] uppercase tracking-wide opacity-70'>
            {t('cart.waived')}
          </span>
        )}
        {isManual && !isWaived && (
          <span className='ms-1 text-[10px] uppercase tracking-wide opacity-70'>
            {t('cart.manual')}
          </span>
        )}
      </span>
      <span className={`money text-[13px] ${'text-foreground'}`}>
        {money(value)}
      </span>
      {editable && (
        <button
          type='button'
          onClick={() => setEditing(true)}
          title={t('cart.editDeliveryFee')}
          className={`shrink-0 rounded-md p-1 ${
            'hover:bg-default-200 text-default-700'
          }`}
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}
