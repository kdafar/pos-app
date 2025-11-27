import React, { useState, useEffect } from 'react';
import { Package, Puzzle } from 'lucide-react';
import { fileUrl } from '../../../utils/fileUrl';
import { Item } from '../types';

export function ItemCard({
  item,
  theme,
  onAddItem,
  onSelectWithAddons,
}: {
  item: Item;
  theme: 'light' | 'dark';
  onAddItem: (it: Item) => void;
  /** Optional: if provided and item.has_addons is true, this will be called instead of onAddItem */
  onSelectWithAddons?: (it: Item) => void;
}) {
  const [localImageFailed, setLocalImageFailed] = useState(false);

  // Sources
  const localSrc = item.image_local ? fileUrl(item.image_local) : null;
  const remoteSrc = item.image || null;
  const activeSrc = localSrc && !localImageFailed ? localSrc : remoteSrc;

  useEffect(() => {
    setLocalImageFailed(false);
  }, [item.id, item.image_local]);

  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const hasAddons = !!item.has_addons; // number|bool → bool

  const handleClick = () => {
    if (item.is_outofstock === 1) return;

    if (hasAddons && onSelectWithAddons) {
      // Open addons selection (modal, drawer, etc.)
      onSelectWithAddons(item);
    } else {
      // Simple add to order
      onAddItem(item);
    }
  };

  return (
    <button
      key={item.id}
      onClick={handleClick}
      disabled={item.is_outofstock === 1}
      className={`group relative p-3 rounded-xl border text-left transition
        ${
          item.is_outofstock === 1
            ? theme === 'dark'
              ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
              : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
            : theme === 'dark'
            ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-blue-500/40'
            : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md'
        }`}
    >
      <div className='mb-2'>
        <div
          className={`relative w-full h-24 rounded-lg mb-2 overflow-hidden border ${
            theme === 'dark'
              ? 'bg-slate-900 border-white/5'
              : 'bg-gray-100 border-gray-200'
          }`}
        >
          {activeSrc ? (
            <img
              src={activeSrc}
              alt={item.name}
              loading='lazy'
              className='w-full h-full object-cover object-center'
              onError={(e) => {
                if (activeSrc === localSrc) {
                  setLocalImageFailed(true);
                } else {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.parentElement?.classList.add(
                    'flex',
                    'items-center',
                    'justify-center'
                  );
                }
              }}
            />
          ) : (
            <div className='w-full h-full flex items-center justify-center'>
              <Package
                size={30}
                className={
                  theme === 'dark' ? 'text-slate-600' : 'text-gray-400'
                }
              />
            </div>
          )}
        </div>

        <h3 className={`font-semibold ${text} line-clamp-2 leading-snug`}>
          {item.name}
        </h3>
        <p className={`text-xs ${textMuted} line-clamp-1`}>{item.name_ar}</p>
      </div>

      <div className='flex items-center justify-between gap-1'>
        <span
          className={`text-[11px] ${
            theme === 'dark'
              ? 'text-slate-500 bg-white/5'
              : 'text-gray-500 bg-gray-100'
          } px-1.5 py-0.5 rounded`}
        >
          {item.barcode || '—'}
        </span>

        <div className='flex items-center gap-1.5'>
          {hasAddons && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium
                ${
                  theme === 'dark'
                    ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/40'
                    : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                }`}
            >
              <Puzzle size={11} />
              Add-ons
            </span>
          )}
          <span
            className={`text-[15px] font-bold ${
              theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
            }`}
          >
            {item.price.toFixed(3)}
          </span>
        </div>
      </div>

      {item.is_outofstock === 1 && (
        <div className='absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl'>
          <span className='text-red-400 font-semibold text-sm'>
            Out of Stock
          </span>
        </div>
      )}
    </button>
  );
}
