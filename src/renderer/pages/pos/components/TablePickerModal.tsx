// components/TablePickerModal.tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { TableInfo, TableStatus, Order } from '../types';

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

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const inputBg =
    theme === 'dark'
      ? 'bg-white/5 border-white/10'
      : 'bg-white border-gray-300';

  const colorFor = (s: TableStatus) => {
    if (s === 'available')
      return theme === 'dark'
        ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/40'
        : 'bg-emerald-50 text-emerald-700 border-emerald-300';
    if (s === 'reserved')
      return theme === 'dark'
        ? 'bg-amber-500/10 text-amber-200 border-amber-500/40'
        : 'bg-amber-50 text-amber-700 border-amber-300';
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
      return theme === 'dark'
        ? 'bg-amber-500/20 text-amber-200'
        : 'bg-amber-100 text-amber-700';
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
        <div className='flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/5'>
          <div className='flex flex-col gap-1'>
            <h2 className={`text-lg font-semibold ${text}`}>Assign Table</h2>
            <div className={`text-[11px] flex items-center gap-3 ${textMuted}`}>
              <span className='flex items-center gap-1'>
                <span
                  className={legendDot(
                    theme === 'dark' ? 'bg-emerald-400' : 'bg-emerald-500'
                  )}
                />
                Available
              </span>
              <span className='flex items-center gap-1'>
                <span
                  className={legendDot(
                    theme === 'dark' ? 'bg-amber-400' : 'bg-amber-500'
                  )}
                />
                Reserved
              </span>
              <span className='flex items-center gap-1'>
                <span
                  className={legendDot(
                    theme === 'dark' ? 'bg-rose-400' : 'bg-rose-500'
                  )}
                />
                Occupied
              </span>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <label className={`text-xs ${textMuted}`}>Covers</label>
            <input
              type='number'
              min={1}
              className={`w-16 px-2 py-1.5 rounded-md text-xs ${inputBg} ${text} focus:outline-none focus:ring-2 ${
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
                theme === 'dark'
                  ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              Refresh
            </button>
            <button
              onClick={onClose}
              className={
                theme === 'dark'
                  ? 'text-slate-400 hover:text-white'
                  : 'text-gray-400 hover:text-gray-900'
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
              No tables found.
            </div>
          )}

          {tables.length > 0 && (
            <>
              {current.table_id && (
                <p className={`${textMuted} text-[11px] mb-2`}>
                  Tip: The blue card is the table currently assigned to this
                  order. You can tap it to keep it and close this dialog.
                </p>
              )}

              <div className='grid grid-cols-2 gap-3'>
                {tables.map((t) => {
                  const isCurrent = current.table_id === t.id;
                  // 🔑 Only disable when not current AND not available
                  const disabled = !isCurrent && t.status !== 'available';

                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        if (!disabled) onAssign(t, covers);
                      }}
                      disabled={disabled}
                      title={`${t.name} • ${t.seats || 0} seats`}
                      className={`
                        relative p-3 rounded-xl border text-left text-xs
                        flex flex-col justify-between h-[110px]
                        transition
                        ${colorFor(t.status)}
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
                            {t.name}
                          </div>
                          <div className={`${textMuted} mt-1`}>
                            Seats: {t.seats || 0}
                          </div>
                        </div>
                        <span
                          className={`
                            px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap
                            ${pillFor(t.status)}
                          `}
                        >
                          {t.status === 'available'
                            ? 'Available'
                            : t.status === 'reserved'
                            ? 'Reserved'
                            : 'Occupied'}
                        </span>
                      </div>

                      {isCurrent && (
                        <div
                          className={`mt-2 text-[10px] font-medium ${
                            theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
                          }`}
                        >
                          Currently assigned to this order
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
