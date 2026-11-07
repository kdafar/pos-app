// components/TableQuickBar.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { TableInfo } from '../types';
import { useI18n } from '../../../i18n';
import { floorsOf, initialFloor, NO_FLOOR, onFloor } from '../tableFloors';

/**
 * Quiet tables: every pill is a neutral surface with a hairline border; only a
 * small solid dot carries the status. The table on screen takes the brand
 * border and ring.
 */
const STATUS_DOT: Record<TableInfo['status'], string> = {
  available: 'bg-[var(--st-green)]',
  reserved: 'bg-[var(--st-amber)]',
  occupied: 'bg-[var(--st-red)]',
};
// Busy is a solid red fill; the table on screen is an OUTLINE in the brand
// colour with a tick. Told apart by shape, not hue: with a red brand a brand
// fill looked exactly like a busy table, and a green one like the free dots.
const OCCUPIED_FILL = 'border-[var(--st-red)] bg-[var(--st-red)] text-white';
const ACTIVE_FILL =
  'border-2 border-[var(--brand)] bg-[var(--surface)] text-[var(--ink)] font-bold shadow-[0_0_0_3px_var(--brand-ring)]';

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
    <div className='px-3 lg:px-4 py-1 bg-canvas'>
      <div className="flex items-center gap-2 overflow-x-auto chip-scroll py-1 px-1">
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
          // Occupied = the whole pill red, no extra word: every pill stays the
          // same size, so the row holds as many tables as possible.
          const occupied = t.status === 'occupied';
          const label = lang === 'ar' && t.name_ar ? t.name_ar : t.name;
          // Held for a draft on another till: say whose, on hover and to readers.
          const heldBy = !t.current_order_id && !(t as any).held_by_me ? (t as any).held_by : null;
          const statusWord = occupied
            ? heldBy
              ? `${translate('tables.occupied')} · ${heldBy}`
              : translate('tables.occupied')
            : '';

          return (
            <button
              key={t.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              disabled={disabled}
              aria-current={isActive ? 'true' : undefined}
              title={statusWord ? `${label} — ${statusWord}` : undefined}
              onClick={async () => {
                if (isActive) return;
                if (t.current_order_id) await onSelectOrder(t.current_order_id);
                else if (t.status === 'available') await onStartDineIn(t);
              }}
              // Not faded when it cannot be tapped: a busy table still has to
              // read as busy from arm's length. The cursor says "not this one".
              className={`inline-flex shrink-0 items-center gap-1.5 min-h-9 pointer-coarse:min-h-11 px-3 rounded-full text-sm font-semibold whitespace-nowrap border transition disabled:cursor-not-allowed active:scale-[.98] ${
                isActive
                  ? ACTIVE_FILL
                  : occupied
                  ? OCCUPIED_FILL
                  : 'border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)]'
              }`}
            >
              {/* The dot only where the fill does not already say it. */}
              {isActive ? (
                <Check size={16} strokeWidth={3} className='shrink-0 text-[var(--brand-strong)]' aria-hidden />
              ) : (
                !occupied && (
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[t.status]}`}
                    aria-hidden
                  />
                )
              )}
              {label}
              {t.seats ? (
                <span className={`text-xs font-medium money ${occupied && !isActive ? 'opacity-80' : 'ink-2'}`}>({t.seats})</span>
              ) : null}
              {statusWord && <span className='sr-only'>{statusWord}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
