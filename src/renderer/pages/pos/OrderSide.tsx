import React, { useMemo, useState, useEffect } from 'react';
import {
  ShoppingCart, Check, X, Percent, Trash2, Plus, Minus,
  UtensilsCrossed, Table2, UserCheck, Zap, Phone, Mail, MapPin, CreditCard, User, ChevronsUpDown, Search, Check as CheckIcon
} from 'lucide-react';
import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';

type OrderType = 1 | 2 | 3;
interface Order {
  id: string; number: string; order_type: OrderType; status: string;
  subtotal: number; discount_total: number; delivery_fee: number; grand_total: number; opened_at: number;
  table_id?: string | null; table_name?: string | null; covers?: number | null; promocode?: string;
}
interface OrderLine { id: string; order_id: string; item_id: string; name: string; qty: number; unit_price: number; line_total: number; }
type TableStatus = 'available' | 'occupied' | 'reserved';
interface TableInfo { id: string; name: string; seats: number; status: TableStatus; current_order_id?: string | null; }
interface State { id: string; name: string; name_ar: string; }
interface City { id: string; state_id: string; name: string; name_ar: string; delivery_fee: number; min_order: number; }
interface Block { id: string; city_id: string; name: string; name_ar: string; }
interface Promo { id: string; code: string; type: string; value: number; min_total: number; max_discount?: number; active?: number | boolean; }
interface Customer { full_name: string; mobile: string; email?: string; address?: string; }

declare global { interface Window { api: { invoke: (channel: string, ...args: any[]) => Promise<any>; } } }

