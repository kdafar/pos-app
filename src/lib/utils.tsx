import React from 'react';
import { OrderType } from '../types';
import { useTheme } from '../context/ThemeContext';

export function labelForType(type: OrderType): string {
  switch (type) {
    case 1: return 'Delivery';
    case 2: return 'Pickup';
    case 3: return 'Dine-in';
    default: return 'Order';
  }
}

export function Row({ label, value }: { label: string; value: string; }) {
  const { theme } = useTheme();
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const text = theme === 'dark' ? 'text-slate-200' : 'text-gray-800';
  return (
    <div className={`flex justify-between ${textMuted}`}>
      <span>{label}</span>
      <span className={`font-medium ${text}`}>{value}</span>
    </div>
  );
}

export function OrderTypePicker({ value, onChange }: { value: OrderType; onChange: (type: OrderType) => void; }) {
  const { theme } = useTheme();
  const types = [
    { k: 1 as const, label: 'Delivery', icon: '🚗' },
    { k: 2 as const, label: 'Pickup', icon: '🛍️' },
    { k: 3 as const, label: 'Dine-in', icon: '🍽️' }
  ];

  const bg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-300';
  const activeBtn = theme === 'dark'
    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow'
    : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow';
  const inactiveBtn = theme === 'dark' ? 'text-slate-300 hover:text-white' : 'text-gray-700 hover:text-gray-900';

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
          <span className="mr-1">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}