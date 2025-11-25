// src/renderer/pages/pos/OrderProcessPage.tsx
import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import CatalogPanel from './CatalogPanel';
import OrderSide from './OrderSide';
import { useRootTheme } from './useRootTheme';

import {
  OrderType,
  Order,
  OrderLine,
  Item,
  Category,
  TableInfo,
  State,
  City,
  Block,
  Promo,
} from './types';

import { OrderTypePicker } from './components/OrderTypePicker';
import { TableQuickBar } from './components/TableQuickBar';

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
  }, [auth?.current_user?.id]);

  const loadInitialData = async () => {
    try {
      const [cats, subs, sts, prms] = await Promise.all([
        window.api.invoke('catalog:listCategories'),
        window.api.invoke('catalog:listSubcategories'),
        window.api.invoke('geo:listStates'),
        window.api.invoke('catalog:listPromos'),
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

    const newOrderStub = await window.api.invoke('orders:start');
    if (!newOrderStub?.id) throw new Error('Failed to create new order.');

    console.log(`[startOrder] Created order ${newOrderStub.id}. Forcing type to ${type}`);

    try {
      await window.api.invoke('orders:setType', newOrderStub.id, type);
    } catch (err) {
      console.error(`[startOrder] Failed to set type ${type} for order ${newOrderStub.id}`, err);
    }

    console.log(`[startOrder] Fetching final order details for ${newOrderStub.id}`);
    const { order: finalNewOrder, lines } = await window.api.invoke('orders:get', newOrderStub.id);

    if (!finalNewOrder) throw new Error('Failed to fetch newly created order.');

    if (finalNewOrder.order_type !== type) {
      console.warn(`[startOrder] Type mismatch! Backend returned type ${finalNewOrder.order_type} after setting type ${type}.`);
    }

    setCurrentOrder(finalNewOrder);
    setOrderLines(lines || []);
    await loadActiveOrders();
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

      if (!orders || orders.length === 0) {
        console.log('[loadActiveOrders] No active orders found. Clearing cart.');
        setCurrentOrder(null);
        setOrderLines([]);
        return;
      }

      if (currentOrder && orders.some(o => o.id === currentOrder.id)) {
        console.log(`[loadActiveOrders] Current order ${currentOrder.id} still active. Refreshing it.`);
        const { order, lines } = await window.api.invoke('orders:get', currentOrder.id);
        setCurrentOrder(order);
        setOrderLines(lines || []);
        return;
      }

      if (currentOrder && !orders.some(o => o.id === currentOrder.id)) {
        console.log(`[loadActiveOrders] Current order ${currentOrder.id} no longer active. Selecting first in list.`);
        await selectOrder(orders[0].id);
        return;
      }

      if (!currentOrder) {
        console.log(`[loadActiveOrders] No order selected. Auto-selecting first active order: ${orders[0].id}`);
        await selectOrder(orders[0].id);
      }
    } catch (e) {
      console.error(e);
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
      await loadActiveOrders();
    }
  };

  const createNewOrder = async (orderType: OrderType = 2) => {
    try {
      const order = await startOrder(orderType);
      await selectOrder(order.id);   // explicitly select, even though startOrder already sets state
    } catch (e) {
      console.error(e);
    }
  };

  const changeOrderType = async (type: OrderType) => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:setType', currentOrder.id, type);
      const updated = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(updated.order);
      setOrderLines(updated.lines || []);
      if (type === 3) await loadTables();
      setDefaultOrderType(type);
    } catch (e) { console.error(e); }
  };

  const addItemToOrder = async (item: Item, qty = 1) => {
    if (item.is_outofstock) return;
    try {
      let order = currentOrder;
      if (!order) {
        order = await startOrder(defaultOrderType);
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
      alert('Invalid or expired promo code');
      console.error(e);
    }
  };

  const removePromoCode = async () => {
    if (!currentOrder) return;
    try {
      const { totals } = await window.api.invoke('orders:removePromo', currentOrder.id);
      setCurrentOrder({ ...currentOrder, ...totals, promocode: undefined });
    } catch (e) { console.error(e); }
  };

  const loadTables = async () => {
    try { setTables(await window.api.invoke('tables:list') || []); }
    catch (e) { console.error(e); }
  };

  const startDineInForTable = async (table: TableInfo) => {
    try {
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

  const onLoadCities = async (stateId: string) => {
    const c = await window.api.invoke('geo:listCities', stateId);
    setCities(c || []);
  };
  const onLoadBlocks = async (cityId: string) => {
    const b = await window.api.invoke('geo:listBlocks', cityId);
    setBlocks(b || []);
  };

  const bg = theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50';
  const headerBg = theme === 'dark' ? 'bg-slate-900/70' : 'bg-white/70';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';

  const labelForType = (type: OrderType): string => {
    switch (type) {
      case 1: return 'Delivery';
      case 2: return 'Pickup';
      case 3: return 'Dine-in';
      default: return 'Order';
    }
  };

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
                        ? (theme === 'dark' ? 'bg-white/10 text-white border-white/20'
                                            : 'bg-gray-100 text-gray-800 border-gray-300')
                        : (theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border-white/10'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-300')
                    }`}
                  >
                    <span className="opacity-70">{labelForType(order.order_type)}</span>
                    <span className="ml-1 font-medium">#{order.number}</span>
                  </button>
                ))}
                <button
                  onClick={() => createNewOrder(2)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    theme === 'dark'
                      ? 'bg-white/10 hover:bg.white/20 text-white'
                      : 'bg-gray-900 hover:bg-black text-white'
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
          setSelectedCategoryId={id => { setSelectedCategoryId(id); setSelectedSubcategoryId(null); }}
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
