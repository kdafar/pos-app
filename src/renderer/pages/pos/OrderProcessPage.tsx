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

   const [defaultOrderType, setDefaultOrderType] = useState<OrderType>(() => {
    const s = Number(localStorage.getItem('pos.defaultOrderType') || 2);
    return (s === 1 || s === 2 || s === 3) ? (s as OrderType) : 2;
  });
  useEffect(() => {
    localStorage.setItem('pos.defaultOrderType', String(defaultOrderType));
  }, [defaultOrderType]);


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
    let cancelled = false;
    (async () => {
      try {
        await loadInitialData();
      } catch (e) {
        console.error('[OrderProcessPage] loadInitialData error', e);
      }
    })();
    return () => { cancelled = true; };
  // if you want it strictly once, use `[]`; if you want to reload per user, use auth?.current_user?.id
  }, [auth?.current_user?.id]);
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
       await Promise.all([loadItems(), loadActiveOrders(), loadTables()]);
    } catch (e) { console.error(e); }
  };


async function startOrder(type: OrderType = defaultOrderType): Promise<Order> {
  console.log(`[startOrder] called with type: ${type}`);
  
  // 1. ALWAYS create a default order first.
  const newOrderStub = await window.api.invoke('orders:start');
  if (!newOrderStub?.id) throw new Error('Failed to create new order.');

  console.log(`[startOrder] Created order ${newOrderStub.id}. Forcing type to ${type}`);
  
  // 2. ALWAYS explicitly set the type.
  try {
    await window.api.invoke('orders:setType', newOrderStub.id, type);
  } catch (err) {
    console.error(`[startOrder] Failed to set type ${type} for order ${newOrderStub.id}`, err);
    // Don't stop, try to fetch anyway
  }

  // 3. Fetch the final, updated order object.
  console.log(`[startOrder] Fetching final order details for ${newOrderStub.id}`);
  const { order: finalNewOrder, lines } = await window.api.invoke('orders:get', newOrderStub.id);
  
  if (!finalNewOrder) throw new Error('Failed to fetch newly created order.');

  // 4. Check if the type-set actually worked
  if (finalNewOrder.order_type !== type) {
    console.warn(`[startOrder] Type mismatch! Backend returned type ${finalNewOrder.order_type} after setting type ${type}.`);
    // We will proceed, but this is a sign of a backend issue.
  }

  // 5. Update state
  setCurrentOrder(finalNewOrder);
  setOrderLines(lines || []);
  await loadActiveOrders(); // Reload tabs
  if (finalNewOrder.order_type === 3) {
    await loadTables();
  }

  console.log(`[startOrder] complete. Returning final order #${finalNewOrder.number} with type ${finalNewOrder.order_type}`);
  return finalNewOrder;
}

  const loadItems = async () => {
    try {
      const filter = { q: searchQuery || null, categoryId: selectedCategoryId, subcategoryId: selectedSubcategoryId };
      setItems(await window.api.invoke('catalog:listItems', filter) || []);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { loadItems(); }, [searchQuery, selectedCategoryId, selectedSubcategoryId]);

const loadActiveOrders = async () => {
  try {
    const orders: Order[] = await window.api.invoke('orders:listActive');
    setActiveOrders(orders || []);

    // No active orders -> clear selection & cart
    if (!orders || orders.length === 0) {
      console.log('[loadActiveOrders] No active orders found. Clearing cart.');
      setCurrentOrder(null);
      setOrderLines([]);
      return;
    }

    // If current order is still in the active list, refresh it
    if (currentOrder && orders.some(o => o.id === currentOrder.id)) {
      console.log(`[loadActiveOrders] Current order ${currentOrder.id} still active. Refreshing it.`);
      const { order, lines } = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(order);
      setOrderLines(lines || []);
      return;
    }
    
    // If current order is NOT in the list (e.g. was completed), auto-select first one
    if (currentOrder && !orders.some(o => o.id === currentOrder.id)) {
      console.log(`[loadActiveOrders] Current order ${currentOrder.id} no longer active. Selecting first in list.`);
      await selectOrder(orders[0].id);
      return;
    }

    // If no order selected, select the first one
    if (!currentOrder) {
      console.log(`[loadActiveOrders] No order selected. Auto-selecting first active order: ${orders[0].id}`);
      await selectOrder(orders[0].id);
    }
  } catch (e) {
    console.error(e);
    // Clear state on catastrophic failure
    setActiveOrders([]);
    setCurrentOrder(null);
    setOrderLines([]);
  }
};

const selectOrder = async (orderId: string) => {
  if (!orderId) {
    console.warn('[selectOrder] called with null/undefined orderId.');
    setCurrentOrder(null);
    setOrderLines([]);
    return;
  }
  try {
    console.log(`[selectOrder] selecting order ${orderId}`);
    const { order, lines } = await window.api.invoke('orders:get', orderId);
    setCurrentOrder(order);
    setOrderLines(lines || []);
    if (order?.order_type === 3) await loadTables();
  } catch (e) { 
    console.error(`[selectOrder] Failed to get order ${orderId}`, e);
    // Order might not exist, reload active list to clean up UI
    await loadActiveOrders();
  }
};

const createNewOrder = async (orderType: OrderType = 2) => {
  try {
    const newOrder = await window.api.invoke('orders:start', { orderType }); // ← pass payload
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
    setDefaultOrderType(type); // remember choice for next auto-start
  } catch (e) { console.error(e); }
};


const addItemToOrder = async (item: Item, qty = 1) => {
  if (item.is_outofstock) return;
  try {
    let order = currentOrder;
    if (!order) {
      order = await startOrder(defaultOrderType); // ⬅️ auto-start
    }
    const { totals, lines } = await window.api.invoke('orders:addLine', order.id, item.id, qty);
    setOrderLines(lines);
    setCurrentOrder({ ...order, ...totals });
  } catch (e) {
    console.error(e);
  }
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

  const startDineInForTable = async (table: TableInfo) => {
    try {
      // ✅ use shared helper – it guarantees order_type is set to 3 (dine-in)
      const order = await startOrder(3);

      if (!order || !order.id) return;

      await window.api.invoke('orders:setTable', order.id, {
        table_id: table.id,
        covers: table.seats || 2,
      });

      await loadActiveOrders();
      await selectOrder(order.id);
      await loadTables();
    } catch (e) {
      console.error('startDineInForTable failed', e);
      alert('Could not start dine-in order for this table.');
    }
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
    <div className={`h-screen flex flex-col ${bg} text-[13px]`}>
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

       {tables.length > 0 && (
        <TableQuickBar
          theme={theme}
          tables={tables}
          currentOrderId={currentOrder?.id ?? null}
          onSelectOrder={selectOrder}
          onStartDineIn={startDineInForTable}
        />
      )}

      {/* Main */}
      <div className="grid grid-cols-[1fr_420px] flex-1 min-h-0 overflow-hidden">
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

function TableQuickBar({
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
  if (!tables.length) return null;

  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const bg = theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50';
  const label = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';

  const colorFor = (t: TableInfo, isActive: boolean) => {
    if (isActive) {
      return 'bg-blue-600 text-white border-blue-500';
    }
    if (t.status === 'available') {
      return theme === 'dark'
        ? 'bg-emerald-600/20 text-emerald-200 border-emerald-500/60'
        : 'bg-emerald-100 text-emerald-700 border-emerald-300';
    }
    if (t.status === 'reserved') {
      return theme === 'dark'
        ? 'bg-amber-600/20 text-amber-200 border-amber-500/60'
        : 'bg-amber-100 text-amber-700 border-amber-300';
    }
    // occupied
    return theme === 'dark'
      ? 'bg-rose-600/20 text-rose-200 border-rose-500/60'
      : 'bg-rose-100 text-rose-700 border-rose-300';
  };

  return (
    <div className={`px-4 py-2 border-b ${border} ${bg}`}>
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className={`text-xs uppercase tracking-wide ${label} whitespace-nowrap`}>
          Tables
        </span>
        {tables.map((t) => {
          const isActive = !!t.current_order_id && t.current_order_id === currentOrderId;
          const color = colorFor(t, isActive);
          const disabled = !t.current_order_id && t.status !== 'available';

          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (t.current_order_id) {
                  await onSelectOrder(t.current_order_id);
                } else if (t.status === 'available') {
                  await onStartDineIn(t);
                }
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition disabled:opacity-60 disabled:cursor-not-allowed ${color}`}
            >
              {t.name}
              {t.seats ? (
                <span className="ml-1 opacity-70 text-[10px]">({t.seats})</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
