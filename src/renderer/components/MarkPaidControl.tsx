// src/renderer/components/MarkPaidControl.tsx
//
// "Mark paid" / "Undo paid" for one order (contract: Mark order paid §12).
//
// Shown only when the server records payment — a server without the feature
// has no endpoint to send the mark to — and only to the right people:
// orders.mark_paid sees "Mark paid"; anyone may press "Undo paid", which goes
// through the manager approval dialog when they lack orders.mark_unpaid.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
} from '@heroui/react';
import { AlertTriangle, HandCoins, Undo2, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { useToast } from './ToastProvider';
import { useApproval } from './ApprovalProvider';
import { copyFor, describeError, isKnownCode } from '../utils/posError';
import { PaymentBadge } from './PaymentBadge';
import { Hint } from './Hint';
import { paidMethodNeedsReference, PAID_REFERENCE_MAX } from '../../shared/paid';

type Support = { supported: boolean; canMark: boolean; canUndoAlone: boolean };

// One answer shared by every row of a list: a badge per order would otherwise
// make one IPC call each. Refreshed every 30 s, like the permission hook, so a
// grant synced from the back office shows without signing out.
let supportCache: { at: number; value: Promise<Support | null> } | null = null;
function loadSupport(): Promise<Support | null> {
  if (!supportCache || Date.now() - supportCache.at > 30_000) {
    supportCache = {
      at: Date.now(),
      value: window.api.invoke('orders:paidSupport').catch(() => null),
    };
  }
  return supportCache.value;
}

type Method = { id: string | number; slug?: string | null; name_en?: string | null; name_ar?: string | null };

export type MarkPaidOrder = {
  id: string;
  status?: string | null;
  status_code?: number | string | null;
  grand_total?: number | null;
  payment_method_id?: string | number | null;
  payment_link_status?: string | null;
  paid_status?: string | null;
  paid_how?: string | null;
  paid_time?: string | null;
  paid_link_open?: number | null;
  paid_pending?: string | null;
  paid_refusal?: string | null;
};

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

const isCancelled = (o: MarkPaidOrder) => {
  const code = Number(o.status_code);
  return (
    (o.status_code != null && o.status_code !== '' && [5, 6, 8, 9].includes(code)) ||
    lower(o.status).startsWith('cancel') ||
    lower(o.status).startsWith('reject')
  );
};

const isClosed = (o: MarkPaidOrder) =>
  (o.status_code != null && o.status_code !== '' && Number(o.status_code) === 4) ||
  ['closed', 'completed', 'done'].includes(lower(o.status));

export function MarkPaidControl({
  order,
  onChanged,
  size = 'sm',
  trigger = 'buttons',
}: {
  order: MarkPaidOrder;
  /** Reload the order after a change; the badge reads the stored state. */
  onChanged: () => void | Promise<void>;
  size?: 'sm' | 'md';
  /**
   * 'buttons' — Mark paid / Undo paid buttons and the refusal notice (order
   * detail, till panel).
   * 'badge' — the payment badge itself; pressing an unpaid one opens the
   * confirm dialog (order lists). Undo is deliberately not offered here: a
   * stray click in a list must not be able to remove a payment.
   */
  trigger?: 'buttons' | 'badge' | 'compact';
}) {
  const { t, money, lang } = useI18n();
  const toast = useToast();
  const approve = useApproval();

  const [support, setSupport] = useState<Support | null>(null);
  const [methods, setMethods] = useState<Method[]>([]);
  const [dialog, setDialog] = useState<'mark' | 'undo' | null>(null);
  const [methodId, setMethodId] = useState('');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadSupport().then((s) => alive && setSupport(s));
    return () => {
      alive = false;
    };
  }, [order.id]);

  const pending = lower(order.paid_pending);
  const paid = lower(order.paid_status) === 'paid' && pending !== 'undo';
  const byHand = lower(order.paid_how) === 'by_hand';
  const closed = isClosed(order);

  const canShowMark =
    !!support?.supported &&
    !!support.canMark &&
    !isCancelled(order) &&
    // A local draft has not reached the server yet; there is nothing to mark.
    lower(order.status) !== 'open' &&
    !paid &&
    pending !== 'mark';
  // Undo: a hand mark, or a mark still waiting in the outbox. A provider
  // payment cannot be undone here (POS_PAID_VERIFIED_LOCKED).
  const canShowUndo =
    !!support?.supported && (pending === 'mark' || (paid && byHand));

  const methodName = useCallback(
    (m?: Method | null) =>
      (lang === 'ar' ? m?.name_ar : null) || m?.name_en || m?.slug || '',
    [lang]
  );
  const selected = useMemo(
    () => methods.find((m) => String(m.id) === methodId) ?? null,
    [methods, methodId]
  );
  // KNET: the server needs the reference printed on the card-machine slip.
  const needsReference = paidMethodNeedsReference(selected?.slug);
  const referenceMissing = needsReference && !reference.trim();
  const linkOpen =
    Number(order.paid_link_open ?? 0) === 1 || lower(order.payment_link_status) === 'pending';

  const openMark = async () => {
    setProblem(null);
    setNote('');
    setReference('');
    try {
      const list = ((await window.api.invoke('payments:listMethods')) ?? []) as Method[];
      setMethods(list);
      const current = String(order.payment_method_id ?? '');
      setMethodId(list.some((m) => String(m.id) === current) ? current : String(list[0]?.id ?? ''));
    } catch (e) {
      toast.error(e, { title: t('paid.markFailed') });
      return;
    }
    setDialog('mark');
  };

  const openUndo = () => {
    setProblem(null);
    setReason('');
    setDialog('undo');
  };

  const afterResult = async (
    r: { state: 'done' | 'queued'; notices?: string[] } | null,
    doneTitle: string
  ) => {
    if (!r) return; // approval dialog cancelled
    setDialog(null);
    if (r.state === 'queued') toast({ tone: 'info', title: t('paid.queuedToast') });
    else toast.success(doneTitle);
    for (const code of r.notices ?? []) {
      if (!isKnownCode(code)) continue;
      const c = copyFor(code, lang);
      toast({ tone: 'warning', title: c.title, message: c.body, code });
    }
    await onChanged();
  };

  const submitMark = async () => {
    if (busy || !selected || referenceMissing) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await window.api.invoke('orders:markPaid', order.id, {
        payment_method_id: String(selected.id),
        amount: Number(order.grand_total ?? 0),
        reference: needsReference ? reference.trim() : null,
        note: note.trim() || null,
      });
      await afterResult(r, t('paid.doneToast'));
    } catch (e) {
      const d = describeError(e, lang);
      if (d.code === 'POS_PAID_ALREADY_PAID') {
        // Someone else got there first — not a failure; show who.
        setDialog(null);
        toast({ tone: 'info', title: d.title, message: d.message });
        await onChanged();
      } else if (d.severity === 'inline' || d.code === 'POS_PAID_REFERENCE_MISSING') {
        // Fixable here: a changed total (reload shows the new one; confirming
        // again sends a new action_id) or a method that is not allowed.
        setProblem(d.message);
        await onChanged();
      } else {
        setDialog(null);
        toast.error(e, { title: t('paid.markFailed') });
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const submitUndo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await approve('mark_unpaid', (approval) =>
        window.api.invoke('orders:markUnpaid', order.id, { reason: reason.trim() || null }, approval)
      );
      await afterResult(r as any, t('paid.undoneToast'));
    } catch (e) {
      setDialog(null);
      toast.error(e, { title: t('paid.undoFailed') });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const dismissRefusal = async () => {
    await window.api.invoke('orders:dismissPaidRefusal', order.id).catch(() => null);
    await onChanged();
  };

  // The refusal was stored with no params; the one placeholder any of these
  // carries is the new total, which the refusal already wrote onto the order.
  const refusal =
    order.paid_refusal && isKnownCode(order.paid_refusal)
      ? copyFor(order.paid_refusal, lang, { grand_total: money(order.grand_total) })
      : null;

  function renderDialogs() {
    return (
      <>
      <Modal
        isOpen={dialog === 'mark'}
        onOpenChange={(open) => !open && !busy && setDialog(null)}
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
          <ModalHeader className='text-lg font-semibold ink'>{t('paid.confirmTitle')}</ModalHeader>
          <ModalBody className='space-y-3 overflow-y-auto'>
            <p className='text-sm font-medium ink'>
              {t('paid.confirmBody', {
                amount: money(order.grand_total),
                method: methodName(selected) || '—',
              })}
            </p>
            <Select
              label={t('paid.method')}
              selectedKeys={methodId ? [methodId] : []}
              isDisabled={busy || closed}
              classNames={{ trigger: 'ui-input' }}
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0];
                if (next != null) setMethodId(String(next));
              }}
            >
              {methods.map((m) => (
                <SelectItem key={String(m.id)}>{methodName(m)}</SelectItem>
              ))}
            </Select>
            {closed && (
              <p className='text-xs font-medium ink-2'>{t('paid.methodLocked')}</p>
            )}
            {needsReference && (
              <Input
                label={t('paid.reference')}
                description={t('paid.referenceHint')}
                value={reference}
                maxLength={PAID_REFERENCE_MAX}
                onValueChange={setReference}
                isDisabled={busy}
                isRequired
                autoFocus
                dir='ltr'
                classNames={{ inputWrapper: 'ui-input' }}
              />
            )}
            <Input
              label={t('paid.note')}
              value={note}
              maxLength={500}
              onValueChange={setNote}
              isDisabled={busy}
              classNames={{ inputWrapper: 'ui-input' }}
            />
            {linkOpen && (
              <div className='ui-notice'>
                <AlertTriangle size={16} strokeWidth={1.8} className='mt-0.5 shrink-0 text-[var(--st-amber)]' />
                <span className='text-sm font-medium ink'>{t('paid.linkWarning')}</span>
              </div>
            )}
            {problem && (
              <p role='alert' className='text-sm font-semibold text-[var(--st-red)]'>
                {problem}
              </p>
            )}
          </ModalBody>
          <ModalFooter className='flex flex-wrap justify-end gap-2 border-t border-line'>
            <Button variant='bordered' size='lg' className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold' onPress={() => setDialog(null)} isDisabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              color='primary'
              size='lg'
              className='rounded-[13px] font-semibold'
              onPress={submitMark}
              isLoading={busy}
              isDisabled={!selected || referenceMissing}
            >
              {t('paid.mark')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={dialog === 'undo'}
        onOpenChange={(open) => !open && !busy && setDialog(null)}
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
          <ModalHeader className='text-lg font-semibold ink'>{t('paid.undo')}</ModalHeader>
          <ModalBody className='space-y-3 overflow-y-auto'>
            <p className='text-sm font-medium text-foreground'>{t('paid.undoConfirm')}</p>
            <Input
              label={t('paid.reason')}
              value={reason}
              maxLength={500}
              onValueChange={setReason}
              isDisabled={busy}
            />
          </ModalBody>
          <ModalFooter className='flex flex-wrap justify-end gap-2 border-t border-line'>
            <Button variant='bordered' size='lg' className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold' onPress={() => setDialog(null)} isDisabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button color='danger' size='lg' className='rounded-[13px] font-semibold' startContent={busy ? undefined : <Undo2 size={18} strokeWidth={1.8} />} onPress={submitUndo} isLoading={busy}>
              {t('paid.undo')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      </>
    );
  }

  const dialogs = renderDialogs();

  // A list row: one small outline "Mark paid" button (same dialog, with the
  // reference field for KNET / online), nothing when it does not apply.
  if (trigger === 'compact') {
    if (!canShowMark) return null;
    return (
      <>
        <Hint content={t('paid.mark')} placement='top'>
          <button
            type='button'
            className='ui-btn ui-btn-outline ui-btn-sm whitespace-nowrap max-2xl:px-2'
            aria-label={t('paid.mark')}
            onClick={(e) => {
              e.stopPropagation();
              openMark();
            }}
          >
            <HandCoins size={15} strokeWidth={1.8} />
            {/* The word from 1280px; an icon (with its tooltip) below. */}
            <span className='hidden 2xl:inline'>{t('paid.mark')}</span>
          </button>
        </Hint>
        {dialogs}
      </>
    );
  }

  if (trigger === 'badge') {
    const badge = <PaymentBadge order={order as any} />;
    if (!canShowMark) return badge;
    return (
      <>
        <Hint content={t('paid.mark')} placement='top'>
          <button
            type='button'
            onClick={(e) => {
              e.stopPropagation();
              openMark();
            }}
            className='rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)]'
            aria-label={t('paid.mark')}
          >
            {badge}
          </button>
        </Hint>
        {dialogs}
      </>
    );
  }

  if (!canShowMark && !canShowUndo && !refusal) return null;

  return (
    <>
      {refusal && (
        <div className='ui-notice'>
          <AlertTriangle size={16} strokeWidth={1.8} className='mt-0.5 shrink-0 text-[var(--st-amber)]' />
          <div className='min-w-0 flex-1 text-sm'>
            <div className='font-semibold ink'>{t('paid.refusedTitle')}</div>
            <div className='font-medium ink-2'>
              {refusal.title} — {refusal.body}
            </div>
          </div>
          <Button
            isIconOnly
            size='md'
            variant='light'
            aria-label={t('common.close')}
            onPress={dismissRefusal}
          >
            <X size={15} strokeWidth={1.8} />
          </Button>
        </div>
      )}

      {(canShowMark || canShowUndo) && (
        <div className='flex flex-wrap items-center gap-2'>
          {canShowMark && (
            <Button
              size={size}
              color='primary'
              className='rounded-[11px] font-semibold [@media(pointer:coarse)]:min-h-11'
              startContent={<HandCoins size={15} strokeWidth={1.8} />}
              onPress={openMark}
            >
              {t('paid.mark')}
            </Button>
          )}
          {canShowUndo && (
            <Button
              size={size}
              variant='bordered'
              className='rounded-[11px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold [@media(pointer:coarse)]:min-h-11'
              startContent={<Undo2 size={15} strokeWidth={1.8} />}
              onPress={openUndo}
            >
              {t('paid.undo')}
            </Button>
          )}
        </div>
      )}

      {dialogs}
    </>
  );
}
