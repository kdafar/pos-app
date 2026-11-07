// components/OrderLineItem.tsx
import React from 'react';
import { Button, Chip } from '@heroui/react';
import { Trash2 } from 'lucide-react';
import { OrderLine } from '../types';
import { QtyStepper } from '../../../components/QtyStepper';
import { useI18n } from '../../../i18n';
import { useApproval } from '../../../components/ApprovalProvider';
import { Hint } from '../../../components/Hint';
import { useToast } from '../../../components/ToastProvider';

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
 * One line in the cart: a bordered surface row. Colours are tokens only.
 * Sizes use the fluid POS scale; read at arm's length.
 */
export function OrderLineItem({
  line,
  orderId,
  onUpdate,
  readOnly = false,
}: {
  line: OrderLineWithExtras;
  orderId: string;
  /** A line another till sent: shown, not changeable from here. */
  readOnly?: boolean;
  /** Unused (tokens). Kept because OrderSide.tsx still passes it. */
  theme?: 'light' | 'dark';
  onUpdate: () => void;
}) {
  const { t, name: localName, money } = useI18n();
  const approve = useApproval();
  const toast = useToast();
  const call = (ch: string, ...args: any[]) => window.api.invoke(ch, ...args);
  const sent = (line as any).is_locked === 1 || (line as any).is_locked === true;
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
    // A line already sent to the kitchen: lowering or removing it is a void
    // that needs a manager unless the cashier may void. No silent fallbacks
    // here — those used to remove a *different* unsent line of the same item,
    // or add a negative quantity, when the sent line refused.
    if (sent) {
      try {
        await approve('void_sent_line', (approval) =>
          nextQty <= 0
            ? call('orders:removeLine', line.id, approval)
            : call('orders:setLineQty', line.id, nextQty, approval)
        );
      } catch (e) {
        toast.error(e);
      }
      onUpdate();
      return;
    }
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

  const text = 'text-foreground';
  const textMuted = 'ink-2';

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

  const extras = (hasVariation || addonPills.length > 0 || hasNote) && (
    <div className='mt-1 space-y-1'>
      {(hasVariation || addonPills.length > 0) && (
        <div className='flex flex-wrap items-center gap-1'>
          {hasVariation && (
            <Chip size='sm' variant='bordered' className='font-semibold border-[var(--line-strong)] text-foreground'>
              {line.variation}
            </Chip>
          )}
          {addonPills.map((label, idx) => (
            <Chip
              key={idx}
              size='sm'
              variant='bordered'
              className='font-semibold border-[var(--line-strong)] ink-2'
            >
              + {label}
            </Chip>
          ))}
        </div>
      )}
      {hasNote && (
        <p className={`pos-xs ${textMuted} italic break-words`}>
          {t('cart.note')}: {line.notes}
        </p>
      )}
    </div>
  );

  // A wide cart: one row — name | quantity | total | remove.
  // A narrow cart: the name gets the whole first row; quantity on the left of
  // the second, total + remove on the right. Never a name squeezed to a sliver.
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2'>
      <div className='min-w-0 basis-full @[24rem]:flex-1 @[24rem]:basis-0'>
        <h4 className={`font-semibold pos-sm ${text} leading-snug break-words`}>
          {localName(line)}
        </h4>
        {/* "1.750 × 1" only repeats the total; show it from 2 up. */}
        {qty > 1 && (
          <div className={`pos-xs ${textMuted} font-medium`}>
            <span className='money'>{money(unitPrice)}</span> ×{' '}
            <span className='money'>{qty}</span>
          </div>
        )}
        {extras}
      </div>

      {readOnly ? (
        <span className={`pos-sm font-semibold ${textMuted} tabular-nums`}>× {qty}</span>
      ) : (
      <QtyStepper
        value={qty}
        min={1}
        max={999}
        size='sm'
        disabled={busy}
        label={`${line.name} quantity`}
        decHint={t('cart.removeHint')}
        onChange={setQty}
      />
      )}
      <div className='ms-auto min-w-[3.5rem] text-end pos-sm font-semibold tabular-nums text-foreground @[24rem]:ms-0'>
        <span className='money'>{money(lineTotal)}</span>
      </div>
      {/* Finger-sized on touch: this deletes a line mid-order. */}
      {!readOnly && (
      <Hint content={t('common.remove')} placement='top'>
        <Button
          isIconOnly
          size='sm'
          variant='light'
          color='danger'
          onPress={remove}
          aria-label={t('common.remove')}
          className='shrink-0 text-danger pointer-coarse:h-11 pointer-coarse:w-11'
        >
          <Trash2 size={17} strokeWidth={1.8} />
        </Button>
      </Hint>
      )}
    </div>
  );
}
