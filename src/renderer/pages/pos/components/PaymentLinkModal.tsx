// components/PaymentLinkModal.tsx
import { useEffect, useState } from 'react';
import { X, Copy, Check, MessageCircle, RefreshCw } from 'lucide-react';
import { useI18n } from '../../../i18n';

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
 */
export function PaymentLinkModal({
  theme,
  url,
  amount,
  mobile,
  orderLabel,
  onClose,
  onCheckStatus,
}: {
  theme: 'light' | 'dark';
  url: string;
  amount: number;
  mobile?: string | null;
  orderLabel?: string | null;
  onClose: () => void;
  onCheckStatus?: () => Promise<'pending' | 'paid' | 'failed' | null>;
}) {
  const { t, money } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'pending' | 'paid' | 'failed' | null>(
    'pending'
  );
  const [checking, setChecking] = useState(false);

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const muted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = await window.api.invoke('payments:linkQr', url);
        if (!cancelled) setQr(dataUrl);
      } catch {
        if (!cancelled) setQr(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the QR and WhatsApp routes still work */
    }
  };

  const sendWhatsApp = async () => {
    const digits = String(mobile ?? '').replace(/\D/g, '');
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
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm px-3'>
      <div
        className={`${bg} ${border} border rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden`}
      >
        <div
          className={`flex items-start justify-between px-5 py-4 border-b ${border}`}
        >
          <div className='space-y-0.5'>
            <div className={`text-[11px] uppercase tracking-[0.14em] ${muted}`}>
              {t('pay.title')}
            </div>
            <div className={`text-base font-semibold ${text}`}>
              <span className='money'>{money(amount)}</span>{' '}
              <span className={`text-xs font-normal ${muted}`}>
                {t('common.currency')}
              </span>
            </div>
            {orderLabel && (
              <div className={`text-[11px] ${muted}`}>{orderLabel}</div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className={`rounded-full p-1.5 ${
              theme === 'dark'
                ? 'hover:bg-white/10 text-slate-300'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        <div className='p-5 space-y-4'>
          <p className={`text-sm text-center ${muted}`}>{t('pay.scanHint')}</p>

          <div className='flex justify-center'>
            {qr ? (
              <img
                src={qr}
                alt={t('pay.qrAlt')}
                className='w-56 h-56 rounded-lg bg-white p-2'
              />
            ) : (
              <div
                className={`w-56 h-56 rounded-lg flex items-center justify-center text-xs ${muted} ${
                  theme === 'dark' ? 'bg-white/5' : 'bg-gray-100'
                }`}
              >
                {t('common.loading')}
              </div>
            )}
          </div>

          <div
            className={`text-[11px] break-all rounded-lg px-3 py-2 ${muted} ${
              theme === 'dark' ? 'bg-white/5' : 'bg-gray-50'
            }`}
            dir='ltr'
          >
            {url}
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <button
              onClick={copy}
              className={`h-10 rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${
                theme === 'dark'
                  ? 'bg-white/10 hover:bg-white/20 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
              }`}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t('pay.copied') : t('pay.copy')}
            </button>

            <button
              onClick={sendWhatsApp}
              disabled={!String(mobile ?? '').replace(/\D/g, '')}
              title={
                String(mobile ?? '').replace(/\D/g, '')
                  ? undefined
                  : t('pay.needMobile')
              }
              className='h-10 rounded-lg text-sm font-medium flex items-center justify-center gap-2
                bg-emerald-600 hover:bg-emerald-500 text-white
                disabled:opacity-40 disabled:cursor-not-allowed'
            >
              <MessageCircle size={16} />
              {t('pay.whatsapp')}
            </button>
          </div>

          {onCheckStatus && (
            <button
              onClick={check}
              disabled={checking}
              className={`w-full h-10 rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${
                status === 'paid'
                  ? 'bg-emerald-600 text-white'
                  : theme === 'dark'
                  ? 'bg-white/5 hover:bg-white/10 text-slate-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
              } disabled:opacity-50`}
            >
              <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
              {status === 'paid'
                ? t('pay.paid')
                : status === 'failed'
                ? t('pay.failed')
                : t('pay.checkStatus')}
            </button>
          )}
        </div>

        <div className={`px-5 py-3 border-t ${border} flex justify-end`}>
          <button
            onClick={onClose}
            className={`px-4 h-9 rounded-lg text-sm font-semibold ${
              theme === 'dark'
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
