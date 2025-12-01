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
  onSelectWithAddons?: (it: Item) => void;
}) {
  const [localImageFailed, setLocalImageFailed] = useState(false);

  const localSrc = item.image_local ? fileUrl(item.image_local) : null;
  const remoteSrc = item.image || null;
  const activeSrc = localSrc && !localImageFailed ? localSrc : remoteSrc;

  useEffect(() => {
    setLocalImageFailed(false);
  }, [item.id, item.image_local]);

  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const hasAddons = !!item.has_addons;

  const handleClick = () => {
    if (item.is_outofstock === 1) return;

    if (hasAddons && onSelectWithAddons) {
      onSelectWithAddons(item);
    } else {
      onAddItem(item);
    }
  };

  return (
    <button
      key={item.id}
      onClick={handleClick}
      disabled={item.is_outofstock === 1}
      className={`group relative flex flex-col rounded-xl border text-left transition
        ${
          item.is_outofstock === 1
            ? theme === 'dark'
              ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
              : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
            : theme === 'dark'
            ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-blue-500/40'
            : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md'
        } p-2.5`}
    >
      {/* IMAGE + ADDONS BADGE */}
      <div
        className={`relative w-full h-24 rounded-lg overflow-hidden border mb-2
          ${
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
              className={theme === 'dark' ? 'text-slate-600' : 'text-gray-400'}
            />
          </div>
        )}

        {hasAddons && (
          <span
            className={`absolute left-1.5 bottom-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shadow-sm
              ${
                theme === 'dark'
                  ? 'bg-indigo-500/90 text-white'
                  : 'bg-indigo-600 text-white'
              }`}
          >
            <Puzzle size={11} />
            Add-ons
          </span>
        )}
      </div>

      {/* TITLE */}
      <div className='flex-1 min-h-[2.3rem] mb-1'>
        <h3
          className={`font-semibold ${text} text-[13px] leading-snug line-clamp-2`}
        >
          {item.name}
        </h3>
        <p className={`text-[11px] ${textMuted} line-clamp-1`}>
          {item.name_ar}
        </p>
      </div>

      {/* PRICE ONLY */}
      <div className='mt-1 flex items-center justify-end'>
        <span
          className={`text-[15px] font-bold ${
            theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
          }`}
        >
          {item.price.toFixed(3)}
        </span>
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
