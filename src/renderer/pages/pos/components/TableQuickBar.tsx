// components/TableQuickBar.tsx
import React from 'react';
import { TableInfo } from '../types';
import { useI18n } from '../../../i18n';

export function TableQuickBar({
  theme,
  tables,
  currentOrderId,
  onSelectOrder,
  onStartDineIn,
}: {
  theme: 'light' | 'dark';
  tables: TableInfo[];
  currentOrderId: string | null;
  onSelectOrder: (orderId: string) => Promise<void>;
  onStartDineIn: (table: TableInfo) => Promise<void>;
}) {
  // Hook must run before the early return.
  const { t: translate } = useI18n();

  if (!tables.length) return null;

  const border = 'border-default-100';
  const bg = theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50';
  const label = 'text-default-600';

  const colorFor = (t: TableInfo, isActive: boolean) => {
    if (isActive) return 'bg-blue-600 text-white border-blue-500';
    if (t.status === 'available') {
      return theme === 'dark'
        ? 'bg-emerald-600/20 text-emerald-200 border-emerald-500/60'
        : 'bg-emerald-100 text-emerald-700 border-emerald-300';
    }
    if (t.status === 'reserved') {
      return 'bg-amber-600/20 text-warning border-amber-500/60';
    }
    return theme === 'dark'
      ? 'bg-rose-600/20 text-rose-200 border-rose-500/60'
      : 'bg-rose-100 text-rose-700 border-rose-300';
  };

  return (
    <div className={`px-4 py-2 border-b ${border} ${bg}`}>
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className={`text-xs uppercase tracking-wide ${label} whitespace-nowrap`}>
          {translate('nav.tables')}
        </span>
        {tables.map(t => {
          const isActive = !!t.current_order_id && t.current_order_id === currentOrderId;
          const color = colorFor(t, isActive);
          const disabled = !t.current_order_id && t.status !== 'available';

          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (t.current_order_id) await onSelectOrder(t.current_order_id);
                else if (t.status === 'available') await onStartDineIn(t);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition disabled:opacity-60 disabled:cursor-not-allowed ${color}`}
            >
              {t.name}
              {t.seats ? (
                <span className="ms-1 opacity-70 text-[10px] money">({t.seats})</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
