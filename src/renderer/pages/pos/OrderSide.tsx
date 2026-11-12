import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { Hint } from '../../components/Hint';
import {
  ShoppingCart,
  Check,
  X,
  Percent,
  UtensilsCrossed,
  Table2,
  Lock,
} from 'lucide-react';

import {
  Order,
  OrderLine,
  TableInfo,
  State,
  City,
  Block,
  Promo,
} from './types';
import { OrderLineItem } from './components/OrderLineItem';
import { PromoDialog } from './components/PromoDialog';
import { TablePickerModal } from './components/TablePickerModal';
import { CheckoutModal } from './components/CheckoutModal';
import { ERROR_CATALOG, interpolate } from '../../../shared/errorCatalog';
import { localizeParams } from '../../../shared/platformOnly';
import { isOnlinePayment } from './paymentKinds';
import { DeliveryFeeRow } from './components/DeliveryFeeRow';
import { useToast } from '../../components/ToastProvider';
import { MarkPaidControl } from '../../components/MarkPaidControl';
import { useConfirmDialog } from '../../components/ConfirmDialogProvider';
import { shortOrderLabel } from '../../utils/orderLabel';
import { PaymentBadge } from '../../components/PaymentBadge';
import { useI18n, useOrderTypeLabel } from '../../i18n';
declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

/**
 * The cart: a white column on the portal's surface tokens, correct in both
 * themes. `theme` is still destructured only because child modals
 * (CheckoutModal above all) still require it.
 *
 * Read at arm's length mid-transaction, so nothing that carries meaning is
 * faded, and every control keeps a finger-sized target. On a short screen the
 * header and footer stay put and the line list scrolls.
 */
