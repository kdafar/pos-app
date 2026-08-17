// components/OrderLineItem.tsx
import React from 'react';
import { Button, Chip } from '@heroui/react';
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

/**
 * One line in the cart.
 *
 * Every colour here is a HeroUI semantic token, so the row, its meta pills and
 * the price all resolve themselves in either theme from a single definition.
 * The previous version branched on `theme === 'dark'` for the variation pill,
 * the addon pills, the name and the line total — four places where the light
 * branch (`bg-sky-50`, `text-blue-700`) rendered near-invisibly whenever the
 * dark theme was actually on.
 *
 * Sizes come from the fluid POS scale rather than fixed 11px: this is read at
 * arm's length while a customer waits, so nothing that carries meaning is
 * rendered at a size or tone that has to be leaned into.
 */
export function OrderLineItem({
  line,
  orderId,
  onUpdate,
}: {
  line: OrderLineWithExtras;
  orderId: string;
  /**
   * Unused — colour comes from semantic tokens now. Kept declared and optional
   * only because OrderSide.tsx still passes it; it can go with that call site.
   */
  theme?: 'light' | 'dark';
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

  const bg = 'bg-default-100 hover:bg-default-200';
  const border = 'border-default-200';
  const text = 'text-foreground';
  const textMuted = 'text-default-700';

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
          <h4 className={`font-semibold pos-base ${text} leading-snug line-clamp-2`}>
            {localName(line)}
          </h4>

          {/* Variation + addons meta */}
          <div className='mt-1 space-y-1'>
            {hasVariation && (
              <div className='flex flex-wrap items-center gap-1'>
                <Chip size='sm' variant='flat' color='primary' className='font-semibold'>
                  {line.variation}
                </Chip>
              </div>
            )}

            {addonPills.length > 0 && (
              <div className='flex flex-wrap items-center gap-1'>
                {addonPills.map((label, idx) => (
                  <Chip
                    key={idx}
                    size='sm'
                    variant='flat'
                    color='success'
                    className='font-semibold'
                  >
                    + {label}
                  </Chip>
                ))}
              </div>
            )}

            <p className={`pos-xs ${textMuted} font-medium`}>
              <span className='money'>{money(unitPrice)}</span> ×{' '}
              <span className='money'>{qty}</span>
            </p>

            {hasNote && (
              <p className={`pos-xs ${textMuted} italic line-clamp-2`}>
                {t('cart.note')}: {line.notes}
              </p>
            )}
          </div>
        </div>

        {/* A finger-sized target rather than a bare 16px glyph — this is the
            control that deletes a line mid-order. */}
        <Button
          isIconOnly
          size='sm'
          variant='light'
          color='danger'
          onPress={remove}
          title={t('common.remove')}
          aria-label={t('common.remove')}
          className='shrink-0 text-danger'
        >
          <Trash2 size={18} />
        </Button>
      </div>

      {/* Bottom row: qty controls + total */}
      <div className='flex items-center justify-between gap-2'>
        <QtyStepper
          value={qty}
          min={1}
          max={999}
          size='md'
          disabled={busy}
          label={`${line.name} quantity`}
          decHint={t('cart.removeHint')}
          onChange={setQty}
        />

        <div className='pos-price font-bold text-primary'>
          <span className='money'>{money(lineTotal)}</span>
        </div>
      </div>
    </div>
  );
}
