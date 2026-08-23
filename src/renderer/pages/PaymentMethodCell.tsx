// src/renderer/pages/PaymentMethodCell.tsx
import { useEffect, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
} from '@heroui/react';
import { useI18n } from '../i18n';

import { errorLine as errLine } from '../utils/posError';
type Method = {
  id: string;
  slug: string;
  name_en?: string | null;
  name_ar?: string | null;
  is_online?: boolean | number;
  supports_payment_link?: boolean | number;
};

/**
 * Change the payment method on an already-placed order.
 *
 * A cashier rings up "cash" and the customer then pays by KNET; with no way to
 * correct it, the day's takings are wrong by that amount and the discrepancy is
 * only found at closing. Deliberately available on closed orders — the
 * correction is almost always needed after the sale, not during it.
 *
 * A native <select> was used here for a while, because the first attempt was a
 * hand-rolled button plus a portalled menu that never opened inside the table —
 * clipped by the container's overflow, and still dead once portalled. HeroUI's
 * Select portals to the document root and manages its own stacking, so it does
 * not reproduce that bug, and unlike the native control it can actually be
 * themed to match the rest of the table.
 */
export function PaymentMethodCell({
  orderId,
  slug,
  mobile,
  amount,
  orderNumber,
  disabled = false,
  onChanged,
  onPaymentLink,
}: {
  orderId: string;
  slug?: string | null;
  mobile?: string | null;
  amount: number;
  orderNumber?: string | null;
  disabled?: boolean;
  onChanged?: () => void;
  onPaymentLink?: (link: {
    url: string;
    mobile: string;
    delivery?: any;
  }) => void;
}) {
  const { t, lang } = useI18n();
  const [methods, setMethods] = useState<Method[]>([]);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string>(slug ?? '');
  const [pendingMethod, setPendingMethod] = useState<Method | null>(null);
  const [mobileValue, setMobileValue] = useState(mobile ?? '');
  const [error, setError] = useState('');

  useEffect(() => setCurrent(slug ?? ''), [slug]);
  useEffect(() => setMobileValue(mobile ?? ''), [mobile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await window.api.invoke('payments:listMethods')) || [];
        if (!cancelled) setMethods(list);
      } catch {
        if (!cancelled) setMethods([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const label = (m: Method) =>
    (lang === 'ar' ? m.name_ar || m.name_en : m.name_en || m.name_ar) || m.slug;

  const change = async (methodId: string) => {
    const m = methods.find((x) => String(x.id) === methodId);
    if (!m) return;
    const onlineSlugs = ['link', 'myfatoorah', 'online', 'online_knet', 'online_card', 'mf_online'];
    const needsLink =
      Boolean(m.supports_payment_link) ||
      Boolean(m.is_online) ||
      onlineSlugs.includes(String(m.slug).toLowerCase());
    if (needsLink) {
      setPendingMethod(m);
      setError('');
      return;
    }
    const previous = current;
    setCurrent(m.slug); // optimistic, reverted on failure
    setBusy(true);
    try {
      await window.api.invoke('orders:setPaymentMethod', orderId, m.id);
      onChanged?.();
    } catch (e) {
      console.error('orders:setPaymentMethod failed', e);
      setCurrent(previous);
    } finally {
      setBusy(false);
    }
  };

  const confirmOnline = async () => {
    if (!pendingMethod) return;
    const normalized = mobileValue.replace(/\D/g, '');
    if (normalized.length < 8 || normalized.length > 15) {
      setError(t('admin.orders.mobileInvalid'));
      return;
    }
    const previous = current;
    setBusy(true);
    setError('');
    try {
      await window.api.invoke('orders:setCustomerMobile', orderId, normalized);
      await window.api.invoke('orders:setPaymentMethod', orderId, pendingMethod.id);
      await window.api.invoke('orders:pushOne', orderId);
      const pay = await window.api.invoke('payments:createLink', {
        external_order_id: orderId,
        payment_method_id: String(pendingMethod.id),
        customer: { mobile: normalized },
        send: true,
      });
      const url = pay?.url || pay?.invoice_url || pay?.PaymentURL;
      if (!url) throw new Error(t('checkout.payLinkNoUrl'));
      await window.api.invoke('orders:paymentLink:set', orderId, url);
      setCurrent(pendingMethod.slug);
      setPendingMethod(null);
      onPaymentLink?.({ url, mobile: normalized, delivery: pay?.delivery });
      onChanged?.();
    } catch (e) {
      setCurrent(previous);
      setError(errLine(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Select
      size='sm'
      selectedKeys={
        methods.find((m) => m.slug === current)
          ? [String(methods.find((m) => m.slug === current)!.id)]
          : []
      }
      isDisabled={disabled || busy || methods.length === 0}
      isLoading={busy}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (next != null) change(String(next));
      }}
      aria-label={t('admin.orders.changePayment')}
      title={t('admin.orders.changePayment')}
      // Falls back to whatever the order carries, so a method the catalogue has
      // since dropped still shows its name instead of an empty control.
      placeholder={current || '—'}
      className='w-full max-w-[10rem]'
    >
      {methods.map((m) => (
        <SelectItem key={String(m.id)}>{label(m)}</SelectItem>
      ))}
    </Select>
    <Modal isOpen={!!pendingMethod} onOpenChange={(open) => !open && !busy && setPendingMethod(null)}>
      <ModalContent>
        <ModalHeader>{t('admin.orders.sendPayLink')}</ModalHeader>
        <ModalBody>
          <p className='text-sm text-default-600'>{t('admin.orders.sendPayLinkHelp')}</p>
          <Input
            label={t('cust.mobile')}
            value={mobileValue}
            onValueChange={setMobileValue}
            inputMode='tel'
            isInvalid={!!error}
            errorMessage={error}
          />
          <div className='text-sm text-default-600'>
            {orderNumber ? `#${orderNumber} · ` : ''}{amount.toFixed(3)} KWD
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='flat' onPress={() => setPendingMethod(null)} isDisabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button color='primary' onPress={confirmOnline} isLoading={busy}>
            {t('admin.orders.sendPayLink')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    </>
  );
}
