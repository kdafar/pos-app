// components/OrderTypePicker.tsx
import React from 'react';
import { OrderType } from '../types';

export function OrderTypePicker({
  value,
  onChange,
  theme,
}: {
  value: OrderType;
  onChange: (t: OrderType) => void;
  theme: 'light' | 'dark';
}) {
  const types = [
    { k: 1 as const, label: 'Delivery', icon: '🚗' },
    { k: 2 as const, label: 'Pickup',   icon: '🛍️' },
    { k: 3 as const, label: 'Dine-in',  icon: '🍽️' },
  ];
  const bg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-300';
  const activeBtn = theme === 'dark'
    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow'
    : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow';
  const inactiveBtn = theme === 'dark'
    ? 'text-slate-300 hover:text-white'
    : 'text-gray-700 hover:text-gray-900';

  return (
    <div className={`inline-flex rounded-lg border p-1 ${bg}`}>
      {types.map(t => (
        <button
          key={t.k}
          type="button"
          onClick={() => onChange(t.k)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
            t.k === value ? activeBtn : inactiveBtn
          }`}
          title={t.label}
        >
          <span className="mr-1">{t.icon}</span>{t.label}
        </button>
      ))}
    </div>
  );
}
