import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spinner } from '@heroui/react';
import { Clock3, RefreshCw, UtensilsCrossed } from 'lucide-react';
import { PageShell } from '../components/PageShell';
import { useI18n, useOrderTypeLabel, type StringKey } from '../i18n';
import { OrderCard } from '../components/OrderCard';
import { shortOrderLabel } from '../utils/orderLabel';

type Ticket = { order: any; lines: any[] };
const LANES = [
  { key: 'placed', title: 'kitchen.new' as StringKey },
  { key: 'prepared', title: 'kitchen.preparing' as StringKey },
  { key: 'ready', title: 'kitchen.ready' as StringKey },
];

const timeValue = (value: unknown) => {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

export default function KitchenDisplayPage() {
  const { t, name } = useI18n();
  const orderTypeLabel = useOrderTypeLabel();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    try { setTickets(await window.api.invoke('orders:kitchenBoard')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);
  const grouped = useMemo(() => Object.fromEntries(LANES.map((lane) => [lane.key, tickets.filter((ticket) => String(ticket.order.status).toLowerCase() === lane.key)])), [tickets]);
  const advance = async (ticket: Ticket) => {
    const id = String(ticket.order.id);
    const next = ticket.order.status === 'placed' ? 'prepared' : ticket.order.status === 'prepared' ? 'ready' : 'closed';
    setBusy(id);
    try { await window.api.invoke('orders:setStatus', id, next); await load(); }
    finally { setBusy(null); }
  };

  return <PageShell title={t('kitchen.title')} subtitle={t('kitchen.subtitle')} primaryAction={<Button variant='bordered' size='lg' className='border border-[var(--line-strong)] bg-[var(--surface)] font-semibold' startContent={<RefreshCw size={16} strokeWidth={1.8}/>} onPress={load}>{t('kitchen.refresh')}</Button>}>
    {loading ? <div className='flex justify-center py-24'><Spinner size='lg'/></div> : <div className='grid grid-cols-1 items-start gap-4 lg:grid-cols-3'>
      {LANES.map((lane) => <section key={lane.key} className='min-w-0'>
        <header className='mb-3 flex items-center gap-2'><h2 className='text-xs font-semibold uppercase tracking-wide ink-2'>{t(lane.title)}</h2><span className='ui-count'>{grouped[lane.key].length}</span></header>
        <div className='space-y-3'>{grouped[lane.key].map((ticket: Ticket) => {
          const order = ticket.order;
          const elapsed = Math.max(0, Math.floor((now - timeValue(order.opened_at || order.created_at)) / 60000));
          const timeChip = elapsed >= 20 ? 'ui-chip-red' : elapsed >= 10 ? 'ui-chip-amber' : 'ui-chip-outline';
          // The same label the order panel and the receipt show (#0008 once the
          // server has numbered it, the short till number before). This read
          // order_number / local_number, which no order row has, so every till
          // order showed "#Local order" and could not be matched to its receipt.
          const displayNumber = shortOrderLabel(order);
          // The checkout "Order Notes" are stored as `note`; `order_notes` is
          // only the alias the receipt query gives it.
          const orderNote = String(order.note ?? order.order_notes ?? '').trim();
          return <OrderCard
            key={order.id}
            fresh={lane.key === 'placed'}
            header={displayNumber}
            type={<span className='ui-chip ui-chip-outline'>{orderTypeLabel(order.order_type)}{order.table_name ? ` · ${order.table_name}` : ''}</span>}
            time={<span className={`ui-chip ${timeChip}`}><Clock3 size={12} strokeWidth={1.8}/>{t('kitchen.minutes', { n: elapsed })}</span>}
            footer={<Button fullWidth size='lg' className='min-h-11 font-semibold' color='primary' variant='solid' isLoading={busy === String(order.id)} startContent={busy === String(order.id) ? undefined : <UtensilsCrossed size={16} strokeWidth={1.8}/>} onPress={() => advance(ticket)}>{t(lane.key === 'placed' ? 'kitchen.start' : lane.key === 'prepared' ? 'kitchen.markReady' : 'kitchen.complete')}</Button>}
          >
            <div className='space-y-3'>
              <div className='space-y-2'>{ticket.lines.length ? ticket.lines.map((line: any, index: number) => <div key={line.id || index} className='flex items-start gap-3'><b className='money min-w-10 shrink-0 rounded-[11px] border border-line-strong bg-surface-2 px-2 py-1 text-center text-sm font-bold'>{Number(line.qty || line.quantity || 1)}×</b><div className='min-w-0'><p className='break-words text-base font-semibold ink'>{name({ name: line.item_name || line.name || line.product_name, name_ar: line.name_ar || line.item_name_ar }) || t('kitchen.item')}</p>{(line.variation_name || line.notes) && <p className='break-words text-sm ink-2'>{line.variation_name || line.notes}</p>}</div></div>) : <p className='text-sm ink-2'>{t('kitchen.itemsMissing')}</p>}</div>
              {orderNote && <div className='ui-notice'><span className='ui-chip ui-chip-amber shrink-0'>{t('cart.note')}</span><span className='min-w-0 break-words text-sm font-medium'>{orderNote}</span></div>}
            </div>
          </OrderCard>;
        })}{!grouped[lane.key].length && <div className='rounded-[20px] border border-dashed border-line-strong py-10 text-center text-sm ink-2'>{t('kitchen.empty')}</div>}</div>
      </section>)}
    </div>}
  </PageShell>;
}
