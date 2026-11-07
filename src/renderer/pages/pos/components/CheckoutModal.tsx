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
  AlertTriangle,
} from 'lucide-react';
import { Order, State, City, Block, Promo, Customer } from '../types';
import { CommandSelect } from './CommandSelect';
import { PromoDialog } from './PromoDialog';
import { PaymentLinkModal } from './PaymentLinkModal';
import { useToast } from '../../../components/ToastProvider'; // adjust path if needed
import { useI18n } from '../../../i18n';
import { isOnlinePayment } from '../paymentKinds';
import { DeliveryFeeRow } from './DeliveryFeeRow';
import { describeError } from '../../../utils/posError';
import { paymentStatusCode } from '../../../../shared/errors';
import {
  WALK_IN_CUSTOMER_MOBILE,
  WALK_IN_CUSTOMER_NAME,
} from '../../../../shared/walkInCustomer';
import {
  computeChangeBlock,
  isCashPayment,
  isTenderable,
  suggestTenders,
} from '../../../../shared/cashChange';
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
  const textMuted = 'ink-2';

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
  /**
   * Whether this branch asks for the cash received. Off until the back office
   * ticks the box, and off on a till that has not bootstrapped since the
   * server started sending the field — so nothing about checkout changes for
   * a shop that never asked for this.
   */
  const [capturesCash, setCapturesCash] = useState(false);
  /**
   * Held as the raw string the cashier is typing, not a number. "5." and ""
   * are both states a half-typed amount passes through, and rounding them to
   * a number on every keystroke fights the person at the keyboard.
   */
  const [cashReceived, setCashReceived] = useState('');
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

      try {
        const branch = await window.api.invoke('branch:profile');
        setCapturesCash(Boolean(branch?.show_change_on_receipt));
      } catch {
        // An unreachable profile means the field stays hidden, which is the
        // pre-existing checkout. Never block the sale over a receipt option.
      }
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

    // Toggle ON → record an anonymous walk-in.
    //
    // This used to prefill the LOGGED-IN OPERATOR's name, personal mobile and
    // email as the customer, which is the most-travelled path in the app —
    // most tickets close through this modal. Every walk-in sale therefore
    // reached the back office with the cashier's own phone number stored as
    // the customer's.
    //
    // The operator is not lost by dropping it: the push now carries them as
    // `server_user_id`, taken from the staff columns the till has always
    // recorded. Prefilling the customer field was only ever a way to smuggle
    // the operator across, and there is a proper column for that now.
    setFormData((p) => ({
      ...p,
      full_name: WALK_IN_CUSTOMER_NAME,
      mobile: WALK_IN_CUSTOMER_MOBILE,
      email: '',
    }));
    setCustomerLookup(null); // override any previous lookup label
    setUseQuickMode(true);
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

  /**
   * The cash field shows only for a cash sale at a branch that captures it.
   * A KNET terminal has already taken the exact amount, so there is no tender
   * to record and no change to hand back.
   */
  const showCashCapture =
    capturesCash && isCashPayment(formData.payment_method_slug);

  /** What the cashier has typed, as a number — NaN while it is unusable. */
  const tenderedValue = Number(cashReceived);

  // Only for an amount that could actually be handed over. Previewing change
  // against 0.507 would contradict the warning shown right under the field.
  const changePreview = showCashCapture && isTenderable(tenderedValue)
    ? computeChangeBlock({
        grandTotal: computeDisplayTotals().grand_total,
        amountTendered: tenderedValue,
        paymentSlug: formData.payment_method_slug,
        enabled: true,
      })
    : null;

  /**
   * Typed something, but less than the bill. Worth saying out loud — it is
   * almost always a slip of the keypad — but not worth blocking: the sale is
   * valid, and a short tender is a partial payment, which this is not.
   */
  const cashIsShort =
    showCashCapture &&
    cashReceived.trim() !== '' &&
    Number.isFinite(tenderedValue) &&
    tenderedValue > 0 &&
    tenderedValue < computeDisplayTotals().grand_total;

  /**
   * Typed an amount that does not exist in coins — 0.007, say.
   *
   * The field used to step in 1 fils, which put 0.001 → 0.002 → 0.003 on the
   * spinner. Kuwait has no coin below 5 fils, so none of those can be handed
   * over, and recording one would print change against money nobody received.
   */
  const cashIsNotTenderable =
    showCashCapture &&
    cashReceived.trim() !== '' &&
    Number.isFinite(tenderedValue) &&
    tenderedValue > 0 &&
    !isTenderable(tenderedValue);

  /** Only a real, covering tender is worth recording. */
  const cashIsUsable =
    showCashCapture &&
    Number.isFinite(tenderedValue) &&
    isTenderable(tenderedValue) &&
    tenderedValue >= computeDisplayTotals().grand_total;

  /** The notes a customer plausibly hands over for this bill. */
  const tenderChoices = showCashCapture
    ? suggestTenders(computeDisplayTotals().grand_total)
    : [];


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
        // Only ever sent for a cash sale at a branch that captures it. The
        // main process re-validates against the recalculated total and drops
        // anything short, so this is a capture, not a claim.
        amount_tendered: cashIsUsable ? tenderedValue : null,
        state_id: selectedState?.id ?? null,
        city_id: selectedCity?.id ?? null,
        block_id: selectedBlock?.id ?? null,
      };

      // Complete order on server
      const completed: any = await window.api.invoke(
        'orders:complete',
        order.id,
        payload
      );
      // Items added to another till's order: a slip of just those for the
      // kitchen, besides the receipt below.
      if (completed?.added_line_ids?.length) {
        window.api.invoke('orders:printAdded', order.id, completed.added_line_ids).catch(() => {});
      }

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

      // No table clearing here. A placed dine-in order stays seated until Close
      // & Release; this used to call orders:clearTable, which only ever did
      // nothing by accident (first a transaction that never ran, then the
      // "table has items" refusal swallowed below).

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

  const bg = 'bg-surface';
  const border = 'border-line';
  const text = 'ink';
  const textMuted = 'ink-2';
  // Portal input: surface + 1px line-strong, brand border and glow on focus.
  const inputCls =
    'w-full min-h-11 px-3 py-2 rounded-[11px] border border-line-strong bg-surface ink placeholder:text-default-500 transition focus:outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_4px_var(--brand-ring)]';
  const label = 'ink-2';

  // Promo quick apply
  const [showPromo, setShowPromo] = useState(false);

  return (
    <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4'>
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
        className={`ui-popup !rounded-[24px] w-full max-w-[76rem] max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden`}
      >
        <div
          className={`shrink-0 ${bg} border-b ${border} px-3 py-3 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-2`}
        >
          <h2 className={`text-lg font-semibold ${text}`}>{t('checkout.title')}</h2>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setShowPromo(true)}
              className='ui-btn ui-btn-outline ui-btn-sm'
            >
              <Percent size={14} strokeWidth={1.8} /> {t('promo.short')}
            </button>
            <button
              type='button'
              onClick={handleQuickMode}
              aria-pressed={useQuickMode}
              className={`ui-btn ui-btn-outline ui-btn-sm ${
                useQuickMode
                  ? '!border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-ring)]'
                  : ''
              }`}
            >
              <Zap size={13} strokeWidth={1.8} className={useQuickMode ? 'text-[var(--brand-strong)]' : 'opacity-70'} />
              <span>
                {useQuickMode
                  ? t('checkout.quickModeOn')
                  : t('checkout.quickMode')}
              </span>
            </button>

            <button
              onClick={onClose}
              className='ui-icon-btn'
              aria-label={t('common.close')}
            >
              <X size={20} strokeWidth={1.8} />
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
                  className='inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[11px] bg-danger px-3 text-[14px] font-semibold text-danger-foreground hover:opacity-90'
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
          <div className='flex-1 min-h-0 overflow-y-auto nice-scroll p-3 sm:p-4 space-y-3'>
          {/* Customer lookup */}
          <div
            data-field='mobile'
            className='p-3 rounded-[16px] border border-line-strong bg-surface-2'
          >
            <label className={`block text-xs font-semibold ${label} mb-1.5`}>
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
                className={`flex-1 px-3 py-2 ${inputCls} ${fieldRing(
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
                  'text-[var(--st-green)]'
                }`}
              >
                <UserCheck size={14} strokeWidth={1.8} />
                <span>
                  {t('checkout.found')} {customerLookup.full_name}
                </span>
              </div>
            )}
            <FieldError issue={issues.codeFor('mobile')} />
          </div>

          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <div data-field='full_name'>
              <label className={`block text-xs font-semibold ${label} mb-1`}>
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
                className={`w-full px-3 py-2 ${inputCls} ${fieldRing(
                  issues.has('full_name')
                )}`}
                placeholder={t('checkout.fullNamePlaceholder')}
              />
              <FieldError issue={issues.codeFor('full_name')} />
            </div>
            <div>
              <label className={`block text-xs font-semibold ${label} mb-1`}>
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
                className={`w-full px-3 py-2 ${inputCls}`}
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
                  <label className={`block text-xs font-semibold ${label} mb-1`}>
                    {t('cust.street')}
                  </label>
                  <input
                    value={formData.street}
                    onChange={(e) =>
                      setFormData({ ...formData, street: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputCls}`}
                    placeholder={t('checkout.streetPlaceholder')}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-semibold ${label} mb-1`}>
                    {t('cust.building')}
                  </label>
                  <input
                    value={formData.building}
                    onChange={(e) =>
                      setFormData({ ...formData, building: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputCls}`}
                    placeholder={t('checkout.buildingPlaceholder')}
                  />
                </div>
              </div>

              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div>
                  <label className={`block text-xs font-semibold ${label} mb-1`}>
                    {t('cust.floor')}
                  </label>
                  <input
                    value={formData.floor}
                    onChange={(e) =>
                      setFormData({ ...formData, floor: e.target.value })
                    }
                    className={`w-full px-3 py-2 ${inputCls}`}
                    placeholder={t('checkout.floorPlaceholder')}
                  />
                </div>
                <div data-field='address'>
                  <label className={`block text-xs font-semibold ${label} mb-1`}>
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
                    className={`w-full px-3 py-2 ${inputCls} resize-none ${fieldRing(
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
              <label className={`block text-xs font-semibold ${label} mb-1`}>
                <span className='inline-flex items-center'>
                  <Utensils size={14} className='me-1' /> {t('nav.tables')} *
                </span>
              </label>
              <div
                className={`flex flex-wrap items-center justify-between gap-3 rounded-[13px] border px-3 py-2 ${
                  order.table_id
                    ? 'border-line-strong bg-surface'
                    : `border-line-strong bg-surface ${fieldRing(
                        issues.has('table')
                      )}`
                }`}
              >
                <span className='inline-flex items-center gap-2 text-sm font-semibold ink'>
                  {order.table_id ? (
                    <>
                      <Check className='h-4 w-4 text-[var(--st-green)]' strokeWidth={1.8} />
                      {(order as any).table_name || t('tables.assign')}
                    </>
                  ) : (
                    <span className='ink-2'>{t('tables.notAssigned')}</span>
                  )}
                </span>
                {onPickTable && (
                  <button
                    type='button'
                    onClick={onPickTable}
                    className='ui-btn ui-btn-outline ui-btn-sm'
                  >
                    {t('tables.assign')}
                  </button>
                )}
              </div>
              <FieldError issue={issues.codeFor('table')} />
            </div>
          )}

          <div>
            <label className={`block text-xs font-semibold ${label} mb-1`}>
              {t('checkout.notes')}
            </label>
            <textarea
              value={formData.note}
              onChange={(e) =>
                setFormData({ ...formData, note: e.target.value })
              }
              className={`w-full px-3 py-2 ${inputCls} resize-none`}
              rows={2}
              placeholder={t('checkout.notesPlaceholder')}
            />
          </div>

          {/* Payment Methods (radio) */}
          <div data-field='payment_method'>
            <label className={`block text-xs font-semibold ${label} mb-1`}>
              <span className='inline-flex items-center'>
                <CreditCard size={14} className='me-1' />{' '}
                {t('cust.paymentMethod')} *
              </span>
            </label>
            <div className='grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-2'>
              {paymentMethods.map((m: any) => {
                const checked =
                  String(m.id) === String(formData.payment_method_id);
                return (
                  <label
                    key={m.id}
                    className={`cursor-pointer rounded-[13px] border min-h-11 p-3 flex items-center gap-2 bg-surface transition ${
                      checked
                        ? 'border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-ring)] font-semibold'
                        : 'border-line-strong hover:bg-surface-2'
                    }`}
                  >
                    <input
                      type='radio'
                      name='payment_method'
                      className='accent-[var(--brand)]'
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
                      className='ink'
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
              border-t lg:border-t-0 lg:border-s ${border} p-3 sm:p-4 space-y-3 ${bg} max-h-[50dvh] overflow-y-auto lg:max-h-none`}
          >
          {/* Summary (uses live displayDeliveryFee) */}
          <div
            data-field='totals'
            className={`p-3 rounded-[16px] border ${
              'bg-surface-2 border-line'
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
              className='flex justify-between pos-price font-bold ink pt-2 border-t border-line'
            >
              <span>{t('common.total')}</span>
              <span
                className={`money ${
                  'ink'
                }`}
              >
                {money(computeDisplayTotals().grand_total)}
              </span>
            </div>
            <FieldError issue={issues.codeFor('totals')} />

            {/*
              Cash received, and the change owed back.
              Under the total deliberately: the cashier reads the amount to
              ask for, takes the note, types it, and reads the change back —
              in the same order on screen as it happens at the counter.
            */}
            {showCashCapture && (
              <div className='pt-2 border-t border-line space-y-1.5'>
                <label className='flex items-center justify-between gap-2'>
                  <span className='ink-2'>
                    {t('checkout.cashReceived')}
                  </span>
                  <input
                    // Deliberately not type='number'. Its spinner steps
                    // through amounts nobody hands over — 0.505, 0.510, 0.515
                    // against a 0.500 bill — which is increment thinking, not
                    // money. The buttons below are the real control; this is
                    // for the occasional odd amount, typed straight in.
                    type='text'
                    inputMode='decimal'
                    dir='ltr'
                    value={cashReceived}
                    onChange={(e) => {
                      // Digits and at most one dot, three decimals — the
                      // shape of a KD amount. Anything else never lands.
                      const next = e.target.value.replace(/[^\d.]/g, '');
                      if (/^\d*\.?\d{0,3}$/.test(next)) setCashReceived(next);
                    }}
                    placeholder={money(computeDisplayTotals().grand_total)}
                    className={`w-28 min-h-11 text-end rounded-[11px] border px-2 py-1 money
                      bg-surface ink transition focus:outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_4px_var(--brand-ring)] ${
                        cashIsShort || cashIsNotTenderable
                          ? 'border-[var(--st-amber)]'
                          : 'border-line-strong'
                      }`}
                  />
                </label>

                {/*
                  The real control: what a customer actually hands over for
                  this bill — the exact money, then the notes above it. One
                  tap, sized for a finger, because this is a till.
                */}
                <div className='flex flex-wrap justify-end gap-1.5'>
                  {tenderChoices.map((amount, i) => {
                    const selected =
                      Number.isFinite(tenderedValue) &&
                      Math.round(tenderedValue * 1000) ===
                        Math.round(amount * 1000);
                    return (
                      <button
                        key={amount}
                        type='button'
                        onClick={() => setCashReceived(amount.toFixed(3))}
                        aria-pressed={selected}
                        className={`rounded-[11px] border min-h-11 px-3 py-1.5 text-sm font-semibold money bg-surface ink transition
                          ${
                            selected
                              ? 'border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-ring)]'
                              : 'border-line-strong hover:bg-surface-2'
                          }`}
                      >
                        {i === 0 ? t('checkout.cashExact') : money(amount)}
                      </button>
                    );
                  })}
                </div>

                {cashIsNotTenderable ? (
                  <div className='ui-notice text-xs'>
                    <AlertTriangle size={14} strokeWidth={1.8} className='mt-0.5 shrink-0 text-[var(--st-amber)]' />
                    <span>{t('checkout.cashNotCoin')}</span>
                  </div>
                ) : cashIsShort ? (
                  <div className='ui-notice text-xs'>
                    <AlertTriangle size={14} strokeWidth={1.8} className='mt-0.5 shrink-0 text-[var(--st-amber)]' />
                    <span>{t('checkout.cashShort')}</span>
                  </div>
                ) : null}

                {/* Only when rounding actually moved the figure — the same
                    rule the receipt follows, so the screen and the slip show
                    the same three lines. */}
                {changePreview && changePreview.rounding !== 0 && (
                  <Row
                    label={t('checkout.rounding')}
                    value={`${changePreview.rounding < 0 ? '-' : ''}${money(
                      Math.abs(changePreview.rounding)
                    )}`}
                    theme={theme}
                  />
                )}

                {changePreview && (
                  <div className='flex justify-between pos-price font-bold ink'>
                    <span>{t('checkout.change')}</span>
                    <span className='money text-[var(--st-green)]'>
                      {money(changePreview.change)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {order.order_type === 1 && Number(selectedCity?.min_order ?? 0) > 0 && (
              <div className='ui-notice text-xs'>
                <AlertTriangle size={14} strokeWidth={1.8} className='mt-0.5 shrink-0 text-[var(--st-amber)]' />
                <span>
                  {t('checkout.minOrder', { city: localName(selectedCity) })}{' '}
                  <span className='money'>{money(selectedCity?.min_order)}</span>{' '}
                  {t('common.currency')}
                </span>
              </div>
            )}
          </div>

          <div className='sticky bottom-0 -mb-1 flex gap-2 bg-surface pb-1 pt-2'>
            <button
              type='button'
              onClick={onClose}
              disabled={submitting}
              className='ui-btn ui-btn-outline ui-btn-lg flex-1'
            >
              {t('common.cancel')}
            </button>
            {/* Disabled while in flight: a second press used to fire a second
                orders:complete, and the loser came back as a raw handler error
                on an order that had in fact gone through. */}
            <button
              type='submit'
              disabled={submitting}
              className='ui-btn ui-btn-primary ui-btn-lg flex-1'
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
