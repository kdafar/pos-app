import React from 'react';
import { Check, Clock, Percent, ShoppingCart, X } from 'lucide-react';
import Row from './Row';
import { useThemeTokens } from '../../hooks/useThemeTokens';
import type { Order, OrderLine, OrderType } from '../../../types';

function labelForType(type: OrderType) {
  switch (type) {
    case 1: return 'Delivery';
    case 2: return 'Pickup';
    case 3: return 'Dine-in';
    default: return 'Order';
  }
}

export default function CartPanel({
  currentOrder,
  orderLines,
  onCreateOrder,
  onSelectOrder,
  onCheckout,
  onShowPromo,
  onRemovePromo,
  onLoadActiveOrders,
}: {
  currentOrder: Order | null;
  orderLines: OrderLine[];
  onCreateOrder: () => void;
  onSelectOrder: (id: string) => void;
  onCheckout: () => void;
  onShowPromo: () => void;
  onRemovePromo: () => void;
  onLoadActiveOrders: () => Promise<void>;
}) {
  const { t, theme } = useThemeTokens();

  return (
    <div className={`backdrop-blur border-l ${t.border} flex flex-col h-full overflow-hidden ${theme === 'dark' ? 'bg-slate-900/60' : 'bg-white'}`}>
      {/* Header */}
      <div className={`p-4 border-b ${t.border} shrink-0`}>
        {currentOrder ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className={`text-xs ${t.textMuted}`}>Order Number</div>
                <div className={`text-xl font-bold ${t.text}`}>#{currentOrder.number}</div>
              </div>
              <div className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                theme === 'dark'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-blue-100 text-blue-700 border border-blue-300'
              }`}>
                {labelForType(currentOrder.order_type)}
              </div>
            </div>

            {/* Promo */}
            {currentOrder.promocode ? (
              <div className={`flex items-center justify-between p-2.5 rounded-lg border ${
                theme === 'dark'
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-green-50 border-green-300'
              }`}>
                <div className="flex items-center gap-2">
                  <Percent size={16} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                  <span className={`text-xs font-medium ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>
                    {currentOrder.promocode}
                  </span>
                </div>
                <button
                  onClick={onRemovePromo}
                  className={`text-xs ${theme === 'dark' ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700'}`}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={onShowPromo}
                className={`w-full py-2 rounded-lg border text-xs font-medium transition ${
                  theme === 'dark'
                    ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Percent size={14} className="inline mr-1" /> Apply Promo Code
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-3">
            <p className={`${t.textMuted} mb-2`}>No active order</p>
            <button
              onClick={onCreateOrder}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium ${
                theme === 'dark'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                  : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
              }`}
            >
              Create New Order
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {currentOrder && (
        <>
          <div className="grow overflow-y-auto p-4">
            {orderLines.length === 0 ? (
              <div className={`flex flex-col items-center justify-center h-full ${t.textMuted}`}>
                <ShoppingCart size={40} className="mb-3 opacity-50" />
                <p className="text-center">Cart is empty<br />Add items to get started</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {orderLines.map(line => (
                  <OrderLineItem
                    key={line.id}
                    line={line}
                    orderId={currentOrder.id}
                    onUpdate={() => onSelectOrder(currentOrder.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`p-4 border-t ${t.border} ${t.cardBg} pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] shrink-0`}>
            <div className="space-y-1.5 mb-3">
              <Row label="Subtotal" value={(currentOrder.subtotal || 0).toFixed(3)} />
              {currentOrder.discount_total > 0 && (
                <Row label="Discount" value={`-${(currentOrder.discount_total || 0).toFixed(3)}`} />
              )}
              {currentOrder.order_type === 1 && (
                <Row label="Delivery Fee" value={(currentOrder.delivery_fee || 0).toFixed(3)} />
              )}
              <div className={`flex justify-between text-[15px] font-bold ${t.text} pt-2 border-t ${
                theme === 'dark' ? 'border-white/10' : 'border-gray-200'
              }`}>
                <span>Total</span>
                <span className={t.accent}>{(currentOrder.grand_total || 0).toFixed(3)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await window.api.invoke('orders:close', currentOrder.id);
                  await onLoadActiveOrders();
                }}
                className={`px-3.5 py-2 rounded-lg text-sm border transition flex items-center justify-center gap-1.5 ${
                  theme === 'dark'
                    ? 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Clock size={18} /> Hold
              </button>
              <button
                onClick={onCheckout}
                disabled={orderLines.length === 0}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 ${
                  theme === 'dark'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                    : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <Check size={18} /> Checkout
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Inline (kept local to CartPanel for brevity) */
function OrderLineItem({
  line,
  orderId,
  onUpdate,
}: {
  line: OrderLine;
  orderId: string;
  onUpdate: () => void;
}) {
  const { t, theme } = useThemeTokens();
  const call = (ch: string, ...args: any[]) => window.api.invoke(ch, ...args);

  const setQty = async (nextQty: number) => {
    if (nextQty <= 0) {
      await call('orders:removeLine', line.id)
        .catch(() => call('orders:removeLineByItem', orderId, line.item_id))
        .catch(() => call('orders:addLine', orderId, line.item_id, -line.qty));
    } else {
      await call('orders:setLineQty', line.id, nextQty).catch(async () => {
        const delta = nextQty - Number(line.qty || 0);
        if (delta !== 0) await call('orders:addLine', orderId, line.item_id, delta);
      });
    }
    onUpdate();
  };

  const inc = async () => setQty(Number(line.qty || 0) + 1);
  const dec = async () => setQty(Math.max(0, Number(line.qty || 0) - 1));
  const remove = async () => setQty(0);

  return (
    <div className={`${t.cardBg} border ${t.cardBorder} rounded-lg p-3 transition ${theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-50'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 pr-2">
          <h4 className={`font-semibold ${t.text} leading-snug`}>{line.name}</h4>
          <p className={`text-xs ${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'} font-medium`}>
            {line.unit_price.toFixed(3)} × {line.qty}
          </p>
        </div>
        <button
          onClick={remove}
          className={theme === 'dark' ? 'text-slate-400 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}
          title="Remove"
        >
          <svg width="0" height="0" />
          {/* bring your Trash2 icon import here if you prefer */}
          ✕
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            onClick={dec}
            disabled={line.qty <= 1}
            className={`w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
              theme === 'dark'
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
            title={line.qty <= 1 ? 'Use the trash to remove' : 'Decrease'}
          >
            –
          </button>
          <span className={`w-10 text-center font-semibold ${t.text}`}>{line.qty}</span>
          <button
            onClick={inc}
            className={`w-8 h-8 rounded-md flex items-center justify-center ${
              theme === 'dark'
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
          >
            +
          </button>
        </div>
        <div className={`text-[15px] font-bold ${t.text}`}>{line.line_total.toFixed(3)}</div>
      </div>
    </div>
  );
}
