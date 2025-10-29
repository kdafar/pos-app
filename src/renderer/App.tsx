import React, { useEffect, useMemo, useState } from 'react';

type Category = { id: string; name: string; name_ar?: string; position?: number; visible?: number };
type Subcategory = { id: string; category_id: string; name: string; name_ar?: string; position?: number; visible?: number };
type Item = { id: string; name: string; name_ar?: string; barcode?: string; price: number; is_outofstock?: number; category_id?: string|null; subcategory_id?: string|null };
type ActiveTab = { id: string; tab_position: number; number: string; order_type: number; updated_at: number };
type OrderLine = { id: string; item_id: string; name: string; name_ar?: string; qty: number; unit_price: number; line_total: number };
type Order = {
  id: string; number: string; order_type: 1|2|3; status: string;
  subtotal: number; tax_total: number; discount_total: number; delivery_fee: number; grand_total: number;
};

const api = (channel: string, ...args: any[]) => window.api!.invoke(channel, ...args);

export default function App() {
  // UI state
  const [collapsed, setCollapsed] = useState(false);
  const [brand, setBrand] = useState('POS');

  // Catalog
  const [cats, setCats] = useState<Category[]>([]);
  const [subs, setSubs] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState('');
  const [catId, setCatId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);

  // Orders
  const [tabs, setTabs] = useState<ActiveTab[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);

  // Prepared
  const [prepared, setPrepared] = useState<any[]>([]);

  // Theme toggle
  const toggleTheme = async () => {
    const isDark = document.documentElement.classList.toggle('dark');
    await api('store:set', 'ui.theme', isDark ? 'dark' : 'light');
  };

  // Load branding
  useEffect(() => {
    (async () => {
      const name = (await api('store:get', 'branch.name')) as string | null;
      const id = (await api('store:get', 'branch_id')) as string | null;
      setBrand(name && name.trim() ? name : (id ? `Branch #${id}` : 'POS'));
    })();
  }, []);

  // Initial data
  useEffect(() => {
    (async () => {
      const [c1, s1] = await Promise.all([
        api('catalog:listCategories'),
        api('catalog:listSubcategories', null),
      ]);
      setCats(c1);
      setSubs(s1);
      await refreshItems();
      await refreshTabs();
      await refreshPrepared();
    })();
  }, []);

  // Filtered subcategories by category
  const subOptions = useMemo(
    () => subs.filter(s => !catId || s.category_id === catId),
    [subs, catId]
  );

  async function refreshItems() {
    const list = await api('catalog:listItems', { q, categoryId: catId, subcategoryId: subId });
    setItems(list);
  }

  async function refreshTabs() {
    const t = await api('orders:listActive');
    setTabs(t);
    if (!currentId && t.length) {
      setCurrentId(t[0].id);
      const got = await api('orders:get', t[0].id);
      setOrder(got.order); setLines(got.lines);
    }
  }

  async function refreshCurrent() {
    if (!currentId) return;
    const got = await api('orders:get', currentId);
    setOrder(got.order); setLines(got.lines);
  }

  async function refreshPrepared() {
    const p = await api('orders:listPrepared', 20);
    setPrepared(p);
  }

  async function newOrder(type: 1|2|3 = 2) {
    const o = await api('orders:start', { orderType: type });
    setCurrentId(o.id);
    await refreshTabs();
    await refreshCurrent();
  }

  async function addItem(it: Item, qty = 1) {
    if (!currentId) {
      const o = await api('orders:start', { orderType: 2 });
      setCurrentId(o.id);
    }
    await api('orders:addLine', currentId || (await api('orders:listActive'))[0]?.id, it.id, qty);
    await refreshCurrent();
    await refreshTabs();
  }

  async function setOrderType(type: 1|2|3) {
    if (!currentId) return;
    await api('orders:setType', currentId, type);
    await refreshCurrent();
    await refreshTabs();
  }

  // Simple decrease using negative qty (supported by our addLine logic)
  async function decreaseLine(line: OrderLine) {
    if (!currentId) return;
    await api('orders:addLine', currentId, line.item_id, -1);
    await refreshCurrent();
  }

  // Layout
  return (
    <div className="h-screen w-screen overflow-hidden grid" style={{ gridTemplateColumns: collapsed ? '76px 1fr 340px' : '260px 1fr 340px' }}>
      {/* Sidebar */}
      <aside className="h-full card p-3 flex flex-col">
        <div className="flex items-center justify-between gap-2 px-2">
          <div className="font-bold tracking-wide text-sm">{collapsed ? '🍣' : `🍣 ${brand}`}</div>
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost" title="Toggle theme" onClick={toggleTheme}>🌓</button>
            <button className="btn btn-ghost" title="Collapse" onClick={() => setCollapsed(s => !s)}>{collapsed ? '➡️' : '⬅️'}</button>
          </div>
        </div>

        <nav className="mt-2 space-y-1">
          <SectionLabel hidden={collapsed}>Orders</SectionLabel>
          <NavLink active text="Order Process" icon="🧾" collapsed={collapsed} />
          <NavLink text="Recent Orders" icon="📜" collapsed={collapsed} />

          <SectionLabel hidden={collapsed}>Catalog</SectionLabel>
          <NavLink text="Categories" icon="🗂️" collapsed={collapsed} />
          <NavLink text="Items" icon="🍱" collapsed={collapsed} />
          <NavLink text="Addons" icon="➕" collapsed={collapsed} />
          <NavLink text="Promos" icon="🔥" collapsed={collapsed} />

          <SectionLabel hidden={collapsed}>Dine-in</SectionLabel>
          <NavLink text="Tables" icon="🪑" collapsed={collapsed} />

          <SectionLabel hidden={collapsed}>System</SectionLabel>
          <NavLink text="Settings" icon="⚙️" collapsed={collapsed} />
          <NavLink text="Payment Methods" icon="💳" collapsed={collapsed} />
          <NavLink text="Locations" icon="📍" collapsed={collapsed} />
        </nav>

        <div className="mt-auto">
          <button className="btn w-full btn-ghost">🚪 {collapsed ? '' : 'Logout'}</button>
        </div>
      </aside>

      {/* Main center */}
      <section className="h-full overflow-hidden p-4">
        {/* Top: tabs + order type */}
        <div className="flex items-center justify-between gap-3">
          <Tabs
            tabs={tabs}
            currentId={currentId}
            onSelect={async (id) => { setCurrentId(id); await refreshCurrent(); }}
            onNew={() => newOrder(2)}
          />
          <OrderTypePicker
            value={order?.order_type || 2}
            onChange={(t) => setOrderType(t)}
          />
        </div>

        {/* Filters */}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="muted text-xs">Categories:</span>
            <button
              className={`chip ${!catId ? 'bg-slate-800/60' : ''}`}
              onClick={() => { setCatId(null); setSubId(null); refreshItems(); }}
            >All</button>
            {cats.map(c => (
              <button
                key={c.id}
                className={`chip ${catId === c.id ? 'bg-slate-800/60' : ''}`}
                onClick={() => { setCatId(c.id); setSubId(null); refreshItems(); }}
              >{c.name}</button>
            ))}
          </div>

          <div className="flex gap-2 items-center">
            <input
              className="px-3 py-2 rounded-xl bg-slate-900/40 border border-slate-700/60 outline-none w-64"
              placeholder="Search name / Arabic / barcode"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={(e) => (e.key === 'Enter') && refreshItems()}
            />
            <button className="btn" onClick={refreshItems}>Search</button>
          </div>
        </div>

        {/* Subcategories */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="muted text-xs">Subcategories:</span>
          <button
            className={`chip ${!subId ? 'bg-slate-800/60' : ''}`}
            onClick={() => { setSubId(null); refreshItems(); }}
          >All</button>
          {subOptions.map(s => (
            <button
              key={s.id}
              className={`chip ${subId === s.id ? 'bg-slate-800/60' : ''}`}
              onClick={() => { setSubId(s.id); refreshItems(); }}
            >{s.name}</button>
          ))}
        </div>

        {/* Items grid */}
        <div className="mt-4 grid gap-3"
             style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', height: 'calc(100% - 168px)', overflow: 'auto' }}>
          {items.map(it => (
            <div key={it.id} className="card p-3 flex flex-col gap-2">
              <div className="font-semibold">{it.name}</div>
              <div className="text-xs muted">{it.name_ar}</div>
              <div className="flex items-center justify-between text-sm">
                <span className="chip">{it.barcode || '—'}</span>
                <strong className="tracking-wide">{it.price.toFixed(3)}</strong>
              </div>
              <button
                className="btn btn-primary mt-1"
                disabled={!!it.is_outofstock}
                onClick={() => addItem(it, 1)}
              >
                {it.is_outofstock ? 'Out of stock' : 'Add to Cart'}
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <div className="muted p-4">No items match your filters.</div>
          )}
        </div>
      </section>

      {/* Right: Cart & Prepared */}
      <aside className="h-full card p-4 flex flex-col overflow-hidden">
        {/* Current Order Summary */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm muted">Current Order</div>
            <div className="font-semibold">{order?.number || '—'}</div>
          </div>
          <span className="chip">{labelForType(order?.order_type || 2)}</span>
        </div>

        {/* Cart lines */}
        <div className="mt-3 border-t border-slate-700/60 pt-2 overflow-auto" style={{ maxHeight: '40%' }}>
          {lines.map(l => (
            <div key={l.id} className="py-2 border-b border-slate-800/60">
              <div className="flex items-center justify-between">
                <div className="text-sm">{l.name}</div>
                <div className="text-sm font-semibold">{l.line_total.toFixed(3)}</div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button className="btn btn-ghost px-2" onClick={() => decreaseLine(l)}>−</button>
                <span className="text-xs muted">x{l.qty}</span>
                <button className="btn btn-ghost px-2" onClick={() => addItem({ id: l.item_id, name: l.name, price: l.unit_price } as Item, 1)}>＋</button>
              </div>
            </div>
          ))}
          {(!lines || lines.length === 0) && (
            <div className="muted text-sm">Cart is empty. Add items from the middle panel.</div>
          )}
        </div>

        {/* Totals */}
        <div className="mt-3 border-t border-slate-700/60 pt-3 space-y-1 text-sm">
          <Row label="Subtotal" value={order?.subtotal} />
          <Row label="Tax" value={order?.tax_total} />
          <Row label="Discount" value={order?.discount_total} />
          <Row label="Delivery Fee" value={order?.delivery_fee} />
          <Row label="Total" value={order?.grand_total} bold />
          <div className="flex gap-2 mt-2">
            <button className="btn w-full">Hold</button>
            <button className="btn btn-primary w-full">Checkout</button>
          </div>
        </div>

        {/* Prepared Orders */}
        <div className="mt-4 border-t border-slate-700/60 pt-3 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">Prepared Orders</div>
            <button className="btn btn-ghost text-xs" onClick={refreshPrepared}>Refresh</button>
          </div>
          <div className="space-y-2">
            {prepared.map((p: any) => (
              <div key={p.id} className="card p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">#{p.number}</div>
                  <div className="chip text-xs">{p.status}</div>
                </div>
                <div className="mt-1 text-sm font-semibold">{Number(p.grand_total ?? 0).toFixed(3)}</div>
              </div>
            ))}
            {prepared.length === 0 && <div className="muted text-sm">No prepared orders yet.</div>}
          </div>
        </div>
      </aside>
    </div>
  );
}

/* --- Small UI helpers --- */

function Tabs(props: { tabs: ActiveTab[]; currentId: string|null; onSelect: (id: string)=>void; onNew: ()=>void }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {props.tabs.map(t => (
        <button
          key={t.id}
          className={`btn ${props.currentId === t.id ? 'bg-slate-800/70' : 'btn-ghost'}`}
          onClick={() => props.onSelect(t.id)}
          title={`Updated ${timeAgo(t.updated_at)}`}
        >
          <span className="mr-2 chip">{labelForType(t.order_type as any)}</span>
          <span>#{t.number}</span>
        </button>
      ))}
      <button className="btn btn-primary" onClick={props.onNew}>New Order</button>
    </div>
  );
}

function OrderTypePicker({ value, onChange }: { value: 1|2|3; onChange: (t:1|2|3)=>void }) {
  const opts: { k:1|2|3; label:string }[] = [
    { k:1, label:'Delivery' },
    { k:2, label:'Pickup' },
    { k:3, label:'Dine-in' },
  ];
  return (
    <div className="inline-flex rounded-2xl border border-slate-700/60 overflow-hidden">
      {opts.map(o => (
        <button
          key={o.k}
          className={`px-4 py-2 text-sm ${o.k===value ? 'bg-slate-800/70 font-semibold' : 'hover:bg-slate-800/40'}`}
          onClick={() => onChange(o.k)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value?: number|null; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="muted">{label}</div>
      <div className={bold ? 'font-semibold' : ''}>{Number(value ?? 0).toFixed(3)}</div>
    </div>
  );
}

function NavLink({ text, icon, collapsed, active = false, href = '#' }: { text: string; icon?: string; collapsed?: boolean; active?: boolean; href?: string; }) {
  return (
    <a className={`flex items-center gap-2 px-3 py-2 rounded-xl ${active ? 'bg-slate-800/70' : 'hover:bg-slate-800/50'}`} href={href}>
      <span>{icon || '•'}</span>
      {!collapsed && <span className="text-sm muted">{text}</span>}
    </a>
  );
}

function SectionLabel({ children, hidden }: any) {
  if (hidden) return <div className="mt-2" />;
  return <div className="mt-2 mb-1 uppercase tracking-wide text-xs muted px-2">{children}</div>;
}

function labelForType(t: 1|2|3) {
  switch (t) { case 1: return 'Delivery'; case 2: return 'Pickup'; case 3: return 'Dine-in'; default: return 'Order'; }
}

function timeAgo(ts?: number) {
  if (!ts) return '—';
  const d = Date.now() - Number(ts);
  if (d < 60_000) return 'just now';
  const m = Math.floor(d/60_000); if (m < 60) return `${m}m`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h`;
  const days = Math.floor(h/24); return `${days}d`;
}
60_000) return 'just now';
  const m = Math.floor(d/60_000); if (m < 60) return `${m}m`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h`;
  const days = Math.floor(h/24); return `${days}d`;
}
