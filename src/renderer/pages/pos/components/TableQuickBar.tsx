// components/TableQuickBar.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TableInfo } from '../types';
import { useI18n } from '../../../i18n';
import { floorsOf, initialFloor, NO_FLOOR, onFloor } from '../tableFloors';

/**
 * Solid status fills, one meaning per colour, white text. Same in both themes.
 * The table on screen takes the brand fill and a brand ring.
 */
const STATUS_FILL: Record<TableInfo['status'], string> = {
  available: 'bg-[var(--st-green)] text-white border-transparent',
  reserved: 'bg-[var(--st-amber)] text-white border-transparent',
  occupied: 'bg-[var(--st-red)] text-white border-transparent',
};
const ACTIVE_FILL =
  'bg-[var(--brand)] text-[var(--brand-ink)] border-transparent ring-4 ring-[var(--brand-ring)]';

export function TableQuickBar({
  theme: _theme,
  tables,
  currentOrderId,
  currentTableId,
  onSelectOrder,
  onStartDineIn,
}: {
  theme: 'light' | 'dark';
  tables: TableInfo[];
  currentOrderId: string | null;
  /**
   * The table of the dine-in order on screen, read from the order itself.
   * The highlight used to be worked out from each table's active order, so it
   * vanished whenever that lookup missed the order — after placing it, for one.
   */
  currentTableId: string | null;
  onSelectOrder: (orderId: string) => Promise<void>;
  onStartDineIn: (table: TableInfo) => Promise<void>;
}) {
  // Hooks must run before the early return.
  const { t: translate, lang } = useI18n();
  const floors = useMemo(() => floorsOf(tables), [tables]);
  const [picked, setPicked] = useState<string | null>(null);
  // A different table on screen means the floor should follow it again, even
  // if the cashier had browsed to another floor in between.
  useEffect(() => setPicked(null), [currentTableId]);
  const wanted = picked ?? initialFloor(floors, tables, currentTableId);
  const floor = floors.some((f) => f.key === wanted) ? wanted : floors[0]?.key ?? NO_FLOOR;
  const visible = floors.length ? tables.filter((t) => onFloor(t, floor)) : tables;

  // Bring the order's table into view: with twenty tables on one row it was
  // usually off-screen, and the cashier had to scroll to find it.
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [currentTableId, floor, tables.length]);

  if (!tables.length) return null;

  return (
    <div className='px-4 py-2 bg-canvas'>
      <div className="flex items-center gap-2 overflow-x-auto py-1 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide ink-2 whitespace-nowrap">
          {translate('nav.tables')}
        </span>
        {floors.length > 0 && (
          <div className="ui-seg shrink-0">
            {floors.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setPicked(f.key)}
                aria-pressed={f.key === floor}
                className="ui-seg-item"
              >
                {f.key === NO_FLOOR
                  ? translate('tables.noFloor')
                  : lang === 'ar'
                  ? f.nameAr
                  : f.nameEn}
              </button>
            ))}
          </div>
        )}
        {floors.length > 0 && (
          <span className="mx-1 h-5 w-px shrink-0 bg-[var(--line-strong)]" aria-hidden />
        )}
        {visible.map(t => {
          const isActive = !!currentTableId && t.id === currentTableId;
          const disabled = !isActive && !t.current_order_id && t.status !== 'available';

          return (
            <button
              key={t.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              disabled={disabled}
              aria-current={isActive ? 'true' : undefined}
              onClick={async () => {
                if (isActive) return;
                if (t.current_order_id) await onSelectOrder(t.current_order_id);
                else if (t.status === 'available') await onStartDineIn(t);
              }}
              // Not faded when it cannot be tapped: a busy table still has to
              // read as busy from arm's length. The cursor says "not this one".
              className={`min-h-11 px-4 rounded-full text-sm font-semibold whitespace-nowrap border transition disabled:cursor-not-allowed active:scale-[.98] ${
                isActive ? ACTIVE_FILL : STATUS_FILL[t.status]
              }`}
            >
              {lang === 'ar' && t.name_ar ? t.name_ar : t.name}
              {t.seats ? (
                <span className="ms-1 text-xs money">({t.seats})</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
