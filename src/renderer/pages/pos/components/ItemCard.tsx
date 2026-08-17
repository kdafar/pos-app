import React, { useState, useEffect } from 'react';
import { Package, Puzzle, Layers } from 'lucide-react';
import { fileUrl } from '../../../utils/fileUrl';
import { useI18n } from '../../../i18n';
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
  const { t, name: localName, money, isRTL } = useI18n();
  const [localImageFailed, setLocalImageFailed] = useState(false);

  const localSrc = item.image_local ? fileUrl(item.image_local) : null;
  const remoteSrc = item.image || null;
  const activeSrc = localSrc && !localImageFailed ? localSrc : remoteSrc;

  useEffect(() => {
    setLocalImageFailed(false);
  }, [item.id, item.image_local]);

  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = 'text-default-500';
  const hasAddons = !!item.has_addons;
  const hasVariations = !!item.has_variations;
  const needsOptions = hasAddons || hasVariations;

  // For variation items the bare item price is usually a placeholder, so show
  // the cheapest variation instead of a number the cashier can't actually ring up.
  const minVariationPrice = Number(item.min_variation_price);
  const displayPrice =
    hasVariations && Number.isFinite(minVariationPrice) && minVariationPrice > 0
      ? minVariationPrice
      : Number(item.price || 0);

  const handleClick = () => {
    if (item.is_outofstock === 1) return;

    if (needsOptions && onSelectWithAddons) {
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
      className={`group relative flex flex-col rounded-xl border text-start transition
        ${
          item.is_outofstock === 1
            ? 'bg-default-100 border-default-100 opacity-50 cursor-not-allowed'
            : 'bg-default-100 border-default-200 hover:bg-default-200 hover:border-blue-500/40'
        } p-2.5`}
    >
      {/* IMAGE + ADDONS BADGE */}
      <div
        className={`relative w-full pos-thumb rounded-lg overflow-hidden border mb-2
          ${
            'bg-slate-900 border-default-100'
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

        {needsOptions && (
          <span
            className={`absolute left-1.5 bottom-1.5 inline-flex items-center gap-1 pos-xs px-1.5 py-0.5 rounded-full font-medium shadow-sm
              ${
                hasVariations
                  ? theme === 'dark'
                    ? 'bg-amber-500/90 text-white'
                    : 'bg-amber-600 text-white'
                  : theme === 'dark'
                  ? 'bg-indigo-500/90 text-white'
                  : 'bg-indigo-600 text-white'
              }`}
          >
            {hasVariations ? <Layers size={11} /> : <Puzzle size={11} />}
            {hasVariations
              ? hasAddons
                ? t('pos.options')
                : t('pos.sizes')
              : t('pos.addons')}
          </span>
        )}
      </div>

      {/* TITLE */}
      <div className='flex-1 mb-1'>
        <h3
          className={`font-semibold ${text} pos-sm leading-snug line-clamp-2`}
        >
          {localName(item)}
        </h3>
        <p className={`pos-xs ${textMuted} line-clamp-1`}>
          {isRTL ? item.name : item.name_ar}
        </p>
      </div>

      {/* PRICE ONLY */}
      <div className='mt-1 flex items-baseline justify-end gap-1'>
        {hasVariations && (
          <span className={`pos-xs ${textMuted}`}>{t('pos.from')}</span>
        )}
        <span
          className={`pos-price font-bold ${
            'text-primary'
          }`}
        >
          <span className='money'>{money(displayPrice)}</span>
        </span>
      </div>

      {item.is_outofstock === 1 && (
        <div className='absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl'>
          <span className='text-red-400 font-semibold text-sm'>
            {t('pos.outOfStock')}
          </span>
        </div>
      )}
    </button>
  );
}