/* ---------- Command palette select (cmdk + Radix Popover) ---------- */
function CommandSelect({
  theme = 'dark',
  label,
  value,
  onChange,
  options,
  placeholder = 'Search…',
  required,
  disabled,
}: {
  theme?: 'light'|'dark';
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: Array<{ id: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.id === value);

  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const labelCls = theme === 'dark' ? 'text-slate-300' : 'text-gray-700';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-300';
  const surface = theme === 'dark' ? 'bg-white/5' : 'bg-white';
  const hover = theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-100';

  return (
    <div>
      <label className={`block text-xs font-medium ${labelCls} mb-1`}>{label}{required ? ' *' : ''}</label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`w-full h-11 px-3 rounded-lg border ${border} ${surface} ${text} flex items-center justify-between text-sm disabled:opacity-50`}
          >
            <span className="truncate">
              {selected ? selected.label : `Select ${label.toLowerCase()}`}
            </span>
            <ChevronsUpDown size={16} className="opacity-60" />
          </button>
        </Popover.Trigger>

        <Popover.Content
          side="bottom"
          align="start"
          className={`w-[min(24rem,90vw)] p-2 mt-1 rounded-lg border ${border} ${surface} shadow-xl z-50`}
        >
          <Command label={`${label} search`} className={`max-h-72 overflow-auto rounded-md ${surface}`}>
            <div className={`flex items-center gap-2 px-2 py-2 rounded-md border ${border} ${surface} mb-2`}>
              <Search size={16} className="opacity-70" />
              <Command.Input
                autoFocus
                placeholder={placeholder}
                className={`w-full bg-transparent outline-none ${text} placeholder-gray-500`}
              />
            </div>

            <Command.List>
              <Command.Empty className="px-3 py-2 text-xs opacity-70">No results</Command.Empty>
              {options.map(o => (
                <Command.Item
                  key={o.id}
                  value={o.label}
                  onSelect={() => { onChange(o.id); setOpen(false); }}
                  className={`flex items-center justify-between px-3 py-3 rounded-md cursor-pointer text-sm ${hover}`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.id === value && <CheckIcon size={16} className="opacity-80" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}

export default function OrderSide({
  theme,
  currentOrder,
  orderLines,
  promos,
  states, cities, blocks,
  tables,
  onRefreshTables,
  onCreateOrder,
  onSelectOrder,
  onReloadActiveOrders,
  onApplyPromo,
  onRemovePromo,
  onLoadCities,
  onLoadBlocks,
}: {
  theme: 'light'|'dark';
  currentOrder: Order | null;
  orderLines: OrderLine[];
  promos: Promo[];
  states: State[];
  cities: City[];
  blocks: Block[];
  tables: TableInfo[];
  onRefreshTables: () => Promise<void>;
  onCreateOrder: () => void;
  onSelectOrder: (id: string) => Promise<void>;
  onReloadActiveOrders: () => Promise<void>;
  onApplyPromo: (code: string) => Promise<void>;
  onRemovePromo: () => Promise<void>;
  onLoadCities: (stateId: string) => Promise<void>;
  onLoadBlocks: (cityId: string) => Promise<void>;
}) {
  const [showCheckout, setShowCheckout] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showPromoDialog, setShowPromoDialog] = useState(false);

  const bg = theme === 'dark' ? 'bg-slate-900/60' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const cardBg = theme === 'dark' ? 'bg-white/5' : 'bg-gray-50';

  const handlePrint = async (orderId: string) => {
    try {
      await window.api.invoke('orders:print', orderId);
    } catch {
      try { await window.api.invoke('orders:markPrinted', orderId); } catch {}
    }
  };

  // After completing an order: reload list and focus next active (so completed one disappears)
  const focusNextActive = async () => {
    await onReloadActiveOrders();
    try {
      const next = await window.api.invoke('orders:listActive');
      if (next?.length) await onSelectOrder(next[0].id);
    } catch { /* no-op */ }
  };

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
                theme === 'dark' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                  : 'bg-blue-100 text-blue-700 border border-blue-300'
              }`}>
                {labelForType(currentOrder.order_type)}
              </div>
            </div>

            {/* Table controls (dine-in) */}
            {currentOrder.order_type === 3 && (
              <div className="flex items-center gap-2 mb-3">
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
                      theme === 'dark' ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                                       : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <UtensilsCrossed size={14} className="inline mr-1" /> Assign Table
                  </button>
                )}
                {currentOrder.table_id && (
                  <button
                    onClick={async () => {
                      try { await window.api.invoke('orders:clearTable', currentOrder.id); await onSelectOrder(currentOrder.id); await onRefreshTables(); } catch (e) { console.error(e); }
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-xs ${
                      theme === 'dark' ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                                       : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Promo section */}
            {currentOrder.promocode ? (
              <div className={`flex items-center justify-between p-2.5 rounded-lg border ${
                theme === 'dark' ? 'bg-green-500/10 border-green-500/30'
                                  : 'bg-green-50 border-green-300'
              }`}>
                <div className="flex items-center gap-2">
                  <Percent size={16} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                  <span className={`text-xs font-medium ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>
                    {currentOrder.promocode}
                  </span>
                </div>
                <button onClick={onRemovePromo}
                  className={`text-xs ${theme === 'dark' ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700'}`}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowPromoDialog(true)}
                className={`w-full py-2 rounded-lg border text-xs font-medium transition ${
                  theme === 'dark' ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
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
                theme === 'dark' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
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

            {/* Removed Hold. Only Print + Checkout */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => { await handlePrint(currentOrder.id); }}
                disabled={orderLines.length === 0}
                className={`px-3.5 py-2 rounded-lg text-sm border transition ${
                  theme === 'dark' ? 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                                   : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                Print
              </button>

              <button
                onClick={() => setShowCheckout(true)}
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

      {/* Modals */}
      {showCheckout && currentOrder && (
        <CheckoutModal
          theme={theme}
          order={currentOrder}
          states={states} cities={cities} blocks={blocks}
          promos={promos}
          onClose={() => setShowCheckout(false)}
          onApplyPromo={onApplyPromo}
          onAfterComplete={async () => {
            setShowCheckout(false);
            await focusNextActive(); // reload + focus next
          }}
          onLoadCities={onLoadCities}
          onLoadBlocks={onLoadBlocks}
          onPrintOrder={handlePrint}
        />
      )}

      {showTablePicker && currentOrder && currentOrder.order_type === 3 && (
        <TablePickerModal
          theme={theme}
          current={currentOrder}
          tables={tables}
          onClose={() => setShowTablePicker(false)}
          onRefresh={onRefreshTables}
          onAssign={async (t, covers) => {
            try {
              await window.api.invoke('orders:setTable', currentOrder.id, { table_id: t.id, covers });
              await onSelectOrder(currentOrder.id);
              await onRefreshTables();
              setShowTablePicker(false);
            } catch (e) { console.error(e); alert('Could not assign table'); }
          }}
        />
      )}

      {showPromoDialog && currentOrder && (
        <PromoDialog
          theme={theme}
          promos={promos}
          onClose={() => setShowPromoDialog(false)}
          onApply={async (code) => { await onApplyPromo(code); setShowPromoDialog(false); }}
        />
      )}
    </div>
  );
}

/* ---------- Reusable bits ---------- */
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
  switch (type) { case 1: return 'Delivery'; case 2: return 'Pickup'; case 3: return 'Dine-in'; default: return 'Order'; }
}

/* ---------- Order line item ---------- */
function OrderLineItem({ line, orderId, theme, onUpdate }: { line: OrderLine; orderId: string; theme: 'light'|'dark'; onUpdate: () => void; }) {
  const call = (ch: string, ...args: any[]) => window.api.invoke(ch, ...args);
  const setQty = async (nextQty: number) => {
    if (nextQty <= 0) {
      await call('orders:removeLine', line.id)
        .catch(() => call('orders:removeLineByItem', orderId, line.item_id))
        .catch(() => call('orders:addLine', orderId, line.item_id, -Number(line.qty || 0)));
    } else {
      await call('orders:setLineQty', line.id, nextQty)
        .catch(async () => {
          const delta = nextQty - Number(line.qty || 0);
          if (delta !== 0) await call('orders:addLine', orderId, line.item_id, delta);
        });
    }
    onUpdate();
  };
  const inc = async () => setQty(Number(line.qty || 0) + 1);
  const dec = async () => setQty(Math.max(0, Number(line.qty || 0) - 1));
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
          <p className={`text-xs ${price} font-medium`}>{line.unit_price.toFixed(3)} × {line.qty}</p>
        </div>
        <button onClick={remove} className={theme === 'dark' ? 'text-slate-400 hover:text-red-400' : 'text-gray-400 hover:text-red-500'} title="Remove">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button onClick={dec} disabled={line.qty <= 1}
            className={`w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
              theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`} title={line.qty <= 1 ? 'Use the trash to remove' : 'Decrease'}>
            <Minus size={14} />
          </button>
          <span className={`w-10 text-center font-semibold ${text}`}>{line.qty}</span>
          <button onClick={inc}
            className={`w-8 h-8 rounded-md flex items-center justify-center ${
              theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}>
            <Plus size={14} />
          </button>
        </div>
        <div className={`text-[15px] font-bold ${text}`}>{line.line_total.toFixed(3)}</div>
      </div>
    </div>
  );
}

/* ---------- Promo Dialog (blocks invalid codes) ---------- */
function PromoDialog({ promos, theme, onClose, onApply }: { promos: Promo[]; theme: 'light'|'dark'; onClose: () => void; onApply: (code: string) => Promise<void>; }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>('');

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';

  const isValidLocal = (c: string) => {
    const normalized = c.trim().toUpperCase();
    return promos.some(p => (p.active === true || p.active === 1) && p.code.toUpperCase() === normalized);
  };

  const apply = async (c: string) => {
    const normalized = (c || code).trim().toUpperCase();
    setErr('');
    if (!normalized) return;
    if (!isValidLocal(normalized)) {
      setErr('Invalid or inactive promo code.');
      return;
    }
    try {
      await onApply(normalized);
      onClose();
    } catch (e) {
      setErr('Could not apply this code.');
    }
  };

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
              onChange={e => { setErr(''); setCode(e.target.value.toUpperCase()); }}
              placeholder="Enter promo code"
              className={`w-full px-3 py-2.5 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
              }`}
            />
            {err && <div className="mt-1 text-xs text-rose-500">{err}</div>}
          </div>

          <button
            onClick={() => apply(code)}
            disabled={!code}
            className={`w-full px-4 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              theme === 'dark' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                               : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
            }`}
          >
            Apply Code
          </button>

          {promos && promos.length > 0 && (
            <div>
              <div className={`text-xs font-medium ${textMuted} mb-2 mt-4`}>Available Promo Codes:</div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {promos.filter((p: Promo) => !!p.active).map((promo: Promo) => (
                  <button key={promo.id} onClick={() => apply(promo.code)}
                    className={`w-full p-2.5 rounded-lg border text-left transition ${
                      theme === 'dark' ? 'bg-white/5 border-white/10 hover:bg-white/10'
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

/* ---------- Table Picker ---------- */
function TablePickerModal({ tables, current, theme, onClose, onAssign, onRefresh }:{
  tables: TableInfo[]; current: Order; theme: 'light'|'dark';
  onClose: () => void; onAssign: (t: TableInfo, covers: number) => void; onRefresh: () => void;
}) {
  const [covers, setCovers] = useState<number>(current.covers || 2);
  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';

  const colorFor = (s: TableStatus) => {
    if (s === 'available') return theme === 'dark' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-600/30' : 'bg-emerald-100 text-emerald-700 border-emerald-300';
    if (s === 'reserved') return theme === 'dark' ? 'bg-amber-500/15 text-amber-300 border-amber-600/30'     : 'bg-amber-100 text-amber-700 border-amber-300';
    return theme === 'dark' ? 'bg-rose-500/15 text-rose-300 border-rose-600/30' : 'bg-rose-100 text-rose-700 border-rose-300';
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${bg} border ${border} rounded-xl w-full max-w-3xl p-4 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-xl font-bold ${text}`}>Assign Table</h2>
          <div className="flex items-center gap-2">
            <label className={`text-xs ${textMuted}`}>Covers</label>
            <input type="number" min={1} className={`w-16 px-2 py-1.5 ${inputBg} rounded-md ${text}`}
              value={covers} onChange={e => setCovers(Math.max(1, Number(e.target.value || 1)))} />
            <button onClick={onRefresh}
              className={`px-3 py-1.5 rounded-md border text-xs ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                                                                                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'}`}>
              Refresh
            </button>
            <button onClick={onClose} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
              <X size={22} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {tables.map((t) => (
            <button key={t.id} onClick={() => t.status === 'available' ? onAssign(t, covers) : null}
              disabled={t.status !== 'available'}
              className={`p-3 rounded-lg border text-left transition ${colorFor(t.status)} ${t.status !== 'available' ? 'opacity-70 cursor-not-allowed' : 'hover:brightness-110'}`}
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

/* ---------- Checkout Modal (cmdk selects, radio payments, live fee, print & clear) ---------- */
function CheckoutModal({
  order, states, cities, blocks, theme, onClose, onApplyPromo, promos, onAfterComplete, onLoadCities, onLoadBlocks, onPrintOrder,
}: {
  order: Order; states: State[]; cities: City[]; blocks: Block[];
  theme: 'light'|'dark'; onClose: () => void;
  onApplyPromo: (code: string) => Promise<void>;
  promos: Promo[];
  onAfterComplete: () => Promise<void>;
  onLoadCities: (stateId: string) => Promise<void>;
  onLoadBlocks: (cityId: string) => Promise<void>;
  onPrintOrder: (orderId: string) => Promise<void>;
}) {
  const [formData, setFormData] = useState({
    full_name: '', mobile: '', email: '', address: '',
    state_id: '', city_id: '', block_id: '',
    street: '', building: '', floor: '', note: '',
    payment_method_id: '', payment_method_slug: 'cash'
  });
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [useQuickMode, setUseQuickMode] = useState(false);
  const [customerLookup, setCustomerLookup] = useState<Customer | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Local fallback lists (if props are empty)
  const [localStates, setLocalStates] = useState<State[]>(states || []);
  const [localCities, setLocalCities] = useState<City[]>(cities || []);
  const [localBlocks, setLocalBlocks] = useState<Block[]>(blocks || []);

  useEffect(() => { if (states?.length) setLocalStates(states); }, [states]);
  useEffect(() => { if (cities?.length) setLocalCities(cities); }, [cities]);
  useEffect(() => { if (blocks?.length) setLocalBlocks(blocks); }, [blocks]);

  // Fallback fetchers
  useEffect(() => {
    (async () => {
      if (!localStates.length) {
        try { const s = await window.api.invoke('geo:listStates'); setLocalStates(s || []); } catch {}
      }
    })();
  }, [localStates.length]);

  const selectedState = useMemo(() => localStates.find((s) => s.id === formData.state_id), [localStates, formData.state_id]);
  const selectedCity  = useMemo(() => localCities.find((c) => c.id === formData.city_id), [localCities, formData.city_id]);
  const selectedBlock = useMemo(() => localBlocks.find((b) => b.id === formData.block_id), [localBlocks, formData.block_id]);

  // Live delivery fee as soon as city picked (fallback to order.delivery_fee)
  const [displayDeliveryFee, setDisplayDeliveryFee] = useState<number>(order.order_type === 1 ? (order.delivery_fee || 0) : 0);
  useEffect(() => {
    if (order.order_type !== 1) return;
    const fee = Number(selectedCity?.delivery_fee ?? order.delivery_fee ?? 0);
    setDisplayDeliveryFee(isFinite(fee) ? fee : 0);
  }, [order.order_type, order.delivery_fee, selectedCity]);

  useEffect(() => {
    (async () => {
      const methods = await window.api.invoke('payments:listMethods');
      setPaymentMethods(methods || []);
      if (methods?.length) {
        setFormData(p => ({ ...p, payment_method_id: String(methods[0].id), payment_method_slug: methods[0].slug || 'cash' }));
      }
    })();
  }, []);

  const searchCustomer = async (mobile: string) => {
    if (mobile.length < 8) return;
    setIsSearching(true);
    try {
      const customer = await window.api.invoke?.('customers:findByMobile', mobile);
      if (customer) {
        setCustomerLookup(customer);
        setFormData(p => ({ ...p, full_name: customer.full_name || '', email: customer.email || '', address: customer.address || '' }));
      } else setCustomerLookup(null);
    } catch (e) { console.error(e); }
    setIsSearching(false);
  };

  const handleQuickMode = async () => {
    try {
      const posUser = await window.api.invoke('settings:getPosUser');
      if (posUser) {
        setFormData(p => ({ ...p, full_name: posUser.name || 'POS User', mobile: posUser.mobile || '00000000', email: posUser.email || '' }));
        setUseQuickMode(true);
      }
    } catch (e) { console.error(e); }
  };

  const makeAddress = () => {
    if (order.order_type !== 1) return (formData.address || '').trim();
    const parts = [
      formData.address,
      formData.street && `St: ${formData.street}`,
      formData.building && `Bldg: ${formData.building}`,
      formData.floor && `Floor: ${formData.floor}`
    ].filter(Boolean);
    return parts.join(', ');
  };
  const computeDisplayTotals = () => {
    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discount_total || 0);
    const delivery = Number(order.order_type === 1 ? displayDeliveryFee : 0);
    const grand = Math.max(0, subtotal - discount + delivery);
    return { subtotal, discount, delivery, grand_total: grand };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (order?.order_type === 1) {
        try { await window.api.invoke('cart:setContext', { order_type: 1, city_id: selectedCity?.id ?? null }); } catch {}
      }
      const payload = {
        full_name: (formData.full_name || '').trim(),
        mobile: (formData.mobile || '').trim(),
        address: makeAddress(),
        note: formData.note || null,
        payment_method_id: String(formData.payment_method_id ?? ''),
        payment_method_slug: String(formData.payment_method_slug ?? ''),
        state_id: selectedState?.id ?? null,
        city_id: selectedCity?.id ?? null,
        block_id: selectedBlock?.id ?? null,
      };
      if (!payload.payment_method_id || !payload.payment_method_slug) throw new Error('Please select a payment method.');

      const result = await window.api.invoke('orders:complete', order.id, payload);

      // Print after complete
      await onPrintOrder(order.id);

      // If link/myfatoorah, try creating a payment link
      if (payload.payment_method_slug === 'link' || payload.payment_method_slug === 'myfatoorah') {
        try {
          const amount = result?.order?.grand_total ?? computeDisplayTotals().grand_total;
          const pay = await window.api.invoke?.('payments:createLink', order.id, amount);
          const payUrl = pay?.url || pay?.payment_url || pay?.redirect_url;
          if (payUrl) await window.api.invoke('orders:paymentLink:set', order.id, payUrl);
        } catch {}
      }

      // Close modal + remove order from view (reload + focus next)
      await onAfterComplete();
    } catch (err) {
      console.error(err); alert((err as Error).message || 'Failed to complete order');
    }
  };

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';
  const label = theme === 'dark' ? 'text-slate-300' : 'text-gray-700';

  // Promo quick apply
  const [showPromo, setShowPromo] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${bg} border ${border} rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto`}>
        <div className={`sticky top-0 ${bg} border-b ${border} p-4 flex items-center justify-between`}>
          <h2 className={`text-xl font-bold ${text}`}>Complete Order</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowPromo(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                theme === 'dark' ? 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                                 : 'bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200'
              }`}>
              <Percent size={14}/> Promo
            </button>
            <button type="button" onClick={handleQuickMode}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                useQuickMode
                  ? theme === 'dark' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                     : 'bg-amber-100 text-amber-700 border-amber-300'
                  : theme === 'dark' ? 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                                     : 'bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200'
              }`}>
              <Zap size={14} /> {useQuickMode ? 'Quick Mode ON' : 'Quick Mode'}
            </button>
            <button onClick={onClose} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
              <X size={22} />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="p-4 space-y-3">
          {/* Customer lookup */}
          <div className={`p-3 rounded-lg border ${theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-300'}`}>
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
              <div className={`mt-2 flex items-center gap-2 text-xs ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>
                <UserCheck size={14} /><span>Found: {customerLookup.full_name}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs font-medium ${label} mb-1`}><span className="inline-flex items-center"><User size={14} className="mr-1" /> Customer Name *</span></label>
              <input required value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                }`} placeholder="Full name" />
            </div>
            <div>
              <label className={`block text-xs font-medium ${label} mb-1`}><span className="inline-flex items-center"><Mail size={14} className="mr-1" /> Email</span></label>
              <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
                }`} placeholder="customer@email.com" />
            </div>
          </div>

          {order.order_type === 1 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <CommandSelect
                  theme={theme}
                  label="State"
                  required
                  value={formData.state_id}
                  onChange={async (id) => {
                    setFormData({ ...formData, state_id: id, city_id: '', block_id: '' });
                    try { await onLoadCities(id); } catch {}
                    try {
                      const cs = await window.api.invoke('geo:listCities', id);
                      setLocalCities(cs || []);
                    } catch {}
                  }}
                  options={localStates.map(s => ({ id: s.id, label: s.name }))}
                />
                <CommandSelect
                  theme={theme}
                  label="City"
                  required
                  value={formData.city_id}
                  disabled={!formData.state_id}
                  onChange={async (id) => {
                    setFormData({ ...formData, city_id: id, block_id: '' });
                    try { await onLoadBlocks(id); } catch {}
                    try { const bs = await window.api.invoke('geo:listBlocks', id); setLocalBlocks(bs || []); } catch {}
                    try { await window.api.invoke('cart:setContext', { order_type: 1, city_id: id }); } catch {}
                  }}
                  options={localCities.map(c => ({ id: c.id, label: c.name }))}
                />
                <CommandSelect
                  theme={theme}
                  label="Block"
                  required
                  value={formData.block_id}
                  disabled={!formData.city_id}
                  onChange={(id) => setFormData({ ...formData, block_id: id })}
                  options={localBlocks.map(b => ({ id: b.id, label: b.name }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>Street</label>
                  <input value={formData.street} onChange={e => setFormData({ ...formData, street: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'}`}
                    placeholder="Street name" />
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>Building</label>
                  <input value={formData.building} onChange={e => setFormData({ ...formData, building: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'}`}
                    placeholder="Building no." />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>Floor</label>
                  <input value={formData.floor} onChange={e => setFormData({ ...formData, floor: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'}`}
                    placeholder="Floor number" />
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}><span className="inline-flex items-center"><MapPin size={14} className="mr-1" /> Full Address</span></label>
                  <textarea value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'} resize-none`} rows={2}
                    placeholder="Complete address (optional)" />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={`block text-xs font-medium ${label} mb-1`}>Order Notes</label>
            <textarea value={formData.note} onChange={e => setFormData({ ...formData, note: e.target.value })}
              className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'} resize-none`} rows={2}
              placeholder="Special instructions…" />
          </div>

          {/* Payment Methods (radio) */}
          <div>
            <label className={`block text-xs font-medium ${label} mb-1`}><span className="inline-flex items-center"><CreditCard size={14} className="mr-1" /> Payment Method *</span></label>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.map((m: any) => {
                const checked = String(m.id) === String(formData.payment_method_id);
                return (
                  <label key={m.id}
                         className={`cursor-pointer rounded-lg border p-3 flex items-center gap-2 ${
                           checked
                             ? (theme === 'dark' ? 'border-blue-400 bg-blue-500/10' : 'border-blue-500 bg-blue-50')
                             : (theme === 'dark' ? 'border-white/10 bg-white/5 hover:bg-white/10' : 'border-gray-300 bg-white hover:bg-gray-50')
                         }`}>
                    <input
                      type="radio"
                      name="payment_method"
                      className="accent-blue-600"
                      checked={checked}
                      onChange={() => setFormData({ ...formData, payment_method_id: String(m.id), payment_method_slug: m.slug || 'cash' })}
                      required
                    />
                    <span className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>{m.name_en}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Summary (uses live displayDeliveryFee) */}
          <div className={`p-3 rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'} space-y-1.5`}>
            <Row label="Subtotal" value={computeDisplayTotals().subtotal.toFixed(3)} theme={theme} />
            {computeDisplayTotals().discount > 0 && <Row label="Discount" value={`-${computeDisplayTotals().discount.toFixed(3)}`} theme={theme} />}
            {order.order_type === 1 && <Row label="Delivery Fee" value={computeDisplayTotals().delivery.toFixed(3)} theme={theme} />}
            <div className={`flex justify-between text-[15px] font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'} pt-2 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
              <span>Total</span>
              <span className={theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}>{computeDisplayTotals().grand_total.toFixed(3)}</span>
            </div>
            {order.order_type === 1 && selectedCity?.min_order > 0 && (
              <div className={`text-xs ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
                Min order for {selectedCity?.name}: {Number(selectedCity?.min_order).toFixed(3)} KWD
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className={`flex-1 px-4 py-2.5 rounded-lg border font-medium ${theme === 'dark' ? 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                                                                                                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}>
              Cancel
            </button>
            <button type="submit"
              className={`flex-1 px-4 py-2.5 rounded-lg font-medium ${theme === 'dark' ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                                                                                         : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white'}`}>
              Complete Order
            </button>
          </div>
        </form>
      </div>

      {showPromo && (
        <PromoDialog
          theme={theme}
          promos={promos}
          onClose={() => setShowPromo(false)}
          onApply={onApplyPromo}
        />
      )}
    </div>
  );
}
