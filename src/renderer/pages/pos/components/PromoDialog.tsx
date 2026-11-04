// components/PromoDialog.tsx
import { useState } from 'react';
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react';
import { Percent } from 'lucide-react';
import { Promo } from '../types';
import { useI18n } from '../../../i18n';

import { errorLine as errLine } from '../../../utils/posError';
export function PromoDialog({
  promos,
  onClose,
  onApply,
}: {
  promos: Promo[];
  /**
   * Unused — colours are semantic tokens now. Kept declared and optional
   * because OrderSide.tsx and CheckoutModal.tsx still pass it; it can go once
   * those call sites are migrated.
   */
  theme?: 'light' | 'dark';
  onClose: () => void;
  onApply: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const { t, money } = useI18n();
  const isPromoActive = (p: Promo) => {
    // No flag at all? Assume active.
    if (p.active === undefined || p.active === null) return true;

    if (typeof p.active === 'boolean') return p.active;

    const n = Number(p.active);
    if (!Number.isNaN(n)) {
      return n === 1; // 1 / 0 style
    }

    const s = String(p.active).toLowerCase();
    if (['inactive', 'disabled', 'false', 'no', '0'].includes(s)) return false;
    return true; // anything else counts as active
  };

  const activePromos = (promos || []).filter(isPromoActive);

  const apply = async (c: string) => {
    const normalized = (c || code).trim().toUpperCase();
    setErr('');
    if (!normalized || busy) return;

    // The local list is a shortcut, not the authority. Rejecting against an
    // empty list told the cashier a perfectly good code was "invalid" whenever
    // the promo load had failed — so only pre-check when there is something to
    // check against, and otherwise let the server answer.
    if (
      activePromos.length > 0 &&
      !activePromos.some((p) => (p.code || '').toUpperCase() === normalized)
    ) {
      setErr(t('promo.invalid'));
      return;
    }

    // Guards a double-tap on a till screen from firing two applications.
    setBusy(true);
    try {
      await onApply(normalized);
      onClose();
    } catch (e) {
      // The real reason, when there is one — "couldn't apply" alone leaves the
      // cashier with nothing to act on.
      const msg = errLine(e);
      setErr(msg || t('promo.applyFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size='md'
      placement='center'
      backdrop='opaque'
      scrollBehavior='inside'
      classNames={{
        wrapper: 'p-2 sm:p-4',
        base: 'ui-popup !rounded-[24px] m-0 w-full max-h-[calc(100dvh-2rem)]',
        backdrop: 'bg-black/50',
      }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className='flex items-center gap-2'>
              <Percent size={20} strokeWidth={1.8} className='ink-2' />
              <span className='text-lg font-semibold ink'>
                {t('promo.title')}
              </span>
            </ModalHeader>

            <ModalBody className='gap-4 overflow-y-auto'>
              <Input
                autoFocus
                size='lg'
                value={code}
                onValueChange={(v) => {
                  setErr('');
                  setCode(v.toUpperCase());
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply(code);
                }}
                placeholder={t('promo.placeholder')}
                isInvalid={!!err}
                errorMessage={err || undefined}
                // Promo codes are Latin alphanumerics — never mirror them.
                classNames={{ inputWrapper: 'ui-input', input: 'money text-base font-semibold' }}
                aria-label={t('promo.title')}
              />

              {activePromos.length > 0 && (
                <div>
                  <div className='mb-2 text-xs font-semibold uppercase tracking-wide ink-2'>
                    {t('promo.available')}
                  </div>
                  <div className='max-h-56 space-y-2 overflow-y-auto nice-scroll'>
                    {activePromos.map((promo: Promo) => (
                      <button
                        key={promo.id}
                        type='button'
                        onClick={() => apply(promo.code)}
                        disabled={busy}
                        className='min-h-11 w-full rounded-[13px] border border-line-strong bg-surface p-3 text-start transition hover:border-[var(--brand)] hover:bg-surface-2'
                      >
                        <div className='flex items-center justify-between gap-2'>
                          <span className='money text-base font-semibold ink'>
                            {promo.code}
                          </span>
                          <Chip
                            size='sm'
                            variant='solid'
                            color='primary'
                            className='shrink-0 font-semibold'
                          >
                            {promo.type === 'percent'
                              ? t('promo.percentOff', { value: promo.value })
                              : t('promo.amountOff', {
                                  value: money(promo.value),
                                })}
                          </Chip>
                        </div>
                        {promo.min_total > 0 && (
                          <div className='mt-1 text-sm font-medium ink-2'>
                            {t('promo.min')}:{' '}
                            <span className='money'>
                              {money(promo.min_total)}
                            </span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </ModalBody>

            <ModalFooter className='flex flex-wrap justify-end gap-2 border-t border-line'>
              <Button
                variant='bordered'
                size='lg'
                className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                onPress={onClose}
              >
                {t('common.cancel')}
              </Button>
              <Button
                color='primary'
                size='lg'
                className='rounded-[13px] font-semibold'
                onPress={() => apply(code)}
                isLoading={busy}
                isDisabled={!code.trim()}
              >
                {t('promo.applyCode')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
