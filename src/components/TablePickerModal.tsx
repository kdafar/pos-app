import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useOrderContext } from '../context/OrderContext';
import { useTheme } from '../context/ThemeContext';
import { TableInfo, TableStatus } from '../types';

export function TablePickerModal() {
  const { theme } = useTheme();
  const { tables, currentOrder, actions } = useOrderContext();

  const [covers, setCovers] = useState<number>(currentOrder?.covers || 2);

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-300' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';

  const colorFor = (s: TableStatus) => {
    if (s === 'available') {
      return theme === 'dark'
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-600/30'
        : 'bg-emerald-100 text-emerald-700 border-emerald-300';
    }
    if (s === 'reserved') {
      return theme === 'dark'
        ? 'bg-amber-500/15 text-amber-300 border-amber-600/30'
        : 'bg-amber-100 text-amber-700 border-amber-300';
    }
    return theme === 'dark'
      ? 'bg-rose-500/15 text-rose-300 border-rose-600/30'
      : 'bg-rose-100 text-rose-700 border-rose-300';
  };
  
  if (!currentOrder) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${bg} border ${border} rounded-xl w-full max-w-3xl p-4 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-xl font-bold ${text}`}>Assign Table</h2>
          <div className="flex items-center gap-2">
            <label className={`text-xs ${textMuted}`}>Covers</label>
            <input
              type="number"
              min={1}
              className={`w-16 px-2 py-1.5 ${inputBg} rounded-md ${text}`}
              value={covers}
              onChange={e => setCovers(Math.max(1, Number(e.target.value || 1)))}
            />
            <button
              onClick={actions.loadTables}
              className={`px-3 py-1.5 rounded-md border text-xs ${
                theme === 'dark'
                  ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              Refresh
            </button>
            <button onClick={actions.closeTablePicker} className={theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>
              <X size={22} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {tables.map((t: TableInfo) => (
            <button
              key={t.id}
              onClick={() => t.status === 'available' ? actions.assignTable(t, covers) : null}
              disabled={t.status !== 'available'}
              className={`p-3 rounded-lg border text-left transition ${colorFor(t.status)} ${
                t.status !== 'available' ? 'opacity-70 cursor-not-allowed' : 'hover:brightness-110'
              }`}
              title={`${t.name} • ${t.seats} seats`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">{t.name}</div>
                <span className="text-[11px] opacity-80 capitalize">{t.status}</span>
              </div>
              <div className={`text-xs ${textMuted}`}>Seats: {t.seats}</div>
            </button>
          ))}
        </div>

        {tables.length === 0 && (
          <div className={`${textMuted} text-sm py-8 text-center`}>No tables found.</div>
        )}
      </div>
    </div>
  );
}