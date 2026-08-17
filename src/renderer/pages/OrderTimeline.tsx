// src/renderer/pages/OrderTimeline.tsx
import {
  Ban,
  CheckCircle2,
  CirclePlus,
  Clock,
  CreditCard,
  Lock,
  Play,
  Printer,
  Shuffle,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n';

/**
 * What happened to an order, and when.
 *
 * The previous version printed the raw action key — "orders.setDeliveryFee" —
 * next to a date, because the labels were written in snake_case while the log
 * records dotted names, so no lookup ever matched. That left the one screen
 * meant to explain an order's history speaking in identifiers.
 *
 * Beyond the labels, a flat list of same-sized dots gave every event equal
 * weight, so "Order placed" and "Quantity changed" looked identical. Each event
 * now carries its own icon and tone, and the rail makes the sequence legible at
 * a glance rather than requiring the timestamps to be read in order.
 */

type Event = { action: string; at: number; user?: string | null };

/** Icon and tone per action. Unknown actions still get a sane default. */
const LOOK: Record<string, { Icon: LucideIcon; tone: string }> = {
  'orders.start': { Icon: Play, tone: 'text-default-700' },
  'orders.setType': { Icon: Shuffle, tone: 'text-default-700' },
  'orders.addLineWithAddons': { Icon: CirclePlus, tone: 'text-primary' },
  'orders.clearLines': { Icon: Ban, tone: 'text-warning' },
  'orders.setDeliveryFee': { Icon: Truck, tone: 'text-warning' },
  'orders.setPaymentMethod': { Icon: CreditCard, tone: 'text-warning' },
  'orders.complete': { Icon: CheckCircle2, tone: 'text-success' },
  'orders.close': { Icon: Lock, tone: 'text-success' },
  'orders.print': { Icon: Printer, tone: 'text-default-700' },
};

export function OrderTimeline({ events }: { events: Event[] }) {
  const { t, lang } = useI18n();

  if (!events.length) {
    return (
      <div className='text-sm font-medium text-default-700'>
        {t('admin.orders.noHistory')}
      </div>
    );
  }

  const when = (ms?: number | null) =>
    ms
      ? new Date(ms).toLocaleString(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB')
      : '—';

  // Oldest first: a history reads forwards, and the last row is then the
  // order's current state rather than something buried at the top.
  const ordered = [...events].sort((a, b) => Number(a.at) - Number(b.at));

  const label = (action: string) => {
    const key = `admin.act.${action}` as StringKey;
    const out = t(key);
    // t() returns the key itself when it is missing; show something readable
    // rather than an identifier if a new action ships before its label does.
    if (out !== key) return out;
    const tail = action.includes('.') ? action.split('.').pop()! : action;
    return tail.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  };

  return (
    <ol className='relative space-y-0'>
      {ordered.map((e, i) => {
        const look = LOOK[e.action] ?? { Icon: Clock, tone: 'text-default-700' };
        const last = i === ordered.length - 1;
        return (
          <li key={`${e.action}-${e.at}-${i}`} className='flex gap-3 min-w-0'>
            {/* Rail: icon plus the connector down to the next event. */}
            <div className='flex flex-col items-center shrink-0'>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full
                  bg-default-100 ${look.tone}`}
              >
                <look.Icon size={14} />
              </span>
              {!last && <span className='w-px flex-1 bg-default-200 my-1' />}
            </div>

            <div className={`min-w-0 flex-1 ${last ? 'pb-0' : 'pb-4'}`}>
              <div className='text-sm font-semibold text-foreground'>
                {label(e.action)}
              </div>
              <div className='flex items-center gap-2 flex-wrap text-xs text-default-700'>
                {/* Timestamps stay LTR so 17/08/2026 never mirrors in Arabic. */}
                <span className='money' dir='ltr'>
                  {when(e.at)}
                </span>
                {e.user && (
                  <>
                    <span aria-hidden>·</span>
                    <span className='font-medium'>{e.user}</span>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
