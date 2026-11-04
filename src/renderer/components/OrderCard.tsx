import type { MouseEvent, ReactNode } from 'react';

/**
 * Portal order card (docs/DESIGN-SYSTEM.md, "Order card"). Purely
 * presentational: the page decides what goes in each slot and owns every
 * handler. Used by Today's Orders and the kitchen display.
 *
 * Rows: [number · type · (end) time] / meta / [money · payment · (end) status]
 * / optional body (kitchen dishes) / optional footer of controls.
 * Tapping the card body calls `onOpen`; anything in `payment`, `footer` or
 * `children` is wrapped so its own taps never reach the card.
 */
export function OrderCard({
  header,
  type,
  time,
  meta,
  money,
  payment,
  status,
  actions,
  footer,
  children,
  onOpen,
  fresh,
  className = '',
}: {
  /** The order number, already formatted. */
  header: ReactNode;
  /** Order type chip. */
  type?: ReactNode;
  /** Time / age chip, pushed to the end of row 1. */
  time?: ReactNode;
  /** Row 2: customer name and the like (ink-2, one line). */
  meta?: ReactNode;
  /** Row 3 start: the total. */
  money?: ReactNode;
  /** Row 3 middle: payment badge / mark-paid trigger. */
  payment?: ReactNode;
  /** Row 3 end: status chip. */
  status?: ReactNode;
  /** Footer controls, start side (status select, payment method). */
  footer?: ReactNode;
  /** Footer controls, end side (icon buttons). */
  actions?: ReactNode;
  /** Free body between row 3 and the footer (kitchen dishes, notes). */
  children?: ReactNode;
  onOpen?: () => void;
  /** New / fresh order: brand border and ring. */
  fresh?: boolean;
  className?: string;
}) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  const hasRow3 = money != null || payment != null || status != null;
  const hasFooter = footer != null || actions != null;
  return (
    <article
      onClick={onOpen}
      className={`ui-card ui-card-raise flex min-w-0 flex-col gap-3 p-4 ${
        onOpen ? 'cursor-pointer' : ''
      } ${fresh ? 'border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-ring)]' : ''} ${className}`}
    >
      <div className='flex min-w-0 flex-wrap items-center gap-2'>
        <span className='money min-w-0 truncate text-lg font-bold ink'>{header}</span>
        {type}
        {time != null && <span className='ms-auto flex shrink-0 items-center'>{time}</span>}
      </div>
      {meta != null && <div className='min-w-0 truncate text-sm ink-2'>{meta}</div>}
      {hasRow3 && (
        <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2'>
          {money != null && <span className='money text-base font-semibold ink'>{money}</span>}
          {payment != null && (
            <div className='min-w-0' onClick={stop}>
              {payment}
            </div>
          )}
          {status != null && <span className='ms-auto flex shrink-0 items-center'>{status}</span>}
        </div>
      )}
      {children != null && (
        <div className='min-w-0' onClick={stop}>
          {children}
        </div>
      )}
      {hasFooter && (
        <div
          className='mt-auto flex min-w-0 flex-wrap items-center gap-2 border-t border-line pt-3'
          onClick={stop}
        >
          {footer}
          {actions != null && <div className='ms-auto flex items-center gap-1.5'>{actions}</div>}
        </div>
      )}
    </article>
  );
}
