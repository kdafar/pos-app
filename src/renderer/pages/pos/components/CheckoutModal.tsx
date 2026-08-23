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
  Utensils,
  Loader2,
  Check,
} from 'lucide-react';
import { Order, State, City, Block, Promo, Customer } from '../types';
import { CommandSelect } from './CommandSelect';
import { PromoDialog } from './PromoDialog';
import { PaymentLinkModal } from './PaymentLinkModal';
import { useToast } from '../../../components/ToastProvider'; // adjust path if needed
import { useI18n } from '../../../i18n';
import { DeliveryFeeRow } from './DeliveryFeeRow';
import { describeError } from '../../../utils/posError';
import { paymentStatusCode } from '../../../../shared/errors';
import {
  FieldError,
  ValidationSummary,
  fieldRing,
  focusField,
  useFormIssues,
  type FormIssue,
} from '../../../components/FormIssues';

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
  const textMuted = 'text-default-700';

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
  onAfterReserve,
  onPickTable,
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
  /** Called once a server reference has been reserved, so the view can refresh. */
  onAfterReserve?: () => Promise<void> | void;
  /**
   * Opens the table picker without closing checkout. A dine-in order with no
   * table used to be refused at the very end, with the fix living on a screen
   * the cashier had to abandon the form to reach.
   */
  onPickTable?: () => void;
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
  const { t, lang, name: localName, money } = useI18n();
  // Scoped so focusField only ever walks this modal's fields, never a field of
  // the same name on the screen behind it.
  const formRef = React.useRef<HTMLFormElement>(null);
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
  const [deliveryFeeOverride, setDeliveryFeeOverride] = useState(() => ({
    manual: Number((order as any).delivery_fee_manual) === 1,
    waived: Number((order as any).void_delivery_fee) === 1,
  }));
  // A hand-entered or waived fee is the cashier's decision and must survive
  // picking an area — otherwise choosing the city silently overwrites it.
  const feeOverridden =
    deliveryFeeOverride.manual || deliveryFeeOverride.waived;

  useEffect(() => {
    if (order.order_type !== 1) return;
    if (feeOverridden) {
      setDisplayDeliveryFee(Number(order.delivery_fee ?? 0));
      return;
    }
    const fee = Number(selectedCity?.delivery_fee ?? order.delivery_fee ?? 0);
    setDisplayDeliveryFee(isFinite(fee) ? fee : 0);
  }, [order.order_type, order.delivery_fee, selectedCity, feeOverridden]);

  /** Load payment methods without creating or pushing an order. */
  /*
   * a real Received order — the backend has no draft concept — so triggering it
   * per line would turn every mis-rung item and every cleared cart into an
   * order on the dashboard. The money is unaffected (revenue posts only at
   * Done) but order counts and average-ticket figures are not, and "the till
   * says 340 orders, the drawer says 300" is not a conversation worth having.
   *
   * Opening checkout is the first genuinely committed moment, and it still
   * lands the number before anything prints — which was the point. A cart
   * abandoned at the payment step does still create an order; that is a rarer
   * event than clearing a mis-rung line.
   */
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

  /** Payment slugs that hand the customer a link instead of taking cash here. */
  const isOnlinePayment = (slug?: string | null) =>
    [
      'link',
      'myfatoorah',
      'online',
      'online_knet',
      'online_card',
      'mf_online',
    ].includes((slug ?? '').toLowerCase());

  /*
   * Every rule the main process enforces on orders:complete, checked here first
   * and tied to the field it belongs to. The handler still enforces them — this
   * is not a security boundary — but a cashier should never learn about a
   * missing table from a rejected save.
   */
  const validate = (): FormIssue[] => {
    const found: FormIssue[] = [];

    if (!formData.full_name.trim()) {
      found.push({ code: 'POS_VAL_NAME_REQUIRED', field: 'full_name' });
    }

    const mobileDigits = formData.mobile.replace(/\D/g, '');

    if (order.order_type === 1) {
      // Area and block are separate rows in the catalogue because they are
      // separate mistakes: one sets the delivery charge, the other is the
      // address. Telling a cashier "choose the area" when the area is already
      // chosen is worse than saying nothing.
      if (!selectedState?.id || !selectedCity?.id) {
        found.push({ code: 'POS_VAL_CITY_REQUIRED', field: 'geo' });
      } else if (!selectedBlock?.id) {
        found.push({ code: 'POS_VAL_BLOCK_REQUIRED', field: 'geo' });
      }
      if (!makeAddress().trim()) {
        found.push({ code: 'POS_VAL_ADDRESS_REQUIRED', field: 'address' });
      }
      // Delivery needs a number whatever the payment method — the driver
      // cannot ring a doorbell that is not there.
      if (mobileDigits.length < 8) {
        found.push({ code: 'POS_VAL_MOBILE_REQUIRED', field: 'mobile' });
      }
      // The area minimum is the server's rule, but it is knowable here, and
      // finding out after Place Order costs a re-ring.
      const min = Number(selectedCity?.min_order ?? 0);
      if (min > 0 && computeDisplayTotals().subtotal < min) {
        found.push({
          code: 'POS_VAL_MIN_ORDER',
          field: 'totals',
          params: { amount: money(min) },
        });
      }
    }

    if (order.order_type === 3 && !order.table_id) {
      found.push({ code: 'POS_VAL_TABLE_REQUIRED', field: 'table' });
    }

    if (!formData.payment_method_id || !formData.payment_method_slug) {
      found.push({ code: 'POS_VAL_PAYMENT_METHOD_REQUIRED', field: 'payment_method' });
    } else if (
      isOnlinePayment(formData.payment_method_slug) &&
      (mobileDigits.length < 8 || mobileDigits.length > 15) &&
      !found.some((i) => i.field === 'mobile')
    ) {
      // The link is delivered by SMS, so an online method without a usable
      // number produces an order nobody can pay for.
      found.push({ code: 'POS_VAL_MOBILE_REQUIRED', field: 'mobile' });
    }

    return found;
  };

  const issues = useFormIssues(validate);
  const [submitting, setSubmitting] = useState(false);

  // Once the banner is up it tracks the form: a field the cashier fixes drops
  // off the list as they type, so the count only ever counts what is still
  // wrong. A clean form is left alone — nothing appears until they submit.
  useEffect(() => {
    issues.refresh();
  }, [
    formData.full_name,
    formData.mobile,
    formData.address,
    formData.payment_method_id,
    formData.payment_method_slug,
    formData.state_id,
    formData.city_id,
    formData.block_id,
    order.table_id,
    order.subtotal,
    displayDeliveryFee,
  ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Nothing leaves the till until the form is complete. The banner and the
    // field markers say what is missing; no request, so no raw handler error.
    if (!issues.check()) {
      focusField(formRef.current, validate()[0]?.field ?? '');
      return;
    }

    setSubmitting(true);
    try {
      const address = makeAddress();

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

      // Complete order on server
      await window.api.invoke(
        'orders:complete',
        order.id,
        payload
      );

      // Creating a reference pushes a real order to the backend. Do this only
      // after Place Order succeeds; simply opening checkout and pressing
      // Cancel/Close must leave no server order behind.
      if (!(order as any).reference_no) {
        try {
          const ref = await window.api.invoke(
            'sync:reserveReference',
            order.id
          );
          if (ref) await onAfterReserve?.();
        } catch {
          // Best-effort: offline sales keep their local order number.
        }
      }

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
            // The order is placed either way; only the link is missing, so this
            // is a warning about what to do next, not a failure of the sale.
            toast({
              tone: 'warning',
              title: t('checkout.payLinkNoUrl'),
              message: t('common.checkConn'),
            });
          }
        } catch (err) {
          toast.error(err, { title: t('checkout.payLinkFailed') });
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
      // A rule the form did not catch (someone else took the table, the order
      // was closed on another till). Translate it, and if the handler named a
      // field, flag that field so the fix is visible rather than described.
      const described = describeError(err, lang);
      if (described.field) {
        issues.setIssues([
          { code: described.code as FormIssue['code'], field: described.field },
        ]);
        focusField(formRef.current, described.field);
      }
      toast.error(err, { title: t('checkout.completeFailed') });
    } finally {
      setSubmitting(false);
    }
  };

  const bg = 'bg-content1';
  const border = 'border-default-200';
  const text = 'text-foreground';
  const textMuted = 'text-default-700';
  const inputBg =
    'bg-default-100 border-default-200';
  const label = 'text-default-700';

  // Promo quick apply
  const [showPromo, setShowPromo] = useState(false);

  return (
    <div className='fixed inset-0 bg-black/55 flex items-center justify-center z-50 p-4'>
      <div
        // max-w-2xl (42rem) forced three address selects into a cramped row
        // and left the form scrolling far more than it needed to. 64rem gives
        // the fields room on a normal till without running the width on 4K.
        // nice-scroll replaces the default chunky bar, matching every other
        // scroller in the app.
        // A column, not a scrolling block. Previously the whole modal scrolled,
        // which pushed Place Order below the fold on any order with a few
        // payment methods — so the one action the cashier always needs was the
        // one thing they had to go looking for. Only the fields scroll now;
        // the totals and the buttons are pinned.
        className={`${bg} border ${border} rounded-2xl shadow-xl w-full max-w-[76rem] max-h-[92vh] flex flex-col overflow-hidden`}
      >
        <div
          className={`shrink-0 ${bg} border-b ${border} px-5 py-4 flex items-center justify-between`}
        >
          <h2 className={`text-xl font-bold ${text}`}>{t('checkout.title')}</h2>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setShowPromo(true)}
              className={`h-9 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                'bg-default-100 border border-default-200 text-default-700 hover:bg-default-200'
              }`}
            >
              <Percent size={14} /> {t('promo.short')}
            </button>
            <button
              type='button'
              onClick={handleQuickMode}
              className={`
                h-9 px-3 rounded-lg text-xs font-semibold
                flex items-center gap-1 border transition-colors
                ${
                  useQuickMode
                    ? 'bg-amber-500/20 text-warning border-amber-400/60'
                    : 'bg-transparent text-default-700 border-default-200 hover:bg-default-100'
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
              className='grid h-9 w-9 place-items-center rounded-lg text-default-600 hover:bg-default-100 hover:text-foreground'
              aria-label={t('common.close')}
            >
              <X size={22} />
            </button>
          </div>
        </div>

        <form
          ref={formRef}
          // `relative`: the validation card floats over these fields rather
          // than sitting in the flow, where it both pushed the form down and
          // got clipped by the scroller below.
          className='relative flex flex-col min-h-0 flex-1'
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
        >
          {/* Floats over the form; dismissible, because the red border and the
              message under the control keep saying it after the card is gone. */}
          <ValidationSummary
            issues={issues.issues}
            attempt={issues.attempt}
            onFocusField={(f) => focusField(formRef.current, f)}
            onDismiss={() => issues.clear()}
            extraAction={(issue) =>
              issue.field === 'table' && onPickTable ? (
                <button
                  type='button'
                  onClick={onPickTable}
                  className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-danger px-3 text-[14px] font-semibold text-danger-foreground hover:opacity-90'
                >
                  <Utensils className='h-4 w-4' />
                  {t('tables.assign')}
                </button>
              ) : null
            }
          />

          {/*
            Split screen, the standard checkout shape: the form the cashier
            works through on one side, the order summary persistently visible
            on the other. It reads better and it removes the reason to scroll —
            the totals and Place Order are simply always on screen.

            Column below 64rem, row above it. In column mode the summary is
            still pinned, so a small till behaves as it did rather than
            inheriting a layout meant for width it does not have.
          */}
          <div className='flex-1 min-h-0 flex flex-col lg:flex-row'>
          <div className='flex-1 min-h-0 overflow-y-auto nice-scroll p-4 space-y-3'>
          {/* Customer lookup */}
          <div
            data-field='mobile'
            className='p-3 rounded-lg border border-primary/40 bg-primary/10'
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
                className={`flex-1 px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40 ${fieldRing(
                  issues.has('mobile')
                )}`}
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
                  'text-success'
                }`}
              >
                <UserCheck size={14} />
                <span>
                  {t('checkout.found')} {customerLookup.full_name}
                </span>
              </div>
            )}
            <FieldError issue={issues.codeFor('mobile')} />
          </div>

          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <div data-field='full_name'>
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
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40 ${fieldRing(
                  issues.has('full_name')
                )}`}
                placeholder={t('checkout.fullNamePlaceholder')}
              />
              <FieldError issue={issues.codeFor('full_name')} />
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
                className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40`}
                placeholder='customer@email.com'
              />
            </div>
          </div>

          {order.order_type === 1 && (
            <>
              <div data-field='geo'>
              <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
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
              <FieldError issue={issues.codeFor('geo')} />
              </div>

              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>
                    {t('cust.street')}
                  </label>
                  <input
                    value={formData.street}
                    onChange={(e) =>
                      setFormData({ ...formData, street: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40`}
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
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40`}
                    placeholder={t('checkout.buildingPlaceholder')}
                  />
                </div>
              </div>

              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div>
                  <label className={`block text-xs font-medium ${label} mb-1`}>
                    {t('cust.floor')}
                  </label>
                  <input
                    value={formData.floor}
                    onChange={(e) =>
                      setFormData({ ...formData, floor: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40`}
                    placeholder={t('checkout.floorPlaceholder')}
                  />
                </div>
                <div data-field='address'>
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
                    className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none ${fieldRing(
                      issues.has('address')
                    )}`}
                    rows={2}
                    placeholder={t('checkout.addressPlaceholder')}
                  />
                  <FieldError issue={issues.codeFor('address')} />
                </div>
              </div>
            </>
          )}

          {/* Dine-in: the table is decided outside this form, so show its state
              inside the form. Otherwise the only mention of a missing table is
              the refusal at the end. */}
          {order.order_type === 3 && (
            <div data-field='table'>
              <label className={`block text-xs font-medium ${label} mb-1`}>
                <span className='inline-flex items-center'>
                  <Utensils size={14} className='me-1' /> {t('nav.tables')} *
                </span>
              </label>
              <div
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  order.table_id
                    ? 'border-success/50 bg-success/10'
                    : `border-default-200 bg-default-100 ${fieldRing(
                        issues.has('table')
                      )}`
                }`}
              >
                <span className='inline-flex items-center gap-2 text-sm font-semibold text-foreground'>
                  {order.table_id ? (
                    <>
                      <Check className='h-4 w-4 text-success' />
                      {(order as any).table_name || t('tables.assign')}
                    </>
                  ) : (
                    <span className='text-default-700'>{t('tables.notAssigned')}</span>
                  )}
                </span>
                {onPickTable && (
                  <button
                    type='button'
                    onClick={onPickTable}
                    className='rounded-lg border border-default-200 px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-default-200'
                  >
                    {t('tables.assign')}
                  </button>
                )}
              </div>
              <FieldError issue={issues.codeFor('table')} />
            </div>
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
              className={`w-full px-3 py-2 ${inputBg} rounded-lg ${text} placeholder:text-default-700 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none`}
              rows={2}
              placeholder={t('checkout.notesPlaceholder')}
            />
          </div>

          {/* Payment Methods (radio) */}
          <div data-field='payment_method'>
            <label className={`block text-xs font-medium ${label} mb-1`}>
              <span className='inline-flex items-center'>
                <CreditCard size={14} className='me-1' />{' '}
                {t('cust.paymentMethod')} *
              </span>
            </label>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
              {paymentMethods.map((m: any) => {
                const checked =
                  String(m.id) === String(formData.payment_method_id);
                return (
                  <label
                    key={m.id}
                    className={`cursor-pointer rounded-lg border p-3 flex items-center gap-2 ${
                      checked
                        ? 'border-primary bg-primary/10 font-semibold'
                        : 'border-default-200 bg-default-100 hover:bg-default-200'
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
                      className='text-foreground'
                    >
                      {/* payment_methods stores name_en/name_ar, so bridge it
                          onto the shape localName() expects. */}
                      {localName({ name: m.name_en, name_ar: m.name_ar })}
                    </span>
                  </label>
                );
              })}
            </div>
            <FieldError issue={issues.codeFor('payment_method')} />
          </div>

          </div>

          {/* Summary column — the order, its totals, and the two actions. */}
          <aside
            className={`shrink-0 lg:w-[24rem] lg:overflow-y-auto nice-scroll
              border-t lg:border-t-0 lg:border-s ${border} p-4 space-y-3 ${bg}`}
          >
          {/* Summary (uses live displayDeliveryFee) */}
          <div
            data-field='totals'
            className={`p-3 rounded-lg border ${
              'bg-default-100 border-default-200'
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
                isManual={deliveryFeeOverride.manual}
                isWaived={deliveryFeeOverride.waived}
                onChanged={async () => {
                  const fresh = await window.api.invoke('orders:get', order.id);
                  const fee = Number(fresh?.order?.delivery_fee ?? 0);
                  setDisplayDeliveryFee(Number.isFinite(fee) ? fee : 0);
                  setDeliveryFeeOverride({
                    manual:
                      Number(fresh?.order?.delivery_fee_manual) === 1,
                    waived: Number(fresh?.order?.void_delivery_fee) === 1,
                  });
                }}
              />
            )}
            <div
              className='flex justify-between pos-price font-bold text-foreground pt-2 border-t border-default-200'
            >
              <span>{t('common.total')}</span>
              <span
                className={`money ${
                  'text-primary'
                }`}
              >
                {money(computeDisplayTotals().grand_total)}
              </span>
            </div>
            <FieldError issue={issues.codeFor('totals')} />
            {order.order_type === 1 && Number(selectedCity?.min_order ?? 0) > 0 && (
              <div
                className={`text-xs ${
                  'text-warning'
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
              disabled={submitting}
              className={`flex-1 h-11 px-4 rounded-xl border font-medium
                border-default-200 bg-default-100 text-foreground hover:bg-default-200
                disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {t('common.cancel')}
            </button>
            {/* Disabled while in flight: a second press used to fire a second
                orders:complete, and the loser came back as a raw handler error
                on an order that had in fact gone through. */}
            <button
              type='submit'
              disabled={submitting}
              className={`flex-1 h-11 px-4 rounded-xl font-medium inline-flex items-center justify-center gap-2
                bg-success text-success-foreground transition-opacity
                disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {submitting && <Loader2 className='h-4 w-4 animate-spin' />}
              {t('cart.placeOrder')}
            </button>
          </div>
          </aside>
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
            // /payments/status answers 200 whatever it says, so a failed or
            // expired payment used to come back as a bare string and go
            // nowhere. The two codes are ours to raise — the server never
            // sends them — and the cashier needs to be told to take cash or
            // issue a fresh link.
            const problem = paymentStatusCode(r?.status);
            if (problem) toast.error(problem);
            return (r?.status ?? null) as 'pending' | 'paid' | 'failed' | null;
          }}
          onClose={() => { setPayLink(null); onClose(); }}
        />
      )}
    </div>
  );
}
