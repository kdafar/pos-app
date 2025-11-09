import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useThemeTokens } from '../../hooks/useThemeTokens';
import type { Promo } from '../../../types';

export default function PromoDialog({
  promos,
  onClose,
  onApply,
}: {
  promos: Promo[];
  onClose: () => void;
  onApply: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const { t, theme } = useThemeTokens();

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${theme === 'dark' ? 'bg-slate-900' : 'bg-white'} border ${t.border} rounded-xl w-full max-w-md p-4`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-xl font-bold ${t.text}`}>Apply Promo Code</h2>
          <button onClick={onClose} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
            <X size={22} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Enter promo code"
              className={`w-full px-3 py-2.5 ${t.inputBg} rounded-lg ${t.text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
              }`}
            />
          </div>

          <button
            onClick={() => code && onApply(code)}
            disabled={!code}
            className={`w-full px-4 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              theme === 'dark' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                                : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
            }`}
          >
            Apply Code
          </button>

          {promos?.length > 0 && (
            <div>
              <div className={`text-xs font-medium ${t.textMuted} mb-2 mt-4`}>Available Promo Codes:</div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {promos
                  .filter((p) => (p as any).active) // keep your original condition
                  .map((promo) => (
                    <button
                      key={promo.id}
                      onClick={() => onApply(promo.code)}
                      className={`w-full p-2.5 rounded-lg border text-left transition ${
                        theme === 'dark' ? 'bg-white/5 border-white/10 hover:bg-white/10'
                                          : 'bg-white border-gray-200 hover:border-blue-400'
                      }`}
                    >
                      <div className={`font-semibold ${t.text} text-sm`}>{promo.code}</div>
                      <div className={`text-xs ${t.textMuted}`}>
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
