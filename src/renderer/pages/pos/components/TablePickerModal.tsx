// components/TablePickerModal.tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { TableInfo, TableStatus, Order } from '../types';
import { useI18n } from '../../../i18n';

export function TablePickerModal({
  tables,
  current,
  theme,
  onClose,
  onAssign,
  onRefresh,
}: {
  tables: TableInfo[];
  current: Order;
  theme: 'light' | 'dark';
  onClose: () => void;
  onAssign: (t: TableInfo, covers: number) => void;
  onRefresh: () => void;
}) {
  const [covers, setCovers] = useState<number>(current.covers || 2);
  const { t } = useI18n();

  const statusLabel = (s: TableStatus) =>
    s === 'available'
      ? t('tables.available')
      : s === 'reserved'
      ? t('tables.reserved')
      : t('tables.occupied');

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = 'border-default-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = 'text-default-500';
  const inputBg =
    'bg-default-100 border-default-200';

  const colorFor = (s: TableStatus) => {
    if (s === 'available')
      return theme === 'dark'
        ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/40'
        : 'bg-emerald-50 text-emerald-700 border-emerald-300';
    if (s === 'reserved')
      return 'bg-amber-500/10 text-warning border-amber-500/40';
    return theme === 'dark'
      ? 'bg-rose-500/10 text-rose-200 border-rose-500/40'
      : 'bg-rose-50 text-rose-700 border-rose-300';
  };

  const pillFor = (s: TableStatus) => {
    if (s === 'available')
      return theme === 'dark'
        ? 'bg-emerald-500/20 text-emerald-200'
        : 'bg-emerald-100 text-emerald-700';
    if (s === 'reserved')
      return 'bg-amber-500/20 text-warning';
    return theme === 'dark'
      ? 'bg-rose-500/20 text-rose-200'
      : 'bg-rose-100 text-rose-700';
  };

  const legendDot = (cls: string) =>
    `inline-block w-2.5 h-2.5 rounded-full ${cls}`;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'>
      <div
        className={`${bg} border ${border} rounded-2xl w-full max-w-lg shadow-xl`}
      >
        {/* Header */}
        <div className='flex items-center justify-between px-4 pt-4 pb-3 border-b border-default-100'>
          <div className='flex flex-col gap-1'>
            <h2 className={`text-lg font-semibold ${text}`}>
              {t('tables.assign')}
            </h2>
            <div className={`text-[11px] flex items-center gap-3 ${textMuted}`}>
              <span className='flex items-center gap-1'>
                <span
                  className={legendDot(
                    theme === 'dark' ? 'bg-emerald-400' : 'bg-emerald-500'
                  )}
                />
                {t('tables.available')}
              </span>
              <span className='flex items-center gap-1'>
                <span
                  className={legendDot(
                    theme === 'dark' ? 'bg-amber-400' : 'bg-amber-500'
                  )}
                />
                {t('tables.reserved')}
              </span>
              <span className='flex items-center gap-1'>
                <span
                  className={legendDot(
                    theme === 'dark' ? 'bg-rose-400' : 'bg-rose-500'
                  )}
                />
                {t('tables.occupied')}
              </span>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <label className={`text-xs ${textMuted}`}>{t('tables.covers')}</label>
            <input
              type='number'
              min={1}
              className={`w-16 px-2 py-1.5 rounded-md text-xs money ${inputBg} ${text} focus:outline-none focus:ring-2 ${
                theme === 'dark'
                  ? 'focus:ring-blue-500/60'
                  : 'focus:ring-blue-500'
              }`}
              value={covers}
              onChange={(e) =>
                setCovers(Math.max(1, Number(e.target.value || 1)))
              }
            />
            <button
              onClick={onRefresh}
              className={`px-3 py-1.5 rounded-md border text-xs font-medium transition ${
                'bg-default-100 border-default-200 text-foreground hover:bg-default-200'
              }`}
            >
              {t('tables.refresh')}
            </button>
            <button
              onClick={onClose}
              className={
                'text-default-500 hover:text-white'
              }
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className='p-4 max-h-[70vh] overflow-y-auto nice-scroll'>
          {tables.length === 0 && (
            <div className={`${textMuted} text-sm py-8 text-center`}>
              {t('tables.none')}
            </div>
          )}

          {tables.length > 0 && (
            <>
              {current.table_id && (
                <p className={`${textMuted} text-[11px] mb-2`}>
                  {t('tables.tip')}
                </p>
              )}

              <div className='grid grid-cols-2 gap-3'>
                {/* `tbl`, not `t` — `t` is the translator in this scope. */}
                {tables.map((tbl) => {
                  const isCurrent = current.table_id === tbl.id;
                  // 🔑 Only disable when not current AND not available
                  const disabled = !isCurrent && tbl.status !== 'available';

                  return (
                    <button
                      key={tbl.id}
                      onClick={() => {
                        if (!disabled) onAssign(tbl, covers);
                      }}
                      disabled={disabled}
                      title={t('tables.seatsTitle', {
                        name: tbl.name,
                        seats: tbl.seats || 0,
                      })}
                      className={`
                        relative p-3 rounded-xl border text-start text-xs
                        flex flex-col justify-between h-[110px]
                        transition
                        ${colorFor(tbl.status)}
                        ${
                          disabled
                            ? 'opacity-70 cursor-not-allowed'
                            : 'hover:-translate-y-0.5 hover:shadow-sm'
                        }
                        ${
                          isCurrent
                            ? 'ring-2 ring-blue-500/70 ring-offset-2 ring-offset-transparent'
                            : ''
                        }
                      `}
                    >
                      <div className='flex items-start justify-between gap-2'>
                        <div className='flex-1 min-w-0'>
                          <div className='text-[13px] font-semibold truncate'>
                            {tbl.name}
                          </div>
                          <div className={`${textMuted} mt-1`}>
                            {t('tables.seats')}:{' '}
                            <span className='money'>{tbl.seats || 0}</span>
                          </div>
                        </div>
                        <span
                          className={`
                            px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap
                            ${pillFor(tbl.status)}
                          `}
                        >
                          {statusLabel(tbl.status)}
                        </span>
                      </div>

                      {isCurrent && (
                        <div
                          className={`mt-2 text-[10px] font-medium ${
                            'text-primary'
                          }`}
                        >
                          {t('tables.currentlyAssigned')}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
