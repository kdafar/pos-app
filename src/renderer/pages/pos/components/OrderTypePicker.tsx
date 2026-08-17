// components/OrderTypePicker.tsx
import React from 'react';
import { OrderType } from '../types';
import { useI18n, useOrderTypeLabel } from '../../../i18n';

export function OrderTypePicker({
  value,
  onChange,
}: {
  value: OrderType;
  onChange: (t: OrderType) => void;
}) {
  const { t: _t } = useI18n();
  const label = useOrderTypeLabel();

  const types = [
    { k: 1 as const, label: label(1), icon: '🚗' },
    { k: 2 as const, label: label(2), icon: '🛍️' },
    { k: 3 as const, label: label(3), icon: '🍽️' },
  ];
  const bg = 'bg-default-100 border-default-200';
  const activeBtn = 'bg-primary text-primary-foreground';
  const inactiveBtn = 'text-default-700 hover:text-white';

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
          <span className="me-1">{t.icon}</span>{t.label}
        </button>
      ))}
    </div>
  );
}
