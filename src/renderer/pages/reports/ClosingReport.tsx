import React, { useEffect, useMemo, useState } from 'react';
import { useThemeTokens } from '../../hooks/useThemeTokens';
import { Printer, RefreshCcw, CalendarClock } from 'lucide-react';

type PaymentRow = { id: string; name: string; total: number };
type OrderTypeRow = { order_type: number; label: string; count: number; total: number };
type CategoryRow = { item: string; sold: number; total: number };
type Footer = {
  date: string;
  total_order: number;
  inside_hours_count: number;
  outside_hours_count: number;
  canceled_order_count: number;
  gross_sales_total: number;
  grand_total: number;
  discounts: number;
  delivery_fees: number;
  outside_hours_total: number;
  cancelled_total: number;
};
type SalesPreview = {
  fromMs: number; toMs: number;
  footer: Footer;
  payments: PaymentRow[];
  orderTypes: OrderTypeRow[];
  categories: CategoryRow[];
};

function fmt(n: number) { return (Number(n) || 0).toFixed(3); }
function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string) { return new Date(s).getTime(); }

export default function ClosingReport() {
  const { theme } = useThemeTokens();
  const [data, setData] = useState<SalesPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const muted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const panel = theme === 'dark' ? 'bg-slate-900/60 border-white/10' : 'bg-white border-gray-200';
  const chipBg = theme === 'dark' ? 'bg-white/10 text-white' : 'bg-gray-900 text-white';

  const load = async (opts?: {from?: number; to?: number}) => {
    setLoading(true);
    try {
      const resp = await window.api.invoke('report:sales:preview', opts);
      setData(resp);
      setFromStr(toLocalInput(resp.fromMs));
      setToStr(toLocalInput(resp.toMs));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const periodLabel = useMemo(() => data ? `${new Date(data.fromMs).toLocaleString()} → ${new Date(data.toMs).toLocaleString()}` : '', [data]);

  const refresh = async () => {
    await load({
      from: fromStr ? fromLocalInput(fromStr) : undefined,
      to:   toStr   ? fromLocalInput(toStr)   : undefined,
    });
  };

  const printNow = async () => {
    window.print?.();
  };

  const f = data?.footer;

  return (
    <div className="p-4 md:p-6 space-y-12">
      {/* PRINT CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
          h1,h2,h3 { margin: 6px 0; }
        }
        @media screen {
          .print-only { display: none; }
        }
      `}</style>

      {/* ===== Screen UI ===== */}
      <header className="no-print flex items-center justify-between gap-3">
        <div>
          <h1 className={`text-2xl font-semibold ${text}`}>Sales Report (Operational)</h1>
          <div className={`text-sm ${muted}`}>Matches PHP logic: operational window, inside/outside, payments, order types, categories</div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={loading}
            className={`px-3 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 ${chipBg}`} title="Refresh">
            <RefreshCcw size={16}/> Refresh
          </button>
          <button onClick={printNow}
            className={`px-3 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 ${chipBg}`} title="Print">
            <Printer size={16}/> Print
          </button>
        </div>
      </header>

      {/* Filters */}
      <section className={`no-print border ${panel} rounded-xl p-4`}>
        <div className={`flex items-center gap-3 ${muted} mb-3`}>
          <CalendarClock size={16}/> <span>Report period</span>
          {data && <span className="text-xs opacity-70">(default: operational window)</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={`block text-xs ${muted} mb-1`}>From</label>
            <input type="datetime-local"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5"
              value={fromStr} onChange={e => setFromStr(e.target.value)}
            />
          </div>
          <div>
            <label className={`block text-xs ${muted} mb-1`}>To</label>
            <input type="datetime-local"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5"
              value={toStr} onChange={e => setToStr(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button onClick={refresh} disabled={loading}
              className={`w-full px-3 py-2 rounded-lg ${chipBg}`}>Apply</button>
          </div>
        </div>
        {data && <div className={`text-xs mt-2 ${muted}`}>Previewing: {periodLabel}</div>}
      </section>

      {/* Footer cards */}
      <section className="no-print grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[
          ['Total Orders', f?.total_order ?? 0],
          ['Inside Hours', f?.inside_hours_count ?? 0],
          ['Outside Hours', f?.outside_hours_count ?? 0],
          ['Cancelled Count', f?.canceled_order_count ?? 0],
          ['Gross Sales', f ? fmt(f.gross_sales_total) : '0.000'],
          ['Discounts', f ? `-${fmt(f.discounts)}` : '0.000'],
          ['Delivery Fees', f ? fmt(f.delivery_fees) : '0.000'],
          ['Grand Total', f ? fmt(f.grand_total) : '0.000'],
        ].map(([label, val]) => (
          <div key={label as string} className={`border ${panel} rounded-xl p-3`}>
            <div className={`text-xs ${muted}`}>{label}</div>
            <div className={`text-lg font-semibold ${text}`}>{val as any}</div>
          </div>
        ))}
      </section>

      {/* Breakdowns */}
      <section className="no-print grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`border ${panel} rounded-xl p-4`}>
          <h3 className={`font-semibold ${text} mb-3`}>By Payment Method</h3>
          <table className="w-full text-sm">
            <tbody>
              {(data?.payments ?? []).map(p => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-white/5">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2 text-right font-medium">{fmt(p.total)}</td>
                </tr>
              ))}
              {(data?.payments?.length ?? 0) === 0 && (
                <tr><td className={`py-2 ${muted}`}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={`border ${panel} rounded-xl p-4`}>
          <h3 className={`font-semibold ${text} mb-3`}>By Order Type</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs">
                <th className="text-left py-1">Type</th>
                <th className="text-right py-1">Count</th>
                <th className="text-right py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {(data?.orderTypes ?? []).map(t => (
                <tr key={t.order_type} className="border-b border-gray-100 dark:border-white/5">
                  <td className="py-2">{t.label}</td>
                  <td className="py-2 text-right">{t.count}</td>
                  <td className="py-2 text-right font-medium">{fmt(t.total)}</td>
                </tr>
              ))}
              {(data?.orderTypes?.length ?? 0) === 0 && (
                <tr><td className={`py-2 ${muted}`} colSpan={3}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Categories */}
      <section className="no-print border rounded-xl p-4"
               style={{ borderColor: theme==='dark' ? 'rgba(255,255,255,0.1)' : '#e5e7eb' }}>
        <h3 className={`font-semibold ${text} mb-3`}>By Category</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs">
              <th className="text-left py-1">Category</th>
              <th className="text-right py-1">Sold</th>
              <th className="text-right py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {(data?.categories ?? []).map((c, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-white/5">
                <td className="py-2">{c.item}</td>
                <td className="py-2 text-right">{c.sold}</td>
                <td className="py-2 text-right font-medium">{fmt(c.total)}</td>
              </tr>
            ))}
            {(data?.categories?.length ?? 0) === 0 && (
              <tr><td className={`py-2 ${muted}`} colSpan={3}>No data</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ===== Print-only layout ===== */}
      {data && (
        <section className="print-only">
          <h1>Sales Report (Operational)</h1>
          <div><strong>Period:</strong> {new Date(data.fromMs).toLocaleString()} → {new Date(data.toMs).toLocaleString()}</div>

          <h3 style={{marginTop: '10px'}}>Summary</h3>
          <table>
            <tbody>
              <tr><td>Total Orders</td><td style={{textAlign:'right'}}>{f?.total_order ?? 0}</td></tr>
              <tr><td>Inside Hours</td><td style={{textAlign:'right'}}>{f?.inside_hours_count ?? 0}</td></tr>
              <tr><td>Outside Hours</td><td style={{textAlign:'right'}}>{f?.outside_hours_count ?? 0}</td></tr>
              <tr><td>Cancelled Count</td><td style={{textAlign:'right'}}>{f?.canceled_order_count ?? 0}</td></tr>
              <tr><td>Gross Sales</td><td style={{textAlign:'right'}}>{f ? fmt(f.gross_sales_total) : '0.000'}</td></tr>
              <tr><td>Discounts</td><td style={{textAlign:'right'}}>-{f ? fmt(f.discounts) : '0.000'}</td></tr>
              <tr><td>Delivery Fees</td><td style={{textAlign:'right'}}>{f ? fmt(f.delivery_fees) : '0.000'}</td></tr>
              <tr><td><strong>Grand Total</strong></td><td style={{textAlign:'right'}}><strong>{f ? fmt(f.grand_total) : '0.000'}</strong></td></tr>
            </tbody>
          </table>

          <h3 style={{marginTop: '12px'}}>By Payment Method</h3>
          <table>
            <thead><tr><th>Method</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
            <tbody>
              {data.payments.length ? data.payments.map(p => (
                <tr key={p.id}><td>{p.name}</td><td style={{textAlign:'right'}}>{fmt(p.total)}</td></tr>
              )) : <tr><td colSpan={2}>No data</td></tr>}
            </tbody>
          </table>

          <h3 style={{marginTop: '12px'}}>By Order Type</h3>
          <table>
            <thead><tr><th>Type</th><th style={{textAlign:'right'}}>Count</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
            <tbody>
              {data.orderTypes.length ? data.orderTypes.map(t => (
                <tr key={t.order_type}><td>{t.label}</td><td style={{textAlign:'right'}}>{t.count}</td><td style={{textAlign:'right'}}>{fmt(t.total)}</td></tr>
              )) : <tr><td colSpan={3}>No data</td></tr>}
            </tbody>
          </table>

          <h3 style={{marginTop: '12px'}}>By Category</h3>
          <table>
            <thead><tr><th>Category</th><th style={{textAlign:'right'}}>Sold</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
            <tbody>
              {data.categories.length ? data.categories.map((c,i)=>(
                <tr key={i}><td>{c.item}</td><td style={{textAlign:'right'}}>{c.sold}</td><td style={{textAlign:'right'}}>{fmt(c.total)}</td></tr>
              )) : <tr><td colSpan={3}>No data</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

declare global {
  interface Window { api: { invoke: (ch: string, ...args: any[]) => Promise<any> } }
}
