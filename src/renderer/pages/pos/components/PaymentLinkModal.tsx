// components/PaymentLinkModal.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@heroui/react';
import { AlertCircle, Check, Copy, MessageCircle, RefreshCw } from 'lucide-react';
import { useI18n } from '../../../i18n';

import { errorLine as errLine } from '../../../utils/posError';
/**
 * Hands a payment link to the CUSTOMER.
 *
 * Previously the link was opened with shell.openExternal, which launched the
 * payment page in the cashier's own browser on the till: the customer never saw
 * it, and the till was taken over mid-sale. A till is a shared device — the
 * customer pays on their own phone.
 *
 * Three ways out, in the order a counter actually uses them:
 *   1. QR on screen — the customer scans it. No typing, no data needed from them.
 *   2. WhatsApp — the dominant channel in Kuwait; needs their mobile.
 *   3. Copy — for anything else.
 *
 * The QR keeps its white plate on purpose: a scanner needs the light quiet zone
 * regardless of which theme the till is running. Everything around it is a
 * semantic token, so the panel is legible in both.
 */
export function PaymentLinkModal({
  url,
  amount,
  mobile,
  orderLabel,
  onClose,
  onCheckStatus,
}: {
  /**
   * Accepted but ignored: colours here are semantic tokens, correct in both
   * themes. Kept optional only because the call sites live in files this change
   * does not touch.
   */
  theme?: 'light' | 'dark';
  url: string;
  amount: number;
  mobile?: string | null;
  orderLabel?: string | null;
  onClose: () => void;
  onCheckStatus?: () => Promise<'pending' | 'paid' | 'failed' | null>;
}) {
  const { t, money } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'pending' | 'paid' | 'failed' | null>(
    'pending'
  );
  const [checking, setChecking] = useState(false);

  const reqRef = useRef(0);

  const loadQr = useCallback(async () => {
    const seq = ++reqRef.current;
    setQrLoading(true);
    setQrError(null);
    try {
      const dataUrl = await window.api.invoke('payments:linkQr', url);
      if (seq !== reqRef.current) return;
      // A missing data URL is a failure, not an empty QR: without this the box
      // sat on "Loading…" forever and the cashier had no idea why.
      if (!dataUrl) {
        setQr(null);
        setQrError(t('admin.loadFailed'));
      } else {
        setQr(dataUrl);
      }
    } catch (e) {
      if (seq !== reqRef.current) return;
      setQr(null);
      setQrError(errLine(e));
    } finally {
      if (seq === reqRef.current) setQrLoading(false);
    }
  }, [url, t]);

  useEffect(() => {
    loadQr();
    return () => {
      reqRef.current++;
    };
  }, [loadQr]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the QR and WhatsApp routes still work */
    }
  };

  const digits = String(mobile ?? '').replace(/\D/g, '');

  const sendWhatsApp = async () => {
    if (!digits) return;
    // Kuwait numbers are 8 digits; prefix the country code when it is absent.
    const intl = digits.length <= 8 ? `965${digits}` : digits;
    const body = encodeURIComponent(
      `${t('pay.waMessage', { amount: money(amount) })}\n${url}`
    );
    // Opens WhatsApp for the CASHIER to send to the customer — the link still
    // travels to the customer's phone, not to the till's browser.
    await window.api.invoke(
      'shell:openExternal',
      `https://wa.me/${intl}?text=${body}`
    );
  };

  const check = async () => {
    if (!onCheckStatus) return;
    setChecking(true);
    try {
      setStatus((await onCheckStatus()) ?? 'pending');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size='md'
      placement='center'
      backdrop='blur'
      scrollBehavior='inside'
      className='rounded-2xl'
    >
      <ModalContent>
        <ModalHeader className='flex flex-col gap-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-default-700'>
            {t('pay.title')}
          </span>
          <span className='flex items-baseline gap-2 text-foreground'>
            <span className='money text-xl font-bold'>{money(amount)}</span>
            <span className='text-sm font-semibold text-default-700'>
              {t('common.currency')}
            </span>
            {status === 'paid' && (
              <Chip
                size='sm'
                variant='flat'
                color='success'
                className='font-semibold'
              >
                {t('pay.paid')}
              </Chip>
            )}
            {status === 'failed' && (
              <Chip
                size='sm'
                variant='flat'
                color='danger'
                className='font-semibold'
              >
                {t('pay.failed')}
              </Chip>
            )}
          </span>
          {orderLabel && (
            <span className='text-xs font-medium text-default-700'>
              {orderLabel}
            </span>
          )}
        </ModalHeader>

        <ModalBody className='space-y-4'>
          <p className='text-center text-sm font-medium text-default-700'>
            {t('pay.scanHint')}
          </p>

          <div className='flex justify-center'>
            {qr ? (
              // The white plate stays: it is the QR's quiet zone, not decoration.
              <img
                src={qr}
                alt={t('pay.qrAlt')}
                className='h-56 w-56 rounded-lg bg-content1 p-2'
              />
            ) : qrError ? (
              <div className='flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-lg border border-default-200 bg-default-100 px-3 text-center'>
                <AlertCircle size={26} className='text-danger' />
                <div className='text-sm font-bold text-danger'>
                  {t('admin.loadFailed')}
                </div>
                <div className='text-xs font-medium text-default-700 break-words'>
                  {qrError}
                </div>
                <Button
                  size='sm'
                  color='danger'
                  variant='flat'
                  onPress={loadQr}
                  isLoading={qrLoading}
                >
                  {t('common.retry')}
                </Button>
              </div>
            ) : (
              <div className='flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-lg border border-default-200 bg-default-100'>
                <Spinner size='lg' />
                <span className='text-sm font-medium text-default-700'>
                  {t('common.loading')}
                </span>
              </div>
            )}
          </div>

          <div
            className='break-all rounded-lg bg-default-100 px-3 py-2 text-xs font-medium text-default-700'
            dir='ltr'
          >
            {url}
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <Button
              variant='flat'
              onPress={copy}
              startContent={copied ? <Check size={16} /> : <Copy size={16} />}
              color={copied ? 'success' : 'default'}
              className='h-11 font-semibold'
            >
              {copied ? t('pay.copied') : t('pay.copy')}
            </Button>

            <Button
              color='success'
              onPress={sendWhatsApp}
              isDisabled={!digits}
              title={digits ? undefined : t('pay.needMobile')}
              startContent={<MessageCircle size={16} />}
              className='h-11 font-semibold'
            >
              {t('pay.whatsapp')}
            </Button>
          </div>

          {onCheckStatus && (
            <Button
              fullWidth
              onPress={check}
              isDisabled={checking}
              color={
                status === 'paid'
                  ? 'success'
                  : status === 'failed'
                    ? 'danger'
                    : 'primary'
              }
              variant={status === 'paid' ? 'solid' : 'flat'}
              startContent={
                <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
              }
              className='h-11 font-semibold'
            >
              {status === 'paid'
                ? t('pay.paid')
                : status === 'failed'
                  ? t('pay.failed')
                  : t('pay.checkStatus')}
            </Button>
          )}
        </ModalBody>

        <ModalFooter>
          <Button color='primary' onPress={onClose}>
            {t('common.close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
