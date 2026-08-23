import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import CatalogPanel from './CatalogPanel';
import OrderSide from './OrderSide';
import { useRootTheme } from './useRootTheme';

import { AddonPickerModal } from './components/AddonPickerModal';
import { useToast } from '../../components/ToastProvider'; // adjust path if needed
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { useI18n, useOrderTypeLabel } from '../../i18n';
import { shortOrderLabel } from '../../utils/orderLabel';
import { PaymentBadge } from '../../components/PaymentBadge';

import {
  OrderType,
  ItemSelection,
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
import { useDeliveryEnabled } from '../../hooks/useDeliveryEnabled';
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
  const { t } = useI18n();
  const labelForType = useOrderTypeLabel();

  const deliveryEnabled = useDeliveryEnabled();

  const [defaultOrderType, setDefaultOrderType] = useState<OrderType>(() => {
    const s = Number(localStorage.getItem('pos.defaultOrderType') || 2);
    return s === 1 || s === 2 || s === 3 ? (s as OrderType) : 2;
  });
  useEffect(() => {
    localStorage.setItem('pos.defaultOrderType', String(defaultOrderType));
  }, [defaultOrderType]);

  // The remembered default outlives the setting. A till that was left on
  // Delivery keeps that in localStorage, so when the office switches delivery
  // off, every new order would still be created as one — the picker would hide
  // the button while the order it just made was delivery anyway. This matters
  // more now that the setting can flip while the app is running, so it is a
  // reaction to the live value rather than a one-time read at boot.
  useEffect(() => {
    if (!deliveryEnabled && defaultOrderType === 1) setDefaultOrderType(2);
  }, [deliveryEnabled, defaultOrderType]);

  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const toast = useToast();
  const [addonItem, setAddonItem] = useState<Item | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [totalItems, setTotalItems] = useState(0);
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
      // Fetch the true match count alongside the (capped) page so the grid can
      // tell the operator when products are being hidden.
      const [rows, count] = await Promise.all([
        window.api.invoke('catalog:listItems', filter),
        window.api.invoke('catalog:countItems', filter),
      ]);
      setItems(rows || []);
      setTotalItems(Number(count?.total ?? (rows?.length || 0)));
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

      // If we already have a selected order and it's still active, refresh it
      if (currentOrder && orders.some((o) => o.id === currentOrder.id)) {
        const { order, lines } = await window.api.invoke(
          'orders:get',
          currentOrder.id
        );
        setCurrentOrder(order);
        setOrderLines(lines || []);
        return;
      }

      // No current order yet (first boot / after checkout cleared it) → focus
      // the newest ticket that is STILL BEING BUILT.
      //
      // It used to focus orders[0] outright, which undid the checkout: a
      // placed order deliberately stays in the active list, it sorts first
      // (opened_at DESC), so the order the cashier had just put through was
      // pulled straight back into the cart pane on the very next refresh.
      // That is the "it is still in view after I place the order" report.
      if (!currentOrder) {
        const stillBeingBuilt = orders.find((o) => {
          const s = String(o.status ?? '').toLowerCase();
          return s === 'open' || s === 'pending';
        });
        if (stillBeingBuilt) await selectOrder(stillBeingBuilt.id);
        return;
      }

      // We HAD a current order and it is no longer active at all (closed or
      // cancelled elsewhere). Clear the selection rather than auto-jumping to
      // some unrelated order.
      setCurrentOrder(null);
      setOrderLines([]);
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
      toast.error(e, {
        title: t('pos.createOrderFailed'),
        onRetry: () => void createNewOrder(orderType),
      });
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
      // The main process refuses some type changes (a dine-in order holding a
      // table, a closed order). Logging to a console nobody has open made this
      // look like a dead button — the cashier clicked "Delivery" and nothing
      // whatsoever happened.
      toast.error(e, { title: t('pos.typeChangeFailed') });
    }
  };

  const addItemToOrder = async (item: Item, qty = 1) => {
    if (item.is_outofstock) return;

    try {
      let order = currentOrder;
      if (!order) {
        order = await startOrder(defaultOrderType);
      }

      const res = await window.api.invoke(
        'orders:addLine',
        order.id,
        item.id,
        qty
      );

      setOrderLines(res.lines || []);
      setCurrentOrder(res.order);
      // Optionally refresh active orders bar
      await loadActiveOrders();
    } catch (e) {
      toast.error(e, { title: t('toast.addFailed') });
    }
  };

  // 🔫 Barcode scanner. Items that need options cannot be added blind — the
  // main process rejects a variation item on orders:addLine — so route those
  // to the picker instead of firing an error at the cashier.
  const handleScan = async (code: string) => {
    try {
      const item: Item | null = await window.api.invoke(
        'catalog:findByBarcode',
        code
      );

      if (!item) {
        toast({
          tone: 'warning',
          title: t('scan.unknown'),
          message: t('scan.noMatch', { code }),
        });
        return;
      }

      if (item.is_outofstock === 1) {
        toast({
          tone: 'warning',
          title: t('pos.outOfStock'),
          message: t('toast.outOfStock', { name: item.name }),
        });
        return;
      }

      if (item.has_variations || item.has_addons) {
        setAddonItem(item);
        return;
      }

      await addItemToOrder(item, 1);
    } catch (e) {
      console.error('[handleScan] failed', e);
      toast.error(e, { title: t('scan.failed') });
    }
  };

  // Pause scanning while the options modal is open: a scan there would add a
  // second item behind the dialog, and digits typed into a qty field are not
  // barcodes.
  useBarcodeScanner({ onScan: handleScan, enabled: !addonItem });

  const applyPromoCode = async (code: string) => {
    if (!currentOrder) return;
    try {
      const res = await window.api.invoke(
        'orders:applyPromo',
        currentOrder.id,
        code
      );
      if (res && res.order) {
        setCurrentOrder(res.order);
      }
    } catch (e) {
      toast.error(e, { title: t('promo.applyFailed') });
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
      // 1. Check if we are already viewing this table's order
      // (Prevents reloading if you just clicked the same table you are working on)
      if (
        currentOrder?.table_id === table.id &&
        currentOrder?.order_type === 3
      ) {
        return;
      }

      // 2. Check backend: Does this table ALREADY have an order?
      // (This fixes the "I can't click that table again" issue)
      const existing = await window.api.invoke(
        'tables:getActiveOrderForTable',
        table.id
      );

      if (existing && existing.id) {
        // If yes, just open that order! Don't create a new one.
        await selectOrder(existing.id);
        // REFRESH HERE: Ensure the UI knows it's occupied (turns red)
        await loadTables();
        return;
      }

      // 3. If no existing order, start a NEW one
      // We pass 3 (Dine-in).
      // NOTE: Ensure your startOrder function DOES NOT call loadTables() internally
      // to avoid double flashing, or if it does, it doesn't matter because we fix it below.
      const order = await startOrder(3);
      if (!order || !order.id) return;

      // 4. ASSIGN THE TABLE
      // This is the most critical step. The table is not "Busy" until this finishes.
      await window.api.invoke('orders:setTable', order.id, {
        table_id: table.id,
        covers: table.seats || 2,
      });

      // 5. UPDATE CURRENT ORDER
      // We need to update currentOrder locally so the UI knows we are on this table
      const updated = await window.api.invoke('orders:get', order.id);
      setCurrentOrder(updated.order);
      setOrderLines(updated.lines || []);

      // 6. THE FIX: REFRESH TABLES NOW
      // We fetch the list NOW, after step 4 is complete.
      // The backend will now report this table has an active_order_id.
      await loadTables();

      // Also refresh active orders bar
      await loadActiveOrders();
    } catch (e) {
      toast.error(e, { title: t('tables.assignFailed') });
      // If error, refresh anyway to show true state
      await loadTables();
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
  const headerBg = 'bg-content1';
  const border = 'border-default-200';

  return (
    <div className={`pos-screen h-screen flex flex-col ${bg}`}>
      {/* Header */}
      <header
        className={`border-b ${border} ${headerBg} min-h-14 shrink-0 z-20`}
      >
        <div className='px-4 h-full'>
          <div className='flex min-h-14 items-center gap-3'>
            {/*
              "Signed in as <name> <role>" used to live here as well as in the
              sidebar, so on any screen wide enough to show both, the operator's
              name appeared twice within about 300px of itself. The sidebar owns
              it — it is on every screen, and it keeps the avatar when collapsed.
              Reclaiming this block also gives the active-orders strip roughly
              180px, which is the difference between seeing three open orders
              and seeing one on a scaled 13" display.
            */}
            <div className='flex-1 flex items-center gap-2 overflow-x-auto chip-scroll min-w-0 py-2'>
              {activeOrders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => selectOrder(order.id)}
                  className={`
                    shrink-0 h-9 px-3 rounded-lg border text-xs transition-colors select-none
                    flex items-center justify-center min-w-[108px]
                    ${
                      currentOrder?.id === order.id
                        ? 'bg-primary border-primary text-primary-foreground font-semibold'
                        : 'bg-content1 border-default-200 text-default-700 hover:bg-default-100 hover:text-foreground'
                    }
                  `}
                >
                  <div className='flex items-center justify-between gap-2 w-full'>
                    <span>
                      {labelForType(order.order_type)}
                    </span>
                    <span className='opacity-80 text-[10px] flex items-center gap-1'>
                      {shortOrderLabel(order as any)}
                      <PaymentBadge
                        status={(order as any).payment_link_status}
                        theme={theme}
                      />
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className='shrink-0 flex items-center gap-2 ps-3 border-s border-default-200'>

              <button
                onClick={() => createNewOrder(2)}
                className='h-9 px-4 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 bg-primary text-primary-foreground hover:opacity-90'
              >
                <Plus size={16} strokeWidth={3} />
                <span>{t('pos.new')}</span>
              </button>

              {currentOrder && (
                <div className='w-px h-7 bg-default-200' />
              )}

              {currentOrder && (
                <OrderTypePicker
                  value={currentOrder.order_type}
                  onChange={changeOrderType}
                  allowDelivery={deliveryEnabled}
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

      {/*
        The order panel was a hard 420px, which is a third of the window once
        Windows scaling shrinks the viewport — the catalog got squeezed while
        the cart sat half empty. clamp() keeps it readable on a small till and
        stops it ballooning on a 4K screen; below 60rem it drops under the
        catalog rather than crushing it.
      */}
      <div
        className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_clamp(20rem,26vw,30rem)]
          flex-1 min-h-0 overflow-hidden'
      >
        <CatalogPanel
          theme={theme}
          items={items}
          totalItems={totalItems}
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
          onSelectWithAddons={(it) => setAddonItem(it)}
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

      {addonItem && (
        <AddonPickerModal
          theme={theme}
          item={addonItem}
          onClose={() => setAddonItem(null)}
          onConfirm={async (selection: ItemSelection) => {
            try {
              // Same as a plain tap: opening an order is implicit.
              const order = currentOrder ?? (await startOrder(defaultOrderType));

              // Map to a compact payload for main process
              const payload = {
                variation_id: selection.variation_id,
                addons: selection.addons.map((s) => ({
                  addon_id: s.id,
                  group_id: s.group_id,
                  qty: s.qty,
                })),
              };

              const res = await window.api.invoke(
                'orders:addLineWithAddons',
                order.id,
                addonItem.id,
                Math.max(1, Number(selection.qty) || 1),
                payload
              );

              // Update local state with server-calculated totals
              if (res && res.order) {
                setCurrentOrder(res.order);
                setOrderLines(res.lines || []);
              } else {
                await loadActiveOrders();
              }
            } catch (e) {
              toast.error(e, { title: t('toast.addFailed') });
            } finally {
              setAddonItem(null);
            }
          }}
        />
      )}
    </div>
  );
}
