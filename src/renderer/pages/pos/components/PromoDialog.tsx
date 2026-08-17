// components/PromoDialog.tsx
import React, { useState } from 'react';
import { X, Percent } from 'lucide-react';
import { Promo } from '../types';
import { useI18n } from '../../../i18n';

export function PromoDialog({ promos, theme, onClose, onApply }: { promos: Promo[]; theme: 'light'|'dark'; onClose: () => void; onApply: (code: string) => Promise<void>; }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>('');
  const { t, money } = useI18n();

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = 'border-default-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = 'text-default-600';
  const inputBg = 'bg-default-100 border-default-200';

    const isPromoActive = (p: Promo) => {
    // No flag at all? Assume active.
    if (p.active === undefined || p.active === null) return true;

    if (typeof p.active === 'boolean') return p.active;

    const n = Number(p.active);
    if (!Number.isNaN(n)) {
      return n === 1; // 1 / 0 style
    }

    const s = String(p.active).toLowerCase();
    if (['inactive', 'disabled', 'false', 'no', '0'].includes(s)) return false;
    return true; // anything else counts as active
  };

  const isValidLocal = (c: string) => {
    const normalized = c.trim().toUpperCase();
    if (!normalized) return false;

    return promos.some(p =>
      isPromoActive(p) &&
      (p.code || '').toUpperCase() === normalized
    );
  };


  const apply = async (c: string) => {
    const normalized = (c || code).trim().toUpperCase();
    setErr('');
    if (!normalized) return;
    if (!isValidLocal(normalized)) {
      setErr(t('promo.invalid'));
      return;
    }
    try {
      await onApply(normalized);
      onClose();
    } catch (e) {
      setErr(t('promo.applyFailed'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${bg} border ${border} rounded-xl w-full max-w-md p-4`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-xl font-bold ${text}`}>{t('promo.title')}</h2>
          <button onClick={onClose} className={'text-default-500 hover:text-white'}>
            <X size={22} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <input
              value={code}
              onChange={e => { setErr(''); setCode(e.target.value.toUpperCase()); }}
              placeholder={t('promo.placeholder')}
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
              'bg-primary text-primary-foreground'
            }`}
          >
            {t('promo.applyCode')}
          </button>

          {promos && promos.length > 0 && (
            <div>
              <div className={`text-xs font-medium ${textMuted} mb-2 mt-4`}>{t('promo.available')}</div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {promos.filter(isPromoActive).map((promo: Promo) => (
                  <button key={promo.id} onClick={() => apply(promo.code)}
                    className={`w-full p-2.5 rounded-lg border text-start transition ${
                      'bg-default-100 border-default-200 hover:bg-default-200'
                    }`}
                  >
                    {/* Promo codes are Latin alphanumerics — never mirror them. */}
                    <div className={`font-semibold ${text} text-sm`}><span className='money'>{promo.code}</span></div>
                    <div className={`text-xs ${textMuted}`}>
                      {promo.type === 'percent'
                        ? t('promo.percentOff', { value: promo.value })
                        : t('promo.amountOff', { value: money(promo.value) })}
                      {promo.min_total > 0 && (
                        <>
                          {' • '}
                          {t('promo.min')}:{' '}
                          <span className='money'>{money(promo.min_total)}</span>
                        </>
                      )}
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
