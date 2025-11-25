// components/PromoDialog.tsx
import React, { useState } from 'react';
import { X, Percent } from 'lucide-react';
import { Promo } from '../types';

export function PromoDialog({ promos, theme, onClose, onApply }: { promos: Promo[]; theme: 'light'|'dark'; onClose: () => void; onApply: (code: string) => Promise<void>; }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>('');

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';

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
                {promos.filter(isPromoActive).map((promo: Promo) => (
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
