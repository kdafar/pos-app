import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import CatalogPanel from '../../pages/pos/CatalogPanel';
import OrderSide from '../../pages/pos/OrderSide';

type OrderType = 1 | 2 | 3;

interface Item { id: string; name: string; name_ar: string; barcode: string; price: number; is_outofstock: number; category_id: string; subcategory_id: string; image?: string | null; image_local?: string | null; }
interface Category { id: string; name: string; name_ar: string; category_id?: string; }
interface OrderLine { id: string; order_id: string; item_id: string; name: string; qty: number; unit_price: number; line_total: number; }
interface Order {
  id: string; number: string; order_type: OrderType; status: string;
  subtotal: number; discount_total: number; delivery_fee: number; grand_total: number; opened_at: number;
  table_id?: string | null; table_name?: string | null; covers?: number | null; promocode?: string;
}
type TableStatus = 'available' | 'occupied' | 'reserved';
interface TableInfo { id: string; name: string; seats: number; status: TableStatus; current_order_id?: string | null; }
interface State { id: string; name: string; name_ar: string; }
interface City { id: string; state_id: string; name: string; name_ar: string; delivery_fee: number; min_order: number; }
interface Block { id: string; city_id: string; name: string; name_ar: string; }
interface Promo { id: string; code: string; type: string; value: number; min_total: number; max_discount?: number; active?: number | boolean; }

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
    pos?: { auth?: { status: () => Promise<any> } };
  }
}

