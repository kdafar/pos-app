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

type PosUser = {
  id: string | number;
  name?: string;
  role?: string;
  type?: string;
  is_admin?: boolean | number;
};

/**
 * Electron wraps handler errors as
 * "Error invoking remote method 'x': Error: real message" — show only the
 * part the cashier can act on.
 */
function ipcErrorMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  if (!raw) return fallback;
  const stripped = raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^(Error|TypeError):\s*/i, '')
    .trim();
  return stripped || fallback;
}

export default function OrderProcessPage() {
  const theme = useRootTheme();
  const { t } = useI18n();
  const labelForType = useOrderTypeLabel();

  const [defaultOrderType, setDefaultOrderType] = useState<OrderType>(() => {
    const s = Number(localStorage.getItem('pos.defaultOrderType') || 2);
    return s === 1 || s === 2 || s === 3 ? (s as OrderType) : 2;
  });
  useEffect(() => {
    localStorage.setItem('pos.defaultOrderType', String(defaultOrderType));
  }, [defaultOrderType]);

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

      // No current order yet (first boot / after manual clear) → focus first
      if (!currentOrder) {
        await selectOrder(orders[0].id);
        return;
      }

      // We HAD a current order, but it is no longer in the active list
      // (e.g. just placed pickup/delivery). Clear selection instead of
      // auto-jumping to some other order.
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
    } catch (e: any) {
      console.error('[createNewOrder] error', e);

      const msg = ipcErrorMessage(e, 'Could not create a new order.');

      const normalized = String(msg).toLowerCase();

      if (normalized.includes('open order with no items')) {
        toast({
          tone: 'warning',
          title: 'Open order already exists',
          message: (
            <div className='space-y-1 text-[11px]'>
              <p>You already have an open order with no items.</p>
              <p>
                Please add items to it or cancel it before opening a new one.
              </p>
            </div>
          ),
        });

        // Refresh list so they can see/select that open empty order
        await loadActiveOrders();
      } else {
        toast({
          tone: 'danger',
          title: 'Could not create a new order',
          message: msg,
        });
      }
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
      console.error(e);
      toast({
        tone: 'danger',
        title: t('pos.typeChangeFailed'),
        message: e instanceof Error ? e.message : String(e ?? ''),
      });
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
    } catch (e: any) {
      console.error('[addItemToOrder] error', e);

      const msg = ipcErrorMessage(e, 'Could not add this item to the order.');

      const normalized = String(msg).toLowerCase();

      if (normalized.includes('open order with no items')) {
        toast({
          tone: 'warning',
          title: 'Open order already exists',
          message: (
            <div className='space-y-1 text-[11px]'>
              <p>You already have an open order with no items.</p>
              <p>
                Please add items to it or cancel it before starting another one.
              </p>
            </div>
          ),
        });

        // Refresh so they can see/select that open empty order
        await loadActiveOrders();
      } else {
        toast({
          tone: 'danger',
          title: 'Could not add item to order',
          message: msg,
        });
      }
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
      toast({
        tone: 'danger',
        title: t('scan.failed'),
        message: ipcErrorMessage(e, 'Could not look up that barcode.'),
      });
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
      toast({
        tone: 'danger',
        title: 'Invalid or expired promo code.',
        message: 'Please check the logs for details or contact support.',
      });
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

  const [user, setUser] = useState<PosUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await window.api.invoke('auth:whoami');
        setUser(u || null);
      } catch {
        setUser(null);
      }
    })();
  }, []);

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
      console.error('startDineInForTable failed', e);
      toast({
        tone: 'danger',
        title: 'Could not assign table.',
        message: 'Please check the logs for details or contact support.',
      });
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
  const headerBg = theme === 'dark' ? 'bg-slate-900/95' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';

  return (
    <div className={`h-screen flex flex-col ${bg} text-[13px]`}>
      {/* Header */}
      <header
        className={`border-b ${border} ${headerBg} backdrop-blur h-14 shrink-0 shadow-sm z-20`}
      >
        <div className='px-4 h-full'>
          <div className='flex h-full items-center gap-4'>
            <div className='shrink-0 hidden md:flex flex-col leading-tight'>
              <span className={`text-[11px] font-medium ${text} opacity-70`}>
                {t('pos.signedInAs')}
              </span>
              <div className='flex items-center gap-2'>
                <span className={`text-sm font-semibold ${text}`}>
                  {user?.name || t('pos.operator')}
                </span>
                {user?.role && (
                  <span className='text-[10px] px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-200'>
                    {user.role}
                  </span>
                )}
              </div>
            </div>

            <div className='flex-1 flex items-center gap-2 overflow-x-auto nice-scroll min-w-0 px-2 pb-0.5'>
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
                    <span className='opacity-70 text-[10px] flex items-center gap-1'>
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

            <div className='shrink-0 flex items-center gap-2 ps-2 border-s border-gray-200 dark:border-white/10'>

              <button
                onClick={() => createNewOrder(2)}
                className={`h-9 px-4 rounded-md text-xs font-bold transition flex items-center gap-2 shadow-sm ${
                  theme === 'dark'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                <Plus size={16} strokeWidth={3} />
                <span>{t('pos.new')}</span>
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
              console.error(
                '[OrderProcessPage] add line with options failed',
                e
              );
              toast({
                tone: 'danger',
                title: t('toast.addFailed'),
                message: ipcErrorMessage(
                  e,
                  'Please check the logs for details or contact support.'
                ),
              });
            } finally {
              setAddonItem(null);
            }
          }}
        />
      )}
    </div>
  );
}
