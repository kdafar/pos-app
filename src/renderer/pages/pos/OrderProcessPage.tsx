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
    return s === 1 || s === 2 || s === 3 ? (s as OrderType) : 2;
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null
  );
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<
    string | null
  >(null);

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
    return () => {
      cancelled = true;
    };
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
    } catch (e) {
      console.error(e);
    }
  };

  async function startOrder(
    type: OrderType = defaultOrderType
  ): Promise<Order> {
    console.log(`[startOrder] called with type: ${type}`);

    const res = await window.api.invoke('orders:start');
    const newOrderStub = res?.order || res;

    if (!newOrderStub?.id) {
      throw new Error('Failed to create new order.');
    }

    try {
      await window.api.invoke('orders:setType', newOrderStub.id, type);
    } catch (err) {
      console.error(`[startOrder] Failed to set type ${type}`, err);
    }

    const { order: finalNewOrder, lines } = await window.api.invoke(
      'orders:get',
      newOrderStub.id
    );

    if (!finalNewOrder) throw new Error('Failed to fetch newly created order.');

    setCurrentOrder(finalNewOrder);
    setOrderLines(lines || []);
    await loadActiveOrders();
    if (finalNewOrder.order_type === 3) {
      await loadTables();
    }
    return finalNewOrder;
  }

  const loadItems = async () => {
    try {
      const filter = {
        q: searchQuery || null,
        categoryId: selectedCategoryId,
        subcategoryId: selectedSubcategoryId,
      };
      setItems((await window.api.invoke('catalog:listItems', filter)) || []);
    } catch (e) {
      console.error(e);
    }
  };
  useEffect(() => {
    loadItems();
  }, [searchQuery, selectedCategoryId, selectedSubcategoryId]);

  const loadActiveOrders = async () => {
    try {
      const orders: Order[] = await window.api.invoke('orders:listActive');
      setActiveOrders(orders || []);

      if (!orders || orders.length === 0) {
        setCurrentOrder(null);
        setOrderLines([]);
        return;
      }

      if (currentOrder && orders.some((o) => o.id === currentOrder.id)) {
        const { order, lines } = await window.api.invoke(
          'orders:get',
          currentOrder.id
        );
        setCurrentOrder(order);
        setOrderLines(lines || []);
        return;
      }

      if (!currentOrder || !orders.some((o) => o.id === currentOrder.id)) {
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
      setCurrentOrder(null);
      setOrderLines([]);
      return;
    }
    try {
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
      await selectOrder(order.id);
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
    } catch (e) {
      console.error(e);
    }
  };

  const addItemToOrder = async (item: Item, qty = 1) => {
    if (item.is_outofstock) return;
    try {
      let order = currentOrder;
      if (!order) {
        order = await startOrder(defaultOrderType);
      }
      const { totals, lines } = await window.api.invoke(
        'orders:addLine',
        order.id,
        item.id,
        qty
      );
      // 'totals' is actually the full object returned by recalcAndGet usually {order, lines} or just {totals} depending on implementation
      // But in our backend 'orders:addLine' returns recalcAndGet() which is {order, lines}.
      // So 'totals' here is actually { order:..., lines:... }
      // Wait, 'orders:addLine' returns { totals, lines } in some versions or { order, lines } in others?
      // In my backend above: returns recalcAndGet() -> { order, lines }.
      // So the destructuring { totals, lines } in this frontend code is WRONG.

      const res = await window.api.invoke(
        'orders:addLine',
        order.id,
        item.id,
        qty
      );
      setOrderLines(res.lines || []);
      setCurrentOrder(res.order); // Use the returned order object directly
    } catch (e) {
      console.error(e);
    }
  };

  const applyPromoCode = async (code: string) => {
    if (!currentOrder) return;
    try {
      // FIX: The backend 'orders:applyPromo' now returns { order, lines } via recalcAndGet.
      const res = await window.api.invoke(
        'orders:applyPromo',
        currentOrder.id,
        code
      );

      // Update state with the full order object returned by backend
      if (res && res.order) {
        setCurrentOrder(res.order);
      }
    } catch (e) {
      alert('Invalid or expired promo code');
    }
  };

  const removePromoCode = async () => {
    if (!currentOrder) return;
    try {
      const res = await window.api.invoke(
        'orders:removePromo',
        currentOrder.id
      );
      if (res && res.order) {
        setCurrentOrder(res.order);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadTables = async () => {
    try {
      setTables((await window.api.invoke('tables:list')) || []);
    } catch (e) {
      console.error(e);
    }
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
  const headerBg = theme === 'dark' ? 'bg-slate-900/95' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';

  const labelForType = (type: OrderType): string => {
    switch (type) {
      case 1:
        return 'Delivery';
      case 2:
        return 'Pickup';
      case 3:
        return 'Dine-in';
      default:
        return 'Order';
    }
  };

  return (
    <div className={`h-screen flex flex-col ${bg} text-[13px]`}>
      {/* Header */}
      <header
        className={`border-b ${border} ${headerBg} backdrop-blur h-14 shrink-0 shadow-sm z-20`}
      >
        <div className='px-4 h-full'>
          <div className='flex h-full items-center gap-4'>
            <div className='shrink-0 hidden md:block'>
              <h1 className={`text-lg font-bold ${text}`}>POS</h1>
            </div>

            <div className='flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 px-2 pb-0.5'>
              {activeOrders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => selectOrder(order.id)}
                  className={`
                    shrink-0 h-9 px-3 rounded-md border text-xs font-medium transition-all select-none
                    flex flex-col justify-center min-w-[100px]
                    ${
                      currentOrder?.id === order.id
                        ? theme === 'dark'
                          ? 'bg-blue-600 border-blue-500 text-white shadow-sm ring-1 ring-blue-500/50'
                          : 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : theme === 'dark'
                        ? 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }
                  `}
                >
                  <div className='flex items-center justify-between gap-2 w-full'>
                    <span className='opacity-90'>
                      {labelForType(order.order_type)}
                    </span>
                    <span className='opacity-70 text-[10px]'>
                      #{order.number?.split('-')?.pop()}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className='shrink-0 flex items-center gap-2 pl-2 border-l border-gray-200 dark:border-white/10'>
              <button
                onClick={() => createNewOrder(2)}
                className={`h-9 px-4 rounded-md text-xs font-bold transition flex items-center gap-2 shadow-sm ${
                  theme === 'dark'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                <Plus size={16} strokeWidth={3} />
                <span>NEW</span>
              </button>

              {currentOrder && (
                <div className='w-[1px] h-6 bg-gray-300 dark:bg-white/20 mx-1' />
              )}

              {currentOrder && (
                <OrderTypePicker
                  value={currentOrder.order_type}
                  onChange={changeOrderType}
                  theme={theme}
                />
              )}
            </div>
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

      <div className='grid grid-cols-[1fr_420px] flex-1 min-h-0 overflow-hidden'>
        <CatalogPanel
          theme={theme}
          items={items}
          categories={categories}
          subcategories={subcategories}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategoryId={selectedCategoryId}
          setSelectedCategoryId={(id) => {
            setSelectedCategoryId(id);
            setSelectedSubcategoryId(null);
          }}
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
