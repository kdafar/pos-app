import React, { useState } from 'react';
import {
  ShoppingCart,
  Check,
  X,
  Percent,
  UtensilsCrossed,
  Table2,
  LogOut,
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
import { DeliveryFeeRow } from './components/DeliveryFeeRow';
import { useToast } from '../../components/ToastProvider';
import { useConfirmDialog } from '../../components/ConfirmDialogProvider';
import { shortOrderLabel } from '../../utils/orderLabel';
import { PaymentBadge } from '../../components/PaymentBadge';
import { useI18n, useOrderTypeLabel } from '../../i18n';
declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

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

  const bg = theme === 'dark' ? 'bg-slate-900/60' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const cardBg = theme === 'dark' ? 'bg-white/5' : 'bg-gray-50';
  const toast = useToast();
  const confirm = useConfirmDialog();
  const { t, money } = useI18n();
  const labelForType = useOrderTypeLabel();
  const isOrderLocked =
    !!currentOrder &&
    (((currentOrder as any).is_locked === 1 ||
      (currentOrder as any).is_locked === true) as boolean);

  const lineIsLocked = (line: any) =>
    line?.is_locked === 1 || line?.is_locked === true;

  // Only after FIRST print: there must be at least one locked line
  const hasMainLockedLines =
    isOrderLocked && orderLines.some((l) => lineIsLocked(l));

  const pendingNewItemsCount = hasMainLockedLines
    ? orderLines.filter((l) => !lineIsLocked(l)).length
    : 0;

  const hasPendingNewItems = pendingNewItemsCount > 0;

  const handleClearCart = async () => {
    if (!currentOrder) return;

    const ok = await confirm({
      title: t('cart.clearTitle'),
      message: (
        <div className='space-y-1 text-[13px]'>
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
    } catch (e: any) {
      console.error('[handleClearCart] error:', e);
      toast({
        tone: 'danger',
        title: t('cart.clearFailed'),
        message: e?.message || t('common.checkLogs'),
      });
    }
  };

  const handlePrint = async (orderId: string) => {
    try {
      await window.api.invoke('orders:print', orderId);
    } catch {
      try {
        await window.api.invoke('orders:markPrinted', orderId);
      } catch {}
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
          tone: 'danger',
          title: t('cart.needAddress'),
          message: t('common.checkLogs'),
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
          tone: 'danger',
          title: t('cart.needTable'),
          message: t('common.checkLogs'),
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
      // If there are items, print before closing
      if (orderLines.length > 0) {
        try {
          await handlePrint(currentOrder.id);
        } catch (e) {
          console.error('Print before close failed (continuing):', e);
        }
      }

      await window.api.invoke('orders:close', currentOrder.id);
    } catch (e) {
      console.error('Failed to close order:', e);
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
      console.error(e);
      toast({
        tone: 'danger',
        title: t('cart.releaseFailed'),
        message: t('common.checkLogs'),
      });
    }
  };

  return (
    <div
      className={`${bg} backdrop-blur border-s ${border} flex flex-col h-full overflow-hidden`}
    >
      {/* Header */}
      <div className={`p-4 border-b ${border} shrink-0`}>
        {currentOrder ? (
          <div className='space-y-3'>
            {/* Top row: order info + type + lock badges */}
            <div className='flex items-start justify-between gap-3'>
              {/* Left: order number + table button */}
              <div className='space-y-1.5'>
                <div>
                  <div className={`text-xs ${textMuted}`}>
                    {t('cart.orderNumber')}
                  </div>
                  <div className={`text-xl font-bold ${text} money`}>
                    {shortOrderLabel(currentOrder as any)}
                    <PaymentBadge
                      status={(currentOrder as any).payment_link_status}
                      theme={theme}
                    />
                  </div>
                </div>

                {/* Table controls (dine-in) */}
                {currentOrder.order_type === 3 && (
                  <div className='flex items-center gap-2'>
                    {currentOrder.table_id ? (
                      <button
                        onClick={() => setShowTablePicker(true)}
                        className={`px-3 py-1.5 rounded-lg border text-xs ${
                          theme === 'dark'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-600/30'
                            : 'bg-emerald-100 text-emerald-700 border-emerald-300'
                        }`}
                      >
                        <Table2 size={14} className='inline me-1' />
                        {currentOrder.table_name || t('cust.table')} •{' '}
                        <span className='money'>{currentOrder.covers || 1}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowTablePicker(true)}
                        className={`px-3 py-1.5 rounded-lg border text-xs ${
                          theme === 'dark'
                            ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <UtensilsCrossed size={14} className='inline me-1' />{' '}
                        {t('tables.assign')}
                      </button>
                    )}

                    {currentOrder.table_id && orderLines.length === 0 && (
                      <button
                        onClick={async () => {
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
                        className={`px-3 py-1.5 rounded-lg border text-xs ${
                          theme === 'dark'
                            ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Right: type pill + lock / pending badges */}
              <div className='flex flex-col items-end gap-1.5'>
                <div
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                    theme === 'dark'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-blue-100 text-blue-700 border-blue-300 border'
                  }`}
                >
                  {labelForType(currentOrder.order_type)}
                </div>

                {hasMainLockedLines && (
                  <div className='flex flex-wrap justify-end gap-1.5'>
                    {/* Main order locked badge */}
                    <div
                      className={`
                  inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium
                  border
                  ${
                    theme === 'dark'
                      ? 'bg-amber-500/10 text-amber-200 border-amber-400/40'
                      : 'bg-amber-50 text-amber-700 border-amber-300'
                  }
                `}
                    >
                      <Lock size={13} />
                      <span>{t('cart.lockedBadge')}</span>
                    </div>

                    {/* New items pending badge */}
                    {hasPendingNewItems && (
                      <div
                        className={`
                    inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
                    border
                    ${
                      theme === 'dark'
                        ? 'bg-emerald-500/10 text-emerald-200 border-emerald-400/40'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    }
                  `}
                      >
                        <span className='w-1.5 h-1.5 rounded-full bg-current inline-block' />
                        <span>
                          {pendingNewItemsCount > 1
                            ? t('cart.pendingMany', {
                                n: pendingNewItemsCount,
                              })
                            : t('cart.pendingOne')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Promo section */}
            {currentOrder.promocode ? (
              <div
                className={`flex items-center justify-between p-2.5 rounded-lg border ${
                  theme === 'dark'
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-green-50 border-green-300'
                }`}
              >
                <div className='flex items-center gap-2'>
                  <Percent
                    size={16}
                    className={
                      theme === 'dark' ? 'text-green-400' : 'text-green-600'
                    }
                  />
                  <span
                    className={`text-xs font-medium ${
                      theme === 'dark' ? 'text-green-300' : 'text-green-700'
                    }`}
                  >
                    {currentOrder.promocode}
                  </span>
                </div>
                <button
                  onClick={onRemovePromo}
                  className={`text-xs ${
                    theme === 'dark'
                      ? 'text-green-400 hover:text-green-300'
                      : 'text-green-600 hover:text-green-700'
                  }`}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowPromoDialog(true)}
                className={`w-full py-2 rounded-lg border text-xs font-medium transition ${
                  theme === 'dark'
                    ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Percent size={14} className='inline me-1' />
                {t('promo.title')}
              </button>
            )}

            {/* Clear cart – full width, aligned with online POS look */}
            {orderLines.length > 0 && (
              <button
                type='button'
                onClick={handleClearCart}
                className='
                  w-full mt-2 h-9
                  rounded-lg text-xs font-semibold
                  flex items-center justify-center gap-1.5
                  bg-red-600 text-white
                  hover:bg-red-700
                  active:scale-[0.99]
                  transition
                '
              >
                <X size={14} />
                {t('cart.clearCart')}
              </button>
            )}
          </div>
        ) : (
          <div className='text-center py-3'>
            <p className={`${textMuted} mb-2`}>{t('cart.noActiveOrder')}</p>
            <button
              onClick={onCreateOrder}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium ${
                theme === 'dark'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary text-primary-foreground'
              }`}
            >
              {t('cart.createOrder')}
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {currentOrder && (
        <>
          <div className='grow overflow-y-auto nice-scroll p-4'>
            {orderLines.length === 0 ? (
              <div
                className={`flex flex-col items-center justify-center min-h-[200px] ${textMuted} opacity-70`}
              >
                <ShoppingCart size={40} className='mb-3' />
                <p className='text-center'>
                  {t('cart.empty')}
                  <br />
                  {t('cart.emptyHint')}
                </p>
              </div>
            ) : (
              <div className='space-y-2.5'>
                {orderLines.map((line) => (
                  <OrderLineItem
                    key={line.id}
                    line={line}
                    orderId={currentOrder.id}
                    theme={theme}
                    onUpdate={() => onSelectOrder(currentOrder.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className={`p-4 border-t ${border} ${cardBg} pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] shrink-0`}
          >
            <div className='space-y-1.5 mb-3'>
              <Row
                label={t('cart.subtotal')}
                value={money(currentOrder.subtotal)}
                theme={theme}
              />
              {currentOrder.discount_total > 0 && (
                <Row
                  label={t('cart.discount')}
                  value={`-${money(currentOrder.discount_total)}`}
                  theme={theme}
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
                  theme={theme}
                  editable={!isOrderLocked}
                  onChanged={() => onSelectOrder(currentOrder.id)}
                />
              )}
              <div
                className={`flex justify-between pos-price font-bold ${text} pt-2 border-t ${
                  theme === 'dark' ? 'border-white/10' : 'border-gray-200'
                }`}
              >
                <span>{t('common.total')}</span>
                <span
                  className={`money ${
                    theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
                  }`}
                >
                  {money(currentOrder.grand_total)}
                </span>
              </div>
            </div>

            {/* BUTTONS – match online POS style */}
            <div className='flex gap-3'>
              {/* Place Order (black) */}
              <button
                type='button'
                onClick={() => setShowCheckout(true)}
                disabled={orderLines.length === 0}
                className={`
                  flex-1 h-11 rounded-lg text-sm font-semibold
                  flex items-center justify-center gap-1.5
                  bg-black text-white
                  hover:bg-gray-900
                  disabled:opacity-40 disabled:cursor-not-allowed
                `}
              >
                <Check size={18} />
                {currentOrder.order_type === 3
                  ? t('cart.updatePay')
                  : t('cart.placeOrder')}
              </button>

              {/* Close / Release (blue) */}
              <button
                type='button'
                onClick={
                  currentOrder.order_type === 3 &&
                  currentOrder.table_id &&
                  orderLines.length > 0
                    ? handleReleaseTable
                    : handleClose
                }
                className={`
                  flex-1 h-11 rounded-lg text-sm font-semibold
                  flex items-center justify-center gap-1.5
                  bg-blue-600 text-white
                  hover:bg-blue-700
                `}
                title={
                  currentOrder.order_type === 3 &&
                  currentOrder.table_id &&
                  orderLines.length > 0
                    ? t('cart.tipRelease')
                    : orderLines.length > 0
                    ? t('cart.tipCancel')
                    : t('cart.tipDeleteEmpty')
                }
              >
                <X size={16} />
                {currentOrder.order_type === 3 &&
                currentOrder.table_id &&
                orderLines.length > 0
                  ? t('cart.closeRelease')
                  : t('cart.closeOrder')}
              </button>
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

              try {
                await onRefreshTables();
              } catch {}
            }
          }}
          onLoadCities={onLoadCities}
          onLoadBlocks={onLoadBlocks}
          onPrintOrder={handlePrint}
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
              console.error(e);
              toast({
                tone: 'danger',
                title: t('tables.assignFailed'),
                message: t('common.checkLogs'),
              });
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
  theme,
}: {
  label: string;
  value: string;
  theme: 'light' | 'dark';
}) {
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  return (
    <div className={`flex justify-between ${textMuted}`}>
      <span>{label}</span>
      {/* .money forces LTR digit order so "12.500" never mirrors in Arabic. */}
      <span className='font-medium money'>{value}</span>
    </div>
  );
}
