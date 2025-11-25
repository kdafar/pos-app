// components/OrderLineItem.tsx
import React from 'react';
import { Trash2, Plus, Minus } from 'lucide-react';
import { OrderLine } from '../types';

declare global {
  interface Window { api: { invoke: (channel: string, ...args: any[]) => Promise<any>; } }
}

export function OrderLineItem({
  line,
  orderId,
  theme,
  onUpdate,
}: {
  line: OrderLine;
  orderId: string;
  theme: 'light' | 'dark';
  onUpdate: () => void;
}) {
  const call = (ch: string, ...args: any[]) => window.api.invoke(ch, ...args);

  const setQty = async (nextQty: number) => {
    if (nextQty <= 0) {
      await call('orders:removeLine', line.id)
        .catch(() => call('orders:removeLineByItem', orderId, line.item_id))
        .catch(() => call('orders:addLine', orderId, line.item_id, -Number(line.qty || 0)));
    } else {
      await call('orders:setLineQty', line.id, nextQty)
        .catch(async () => {
          const delta = nextQty - Number(line.qty || 0);
          if (delta !== 0) await call('orders:addLine', orderId, line.item_id, delta);
        });
    }
    onUpdate();
  };

  const inc = async () => setQty(Number(line.qty || 0) + 1);
  const dec = async () => setQty(Math.max(0, Number(line.qty || 0) - 1));
  const remove = async () => setQty(0);

  const bg = theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const price = theme === 'dark' ? 'text-slate-200' : 'text-gray-800';

  return (
    <div className={`${bg} border ${border} rounded-lg p-3 transition`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 pr-2">
          <h4 className={`font-semibold ${text} leading-snug`}>{line.name}</h4>
          <p className={`text-xs ${price} font-medium`}>
            {line.unit_price.toFixed(3)} × {line.qty}
          </p>
        </div>
        <button
          onClick={remove}
          className={theme === 'dark'
            ? 'text-slate-400 hover:text-red-400'
            : 'text-gray-400 hover:text-red-500'}
          title="Remove"
        >
          <Trash2 size={16} />
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
            <Minus size={14} />
          </button>
          <span className={`w-10 text-center font-semibold ${text}`}>{line.qty}</span>
          <button
            onClick={inc}
            className={`w-8 h-8 rounded-md flex items-center justify-center ${
              theme === 'dark'
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className={`text-[15px] font-bold ${text}`}>{line.line_total.toFixed(3)}</div>
      </div>
    </div>
  );
}
