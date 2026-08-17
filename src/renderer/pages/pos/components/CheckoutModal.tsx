// components/CheckoutModal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Percent,
  Zap,
  Phone,
  UserCheck,
  User,
  Mail,
  MapPin,
  CreditCard,
} from 'lucide-react';
import { Order, State, City, Block, Promo, Customer } from '../types';
import { CommandSelect } from './CommandSelect';
import { PromoDialog } from './PromoDialog';
import { PaymentLinkModal } from './PaymentLinkModal';
import { useToast } from '../../../components/ToastProvider'; // adjust path if needed
import { useI18n } from '../../../i18n';
import { DeliveryFeeRow } from './DeliveryFeeRow';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

function Row({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: 'light' | 'dark';
}) {
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';

  return (
    <div className={`flex justify-between ${textMuted}`}>
      <span>{label}</span>
      {/* .money forces LTR digit order so "12.500" never mirrors in Arabic. */}
      <span className='font-medium money'>{value}</span>
    </div>
  );
}

export function CheckoutModal({
  order,
  states,
  cities,
  blocks,
  theme,
  onClose,
  onApplyPromo,
  promos,
  onAfterComplete,
  onLoadCities,
  onLoadBlocks,
  onPrintOrder,
}: {
  order: Order;
  states: State[];
  cities: City[];
  blocks: Block[];
  theme: 'light' | 'dark';
  onClose: () => void;
  onApplyPromo: (code: string) => Promise<void>;
  promos: Promo[];
  onAfterComplete: () => Promise<void>;
  onLoadCities: (stateId: string) => Promise<void>;
  onLoadBlocks: (cityId: string) => Promise<void>;
  onPrintOrder: (orderId: string) => Promise<void>;
}) {
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
    payment_method_slug: 'cash',
  });
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [useQuickMode, setUseQuickMode] = useState(false);
  const [customerLookup, setCustomerLookup] = useState<Customer | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  // A ref, not the state: submit needs to know within the same tick whether a
  // link was created, and setState has not committed by then.
  const pendingPayLinkRef = React.useRef(false);
  const [payLink, setPayLink] = useState<{
    url: string;
    amount: number;
    mobile: string | null;
    orderId: string;
    orderNumber: string | null;
  } | null>(null);

  // Local fallback lists (if props are empty)
  const [localStates, setLocalStates] = useState<State[]>(states || []);
  const [localCities, setLocalCities] = useState<City[]>(cities || []);
  const [localBlocks, setLocalBlocks] = useState<Block[]>(blocks || []);
  const toast = useToast();
  const { t, name: localName, money } = useI18n();
  useEffect(() => {
    if (states?.length) setLocalStates(states);
  }, [states]);
  useEffect(() => {
    if (cities?.length) setLocalCities(cities);
  }, [cities]);
  useEffect(() => {
    if (blocks?.length) setLocalBlocks(blocks);
  }, [blocks]);

  // Fallback fetchers
  useEffect(() => {
    (async () => {
      if (!localStates.length) {
        try {
          const s = await window.api.invoke('geo:listStates');
          setLocalStates(s || []);
        } catch {}
      }
    })();
  }, [localStates.length]);

  const selectedState = useMemo(
    () => localStates.find((s) => s.id === formData.state_id),
    [localStates, formData.state_id]
  );
  const selectedCity = useMemo(
    () => localCities.find((c) => c.id === formData.city_id),
    [localCities, formData.city_id]
  );
  const selectedBlock = useMemo(
    () => localBlocks.find((b) => b.id === formData.block_id),
    [localBlocks, formData.block_id]
  );

  // Live delivery fee as soon as city picked (fallback to order.delivery_fee)
  const [displayDeliveryFee, setDisplayDeliveryFee] = useState<number>(
    order.order_type === 1 ? order.delivery_fee || 0 : 0
  );
  // A hand-entered or waived fee is the cashier's decision and must survive
  // picking an area — otherwise choosing the city silently overwrites it.
  const feeOverridden =
    Number((order as any).delivery_fee_manual) === 1 ||
    Number((order as any).void_delivery_fee) === 1;

  useEffect(() => {
    if (order.order_type !== 1) return;
    if (feeOverridden) {
      setDisplayDeliveryFee(Number(order.delivery_fee ?? 0));
      return;
    }
    const fee = Number(selectedCity?.delivery_fee ?? order.delivery_fee ?? 0);
    setDisplayDeliveryFee(isFinite(fee) ? fee : 0);
  }, [order.order_type, order.delivery_fee, selectedCity, feeOverridden]);

  useEffect(() => {
    (async () => {
      const methods = await window.api.invoke('payments:listMethods');
      setPaymentMethods(methods || []);
      if (methods?.length) {
        setFormData((p) => ({
          ...p,
          payment_method_id: String(methods[0].id),
          payment_method_slug: methods[0].slug || 'cash',
        }));
      }
    })();
  }, []);

  const searchCustomer = async (mobile: string) => {
    if (mobile.length < 8) return;
    setIsSearching(true);
    try {
      const customer = await window.api.invoke?.(
        'customers:findByMobile',
        mobile
      );
      if (customer) {
        setCustomerLookup(customer);
        setFormData((p) => ({
          ...p,
          full_name: customer.full_name || '',
          email: customer.email || '',
          address: customer.address || '',
        }));
      } else setCustomerLookup(null);
    } catch (e) {
      console.error(e);
    }
    setIsSearching(false);
  };

  const handleQuickMode = async () => {
    // Toggle OFF → clear quick-mode fields
    if (useQuickMode) {
      setUseQuickMode(false);
      setFormData((p) => ({
        ...p,
        full_name: '',
        mobile: '',
        email: '',
      }));
      setCustomerLookup(null);
      return;
    }

    // Toggle ON → prefill from POS user
    try {
      const posUser = await window.api.invoke('settings:getPosUser');
      if (posUser) {
        setFormData((p) => ({
          ...p,
          full_name: posUser.name || 'POS User',
          mobile: posUser.mobile || '55555555',
          email: posUser.email || '',
        }));
        setCustomerLookup(null); // override any previous lookup label
        setUseQuickMode(true);
      }
    } catch (e) {
      console.error(e);
    }
  };
  const makeAddress = () => {
    // For pickup / dine-in, just use the raw address field (optional)
    if (order.order_type !== 1) {
      return (formData.address || '').trim();
    }

    // For delivery, build a composite address from dropdowns + fields
    const parts: string[] = [];

    // State / City / Block names
    if (selectedState?.name) parts.push(selectedState.name);
    if (selectedCity?.name) parts.push(selectedCity.name);
    if (selectedBlock?.name) parts.push(selectedBlock.name);

    // Extra details
    if (formData.street) parts.push(`St: ${formData.street}`);
    if (formData.building) parts.push(`Bldg: ${formData.building}`);
    if (formData.floor) parts.push(`Floor: ${formData.floor}`);
    if (formData.address) parts.push(formData.address);

    return parts.join(', ').trim();
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
      const address = makeAddress();

      // Basic validation for delivery
      if (order.order_type === 1) {
        if (!selectedState?.id || !selectedCity?.id || !selectedBlock?.id) {
          throw new Error(t('checkout.errGeo'));
        }
        if (!address.trim()) {
          throw new Error(t('checkout.errAddress'));
        }
      }

      // Compute totals once (for payment link)
      const totals = computeDisplayTotals();

      const payload = {
        full_name: (formData.full_name || '').trim(),
        mobile: (formData.mobile || '').trim(),
        address,
        note: formData.note || null,
        payment_method_id: String(formData.payment_method_id ?? ''),
        payment_method_slug: String(formData.payment_method_slug ?? ''),
        state_id: selectedState?.id ?? null,
        city_id: selectedCity?.id ?? null,
        block_id: selectedBlock?.id ?? null,
      };

      if (!payload.payment_method_id || !payload.payment_method_slug) {
        throw new Error(t('checkout.errPayment'));
      }

      // Complete order on server
      const result = await window.api.invoke(
        'orders:complete',
        order.id,
        payload
      );

      const isOnlinePayment = (slug?: string | null) => {
        const s = (slug ?? '').toLowerCase();
        return [
          'link',
          'myfatoorah',
          'online',
          'online_knet',
          'online_card',
          'mf_online',
        ].includes(s);
      };

      // If online method → create payment link
      if (isOnlinePayment(formData.payment_method_slug)) {
        try {
          const linkPayload = {
            external_order_id: String(order.id),
            order_number: order.number ?? null,
            amount: totals.grand_total, // 👈 use computed totals
            currency: 'KWD',
            customer: {
              name: (formData.full_name || '').trim() || null,
              mobile: (formData.mobile || '').trim() || null,
              email: formData.email?.trim() || null,
            },
          };

          const pay: any = await window.api.invoke(
            'payments:createLink',
            linkPayload
          );

          const url =
            pay?.url || pay?.invoice_url || pay?.PaymentURL || pay?.redirectUrl;

          if (url) {
            // Do NOT open this on the till. Persist it, then hand it to the
            // customer via QR / WhatsApp in PaymentLinkModal.
            try {
              await window.api.invoke('orders:paymentLink:set', order.id, url);
            } catch (e) {
              console.error('orders:paymentLink:set failed', e);
            }
            pendingPayLinkRef.current = true;
            setPayLink({
              url,
              amount: totals.grand_total,
              mobile: (formData.mobile || '').trim() || null,
              orderId: String(order.id),
              orderNumber: order.number ?? null,
            });
          } else {
            toast({
              tone: 'danger',
              title: t('checkout.payLinkNoUrl'),
              message: t('common.checkConn'),
            });
          }
        } catch (err) {
          console.error('payments:createLink failed', err);
          toast({
            tone: 'danger',
            title: t('checkout.payLinkFailed'),
            message: t('common.checkConn'),
          });
        }
      }

      // Print after complete. Deliberately not awaited into the same failure
      // path: closing the Windows print dialog used to unwind submit, which
      // dismissed the payment QR along with it — the cashier lost the code the
      // customer was about to scan.
      onPrintOrder(order.id).catch((e) =>
        console.error('[CheckoutModal] print after complete failed', e)
      );

      // Clear table on dine-in
      if (order.order_type === 3 && order.table_id) {
        try {
          await window.api.invoke('orders:clearTable', order.id);
          console.log(
            `[CheckoutModal] Explicitly cleared table for completed order ${order.id}`
          );
        } catch (e) {
          console.warn(
            `[CheckoutModal] Failed to clear table for completed order ${order.id}`,
            e
          );
        }
      }

      // With a QR on screen the modal owns teardown; running onAfterComplete
      // here would close the checkout and take the QR with it.
      if (!pendingPayLinkRef.current) {
        await onAfterComplete();
      }
    } catch (err) {
      console.error(err);

      const message =
        (err as any)?.message || t('checkout.completeFailedMsg');

      toast({
        tone: 'danger',
        title: t('checkout.completeFailed'),
        message,
      });
    }
  };

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg =
    theme === 'dark'
      ? 'bg-white/5 border-white/10'
      : 'bg-white border-gray-300';
  const label = theme === 'dark' ? 'text-slate-300' : 'text-gray-700';

  // Promo quick apply
  const [showPromo, setShowPromo] = useState(false);

  return (
    <div className='fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4'>
      <div
        className={`${bg} border ${border} rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto`}
      >
        <div
          className={`sticky top-0 ${bg} border-b ${border} p-4 flex items-center justify-between`}
        >
          <h2 className={`text-xl font-bold ${text}`}>{t('checkout.title')}</h2>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setShowPromo(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                theme === 'dark'
                  ? 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                  : 'bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Percent size={14} /> {t('promo.short')}
            </button>
            <button
              type='button'
              onClick={handleQuickMode}
              className={`
                h-8 px-2.5 rounded-md text-[11px] font-semibold
                flex items-center gap-1 border transition-colors
                ${
                  useQuickMode
                    ? theme === 'dark'
                      ? 'bg-amber-500/20 text-amber-200 border-amber-400/60'
                      : 'bg-amber-50 text-amber-700 border-amber-300'
                    : theme === 'dark'
                    ? 'bg-transparent text-slate-300 border-white/15 hover:bg-white/5'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }
              `}
            >
              <Zap size={13} className={useQuickMode ? '' : 'opacity-70'} />
              <span>
                {useQuickMode
                  ? t('checkout.quickModeOn')
                  : t('checkout.quickMode')}
              </span>
            </button>

            <button
              onClick={onClose}
              className={
                theme === 'dark'
                  ? 'text-slate-400 hover:text-white'
                  : 'text-gray-400 hover:text-gray-900'
              }
            >
              <X size={22} />
            </button>
          </div>
        </div>

        <form
          onSubmit={submit}
          // Enter inside any field used to implicitly submit the form, which
          // placed the order while the cashier was still filling in customer
          // details. Placing an order must be a deliberate click on the button
          // (or Enter while that button itself is focused).
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const el = e.target as HTMLElement | null;
            const tag = el?.tagName;
            // Textareas keep Enter for newlines; buttons keep it for activation.
            if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
            e.preventDefault();
          }}
          className='p-4 pt-4 pb-6 space-y-3'
        >
          {/* Customer lookup */}
          <div
            className={`p-3 rounded-lg border ${
              theme === 'dark'
                ? 'bg-blue-500/10 border-blue-500/30'
                : 'bg-blue-50 border-blue-300'
            }`}
          >
            <label className={`block text-xs font-medium ${label} mb-1.5`}>
              <Phone size={14} className='inline me-1' />{' '}
              {t('checkout.mobileLookup')}
            </label>
            <div className='flex gap-3 pt-3 pb-1'>
              <input
                value={formData.mobile}
                onChange={(e) => {
                  setFormData({ ...formData, mobile: e.target.value });
                  if (e.target.value.length >= 8)
                    searchCustomer(e.target.value);
                }}
                className={`flex-1 px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark'
                    ? 'focus:ring-blue-500/40'
                    : 'focus:ring-blue-500'
                }`}
                placeholder={t('checkout.mobilePlaceholder')}
              />
              {isSearching && (
                <div className={`px-3 py-2 ${textMuted} text-xs`}>
                  {t('checkout.searching')}
                </div>
              )}
            </div>
            {customerLookup && (
              <div
                className={`mt-2 flex items-center gap-2 text-xs ${
                  theme === 'dark' ? 'text-green-300' : 'text-green-700'
                }`}
              >
                <UserCheck size={14} />
                <span>
                  {t('checkout.found')} {customerLookup.full_name}
                </span>
              </div>
            )}
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className={`block text-xs font-medium ${label} mb-1`}>
                <span className='inline-flex items-center'>
                  <User size={14} className='me-1' />{' '}
                  {t('checkout.customerName')} *
                </span>
              </label>
              <input
                required
                value={formData.full_name}
                onChange={(e) =>
                  setFormData({ ...formData, full_name: e.target.value })
                }
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark'
                    ? 'focus:ring-blue-500/40'
                    : 'focus:ring-blue-500'
                }`}
                placeholder={t('checkout.fullNamePlaceholder')}
              />
            </div>
            <div>
              <label className={`block text-xs font-medium ${label} mb-1`}>
                <span className='inline-flex items-center'>
                  <Mail size={14} className='me-1' /> {t('checkout.email')}
                </span>
              </label>
              <input
                type='email'
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  theme === 'dark'
                    ? 'focus:ring-blue-500/40'
                    : 'focus:ring-blue-500'
                }`}
                placeholder='customer@email.com'
              />
            </div>
          </div>

          {order.order_type === 1 && (
            <>
              <div className='grid grid-cols-3 gap-3'>
                <CommandSelect
                  theme={theme}
                  label={t('checkout.state')}
                  required
                  value={formData.state_id}
                  onChange={async (id) => {
                    setFormData({
                      ...formData,
                      state_id: id,
                      city_id: '',
                      block_id: '',
                    });
                    try {
                      await onLoadCities(id);
                    } catch {}
                    try {
                      const cs = await window.api.invoke('geo:listCities', id);
                      setLocalCities(cs || []);
                    } catch {}
                  }}
                  options={localStates.map((s) => ({
                    id: s.id,
                    label: localName(s),
                  }))}
                />
                <CommandSelect
                  theme={theme}
                  label={t('checkout.city')}
                  required
                  value={formData.city_id}
                  disabled={!formData.state_id}
                  onChange={async (id) => {
                    setFormData({ ...formData, city_id: id, block_id: '' });
                    try {
                      await onLoadBlocks(id);
                    } catch {}
                    try {
                      const bs = await window.api.invoke('geo:listBlocks', id);
                      setLocalBlocks(bs || []);
                    } catch {}
                  }}
                  options={localCities.map((c) => ({
                    id: c.id,
                    label: localName(c),
                  }))}
                />
                <CommandSelect
                  theme={theme}
                  label={t('cust.block')}
                  required
                  value={formData.block_id}
                  disabled={!formData.city_id}
                  onChange={(id) => setFormData({ ...formData, block_id: id })}
                  options={localBlocks.map((b) => ({
                    id: b.id,
                    label: localName(b),
                  }))}
                />
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>
                    {t('cust.street')}
                  </label>
                  <input
                    value={formData.street}
                    onChange={(e) =>
                      setFormData({ ...formData, street: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark'
                        ? 'focus:ring-blue-500/40'
                        : 'focus:ring-blue-500'
                    }`}
                    placeholder={t('checkout.streetPlaceholder')}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>
                    {t('cust.building')}
                  </label>
                  <input
                    value={formData.building}
                    onChange={(e) =>
                      setFormData({ ...formData, building: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark'
                        ? 'focus:ring-blue-500/40'
                        : 'focus:ring-blue-500'
                    }`}
                    placeholder={t('checkout.buildingPlaceholder')}
                  />
                </div>
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>
                    {t('cust.floor')}
                  </label>
                  <input
                    value={formData.floor}
                    onChange={(e) =>
                      setFormData({ ...formData, floor: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark'
                        ? 'focus:ring-blue-500/40'
                        : 'focus:ring-blue-500'
                    }`}
                    placeholder={t('checkout.floorPlaceholder')}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>
                    <span className='inline-flex items-center'>
                      <MapPin size={14} className='me-1' />{' '}
                      {t('checkout.fullAddress')}
                    </span>
                  </label>
                  <textarea
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                      theme === 'dark'
                        ? 'focus:ring-blue-500/40'
                        : 'focus:ring-blue-500'
                    } resize-none`}
                    rows={2}
                    placeholder={t('checkout.addressPlaceholder')}
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={`block text-xs font-medium ${label} mb-1`}>
              {t('checkout.notes')}
            </label>
            <textarea
              value={formData.note}
              onChange={(e) =>
                setFormData({ ...formData, note: e.target.value })
              }
              className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                theme === 'dark'
                  ? 'focus:ring-blue-500/40'
                  : 'focus:ring-blue-500'
              } resize-none`}
              rows={2}
              placeholder={t('checkout.notesPlaceholder')}
            />
          </div>

          {/* Payment Methods (radio) */}
          <div>
            <label className={`block text-xs font-medium ${label} mb-1`}>
              <span className='inline-flex items-center'>
                <CreditCard size={14} className='me-1' />{' '}
                {t('cust.paymentMethod')} *
              </span>
            </label>
            <div className='grid grid-cols-2 gap-2'>
              {paymentMethods.map((m: any) => {
                const checked =
                  String(m.id) === String(formData.payment_method_id);
                return (
                  <label
                    key={m.id}
                    className={`cursor-pointer rounded-lg border p-3 flex items-center gap-2 ${
                      checked
                        ? theme === 'dark'
                          ? 'border-blue-400 bg-blue-500/10'
                          : 'border-blue-500 bg-blue-50'
                        : theme === 'dark'
                        ? 'border-white/10 bg-white/5 hover:bg-white/10'
                        : 'border-gray-300 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type='radio'
                      name='payment_method'
                      className='accent-blue-600'
                      checked={checked}
                      onChange={() =>
                        setFormData({
                          ...formData,
                          payment_method_id: String(m.id),
                          payment_method_slug: m.slug || 'cash',
                        })
                      }
                      required
                    />
                    <span
                      className={
                        theme === 'dark' ? 'text-white' : 'text-gray-900'
                      }
                    >
                      {/* payment_methods stores name_en/name_ar, so bridge it
                          onto the shape localName() expects. */}
                      {localName({ name: m.name_en, name_ar: m.name_ar })}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Summary (uses live displayDeliveryFee) */}
          <div
            className={`p-3 rounded-lg border ${
              theme === 'dark'
                ? 'bg-white/5 border-white/10'
                : 'bg-gray-50 border-gray-200'
            } space-y-1.5`}
          >
            <Row
              label={t('cart.subtotal')}
              value={money(computeDisplayTotals().subtotal)}
              theme={theme}
            />
            {computeDisplayTotals().discount > 0 && (
              <Row
                label={t('cart.discount')}
                value={`-${money(computeDisplayTotals().discount)}`}
                theme={theme}
              />
            )}
            {order.order_type === 1 && (
              <DeliveryFeeRow
                orderId={order.id}
                value={computeDisplayTotals().delivery}
                isManual={Number((order as any).delivery_fee_manual) === 1}
                isWaived={Number((order as any).void_delivery_fee) === 1}
                theme={theme}
                onChanged={async () => {
                  const fresh = await window.api.invoke('orders:get', order.id);
                  const fee = Number(fresh?.order?.delivery_fee ?? 0);
                  setDisplayDeliveryFee(Number.isFinite(fee) ? fee : 0);
                }}
              />
            )}
            <div
              className={`flex justify-between text-[15px] font-bold ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              } pt-2 border-t ${
                theme === 'dark' ? 'border-white/10' : 'border-gray-200'
              }`}
            >
              <span>{t('common.total')}</span>
              <span
                className={`money ${
                  theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
                }`}
              >
                {money(computeDisplayTotals().grand_total)}
              </span>
            </div>
            {order.order_type === 1 && selectedCity?.min_order > 0 && (
              <div
                className={`text-xs ${
                  theme === 'dark' ? 'text-amber-300' : 'text-amber-700'
                }`}
              >
                {t('checkout.minOrder', { city: localName(selectedCity) })}{' '}
                <span className='money'>{money(selectedCity?.min_order)}</span>{' '}
                {t('common.currency')}
              </div>
            )}
          </div>

          <div className='flex gap-2 pt-1'>
            <button
              type='button'
              onClick={onClose}
              className={`flex-1 px-4 py-2.5 rounded-lg border font-medium ${
                theme === 'dark'
                  ? 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t('common.cancel')}
            </button>
            <button
              type='submit'
              className={`flex-1 px-4 py-2.5 rounded-lg font-medium ${
                theme === 'dark'
                  ? 'bg-success text-success-foreground'
                  : 'bg-success text-success-foreground'
              }`}
            >
              {t('cart.placeOrder')}
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
      {payLink && (
        <PaymentLinkModal
          theme={theme}
          url={payLink.url}
          amount={payLink.amount}
          mobile={payLink.mobile}
          orderLabel={payLink.orderNumber}
          onCheckStatus={async () => {
            const r = await window.api.invoke('payments:checkStatus', payLink.orderId);
            return (r?.status ?? null) as 'pending' | 'paid' | 'failed' | null;
          }}
          onClose={() => { setPayLink(null); onClose(); }}
        />
      )}
    </div>
  );
}
