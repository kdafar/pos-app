import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Minus, Trash2, ShoppingCart, Clock, Package, X, Check, User, MapPin, CreditCard } from 'lucide-react';

// Type definitions
interface Item {
  id: string;
  name: string;
  name_ar: string;
  barcode: string;
  price: number;
  is_outofstock: number;
  category_id: string;
  subcategory_id: string;
}

interface Category {
  id: string;
  name: string;
  name_ar: string;
}

interface OrderLine {
  id: string;
  order_id: string;
  item_id: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

interface Order {
  id: string;
  number: string;
  order_type: 1 | 2 | 3;
  status: string;
  subtotal: number;
  discount_total: number;
  delivery_fee: number;
  grand_total: number;
  opened_at: number;
}

function OrderProcessPage() {
  // State
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Category[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const cats = await window.api.invoke('catalog:listCategories');
      const subs = await window.api.invoke('catalog:listSubcategories');
      setCategories(cats || []);
      setSubcategories(subs || []);
      
      await loadItems();
      await loadActiveOrders();
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  };

  const loadItems = async () => {
    try {
      const filter = {
        q: searchQuery || null,
        categoryId: selectedCategoryId,
        subcategoryId: selectedSubcategoryId
      };
      const data = await window.api.invoke('catalog:listItems', filter);
      setItems(data || []);
    } catch (error) {
      console.error('Failed to load items:', error);
    }
  };

  const loadActiveOrders = async () => {
    try {
      const orders = await window.api.invoke('orders:listActive');
      setActiveOrders(orders || []);
      
      if (orders && orders.length > 0 && !currentOrder) {
        await selectOrder(orders[0].id);
      }
    } catch (error) {
      console.error('Failed to load active orders:', error);
    }
  };

  const selectOrder = async (orderId: string) => {
    try {
      const { order, lines } = await window.api.invoke('orders:get', orderId);
      setCurrentOrder(order);
      setOrderLines(lines || []);
    } catch (error) {
      console.error('Failed to select order:', error);
    }
  };

  const createNewOrder = async (orderType: 1 | 2 | 3 = 2) => {
    try {
      const newOrder = await window.api.invoke('orders:start');
      await window.api.invoke('orders:setType', newOrder.id, orderType);
      await loadActiveOrders();
      await selectOrder(newOrder.id);
    } catch (error) {
      console.error('Failed to create new order:', error);
    }
  };

  const changeOrderType = async (type: 1 | 2 | 3) => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:setType', currentOrder.id, type);
      await selectOrder(currentOrder.id);
    } catch (error) {
      console.error('Failed to change order type:', error);
    }
  };

  const addItemToOrder = async (item: Item) => {
    if (!currentOrder || item.is_outofstock) return;
    try {
      const { totals, lines } = await window.api.invoke('orders:addLine', currentOrder.id, item.id, 1);
      setOrderLines(lines);
      setCurrentOrder({ ...currentOrder, ...totals });
    } catch (error) {
      console.error('Failed to add item:', error);
    }
  };

  const filteredSubcategories = useMemo(() => {
    return subcategories.filter(sub => 
      !selectedCategoryId || sub.category_id === selectedCategoryId
    );
  }, [subcategories, selectedCategoryId]);

  useEffect(() => {
    loadItems();
  }, [searchQuery, selectedCategoryId, selectedSubcategoryId]);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      loadItems();
    }
  };

  const handleCategoryChange = (catId: string | null) => {
    setSelectedCategoryId(catId);
    setSelectedSubcategoryId(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className="border-b border-white/5 bg-slate-900/50 backdrop-blur-xl">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                POS System
              </h1>
              
              {/* Order Tabs */}
              <div className="flex items-center gap-2">
                {activeOrders.map(order => (
                  <button
                    key={order.id}
                    onClick={() => selectOrder(order.id)}
                    className={`px-4 py-2 rounded-xl font-medium transition-all ${
                      currentOrder?.id === order.id
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5'
                    }`}
                  >
                    <span className="text-xs opacity-70">{labelForType(order.order_type)}</span>
                    <span className="ml-2">#{order.number}</span>
                  </button>
                ))}
                <button
                  onClick={() => createNewOrder(2)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-medium transition-all flex items-center gap-2"
                >
                  <Plus size={16} />
                  New
                </button>
              </div>
            </div>

            {/* Order Type Selector */}
            {currentOrder && (
              <OrderTypePicker
                value={currentOrder.order_type}
                onChange={changeOrderType}
              />
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[1fr_400px] h-[calc(100vh-73px)]">
        {/* Left: Products */}
        <div className="flex flex-col p-6 overflow-hidden">
          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleSearch}
                placeholder="Search items, barcode, or Arabic name..."
                className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="mb-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <button
                onClick={() => handleCategoryChange(null)}
                className={`px-4 py-2 rounded-xl font-medium whitespace-nowrap transition-all ${
                  !selectedCategoryId
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5'
                }`}
              >
                All Categories
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryChange(cat.id)}
                  className={`px-4 py-2 rounded-xl font-medium whitespace-nowrap transition-all ${
                    selectedCategoryId === cat.id
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Subcategories */}
          {filteredSubcategories.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                <button
                  onClick={() => setSelectedSubcategoryId(null)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                    !selectedSubcategoryId
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  All
                </button>
                {filteredSubcategories.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setSelectedSubcategoryId(sub.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                      selectedSubcategoryId === sub.id
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {sub.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Products Grid */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-4 gap-4">
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => addItemToOrder(item)}
                  disabled={item.is_outofstock === 1 || !currentOrder}
                  className={`group relative p-4 rounded-2xl border transition-all text-left ${
                    item.is_outofstock === 1 || !currentOrder
                      ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 hover:scale-105'
                  }`}
                >
                  <div className="mb-3">
                    <div className="w-full h-32 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl mb-3 flex items-center justify-center border border-white/5">
                      <Package size={40} className="text-slate-600" />
                    </div>
                    <h3 className="font-semibold text-white mb-1 line-clamp-2">{item.name}</h3>
                    <p className="text-sm text-slate-400 line-clamp-1">{item.name_ar}</p>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 bg-white/5 px-2 py-1 rounded">
                      {item.barcode || '—'}
                    </span>
                    <span className="text-lg font-bold text-blue-400">
                      {item.price.toFixed(3)}
                    </span>
                  </div>

                  {item.is_outofstock === 1 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl">
                      <span className="text-red-400 font-semibold">Out of Stock</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
            
            {items.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <Package size={48} className="mb-4 opacity-50" />
                <p>No items found</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Cart */}
        <div className="bg-slate-900/50 backdrop-blur-xl border-l border-white/5 flex flex-col">
          {/* Cart Header */}
          <div className="p-6 border-b border-white/5">
            {currentOrder ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm text-slate-400">Order Number</div>
                    <div className="text-2xl font-bold text-white">#{currentOrder.number}</div>
                  </div>
                  <div className="px-4 py-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">
                    {labelForType(currentOrder.order_type)}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-slate-400 mb-3">No active order</p>
                <button
                  onClick={() => createNewOrder(2)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-medium transition-all"
                >
                  Create New Order
                </button>
              </div>
            )}
          </div>

          {/* Cart Items */}
          {currentOrder && (
            <>
              <div className="flex-1 overflow-y-auto p-6">
                {orderLines.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500">
                    <ShoppingCart size={48} className="mb-4 opacity-50" />
                    <p className="text-center">Cart is empty<br />Add items to get started</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orderLines.map(line => (
                      <OrderLineItem
                        key={line.id}
                        line={line}
                        orderId={currentOrder.id}
                        onUpdate={() => selectOrder(currentOrder.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Cart Footer */}
              <div className="p-6 border-t border-white/5 bg-slate-900/80">
                {/* Totals */}
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-slate-400">
                    <span>Subtotal</span>
                    <span className="font-medium">{(currentOrder.subtotal || 0).toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Discount</span>
                    <span className="font-medium">-{(currentOrder.discount_total || 0).toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Delivery Fee</span>
                    <span className="font-medium">{(currentOrder.delivery_fee || 0).toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between text-xl font-bold text-white pt-2 border-t border-white/10">
                    <span>Total</span>
                    <span className="text-blue-400">{(currentOrder.grand_total || 0).toFixed(3)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={async () => {
                      await window.api.invoke('orders:close', currentOrder.id);
                      await loadActiveOrders();
                    }}
                    className="px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all flex items-center justify-center gap-2 border border-white/10"
                  >
                    <Clock size={20} />
                    Hold
                  </button>
                  <button 
                    onClick={() => setShowCheckout(true)}
                    disabled={orderLines.length === 0}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check size={20} />
                    Checkout
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Checkout Modal */}
      {showCheckout && currentOrder && (
        <CheckoutModal
          order={currentOrder}
          onClose={() => setShowCheckout(false)}
          onComplete={async () => {
            setShowCheckout(false);
            await loadActiveOrders();
          }}
        />
      )}
    </div>
  );
}

function OrderLineItem({ line, orderId, onUpdate }: { line: OrderLine; orderId: string; onUpdate: () => void }) {
  const handleIncrease = async () => {
    try {
      await window.api.invoke('orders:addLine', orderId, line.item_id, 1);
      onUpdate();
    } catch (error) {
      console.error('Failed to increase quantity:', error);
    }
  };

  const handleDecrease = async () => {
    try {
      if (line.qty <= 1) {
        // Remove the line
        await window.api.invoke('orders:removeLine', line.id);
      } else {
        await window.api.invoke('orders:addLine', orderId, line.item_id, -1);
      }
      onUpdate();
    } catch (error) {
      console.error('Failed to decrease quantity:', error);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h4 className="font-semibold text-white mb-1">{line.name}</h4>
          <p className="text-sm text-blue-400 font-medium">
            {line.unit_price.toFixed(3)} × {line.qty}
          </p>
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleDecrease}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
          >
            <Minus size={16} />
          </button>
          <span className="w-12 text-center font-semibold text-white">{line.qty}</span>
          <button
            onClick={handleIncrease}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="text-xl font-bold text-white">
          {line.line_total.toFixed(3)}
        </div>
      </div>
    </div>
  );
}

function CheckoutModal({ order, onClose, onComplete }: { order: Order; onClose: () => void; onComplete: () => void }) {
  const [formData, setFormData] = useState({
    full_name: '',
    mobile: '',
    address: '',
    note: '',
    payment_method_id: '',
    payment_method_slug: 'cash'
  });
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);

  useEffect(() => {
    loadPaymentMethods();
  }, []);

  const loadPaymentMethods = async () => {
    try {
      const methods = await window.api.invoke('payments:listMethods');
      setPaymentMethods(methods || []);
      if (methods && methods.length > 0) {
        setFormData(prev => ({
          ...prev,
          payment_method_id: methods[0].id,
          payment_method_slug: methods[0].slug
        }));
      }
    } catch (error) {
      console.error('Failed to load payment methods:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await window.api.invoke('orders:createFromCart', formData);
      onComplete();
    } catch (error) {
      console.error('Failed to complete checkout:', error);
      alert('Failed to complete order. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Complete Order</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer Info */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              <User size={16} className="inline mr-2" />
              Customer Name *
            </label>
            <input
              type="text"
              required
              value={formData.full_name}
              onChange={e => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="Enter customer name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Mobile Number *
            </label>
            <input
              type="tel"
              required
              value={formData.mobile}
              onChange={e => setFormData({ ...formData, mobile: e.target.value })}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="Enter mobile number"
            />
          </div>

          {order.order_type === 1 && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <MapPin size={16} className="inline mr-2" />
                Delivery Address *
              </label>
              <textarea
                required
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                rows={3}
                placeholder="Enter delivery address"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Order Notes
            </label>
            <textarea
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
              rows={2}
              placeholder="Special instructions..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              <CreditCard size={16} className="inline mr-2" />
              Payment Method *
            </label>
            <select
              required
              value={formData.payment_method_id}
              onChange={e => {
                const method = paymentMethods.find(m => m.id === e.target.value);
                setFormData({
                  ...formData,
                  payment_method_id: e.target.value,
                  payment_method_slug: method?.slug || 'cash'
                });
              }}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              {paymentMethods.map(method => (
                <option key={method.id} value={method.id}>
                  {method.name_en}
                </option>
              ))}
            </select>
          </div>

          {/* Order Summary */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-slate-300">
              <span>Subtotal</span>
              <span>{order.subtotal.toFixed(3)}</span>
            </div>
            {order.delivery_fee > 0 && (
              <div className="flex justify-between text-slate-300">
                <span>Delivery Fee</span>
                <span>{order.delivery_fee.toFixed(3)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold text-white pt-2 border-t border-white/10">
              <span>Total</span>
              <span className="text-blue-400">{order.grand_total.toFixed(3)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all border border-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-medium transition-all shadow-lg shadow-green-500/20"
            >
              Complete Order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderTypePicker({ value, onChange }: { value: 1 | 2 | 3; onChange: (type: 1 | 2 | 3) => void }) {
  const types = [
    { k: 1 as const, label: 'Delivery', icon: '🚗' },
    { k: 2 as const, label: 'Pickup', icon: '🛍️' },
    { k: 3 as const, label: 'Dine-in', icon: '🍽️' }
  ];

  return (
    <div className="inline-flex rounded-xl bg-white/5 border border-white/10 p-1">
      {types.map(t => (
        <button
          key={t.k}
          type="button"
          onClick={() => onChange(t.k)}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            t.k === value
              ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <span className="mr-2">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function labelForType(type: 1 | 2 | 3): string {
  switch (type) {
    case 1: return 'Delivery';
    case 2: return 'Pickup';
    case 3: return 'Dine-in';
    default: return 'Order';
  }
}

// TypeScript declarations for Electron IPC
declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
  }
}
export default OrderProcessPage;