type AuthStatus = {
  current_user?: { id: number | string; name: string; role?: string };
  branch_name?: string;
};
function useRootTheme(): 'light' | 'dark' {
  const [t, setT] = useState<'light' | 'dark'>(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  useEffect(() => {
    const mo = new MutationObserver(() => setT(document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return t;
}

export default function OrderProcessPage() {
  const theme = useRootTheme();

  const [auth, setAuth] = useState<AuthStatus | null>(null);
  // Data
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Category[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);

  // Catalog UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);

  // Boot
   useEffect(() => {
    (async () => {
      try {
        // preferred: from preload `window.pos.auth.status()`
        const s = await window.pos?.auth?.status?.();
        if (s) return setAuth(s);
      } catch {}
      try {
        // fallback: IPC channel if you wired one
        const s = await window.api.invoke('auth:status');
        setAuth(s || null);
      } catch (e) {
        console.warn('Auth status unavailable', e);
        setAuth(null);
      }
    })();
  }, []);
  const loadInitialData = async () => {
    try {
      const [cats, subs, sts, prms] = await Promise.all([
        window.api.invoke('catalog:listCategories'),
        window.api.invoke('catalog:listSubcategories'),
        window.api.invoke('geo:listStates'),
        window.api.invoke('catalog:listPromos')
      ]);
      setCategories(cats || []);
      setSubcategories(subs || []);
      setStates(sts || []);
      setPromos(prms || []);
      await Promise.all([loadItems(), loadActiveOrders()]);
    } catch (e) { console.error(e); }
  };

  const loadItems = async () => {
    try {
      const filter = { q: searchQuery || null, categoryId: selectedCategoryId, subcategoryId: selectedSubcategoryId };
      setItems(await window.api.invoke('catalog:listItems', filter) || []);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { loadItems(); }, [searchQuery, selectedCategoryId, selectedSubcategoryId]);

  const loadActiveOrders = async () => {
    try {
      const orders = await window.api.invoke('orders:listActive');
      setActiveOrders(orders || []);
      if (orders?.length && !currentOrder) await selectOrder(orders[0].id);
    } catch (e) { console.error(e); }
  };

  const selectOrder = async (orderId: string) => {
    try {
      const { order, lines } = await window.api.invoke('orders:get', orderId);
      setCurrentOrder(order);
      setOrderLines(lines || []);
      if (order?.order_type === 3) await loadTables();
    } catch (e) { console.error(e); }
  };

  const createNewOrder = async (orderType: OrderType = 2) => {
    try {
      const newOrder = await window.api.invoke('orders:start');
      await window.api.invoke('orders:setType', newOrder.id, orderType);
      await loadActiveOrders();
      await selectOrder(newOrder.id);
    } catch (e) { console.error(e); }
  };

  const changeOrderType = async (type: OrderType) => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:setType', currentOrder.id, type);
      const updated = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(updated.order);
      setOrderLines(updated.lines || []);
      if (type === 3) await loadTables();
    } catch (e) { console.error(e); }
  };

  const addItemToOrder = async (item: Item, qty = 1) => {
    if (!currentOrder || item.is_outofstock) return;
    try {
      const { totals, lines } = await window.api.invoke('orders:addLine', currentOrder.id, item.id, qty);
      setOrderLines(lines);
      setCurrentOrder({ ...currentOrder, ...totals });
    } catch (e) { console.error(e); }
  };

  const applyPromoCode = async (code: string) => {
    if (!currentOrder) return;
    try {
      const { totals } = await window.api.invoke('orders:applyPromo', currentOrder.id, code);
      setCurrentOrder({ ...currentOrder, ...totals, promocode: code });
    } catch (e) {
      alert('Invalid or expired promo code'); console.error(e);
    }
  };

  const removePromoCode = async () => {
    if (!currentOrder) return;
    try {
      const { totals } = await window.api.invoke('orders:removePromo', currentOrder.id);
      setCurrentOrder({ ...currentOrder, ...totals, promocode: undefined });
    } catch (e) { console.error(e); }
  };

  // Tables
  const loadTables = async () => {
    try { setTables(await window.api.invoke('tables:list') || []); }
    catch (e) { console.error(e); }
  };

  // Geo loaders (CheckoutModal needs these)
  const onLoadCities = async (stateId: string) => {
    const c = await window.api.invoke('geo:listCities', stateId);
    setCities(c || []);
  };
  const onLoadBlocks = async (cityId: string) => {
    const b = await window.api.invoke('geo:listBlocks', cityId);
    setBlocks(b || []);
  };

  // Visual theme helpers
  const bg = theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50';
  const headerBg = theme === 'dark' ? 'bg-slate-900/70' : 'bg-white/70';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';

  return (
    <div className={`min-h-screen ${bg} text-[13px]`}>
      {/* Header */}
      <header className={`border-b ${border} ${headerBg} backdrop-blur h-14`}>
        <div className="px-4 h-full">
          <div className="flex h-full items-center justify-between gap-2">
            <div className="flex items-center gap-3 overflow-hidden">
              <h1 className={`text-lg font-semibold ${text}`}>
                {auth?.current_user?.name ?? 'POS System'}
                {auth?.branch_name ? <span className="ml-2 opacity-70"></span> : null}
                </h1>

              {/* Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-[50vw] pr-2">
                {activeOrders.map(order => (
                  <button
                    key={order.id}
                    onClick={() => selectOrder(order.id)}
                    className={`px-3 py-1.5 rounded-lg border transition text-xs ${
                      currentOrder?.id === order.id
                        ? (theme === 'dark' ? 'bg-white/10 text-white border-white/20' : 'bg-gray-100 text-gray-800 border-gray-300')
                        : (theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-300')
                    }`}
                  >
                    <span className="opacity-70">{labelForType(order.order_type)}</span>
                    <span className="ml-1 font-medium">#{order.number}</span>
                  </button>
                ))}
                <button
                  onClick={() => createNewOrder(2)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-900 hover:bg-black text-white'
                  }`}
                >
                  <Plus size={14} /> New
                </button>
              </div>
            </div>

            {currentOrder && (
              <OrderTypePicker
                value={currentOrder.order_type}
                onChange={changeOrderType}
                theme={theme}
              />
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="grid grid-cols-[1fr_420px] h-[calc(100dvh-56px)] overflow-hidden">
        <CatalogPanel
          theme={theme}
          items={items}
          categories={categories}
          subcategories={subcategories}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategoryId={selectedCategoryId}
          setSelectedCategoryId={(id) => { setSelectedCategoryId(id); setSelectedSubcategoryId(null); }}
          selectedSubcategoryId={selectedSubcategoryId}
          setSelectedSubcategoryId={setSelectedSubcategoryId}
          onAddItem={addItemToOrder}
        />

        <OrderSide
          theme={theme}
          currentOrder={currentOrder}
          orderLines={orderLines}
          promos={promos}
          states={states}
          cities={cities}
          blocks={blocks}
          tables={tables}
          onRefreshTables={loadTables}
          onSelectOrder={selectOrder}
          onCreateOrder={() => createNewOrder(2)}
          onReloadActiveOrders={loadActiveOrders}
          onApplyPromo={applyPromoCode}
          onRemovePromo={removePromoCode}
          onLoadCities={onLoadCities}
          onLoadBlocks={onLoadBlocks}
        />
      </div>
    </div>
  );
}

function labelForType(type: OrderType): string {
  switch (type) {
    case 1: return 'Delivery';
    case 2: return 'Pickup';
    case 3: return 'Dine-in';
    default: return 'Order';
  }
}

function OrderTypePicker({ value, onChange, theme }: { value: OrderType; onChange: (t: OrderType) => void; theme: 'light'|'dark' }) {
  const types = [
    { k: 1 as const, label: 'Delivery', icon: '🚗' },
    { k: 2 as const, label: 'Pickup',   icon: '🛍️' },
    { k: 3 as const, label: 'Dine-in',  icon: '🍽️' },
  ];
  const bg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-300';
  const activeBtn = theme === 'dark' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow'
                                     : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow';
  const inactiveBtn = theme === 'dark' ? 'text-slate-300 hover:text-white' : 'text-gray-700 hover:text-gray-900';
  return (
    <div className={`inline-flex rounded-lg border p-1 ${bg}`}>
      {types.map(t => (
        <button key={t.k} type="button" onClick={() => onChange(t.k)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${t.k === value ? activeBtn : inactiveBtn}`} title={t.label}>
          <span className="mr-1">{t.icon}</span>{t.label}
        </button>
      ))}
    </div>
  );
}
