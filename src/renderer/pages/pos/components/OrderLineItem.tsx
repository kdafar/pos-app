// components/OrderLineItem.tsx
import React from 'react';
import { Trash2 } from 'lucide-react';
import { OrderLine } from '../types';
import { QtyStepper } from '../../../components/QtyStepper';
import { useI18n } from '../../../i18n';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}
type OrderLineWithExtras = OrderLine & {
  variation?: string | null;
  variation_price?: number | null;
  addons_name?: string | null;
  addons_price?: string | null;
  addons_qty?: string | null;
  notes?: string | null;
};

export function OrderLineItem({
  line,
  orderId,
  theme,
  onUpdate,
}: {
  line: OrderLineWithExtras;
  orderId: string;
  theme: 'light' | 'dark';
  onUpdate: () => void;
}) {
  const { t, name: localName, money } = useI18n();
  const call = (ch: string, ...args: any[]) => window.api.invoke(ch, ...args);
  // Typing a quantity commits in one go; guard against a second commit landing
  // (blur + Enter, or an impatient double tap) while the first is in flight.
  const [busy, setBusy] = React.useState(false);

  const setQty = async (nextQty: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await applyQty(nextQty);
    } finally {
      setBusy(false);
    }
  };

  const applyQty = async (nextQty: number) => {
    if (nextQty <= 0) {
      await call('orders:removeLine', line.id)
        .catch(() => call('orders:removeLineByItem', orderId, line.item_id))
        .catch(() =>
          call('orders:addLine', orderId, line.item_id, -Number(line.qty || 0))
        );
    } else {
      await call('orders:setLineQty', line.id, nextQty).catch(async () => {
        const delta = nextQty - Number(line.qty || 0);
        if (delta !== 0) {
          await call('orders:addLine', orderId, line.item_id, delta);
        }
      });
    }
    onUpdate();
  };

  const remove = async () => setQty(0);

  const bg =
    theme === 'dark'
      ? 'bg-white/5 hover:bg-white/10'
      : 'bg-white hover:bg-gray-50';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-500';

  const unitPrice = Number(line.unit_price || 0);
  const qty = Number(line.qty || 0);
  const lineTotal = Number(line.line_total || unitPrice * qty);

  const hasVariation = !!line.variation && String(line.variation).trim() !== '';
  const addonsLabel = (line.addons_name && line.addons_name.trim()) || null;
  const hasNote = !!line.notes && String(line.notes).trim() !== '';

  // If addons_name is "Cheese, Bacon", make small pills
  const addonPills = addonsLabel
    ? addonsLabel
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return (
    <div className={`${bg} border ${border} rounded-lg p-3 transition`}>
      {/* Top row: name + remove */}
      <div className='flex items-start justify-between gap-2 mb-2'>
        <div className='flex-1 pe-1'>
          <h4 className={`font-semibold ${text} leading-snug line-clamp-2`}>
            {localName(line)}
          </h4>

          {/* Variation + addons meta */}
          <div className='mt-1 space-y-1'>
            {hasVariation && (
              <div className='flex flex-wrap items-center gap-1 text-[11px]'>
                <span
                  className={
                    theme === 'dark'
                      ? 'px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-200 border border-sky-500/40'
                      : 'px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200'
                  }
                >
                  {line.variation}
                </span>
              </div>
            )}

            {addonPills.length > 0 && (
              <div className='flex flex-wrap items-center gap-1 text-[11px]'>
                {addonPills.map((label, idx) => (
                  <span
                    key={idx}
                    className={
                      theme === 'dark'
                        ? 'px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-100 border border-indigo-500/40'
                        : 'px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200'
                    }
                  >
                    + {label}
                  </span>
                ))}
              </div>
            )}

            <p className={`text-[11px] ${textMuted} font-medium`}>
              <span className='money'>{money(unitPrice)}</span> × {qty}
            </p>

            {hasNote && (
              <p className={`text-[11px] ${textMuted} italic line-clamp-2`}>
                {t('cart.note')}: {line.notes}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={remove}
          className={
            theme === 'dark'
              ? 'text-slate-400 hover:text-red-400'
              : 'text-gray-400 hover:text-red-500'
          }
          title={t('common.remove')}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Bottom row: qty controls + total */}
      <div className='flex items-center justify-between gap-2'>
        <QtyStepper
          theme={theme}
          value={qty}
          min={1}
          max={999}
          size='md'
          disabled={busy}
          label={`${line.name} quantity`}
          decHint={t('cart.removeHint')}
          onChange={setQty}
        />

        <div
          className={`text-[15px] font-bold ${
            theme === 'dark' ? 'text-blue-200' : 'text-blue-700'
          }`}
        >
          <span className='money'>{money(lineTotal)}</span>
        </div>
      </div>
    </div>
  );
}
