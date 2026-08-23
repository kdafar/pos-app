import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Spinner } from '@heroui/react';
import { ChefHat, Clock3, RefreshCw, UtensilsCrossed } from 'lucide-react';
import { PageShell } from '../components/PageShell';
import { useI18n, useOrderTypeLabel, type StringKey } from '../i18n';

type Ticket = { order: any; lines: any[] };
const LANES = [
  { key: 'placed', title: 'kitchen.new' as StringKey, tone: 'primary' as const, header: 'bg-primary text-primary-foreground' },
  { key: 'prepared', title: 'kitchen.preparing' as StringKey, tone: 'warning' as const, header: 'bg-warning text-warning-foreground' },
  { key: 'ready', title: 'kitchen.ready' as StringKey, tone: 'success' as const, header: 'bg-success text-success-foreground' },
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

  return <PageShell title={t('kitchen.title')} subtitle={t('kitchen.subtitle')} primaryAction={<Button variant='flat' startContent={<RefreshCw size={16}/>} onPress={load}>{t('kitchen.refresh')}</Button>}>
    {loading ? <div className='flex justify-center py-24'><Spinner size='lg'/></div> : <div className='grid items-start gap-4 xl:grid-cols-3'>
      {LANES.map((lane) => <section key={lane.key} className='min-h-48 overflow-hidden rounded-xl border border-default-300 bg-content1 shadow-sm'>
        <header className={`flex items-center justify-between px-4 py-3 ${lane.header}`}><div className='flex items-center gap-2'><ChefHat size={20}/><h2 className='text-base font-black'>{t(lane.title)}</h2></div><span className='min-w-8 rounded-full bg-black/25 px-2 py-1 text-center text-sm font-black text-white'>{grouped[lane.key].length}</span></header>
        <div className='space-y-3 p-3'>{grouped[lane.key].map((ticket: Ticket) => {
          const order = ticket.order;
          const elapsed = Math.max(0, Math.floor((now - timeValue(order.opened_at || order.created_at)) / 60000));
          const border = elapsed >= 20 ? 'border-danger' : lane.key === 'placed' ? 'border-primary' : lane.key === 'prepared' ? 'border-warning' : 'border-success';
          const orderNumber = String(order.order_number || order.local_number || order.reference_no || '');
          const displayNumber = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(orderNumber) || !orderNumber ? t('kitchen.localOrder') : orderNumber;
          return <article key={order.id} className={`overflow-hidden rounded-xl border-2 bg-content1 shadow-sm ${border}`}>
            <div className='flex items-start justify-between gap-3 border-b border-default-300 px-4 py-3'><div className='min-w-0'><p className='truncate text-xl font-black'>#{displayNumber}</p><p className='text-sm font-semibold text-default-700'>{orderTypeLabel(order.order_type)}{order.table_name ? ` · ${order.table_name}` : ''}</p></div><Chip className='shrink-0 font-bold' size='sm' color={elapsed >= 20 ? 'danger' : elapsed >= 10 ? 'warning' : lane.tone} variant='solid' startContent={<Clock3 size={12}/>}>{t('kitchen.minutes', { n: elapsed })}</Chip></div>
            <div className='space-y-3 px-4 py-3'>{ticket.lines.length ? ticket.lines.map((line: any, index: number) => <div key={line.id || index} className='flex items-start gap-3'><b className='min-w-10 rounded-md bg-primary px-2 py-1 text-center text-sm font-black text-primary-foreground'>{Number(line.qty || line.quantity || 1)}×</b><div><p className='text-base font-bold text-foreground'>{name({ name: line.item_name || line.name || line.product_name, name_ar: line.name_ar || line.item_name_ar }) || t('kitchen.item')}</p>{(line.variation_name || line.notes) && <p className='text-sm font-medium text-default-700'>{line.variation_name || line.notes}</p>}</div></div>) : <p className='text-sm font-medium text-default-600'>{t('kitchen.itemsMissing')}</p>}</div>
            {order.order_notes && <div className='mx-4 mb-3 rounded-lg bg-warning p-2 text-xs font-bold text-warning-foreground'>{order.order_notes}</div>}
            <div className='border-t border-default-300 p-3'><Button fullWidth size='lg' className='font-bold' color={lane.key === 'placed' ? 'primary' : lane.key === 'prepared' ? 'warning' : 'success'} variant='solid' isLoading={busy === String(order.id)} startContent={busy === String(order.id) ? undefined : <UtensilsCrossed size={16}/>} onPress={() => advance(ticket)}>{t(lane.key === 'placed' ? 'kitchen.start' : lane.key === 'prepared' ? 'kitchen.markReady' : 'kitchen.complete')}</Button></div>
          </article>;
        })}{!grouped[lane.key].length && <div className='rounded-xl border border-dashed border-default-400 py-10 text-center text-sm font-semibold text-default-600'>{t('kitchen.empty')}</div>}</div>
      </section>)}
    </div>}
  </PageShell>;
}