export default function OrderSide({
  theme,
  currentOrder,
  orderLines,
  promos,
  states,
  cities,
  blocks,
  tables,
  onRefreshTables,
  onCreateOrder,
  onSelectOrder,
  onReloadActiveOrders,
  onApplyPromo,
  onRemovePromo,
  onLoadCities,
  onLoadBlocks,
}: {
  theme: 'light' | 'dark';
  currentOrder: Order | null;
  orderLines: OrderLine[];
  promos: Promo[];
  states: State[];
  cities: City[];
  blocks: Block[];
  tables: TableInfo[];
  onRefreshTables: () => Promise<void>;
  onCreateOrder: () => void;
  onSelectOrder: (id: string) => Promise<void>;
  onReloadActiveOrders: () => Promise<void>;
  onApplyPromo: (code: string) => Promise<void>;
  onRemovePromo: () => Promise<void>;
  onLoadCities: (stateId: string) => Promise<void>;
  onLoadBlocks: (cityId: string) => Promise<void>;
}) {
  const [showCheckout, setShowCheckout] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showPromoDialog, setShowPromoDialog] = useState(false);
  const [quickUpdating, setQuickUpdating] = useState(false);

  const text = 'text-foreground';
  const textMuted = 'ink-2';
  const toast = useToast();
  const confirm = useConfirmDialog();
  const { t, lang, money } = useI18n();
  // POS_PUSH_PLATFORM_ONLY_PAYMENT kept on this order: its words, filled in
  // from the order and this till's platform_only copy.
  const [platformNotice, setPlatformNotice] = useState<Record<string, string> | null>(null);
  const noticeOrderId = Number(currentOrder?.platform_notice ?? 0) > 0 ? currentOrder?.id : null;
  useEffect(() => {
    let live = true;
    setPlatformNotice(null);
    if (noticeOrderId) {
      window.api
        .invoke('catalog:platformNotice', noticeOrderId)
        .then((p: Record<string, string>) => live && setPlatformNotice(p ?? null))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [noticeOrderId]);
  const labelForType = useOrderTypeLabel();
  const isOrderLocked =
    !!currentOrder &&
    (((currentOrder as any).is_locked === 1 ||
      (currentOrder as any).is_locked === true) as boolean);
  // Another till's order (server id, all digits): new items go to it like a
  // new round on a placed table, then print as an added-items slip.
  const isOtherTillsOrder = !!currentOrder && /^\d+$/.test(String(currentOrder.id));

  const lineIsLocked = (line: any) =>
    line?.is_locked === 1 || line?.is_locked === true;

  // Only after FIRST print: there must be at least one locked line
  const hasMainLockedLines =
    (isOrderLocked || isOtherTillsOrder) && orderLines.some((l) => lineIsLocked(l));

  const pendingNewItemsCount = hasMainLockedLines
    ? orderLines.filter((l) => !lineIsLocked(l)).length
    : 0;

  const hasPendingNewItems = pendingNewItemsCount > 0;

  const handleClearCart = async () => {
    if (!currentOrder) return;

    const ok = await confirm({
      title: t('cart.clearTitle'),
      message: (
        <div className='space-y-1 pos-sm'>
          <p>
            {t('cart.clearBodyBefore')} <b>{t('cart.clearBodyAllItems')}</b>{' '}
            {t('cart.clearBodyAfter')}
          </p>
          <p>{t('cart.clearUndo')}</p>
        </div>
      ),
      confirmLabel: t('cart.clearCart'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });

    if (!ok) return;

    try {
      // 🔗 new IPC handler – clears order_lines for this order
      await window.api.invoke('orders:clearLines', currentOrder.id);

      // reload this order so UI updates
      await onSelectOrder(currentOrder.id);

      toast({
        tone: 'success',
        title: t('cart.cleared'),
        message: t('cart.clearedMsg'),
      });
    } catch (e) {
      toast.error(e, { title: t('cart.clearFailed') });
    }
  };

  const handlePrint = async (orderId: string) => {
    try {
      await window.api.invoke('orders:print', orderId);
    } catch (e) {
      // A failed print must remain retryable. Previously we stamped printed_at
      // here, which hid the retry and made a printer failure look successful.
      toast.error(e, {
        title: t('admin.orders.printFailed'),
        onRetry: () => void handlePrint(orderId),
      });
      throw e;
    }
  };

  /**
   * A dine-in table already placed once has its details on the order: name,
   * mobile, payment method. Asking for them again on every new round made the
   * cashier re-confirm a form that had not changed. So a placed table sends
   * the round straight away with what is stored.
   *
   * Not for the first placement — that is where the details are entered — and
   * not for an online payment, which needs checkout to issue a link for the
   * new total.
   */
  const order = currentOrder as any;
  //
  // Only while there is a new round to send. With nothing new, the button is
  // "Pay": checkout opens as before, so the customer can still settle by a
  // different method than the one taken at the first round.
  const canQuickUpdate =
    !!currentOrder &&
    currentOrder.order_type === 3 &&
    !!currentOrder.table_id &&
    (isOrderLocked || isOtherTillsOrder) &&
    hasPendingNewItems &&
    !!String(order?.full_name ?? '').trim() &&
    !!order?.payment_method_id &&
    !isOnlinePayment(order?.payment_method_slug);

  const handleQuickUpdate = async () => {
    if (!currentOrder || quickUpdating) return;
    setQuickUpdating(true);
    try {
      // The same payload checkout sends, from the stored order. The main
      // process re-checks it exactly as it would a submitted form.
      const res: any = await window.api.invoke('orders:complete', currentOrder.id, {
        full_name: String(order.full_name ?? '').trim(),
        mobile: String(order.mobile ?? '').trim(),
        address: order.address ?? null,
        note: order.note ?? null,
        payment_method_id: String(order.payment_method_id ?? ''),
        payment_method_slug: String(order.payment_method_slug ?? ''),
        // Kept, not cleared: the main process drops it if it no longer covers
        // the new total.
        amount_tendered: order.amount_tendered ?? null,
        state_id: order.state_id ?? null,
        city_id: order.city_id ?? null,
        block_id: order.block_id ?? null,
      });

      // Printing matches the checkout path, and like it does not undo the
      // update if the printer fails — handlePrint already says so. Items
      // added to another till's order print as a slip of just those items.
      if (res?.added_line_ids?.length) {
        window.api.invoke('orders:printAdded', currentOrder.id, res.added_line_ids).catch(() => {});
      } else {
        handlePrint(currentOrder.id).catch(() => {});
      }

      await onSelectOrder(currentOrder.id);
      try {
        await onRefreshTables();
      } catch {}
      toast({ tone: 'success', title: t('cart.roundSent') });
    } catch (e) {
      toast.error(e, { title: t('cart.roundFailed') });
    } finally {
      setQuickUpdating(false);
    }
  };

  const focusNextActive = async () => {
    await onReloadActiveOrders();
    try {
      const next = await window.api.invoke('orders:listActive');
      if (next?.length) await onSelectOrder(next[0].id);
    } catch {
      /* no-op */
    }
  };

  const handleClose = async () => {
    if (!currentOrder) return;

    // ---------- PRE-VALIDATION ----------

    // 1) DELIVERY: require address if there are items
    if (currentOrder.order_type === 1 && orderLines.length > 0) {
      const asAny = currentOrder as any;
      const hasDeliveryAddress =
        !!asAny.state_id && !!asAny.city_id && !!asAny.block_id;

      if (!hasDeliveryAddress) {
        toast({
          tone: 'warning',
          title: t('cart.needAddress'),
          message: ERROR_CATALOG.POS_VAL_CITY_REQUIRED[lang].body,
        });
        // open checkout so they can fill it
        setShowCheckout(true);
        return;
      }
    }

    // 2) DINE-IN: require table if there are items
    if (currentOrder.order_type === 3 && orderLines.length > 0) {
      if (!currentOrder.table_id) {
        toast({
          tone: 'warning',
          title: t('cart.needTable'),
          message: ERROR_CATALOG.POS_VAL_TABLE_REQUIRED[lang].body,
        });
        setShowTablePicker(true);
        return;
      }
      // note: if there *is* a table and there are items,
      // the button will use handleReleaseTable instead (see JSX),
      // so this guard is mainly for dine-in orders with items but no table.
    }

    // ---------- SPECIAL CASE: empty dine-in with table ----------
    // For dine-in with a table and NO items: just free the table & close empty order.
    if (
      currentOrder.order_type === 3 &&
      currentOrder.table_id &&
      orderLines.length === 0
    ) {
      try {
        await window.api.invoke('orders:clearTable', currentOrder.id);
      } catch (e) {
        console.error('Failed to clear table on empty dine-in order:', e);
      }
    }

    // ---------- NORMAL CLOSE FLOW ----------
    try {
      // Print only if this order has never been printed.
      //
      // Placing an order prints the customer's receipt. Placing no longer
      // closes the order — staff move it through prepared/ready and close it
      // when it is actually handed over — so closing is now a second event, and
      // printing here unconditionally put a duplicate receipt through the
      // printer every time a delivery came back. A receipt belongs to the sale,
      // not to the moment the order is filed.
      const alreadyPrinted = Number((currentOrder as any).printed_at ?? 0) > 0;
      if (orderLines.length > 0 && !alreadyPrinted) {
        try {
          await handlePrint(currentOrder.id);
        } catch (e) {
          console.error('Print before close failed (continuing):', e);
        }
      }

      await window.api.invoke('orders:close', currentOrder.id);
    } catch (e) {
      // Was console-only: a refused close (missing city, unreadable lines)
      // left the button looking dead. Say why, and keep the order on screen.
      toast.error(e, { title: t('cart.closeFailed') });
      return;
    }

    await focusNextActive();
    try {
      await onRefreshTables();
    } catch {}
  };

  // Final settlement for dine-in
  const handleReleaseTable = async () => {
    if (!currentOrder) return;
    // `confirm` here is useConfirmDialog(), which takes an options object and
    // returns a Promise. It was being called with a bare string and without
    // await, so the returned promise was always truthy — the guard never
    // blocked, and the dialog opened empty and was never resolved. Releasing a
    // table also prints and finalises, so an unguarded click is destructive.
    const ok = await confirm({
      title: t('cart.releaseConfirmTitle'),
      message: t('cart.releaseConfirm'),
      confirmLabel: t('cart.releaseTable'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;

    try {
      // 🧾 Print BEFORE finalizing & freeing the table
      try {
        await handlePrint(currentOrder.id);
      } catch (e) {
        console.error('Print before release failed (continuing):', e);
      }

      await window.api.invoke('orders:releaseTable', currentOrder.id);
      await focusNextActive();
      await onRefreshTables();
    } catch (e) {
      toast.error(e, { title: t('cart.releaseFailed') });
    }
  };

  return (
    <div className='bg-surface border-s border-line flex flex-col h-full min-h-0 min-w-0 overflow-hidden'>
      {/* Header (scrolls itself if a short screen cannot fit it) */}
      <div className='p-3 lg:p-4 border-b border-line shrink-0 max-h-[45%] overflow-y-auto nice-scroll'>
        {currentOrder ? (
          <div className='space-y-2'>
            {/* Top row: order info + type + lock badges */}
            <div className='flex items-start justify-between gap-3'>
              {/* Left: order number + table button */}
              <div className='space-y-1.5 min-w-0'>
                <div>
                  {/* The number speaks for itself; the label is for screen readers. */}
                  <span className='sr-only'>{t('cart.orderNumber')}</span>
                  <div
                    className={`flex flex-wrap items-center gap-2 text-lg font-bold leading-tight ${text}`}
                  >
                    {/* .money forces LTR digit order so the number never
                        mirrors in Arabic. */}
                    <span className='money'>
                      {shortOrderLabel(currentOrder as any)}
                    </span>
                    {/* The whole order only once there is a paid state to
                        show; otherwise the link status alone, so a draft does
                        not grow an "Unpaid" chip. */}
                    {(currentOrder as any).paid_status ||
                    (currentOrder as any).paid_pending ? (
                      <PaymentBadge order={currentOrder as any} />
                    ) : (
                      <PaymentBadge
                        status={(currentOrder as any).payment_link_status}
                      />
                    )}
                  </div>
                </div>

                {/* Mark paid on the open order: a dine-in table can pay early
                    and stay open (contract §2). */}
                <MarkPaidControl
                  order={currentOrder as any}
                  onChanged={() => onSelectOrder(currentOrder.id)}
                />

                {/* Table controls (dine-in) */}
                {currentOrder.order_type === 3 && (
                  <div className='flex flex-wrap items-center gap-2'>
                    {currentOrder.table_id ? (
                      <Button
                        size='md'
                        variant='bordered'
                        className='font-semibold border border-[var(--line-strong)] bg-[var(--surface)]'
                        onPress={() => setShowTablePicker(true)}
                        startContent={<Table2 size={16} strokeWidth={1.8} className='shrink-0' />}
                      >
                        {currentOrder.table_name || t('cust.table')} •{' '}
                        <span className='money'>{currentOrder.covers || 1}</span>
                      </Button>
                    ) : (
                      <Button
                        size='md'
                        variant='bordered'
                        className='font-semibold border border-[var(--line-strong)] bg-[var(--surface)]'
                        onPress={() => setShowTablePicker(true)}
                        startContent={<UtensilsCrossed size={16} strokeWidth={1.8} className='shrink-0' />}
                      >
                        {t('tables.assign')}
                      </Button>
                    )}

                    {currentOrder.table_id && orderLines.length === 0 && (
                      <Hint content={t('admin.tables.clear')} placement='top'>
                      <Button
                        isIconOnly
                        size='md'
                        variant='bordered'
                        className='border border-[var(--line-strong)] bg-[var(--surface)]'
                        aria-label={t('admin.tables.clear')}
                        onPress={async () => {
                          try {
                            await window.api.invoke(
                              'orders:clearTable',
                              currentOrder.id
                            );
                            await onSelectOrder(currentOrder.id);
                            await onRefreshTables();
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                      >
                        <X size={16} strokeWidth={1.8} />
                      </Button>
                      </Hint>
                    )}
                  </div>
                )}
                {/* The server kept this order on its previous table. Stays
                    until a table is picked again, so it is still there when
                    the order is reopened later. */}
                {currentOrder.order_type === 3 &&
                  currentOrder.push_notice === 'POS_PUSH_TABLE_INVALID' && (
                    <p className='mt-1 max-w-xs text-xs font-semibold text-danger'>
                      {ERROR_CATALOG.POS_PUSH_TABLE_INVALID[lang].body}
                    </p>
                  )}
                {/* The server kept a Talabat/Keeta-only dish paid another way. */}
                {platformNotice && (
                  <p className='mt-1 max-w-xs text-xs font-semibold text-danger'>
                    {interpolate(
                      ERROR_CATALOG.POS_PUSH_PLATFORM_ONLY_PAYMENT[lang].body,
                      localizeParams(platformNotice, lang)
                    )}
                  </p>
                )}
              </div>

              {/* Right: type chip + lock / pending badges */}
              {/* May shrink and wrap: with both badges a fixed column pushed
                  the panel off its edge. */}
              <div className='flex flex-col items-end gap-1.5 min-w-0 max-w-[55%]'>
                <span className='ui-chip ui-chip-outline'>
                  {labelForType(currentOrder.order_type)}
                </span>

                {hasMainLockedLines && (
                  <div className='flex flex-wrap justify-end gap-1.5'>
                    {/* Main order locked badge */}
                    <span className='ui-chip ui-chip-amber'>
                      <Lock size={12} strokeWidth={1.8} />
                      {t('cart.lockedBadge')}
                    </span>

                    {/* New items pending badge */}
                    {hasPendingNewItems && (
                      <span className='ui-chip ui-chip-brand'>
                        <span className='w-1.5 h-1.5 rounded-full bg-current inline-block' />
                        {pendingNewItemsCount > 1
                          ? t('cart.pendingMany', {
                              n: pendingNewItemsCount,
                            })
                          : t('cart.pendingOne')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Promo + Clear cart share one compact row. Neither can be used on
                another till's order, so neither is offered there. */}
            {!isOtherTillsOrder && (
            // Stretch: when the promo label wraps, Clear cart grows with it.
            <div className='flex flex-wrap items-stretch gap-2'>
              {currentOrder.promocode ? (
                <div className='ui-notice items-center justify-between flex-1 min-w-0 !py-0.5'>
                  <div className='flex items-center gap-2 min-w-0'>
                    <Percent size={16} strokeWidth={1.8} className='shrink-0' />
                    <span className='pos-sm font-semibold truncate'>
                      {currentOrder.promocode}
                    </span>
                  </div>
                  <Hint content={t('common.remove')} placement='top'>
                    <button
                      type='button'
                      className='ui-icon-btn shrink-0 text-danger'
                      aria-label={t('common.remove')}
                      onClick={onRemovePromo}
                    >
                      <X size={16} strokeWidth={1.8} />
                    </button>
                  </Hint>
                </div>
              ) : (
                <Button
                  size='md'
                  variant='bordered'
                  className='flex-1 min-w-0 h-auto min-h-11 py-1.5 px-3 whitespace-normal leading-tight font-semibold border border-[var(--line-strong)] bg-[var(--surface)]'
                  onPress={() => setShowPromoDialog(true)}
                  startContent={<Percent size={16} strokeWidth={1.8} className='shrink-0' />}
                >
                  {/* Takes the button's width: left to shrink, the label broke
                      onto three lines ("Apply / Promo / Code"). */}
                  <span className='text-start min-w-0 flex-1'>{t('promo.title')}</span>
                </Button>
              )}

              {/* Clear cart: outline with danger text, not a solid red block */}
              {orderLines.length > 0 && (
                <Button
                  size='md'
                  variant='bordered'
                  color='danger'
                  // Its own width; the promo button takes the rest of the row.
                  className='shrink-0 h-auto min-h-11 py-1.5 px-3 whitespace-nowrap leading-tight font-semibold border border-[var(--line-strong)] bg-[var(--surface)] text-danger'
                  onPress={handleClearCart}
                  startContent={<X size={16} strokeWidth={1.8} className='shrink-0' />}
                >
                  <span className='text-start'>{t('cart.clearCart')}</span>
                </Button>
              )}
            </div>
            )}
          </div>
        ) : (
          <div className='text-center py-3'>
            <p className={`${textMuted} font-medium mb-2`}>
              {t('cart.noActiveOrder')}
            </p>
            <Button
              color='primary'
              size='lg'
              className='font-semibold rounded-[13px]'
              onPress={onCreateOrder}
            >
              {t('cart.createOrder')}
            </Button>
          </div>
        )}
      </div>

      {/* Body */}
      {currentOrder && (
        <>
          <div className='grow min-h-0 overflow-y-auto nice-scroll px-3 py-1 lg:px-4'>
            {orderLines.length === 0 ? (
              <div
                className={`flex flex-col items-center justify-center min-h-[200px] ${textMuted}`}
              >
                <ShoppingCart size={40} strokeWidth={1.8} className='mb-3' />
                <p className='text-center font-medium'>
                  {t('cart.empty')}
                  <br />
                  {t('cart.emptyHint')}
                </p>
              </div>
            ) : (
              <div className='@container divide-y divide-[var(--line)]'>
                {orderLines.map((line) => (
                  <OrderLineItem
                    key={line.id}
                    line={line}
                    orderId={currentOrder.id}
                    theme={theme}
                    onUpdate={() => onSelectOrder(currentOrder.id)}
                    readOnly={isOtherTillsOrder && lineIsLocked(line)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className='px-3 lg:px-4 border-t border-line bg-surface pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] shrink-0'
          >
            <div className='space-y-1.5 mb-3'>
              <Row
                label={t('cart.subtotal')}
                value={money(currentOrder.subtotal)}
              />
              {currentOrder.discount_total > 0 && (
                <Row
                  label={t('cart.discount')}
                  value={`-${money(currentOrder.discount_total)}`}
                />
              )}
              {currentOrder.order_type === 1 && (
                <DeliveryFeeRow
                  orderId={currentOrder.id}
                  value={Number(currentOrder.delivery_fee ?? 0)}
                  isManual={
                    Number((currentOrder as any).delivery_fee_manual) === 1
                  }
                  isWaived={
                    Number((currentOrder as any).void_delivery_fee) === 1
                  }
                  editable={!isOrderLocked}
                  onChanged={() => onSelectOrder(currentOrder.id)}
                />
              )}
              <div
                className={`flex justify-between pos-price font-bold ${text} pt-2 border-t border-line`}
              >
                <span>{t('common.total')}</span>
                <span className='money'>
                  {money(currentOrder.grand_total)}
                </span>
              </div>
            </div>

            {/* BUTTONS – match online POS style */}
            <div className='flex flex-wrap gap-3'>
              {/* Place Order — the one action this panel exists for, so it is
                  the only solid fill down here. */}
              <Button
                size='lg'
                color='primary'
                className='flex-1 basis-32 h-auto min-h-12 px-3 gap-1.5 py-2 whitespace-normal leading-tight font-semibold rounded-[13px]'
                onPress={() =>
                  canQuickUpdate ? handleQuickUpdate() : setShowCheckout(true)
                }
                isDisabled={orderLines.length === 0 || quickUpdating}
                isLoading={quickUpdating}
                startContent={!quickUpdating && <Check size={18} strokeWidth={1.8} className='shrink-0' />}
              >
                {currentOrder.order_type === 3
                  ? t('cart.updatePay')
                  : t('cart.placeOrder')}
              </Button>

              {/* Close / Release: large outline */}
              <Hint
                content={
                  currentOrder.order_type === 3 &&
                  currentOrder.table_id &&
                  orderLines.length > 0
                    ? t('cart.tipRelease')
                    : orderLines.length > 0
                    ? t('cart.tipClose')
                    : t('cart.tipDeleteEmpty')
                }
                placement='top'
              >
              <Button
                size='lg'
                variant='bordered'
                className='flex-1 basis-32 h-auto min-h-12 px-3 gap-1.5 py-2 whitespace-normal leading-tight font-semibold rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)]'
                onPress={
                  currentOrder.order_type === 3 &&
                  currentOrder.table_id &&
                  orderLines.length > 0
                    ? handleReleaseTable
                    : handleClose
                }
                startContent={<X size={16} strokeWidth={1.8} className='shrink-0' />}
              >
                {currentOrder.order_type === 3 &&
                currentOrder.table_id &&
                orderLines.length > 0
                  ? t('cart.closeRelease')
                  : t('cart.closeOrder')}
              </Button>
              </Hint>
            </div>
          </div>
        </>
      )}

      {/* Modals */}
      {showCheckout && currentOrder && (
        <CheckoutModal
          theme={theme}
          order={currentOrder}
          states={states}
          cities={cities}
          blocks={blocks}
          promos={promos}
          onClose={() => setShowCheckout(false)}
          onApplyPromo={onApplyPromo}
          onAfterComplete={async () => {
            setShowCheckout(false);

            if (currentOrder.order_type === 3) {
              // 🟢 Dine-in: keep the order on screen (e.g. for more items / partial payments)
              await onSelectOrder(currentOrder.id);
              try {
                await onRefreshTables();
              } catch {}
            } else {
              // 🚚 Delivery & 🧺 Pickup:
              // Just refresh the active orders list and tables,
              // DO NOT auto-select another order → right side can show "No active order".
              try {
                await onReloadActiveOrders();
              } catch {}

              // `placed` remains an active lifecycle status, so the refresh
              // above may keep it selected. Checkout is finished regardless
              // of whether printing succeeded; explicitly clear the cart view.
              await onSelectOrder('');

              try {
                await onRefreshTables();
              } catch {}
            }
          }}
          onLoadCities={onLoadCities}
          onLoadBlocks={onLoadBlocks}
          onPrintOrder={handlePrint}
          // A reserved reference changes what the order displays and prints,
          // so pull the row again once one lands.
          onAfterReserve={() =>
            currentOrder ? onSelectOrder(currentOrder.id) : undefined
          }
          // Checkout stays open behind the picker: assigning a table should not
          // cost the cashier the customer details they have already typed.
          onPickTable={() => setShowTablePicker(true)}
        />
      )}

      {showTablePicker && currentOrder && currentOrder.order_type === 3 && (
        <TablePickerModal
          theme={theme}
          current={currentOrder}
          tables={tables}
          onClose={() => setShowTablePicker(false)}
          onRefresh={onRefreshTables}
          onAssign={async (tbl, covers) => {
            // `tbl`, not `t` — `t` is the translator in this scope.
            try {
              await window.api.invoke('orders:setTable', currentOrder.id, {
                table_id: tbl.id,
                covers,
              });
              await onSelectOrder(currentOrder.id);
              await onRefreshTables();
              setShowTablePicker(false);
            } catch (e) {
              toast.error(e, { title: t('tables.assignFailed') });
            }
          }}
        />
      )}

      {showPromoDialog && currentOrder && (
        <PromoDialog
          theme={theme}
          promos={promos}
          onClose={() => setShowPromoDialog(false)}
          onApply={async (code) => {
            await onApplyPromo(code);
            setShowPromoDialog(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
function Row({
  label,
  value,
}: {
  label: string;
  value: string;
  /** Unused. Kept optional so a caller may still pass it. */
  theme?: 'light' | 'dark';
}) {
  const textMuted = 'ink-2';
  return (
    <div className={`flex justify-between pos-sm font-medium ${textMuted}`}>
      <span>{label}</span>
      {/* .money forces LTR digit order so "12.500" never mirrors in Arabic. */}
      <span className='font-semibold money'>{value}</span>
    </div>
  );
}
