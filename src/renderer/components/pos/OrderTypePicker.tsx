import React from 'react';
import { useThemeTokens } from '../../hooks/useThemeTokens';

export type OrderType = 1 | 2 | 3;

export default function OrderTypePicker({
  value,
  onChange,
}: { value: OrderType; onChange: (t: OrderType) => void }) {
  const { t } = useThemeTokens();
  const types = [
    { k: 1 as const, label: 'Delivery', icon: '🚗' },
    { k: 2 as const, label: 'Pickup',   icon: '🛍️' },
    { k: 3 as const, label: 'Dine-in',  icon: '🍽️' },
  ];
  return (
    <div className={`inline-flex rounded-lg border p-1 ${t.segBg}`}>
      {types.map(x => (
        <button
          key={x.k}
          type="button"
          onClick={() => onChange(x.k)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
            x.k === value ? t.segActive : t.segInactive
          }`}
          title={x.label}
        >
          <span className="mr-1">{x.icon}</span>
          {x.label}
        </button>
      ))}
    </div>
  );
}
