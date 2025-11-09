import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, Clock, Package, X, Check, User, MapPin, CreditCard, 
  UtensilsCrossed, Table2, Moon, Sun, Percent, UserCheck, Zap, Phone, Mail
} from 'lucide-react';
import { fileUrl } from '../utils/fileUrl';

/* ========= Types ========= */
interface Item { id: string; name: string; name_ar: string; barcode: string; price: number; is_outofstock: number; category_id: string; subcategory_id: string; image?: string | null;
  image_local?: string | null;}
interface Category { id: string; name: string; name_ar: string; category_id?: string; }
interface OrderLine { id: string; order_id: string; item_id: string; name: string; qty: number; unit_price: number; line_total: number; }
type OrderType = 1 | 2 | 3;
interface Order {
  id: string; number: string; order_type: OrderType; status: string;
  subtotal: number; discount_total: number; delivery_fee: number; grand_total: number; opened_at: number;
  table_id?: string | null; table_name?: string | null; covers?: number | null;
  promocode?: string;
}
type TableStatus = 'available' | 'occupied' | 'reserved';
interface TableInfo { id: string; name: string; seats: number; status: TableStatus; current_order_id?: string | null; }
interface State { id: string; name: string; name_ar: string; }
interface City { id: string; state_id: string; name: string; name_ar: string; delivery_fee: number; min_order: number; }
interface Block { id: string; city_id: string; name: string; name_ar: string; }
interface Customer { full_name: string; mobile: string; email?: string; address?: string; }
interface Promo { id: string; code: string; type: string; value: number; min_total: number; max_discount?: number; }


