import React, { useState, useEffect } from 'react';
import { X, User, MapPin, CreditCard, Zap, Phone, Mail, UserCheck } from 'lucide-react';
import { useOrderContext } from '../context/OrderContext';
import { useTheme } from '../context/ThemeContext';
import { State, City, Block, Customer } from '../types';
import { Row } from '../lib/utils';

export function CheckoutModal() {
  const { theme } = useTheme();
  const { 
    currentOrder, 
    states, 
    cities, 
    blocks, 
    actions 
  } = useOrderContext();

  const [formData, setFormData] = useState({
    full_name: '', mobile: '', email: '', address: '', state_id: '',
    city_id: '', block_id: '', street: '', building: '', floor: '',
    note: '', payment_method_id: '', payment_method_slug: 'cash'
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
          mobile: posUser.mobile || '55555555',
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
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:complete', currentOrder.id, formData);
      actions.closeCheckout();
      await actions.loadActiveOrders(); // Refresh list after completion
    } catch (e) {
      alert('Failed to complete order');
      console.error(e);
    }
  };
  
  // Style shortcuts
  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';
  const label = theme === 'dark' ? 'text-slate-300' : 'text-gray-700';
  const focusRing = theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500';

  if (!currentOrder) return null;

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
            <button onClick={actions.closeCheckout} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
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
                className={`flex-1 px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${focusRing}`}
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
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${focusRing}`}
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
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${focusRing}`}
                placeholder="customer@email.com"
              />
            </div>
          </div>

          {currentOrder.order_type === 1 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>State *</label>
                  <select
                    required
                    value={formData.state_id}
                    onChange={e => {
                      setFormData({ ...formData, state_id: e.target.value, city_id: '', block_id: '' });
                      actions.loadCities(e.target.value);
                    }}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${focusRing}`}
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
                      actions.loadBlocks(e.target.value);
                    }}
                    disabled={!formData.state_id}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${focusRing} disabled:opacity-50`}
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
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${focusRing} disabled:opacity-50`}
                  >
                    <option value="">Select block</option>
                    {blocks.map((b: Block) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              {/* Other address fields */}
              <div>
                <label className={`block text-xs font-medium ${label} mb-1`}>
                  <MapPin size={14} className="inline mr-1" /> Full Address *
                </label>
                <textarea
                  required
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${focusRing} resize-none`}
                  rows={2}
                  placeholder="Complete address (e.g., St 1, Bldg 2, Fl 3)"
                />
              </div>
            </>
          )}

          <div>
            <label className={`block text-xs font-medium ${label} mb-1`}>Order Notes</label>
            <textarea
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
              className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${focusRing} resize-none`}
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
              className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} focus:outline-none focus:ring-2 ${focusRing}`}
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
            <Row label="Subtotal" value={currentOrder.subtotal.toFixed(3)} />
            {currentOrder.discount_total > 0 && (
              <Row label="Discount" value={`-${currentOrder.discount_total.toFixed(3)}`} />
            )}
            {currentOrder.order_type === 1 && (
              <Row label="Delivery Fee" value={currentOrder.delivery_fee.toFixed(3)} />
            )}
            <div className={`flex justify-between text-[15px] font-bold ${text} pt-2 border-t ${border}`}>
              <span>Total</span>
              <span className={theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}>
                {currentOrder.grand_total.toFixed(3)}
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={actions.closeCheckout}
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