function OrderProcessPage() {
 const theme = useRootTheme();

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

  // UI
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showPromoDialog, setShowPromoDialog] = useState(false);

  // Boot
  useEffect(() => { loadInitialData(); }, []);
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

  const imgSrcFor = (it: Pick<Item, 'image' | 'image_local' | 'name'>) => {
    const local = it.image_local ? fileUrl(it.image_local) : null;
    return local ?? it.image ?? null;
  };

  const loadItems = async () => {
    try {
      const filter = { q: searchQuery || null, categoryId: selectedCategoryId, subcategoryId: selectedSubcategoryId };
      setItems(await window.api.invoke('catalog:listItems', filter) || []);
    } catch (e) { console.error(e); }
  };

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
      setShowPromoDialog(false);
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

  // Tables
  const loadTables = async () => {
    try { setTables(await window.api.invoke('tables:list') || []); }
    catch (e) { console.error(e); }
  };
  const assignTable = async (t: TableInfo, covers: number) => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:setTable', currentOrder.id, { table_id: t.id, covers });
      const { order } = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(order);
      setShowTablePicker(false);
      await loadTables();
    } catch (e) { console.error(e); alert('Could not assign table'); }
  };
  const clearTable = async () => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:clearTable', currentOrder.id);
      const { order } = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(order);
      await loadTables();
    } catch (e) { console.error(e); }
  };

  // Filters
  const filteredSubcategories = useMemo(
    () => subcategories.filter(sub => !selectedCategoryId || sub.category_id === selectedCategoryId),
    [subcategories, selectedCategoryId]
  );
  useEffect(() => { loadItems(); }, [searchQuery, selectedCategoryId, selectedSubcategoryId]);
  const handleCategoryChange = (catId: string | null) => { setSelectedCategoryId(catId); setSelectedSubcategoryId(null); };

  const bg = theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50';
  const headerBg = theme === 'dark' ? 'bg-slate-900/70' : 'bg-white/70';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const cardBg = theme === 'dark' ? 'bg-white/5' : 'bg-white';
  const cardBorder = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';

  return (
      <div className={`min-h-screen ${bg} text-[13px]`}>
        {/* Header */}
        <header className={`border-b ${border} ${headerBg} backdrop-blur h-14`}>
          <div className="px-4 h-full">
            <div className="flex h-full items-center justify-between gap-2">
              <div className="flex items-center gap-3 overflow-hidden">
                <h1 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  POS System
                </h1>
                
                {/* Tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto max-w-[50vw] pr-2">
                  {activeOrders.map(order => (
                    <button
                      key={order.id}
                      onClick={() => selectOrder(order.id)}
                      className={`px-3 py-1.5 rounded-lg border transition text-xs ${
                        currentOrder?.id === order.id
  ? (theme === 'dark'
      ? 'bg-white/10 text-white border-white/20'
      : 'bg-gray-100 text-gray-800 border-gray-300')
  : (theme === 'dark'
      ? 'bg-white/5 text-slate-300 hover:bg-white/10 border-white/10'
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
  ? 'bg-white/10 hover:bg-white/20 text-white'
  : 'bg-gray-900 hover:bg-black text-white'
                    }`}
                  >
                    <Plus size={14} /> New
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
              

                {currentOrder && (
                  <>
                    <OrderTypePicker value={currentOrder.order_type} onChange={changeOrderType} theme={theme} />
                    {currentOrder.order_type === 3 && (
                      <div className="flex items-center gap-2">
                        {currentOrder.table_id ? (
                          <button 
                            onClick={() => setShowTablePicker(true)} 
                            className={`px-3 py-1.5 rounded-lg border text-xs ${
                              theme === 'dark'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-600/30'
                                : 'bg-emerald-100 text-emerald-700 border-emerald-300'
                            }`}
                          >
                            <Table2 size={14} className="inline mr-1" />
                            {currentOrder.table_name || 'Table'} • {currentOrder.covers || 1}
                          </button>
                        ) : (
                          <button 
                            onClick={() => setShowTablePicker(true)} 
                            className={`px-3 py-1.5 rounded-lg border text-xs ${
                              theme === 'dark'
                                ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <UtensilsCrossed size={14} className="inline mr-1" /> Assign Table
                          </button>
                        )}
                        {currentOrder.table_id && (
                          <button 
                            onClick={clearTable} 
                            className={`px-3 py-1.5 rounded-lg border text-xs ${
                              theme === 'dark'
                                ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main */}
        <div className="grid grid-cols-[1fr_420px] h-[calc(100dvh-56px)] overflow-hidden">
          {/* LEFT: Catalog */}
          <div className="flex flex-col overflow-hidden">
            {/* Filters */}
            <div className={`sticky top-0 z-10 ${bg} backdrop-blur p-4 border-b ${border}`}>
              {/* Search */}
              <div className="mb-3">
                <div className="relative">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${textMuted}`} size={18} />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search items, barcode, or Arabic name…"
                    className={`w-full pl-10 pr-3 py-2.5 ${inputBg} rounded-xl ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    }`}
                  />
                </div>
              </div>

              {/* Categories */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button 
                    onClick={() => handleCategoryChange(null)} 
                    className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                      !selectedCategoryId 
                        ? theme === 'dark'
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                          : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                        : theme === 'dark'
                          ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                    }`}
                  >
                    All Categories
                  </button>
                  {categories.map(cat => (
                    <button 
                      key={cat.id} 
                      onClick={() => handleCategoryChange(cat.id)} 
                      className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                        selectedCategoryId === cat.id
                          ? theme === 'dark'
                            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                            : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                          : theme === 'dark'
                            ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subcategories */}
              {filteredSubcategories.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button 
                    onClick={() => setSelectedSubcategoryId(null)} 
                    className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                      !selectedSubcategoryId
                        ? theme === 'dark'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'bg-blue-100 text-blue-700 border border-blue-300'
                        : theme === 'dark'
                          ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                    }`}
                  >
                    All
                  </button>
                  {filteredSubcategories.map(sub => (
                    <button 
                      key={sub.id} 
                      onClick={() => setSelectedSubcategoryId(sub.id)} 
                      className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                        selectedSubcategoryId === sub.id
                          ? theme === 'dark'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-blue-100 text-blue-700 border border-blue-300'
                          : theme === 'dark'
                            ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                      }`}
                    >
                      {sub.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 p-3">
                {items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => addItemToOrder(item)}
                    disabled={item.is_outofstock === 1 || !currentOrder}
                    className={`group relative p-3 rounded-xl border text-left transition ${
                      item.is_outofstock === 1 || !currentOrder
                        ? theme === 'dark'
                          ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
                          : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                        : theme === 'dark'
                          ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-blue-500/40'
                          : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md'
                    }`}
                  >
                    <div className="mb-2">
                      <div className={`w-full h-24 rounded-lg mb-2 overflow-hidden border ${
                        theme === 'dark' ? 'bg-slate-900 border-white/5' : 'bg-gray-100 border-gray-200'
                      }`}>
                        {(() => {
                          const src = imgSrcFor(item);
                          if (!src) {
                            return (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package size={30} className={theme === 'dark' ? 'text-slate-600' : 'text-gray-400'} />
                              </div>
                            );
                          }
                          return (
                            <img
                              src={src}
                              alt={item.name}
                              loading="lazy"
                              className="w-full h-full object-cover object-center"
                              onError={(e) => {
                                // fallback to a local placeholder if remote/local image fails
                                (e.currentTarget as HTMLImageElement).onerror = null;
                                (e.currentTarget as HTMLImageElement).src = '/assets/placeholder.png';
                              }}
                            />
                          );
                        })()}
                      </div>

                      <h3 className={`font-semibold ${text} line-clamp-2 leading-snug`}>{item.name}</h3>
                      <p className={`text-xs ${textMuted} line-clamp-1`}>{item.name_ar}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] ${
                        theme === 'dark' ? 'text-slate-500 bg-white/5' : 'text-gray-500 bg-gray-100'
                      } px-1.5 py-0.5 rounded`}>
                        {item.barcode || '—'}
                      </span>
                      <span className={`text-[15px] font-bold ${
                        theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
                      }`}>
                        {item.price.toFixed(3)}
                      </span>
                    </div>
                    {item.is_outofstock === 1 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
                        <span className="text-red-400 font-semibold text-sm">Out of Stock</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {items.length === 0 && (
                <div className={`flex flex-col items-center justify-center h-56 ${textMuted}`}>
                  <Package size={40} className="mb-3 opacity-50" />
                  <p>No items found</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Cart */}
          <CartPanel 
            currentOrder={currentOrder}
            orderLines={orderLines}
            theme={theme}
            onCreateOrder={() => createNewOrder(2)}
            onSelectOrder={selectOrder}
            onCheckout={() => setShowCheckout(true)}
            onShowPromo={() => setShowPromoDialog(true)}
            onRemovePromo={removePromoCode}
            onLoadActiveOrders={loadActiveOrders}
          />
        </div>

        {/* Modals */}
        {showCheckout && currentOrder && (
          <CheckoutModal
            order={currentOrder}
            states={states}
            cities={cities}
            blocks={blocks}
            theme={theme}
            onClose={() => setShowCheckout(false)}
            onComplete={async () => { setShowCheckout(false); await loadActiveOrders(); }}
            onLoadCities={async (stateId) => {
              const c = await window.api.invoke('geo:listCities', stateId);
              setCities(c || []);
            }}
            onLoadBlocks={async (cityId) => {
              const b = await window.api.invoke('geo:listBlocks', cityId);
              setBlocks(b || []);
            }}
          />
        )}

        {showTablePicker && currentOrder && currentOrder.order_type === 3 && (
          <TablePickerModal
            tables={tables}
            current={currentOrder}
            theme={theme}
            onClose={() => setShowTablePicker(false)}
            onAssign={assignTable}
            onRefresh={loadTables}
          />
        )}

        {showPromoDialog && currentOrder && (
          <PromoDialog
            promos={promos}
            theme={theme}
            onClose={() => setShowPromoDialog(false)}
            onApply={applyPromoCode}
          />
        )}
      </div>

  );
}

/* ========== Cart Panel ========== */
function CartPanel({ 
  currentOrder, 
  orderLines, 
  theme,
  onCreateOrder,
  onSelectOrder,
  onCheckout,
  onShowPromo,
  onRemovePromo,
  onLoadActiveOrders
}: any) {
  const bg = theme === 'dark' ? 'bg-slate-900/60' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const cardBg = theme === 'dark' ? 'bg-white/5' : 'bg-gray-50';
  const cardBorder = theme === 'dark' ? 'border-white/10' : 'border-gray-200';

  return (
    <div className={`${bg} backdrop-blur border-l ${border} flex flex-col h-full overflow-hidden`}>
      {/* Header */}
      <div className={`p-4 border-b ${border} shrink-0`}>
        {currentOrder ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className={`text-xs ${textMuted}`}>Order Number</div>
                <div className={`text-xl font-bold ${text}`}>#{currentOrder.number}</div>
              </div>
              <div className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                theme === 'dark'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-blue-100 text-blue-700 border border-blue-300'
              }`}>
                {labelForType(currentOrder.order_type)}
              </div>
            </div>

            {/* Promo section */}
            {currentOrder.promocode ? (
              <div className={`flex items-center justify-between p-2.5 rounded-lg border ${
                theme === 'dark' 
                  ? 'bg-green-500/10 border-green-500/30' 
                  : 'bg-green-50 border-green-300'
              }`}>
                <div className="flex items-center gap-2">
                  <Percent size={16} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                  <span className={`text-xs font-medium ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>
                    {currentOrder.promocode}
                  </span>
                </div>
                <button
                  onClick={onRemovePromo}
                  className={`text-xs ${theme === 'dark' ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700'}`}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={onShowPromo}
                className={`w-full py-2 rounded-lg border text-xs font-medium transition ${
                  theme === 'dark'
                    ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Percent size={14} className="inline mr-1" /> Apply Promo Code
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-3">
            <p className={`${textMuted} mb-2`}>No active order</p>
            <button 
              onClick={onCreateOrder} 
              className={`px-4 py-2.5 rounded-lg text-sm font-medium ${
                theme === 'dark'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                  : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
              }`}
            >
              Create New Order
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {currentOrder && (
        <>
          <div className="grow overflow-y-auto p-4">
            {orderLines.length === 0 ? (
              <div className={`flex flex-col items-center justify-center h-full ${textMuted}`}>
                <ShoppingCart size={40} className="mb-3 opacity-50" />
                <p className="text-center">Cart is empty<br />Add items to get started</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {orderLines.map(line => (
                  <OrderLineItem 
                    key={line.id} 
                    line={line} 
                    orderId={currentOrder.id} 
                    theme={theme}
                    onUpdate={() => onSelectOrder(currentOrder.id)} 
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`p-4 border-t ${border} ${cardBg} pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] shrink-0`}>
            <div className="space-y-1.5 mb-3">
              <Row label="Subtotal" value={(currentOrder.subtotal || 0).toFixed(3)} theme={theme} />
              {currentOrder.discount_total > 0 && (
                <Row label="Discount" value={`-${(currentOrder.discount_total || 0).toFixed(3)}`} theme={theme} />
              )}
              {currentOrder.order_type === 1 && (
                <Row label="Delivery Fee" value={(currentOrder.delivery_fee || 0).toFixed(3)} theme={theme} />
              )}
              <div className={`flex justify-between text-[15px] font-bold ${text} pt-2 border-t ${
                theme === 'dark' ? 'border-white/10' : 'border-gray-200'
              }`}>
                <span>Total</span>
                <span className={theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}>
                  {(currentOrder.grand_total || 0).toFixed(3)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await window.api.invoke('orders:close', currentOrder.id);
                  await onLoadActiveOrders();
                }}
                className={`px-3.5 py-2 rounded-lg text-sm border transition flex items-center justify-center gap-1.5 ${
                  theme === 'dark'
                    ? 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Clock size={18} /> Hold
              </button>
              <button
                onClick={onCheckout}
                disabled={orderLines.length === 0}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 ${
                  theme === 'dark'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                    : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <Check size={18} /> Checkout
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


function useRootTheme(): 'light' | 'dark' {
  const [t, setT] = useState<'light' | 'dark'>(
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );
  useEffect(() => {
    const mo = new MutationObserver(() =>
      setT(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    );
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return t;
}

/* ========== Order Line Item ========== */
function OrderLineItem({ line, orderId, theme, onUpdate }: any) {
  const call = (ch: string, ...args: any[]) =>
    window.api.invoke(ch, ...args);

  const setQty = async (nextQty: number) => {
    if (nextQty <= 0) {
      // Try the most explicit remove first; fall back to delta
      await call('orders:removeLine', line.id)
        .catch(() => call('orders:removeLineByItem', orderId, line.item_id))
        .catch(() => call('orders:addLine', orderId, line.item_id, -line.qty));
    } else {
      // Prefer set-qty; fall back to delta -/+1
      await call('orders:setLineQty', line.id, nextQty)
        .catch(async () => {
          const delta = nextQty - Number(line.qty || 0);
          if (delta !== 0) await call('orders:addLine', orderId, line.item_id, delta);
        });
    }
    onUpdate();
  };

  const inc = async () => setQty(Number(line.qty || 0) + 1);
  const dec = async () => {
    const next = Math.max(0, Number(line.qty || 0) - 1);
    await setQty(next);
  };
  const remove = async () => setQty(0);

  const bg = theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const price = theme === 'dark' ? 'text-slate-200' : 'text-gray-800';

  return (
    <div className={`${bg} border ${border} rounded-lg p-3 transition`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 pr-2">
          <h4 className={`font-semibold ${text} leading-snug`}>{line.name}</h4>
          <p className={`text-xs ${price} font-medium`}>
            {line.unit_price.toFixed(3)} × {line.qty}
          </p>
        </div>
        <button
          onClick={remove}
          className={theme === 'dark' ? 'text-slate-400 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}
          title="Remove"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            onClick={dec}
            disabled={line.qty <= 1}
            className={`w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
              theme === 'dark'
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
            title={line.qty <= 1 ? 'Use the trash to remove' : 'Decrease'}
          >
            <Minus size={14} />
          </button>
          <span className={`w-10 text-center font-semibold ${text}`}>{line.qty}</span>
          <button
            onClick={inc}
            className={`w-8 h-8 rounded-md flex items-center justify-center ${
              theme === 'dark'
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className={`text-[15px] font-bold ${text}`}>{line.line_total.toFixed(3)}</div>
      </div>
    </div>
  );
}

/* ========== Checkout Modal ========== */
function CheckoutModal({ order, states, cities, blocks, theme, onClose, onComplete, onLoadCities, onLoadBlocks }: any) {
  const [formData, setFormData] = useState({
    full_name: '',
    mobile: '',
    email: '',
    address: '',
    state_id: '',
    city_id: '',
    block_id: '',
    street: '',
    building: '',
    floor: '',
    note: '',
    payment_method_id: '',
    payment_method_slug: 'cash'
  });
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [useQuickMode, setUseQuickMode] = useState(false);
  const [customerLookup, setCustomerLookup] = useState<Customer | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    (async () => {
      const methods = await window.api.invoke('payments:listMethods');
      setPaymentMethods(methods || []);
      if (methods?.length) {
        setFormData(p => ({
          ...p,
          payment_method_id: String(methods[0].id),
          payment_method_slug: methods[0].slug || 'cash'
        }));
      }
    })();
  }, []);

  const searchCustomer = async (mobile: string) => {
    if (mobile.length < 8) return;
    setIsSearching(true);
    try {
      const customer = await window.api.invoke('customers:findByMobile', mobile);
      if (customer) {
        setCustomerLookup(customer);
        setFormData(p => ({
          ...p,
          full_name: customer.full_name || '',
          email: customer.email || '',
          address: customer.address || ''
        }));
      } else {
        setCustomerLookup(null);
      }
    } catch (e) {
      console.error(e);
    }
    setIsSearching(false);
  };

  const handleQuickMode = async () => {
    try {
      const posUser = await window.api.invoke('settings:getPosUser');
      if (posUser) {
        setFormData(p => ({
          ...p,
          full_name: posUser.name || 'POS User',
          mobile: posUser.mobile || '00000000',
          email: posUser.email || ''
        }));
        setUseQuickMode(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await window.api.invoke('orders:complete', order.id, formData);
      onComplete();
    } catch (e) {
      alert('Failed to complete order');
      console.error(e);
    }
  };

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';
  const label = theme === 'dark' ? 'text-slate-300' : 'text-gray-700';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${bg} border ${border} rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto`}>
        <div className={`sticky top-0 ${bg} border-b ${border} p-4 flex items-center justify-between`}>
          <h2 className={`text-xl font-bold ${text}`}>Complete Order</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleQuickMode}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                useQuickMode
                  ? theme === 'dark'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-amber-100 text-amber-700 border border-amber-300'
                  : theme === 'dark'
                    ? 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                    : 'bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Zap size={14} /> {useQuickMode ? 'Quick Mode ON' : 'Quick Mode'}
            </button>
            <button onClick={onClose} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
              <X size={22} />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="p-4 space-y-3">
          {/* Customer lookup */}
          <div className={`p-3 rounded-lg border ${
            theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-300'
          }`}>
            <label className={`block text-xs font-medium ${label} mb-1.5`}>
              <Phone size={14} className="inline mr-1" /> Mobile Number (Customer Lookup)
            </label>
            <div className="flex gap-2">
              <input
                value={formData.mobile}
                onChange={e => {
                  setFormData({ ...formData, mobile: e.target.value });
                  if (e.target.value.length >= 8) searchCustomer(e.target.value);
                }}
                className={`flex-1 px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                }`}
                placeholder="Enter mobile to find customer"
              />
              {isSearching && <div className={`px-3 py-2 ${textMuted} text-xs`}>Searching...</div>}
            </div>
            {customerLookup && (
              <div className={`mt-2 flex items-center gap-2 text-xs ${
                theme === 'dark' ? 'text-green-300' : 'text-green-700'
              }`}>
                <UserCheck size={14} />
                <span>Found: {customerLookup.full_name}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs font-medium ${label} mb-1`}>
                <User size={14} className="inline mr-1" /> Customer Name *
              </label>
              <input
                required
                value={formData.full_name}
                onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                }`}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className={`block text-xs font-medium ${label} mb-1`}>
                <Mail size={14} className="inline mr-1" /> Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                }`}
                placeholder="customer@email.com"
              />
            </div>
          </div>

          {order.order_type === 1 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>State *</label>
                  <select
                    required
                    value={formData.state_id}
                    onChange={e => {
                      setFormData({ ...formData, state_id: e.target.value, city_id: '', block_id: '' });
                      onLoadCities(e.target.value);
                    }}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    }`}
                  >
                    <option value="">Select state</option>
                    {states.map((s: State) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>City *</label>
                  <select
                    required
                    value={formData.city_id}
                    onChange={e => {
                      setFormData({ ...formData, city_id: e.target.value, block_id: '' });
                      onLoadBlocks(e.target.value);
                    }}
                    disabled={!formData.state_id}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    } disabled:opacity-50`}
                  >
                    <option value="">Select city</option>
                    {cities.map((c: City) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>Block *</label>
                  <select
                    required
                    value={formData.block_id}
                    onChange={e => setFormData({ ...formData, block_id: e.target.value })}
                    disabled={!formData.city_id}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    } disabled:opacity-50`}
                  >
                    <option value="">Select block</option>
                    {blocks.map((b: Block) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>Street *</label>
                  <input
                    required
                    value={formData.street}
                    onChange={e => setFormData({ ...formData, street: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    }`}
                    placeholder="Street name"
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>Building</label>
                  <input
                    value={formData.building}
                    onChange={e => setFormData({ ...formData, building: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    }`}
                    placeholder="Building no."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>Floor</label>
                  <input
                    value={formData.floor}
                    onChange={e => setFormData({ ...formData, floor: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    }`}
                    placeholder="Floor number"
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>
                    <MapPin size={14} className="inline mr-1" /> Full Address *
                  </label>
                  <textarea
                    required
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                    } resize-none`}
                    rows={2}
                    placeholder="Complete address"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={`block text-xs font-medium ${label} mb-1`}>Order Notes</label>
            <textarea
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
              className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
              } resize-none`}
              rows={2}
              placeholder="Special instructions…"
            />
          </div>

          <div>
            <label className={`block text-xs font-medium ${label} mb-1`}>
              <CreditCard size={14} className="inline mr-1" /> Payment Method *
            </label>
            <select
              required
              value={formData.payment_method_id}
              onChange={e => {
                const method = paymentMethods.find(m => String(m.id) === e.target.value);
                setFormData({
                  ...formData,
                  payment_method_id: e.target.value,
                  payment_method_slug: method?.slug || 'cash'
                });
              }}
              className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${
                theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
              }`}
            >
              {paymentMethods.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name_en}</option>
              ))}
            </select>
          </div>

          {/* Summary */}
          <div className={`p-3 rounded-lg border ${
            theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
          } space-y-1.5`}>
            <Row label="Subtotal" value={order.subtotal.toFixed(3)} theme={theme} />
            {order.discount_total > 0 && (
              <Row label="Discount" value={`-${order.discount_total.toFixed(3)}`} theme={theme} />
            )}
            {order.order_type === 1 && (
              <Row label="Delivery Fee" value={order.delivery_fee.toFixed(3)} theme={theme} />
            )}
            <div className={`flex justify-between text-[15px] font-bold ${text} pt-2 border-t ${
              theme === 'dark' ? 'border-white/10' : 'border-gray-200'
            }`}>
              <span>Total</span>
              <span className={theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}>
                {order.grand_total.toFixed(3)}
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 px-4 py-2.5 rounded-lg border font-medium ${
                theme === 'dark'
                  ? 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`flex-1 px-4 py-2.5 rounded-lg font-medium ${
                theme === 'dark'
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                  : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white'
              }`}
            >
              Complete Order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ========== Promo Dialog ========== */
function PromoDialog({ promos, theme, onClose, onApply }: any) {
  const [code, setCode] = useState('');

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';
  const cardBg = theme === 'dark' ? 'bg-white/5' : 'bg-gray-50';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${bg} border ${border} rounded-xl w-full max-w-md p-4`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-xl font-bold ${text}`}>Apply Promo Code</h2>
          <button onClick={onClose} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
            <X size={22} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="Enter promo code"
              className={`w-full px-3 py-2.5 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
              }`}
            />
          </div>

          <button
            onClick={() => code && onApply(code)}
            disabled={!code}
            className={`w-full px-4 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              theme === 'dark'
                ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
            }`}
          >
            Apply Code
          </button>

          {promos && promos.length > 0 && (
            <div>
              <div className={`text-xs font-medium ${textMuted} mb-2 mt-4`}>Available Promo Codes:</div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {promos.filter((p: Promo) => p.active).map((promo: Promo) => (
                  <button
                    key={promo.id}
                    onClick={() => onApply(promo.code)}
                    className={`w-full p-2.5 rounded-lg border text-left transition ${
                      theme === 'dark'
                        ? 'bg-white/5 border-white/10 hover:bg-white/10'
                        : 'bg-white border-gray-200 hover:border-blue-400'
                    }`}
                  >
                    <div className={`font-semibold ${text} text-sm`}>{promo.code}</div>
                    <div className={`text-xs ${textMuted}`}>
                      {promo.type === 'percent' ? `${promo.value}% off` : `${promo.value.toFixed(3)} KWD off`}
                      {promo.min_total > 0 && ` • Min: ${promo.min_total.toFixed(3)}`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========== Table Picker Modal ========== */
function TablePickerModal({ tables, current, theme, onClose, onAssign, onRefresh }: any) {
  const [covers, setCovers] = useState<number>(current.covers || 2);

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';

  const colorFor = (s: TableStatus) => {
    if (s === 'available') {
      return theme === 'dark'
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-600/30'
        : 'bg-emerald-100 text-emerald-700 border-emerald-300';
    }
    if (s === 'reserved') {
      return theme === 'dark'
        ? 'bg-amber-500/15 text-amber-300 border-amber-600/30'
        : 'bg-amber-100 text-amber-700 border-amber-300';
    }
    return theme === 'dark'
      ? 'bg-rose-500/15 text-rose-300 border-rose-600/30'
      : 'bg-rose-100 text-rose-700 border-rose-300';
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${bg} border ${border} rounded-xl w-full max-w-3xl p-4 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-xl font-bold ${text}`}>Assign Table</h2>
          <div className="flex items-center gap-2">
            <label className={`text-xs ${textMuted}`}>Covers</label>
            <input
              type="number"
              min={1}
              className={`w-16 px-2 py-1.5 ${inputBg} rounded-md ${text}`}
              value={covers}
              onChange={e => setCovers(Math.max(1, Number(e.target.value || 1)))}
            />
            <button
              onClick={onRefresh}
              className={`px-3 py-1.5 rounded-md border text-xs ${
                theme === 'dark'
                  ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              Refresh
            </button>
            <button onClick={onClose} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
              <X size={22} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {tables.map((t: TableInfo) => (
            <button
              key={t.id}
              onClick={() => t.status === 'available' ? onAssign(t, covers) : null}
              disabled={t.status !== 'available'}
              className={`p-3 rounded-lg border text-left transition ${colorFor(t.status)} ${
                t.status !== 'available' ? 'opacity-70 cursor-not-allowed' : 'hover:brightness-110'
              }`}
              title={`${t.name} • ${t.seats} seats`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">{t.name}</div>
                <span className="text-[11px] opacity-80 capitalize">{t.status}</span>
              </div>
              <div className={`text-xs ${textMuted}`}>Seats: {t.seats}</div>
            </button>
          ))}
        </div>

        {tables.length === 0 && (
          <div className={`${textMuted} text-sm py-8 text-center`}>No tables found.</div>
        )}
      </div>
    </div>
  );
}

/* ========== Order Type Picker ========== */
function OrderTypePicker({ value, onChange, theme }: { value: OrderType; onChange: (type: OrderType) => void; theme: 'light' | 'dark' }) {
  const types = [
    { k: 1 as const, label: 'Delivery', icon: '🚗' },
    { k: 2 as const, label: 'Pickup', icon: '🛍️' },
    { k: 3 as const, label: 'Dine-in', icon: '🍽️' }
  ];

  const bg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-300';
  const activeBtn = theme === 'dark'
    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow'
    : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow';
  const inactiveBtn = theme === 'dark' ? 'text-slate-300 hover:text-white' : 'text-gray-700 hover:text-gray-900';

  return (
    <div className={`inline-flex rounded-lg border p-1 ${bg}`}>
      {types.map(t => (
        <button
          key={t.k}
          type="button"
          onClick={() => onChange(t.k)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
            t.k === value ? activeBtn : inactiveBtn
          }`}
          title={t.label}
        >
          <span className="mr-1">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ========== Helper Components ========== */
function Row({ label, value, theme }: { label: string; value: string; theme: 'light' | 'dark' }) {
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  return (
    <div className={`flex justify-between ${textMuted}`}>
      <span>{label}</span>
      <span className="font-medium">{value}</span>
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

/* ========== Global declarations ========== */
declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
  }
}

export default OrderProcessPage;