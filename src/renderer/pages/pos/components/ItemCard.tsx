import { useState, useEffect } from 'react';
import { Package, Puzzle, Layers } from 'lucide-react';
import { fileUrl } from '../../../utils/fileUrl';
import { useI18n } from '../../../i18n';
import { Item } from '../types';

export function ItemCard({
  item,
  onAddItem,
  onSelectWithAddons,
}: {
  item: Item;
  /** Not read: colours come from tokens. Kept so call sites compile. */
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

  const outOfStock = item.is_outofstock === 1;

  const handleClick = () => {
    if (outOfStock) return;

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
      disabled={outOfStock}
      // Out of stock: the card keeps full-strength text; a solid red chip over
      // a surface scrim states it. No opacity on text, no black wash.
      className={`ui-card ui-card-raise group relative flex flex-col text-start p-3
        ${outOfStock ? 'cursor-not-allowed' : 'hover:border-[var(--line-strong)] active:scale-[.99]'}`}
    >
      {/* IMAGE + OPTIONS BADGE */}
      <div className='relative w-full pos-thumb rounded-[14px] overflow-hidden bg-surface-2 mb-2'>
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
            <Package size={30} strokeWidth={1.8} className='ink-2' />
          </div>
        )}

        {needsOptions && (
          <span
            className={`ui-chip absolute start-1.5 bottom-1.5 ${
              'ui-chip-gray'
            }`}
          >
            {hasVariations ? (
              <Layers size={12} strokeWidth={1.8} />
            ) : (
              <Puzzle size={12} strokeWidth={1.8} />
            )}
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
        <h3 className='font-semibold text-foreground pos-sm leading-snug line-clamp-2'>
          {localName(item)}
        </h3>
        <p className='pos-xs ink-2 line-clamp-1'>
          {isRTL ? item.name : item.name_ar}
        </p>
      </div>

      {/* PRICE ONLY */}
      <div className='mt-1 flex items-baseline justify-end gap-1'>
        {hasVariations && (
          <span className='pos-xs font-medium ink-2'>
            {t('pos.from')}
          </span>
        )}
        {/* `--ink`, not brand: bare brand text is only as legible as the shop's colour. */}
        <span className='pos-price font-semibold tabular-nums text-foreground'>
          <span className='money'>{money(displayPrice)}</span>
        </span>
      </div>

      {outOfStock && (
        <div className='absolute inset-0 flex items-center justify-center rounded-[20px] bg-surface/80'>
          <span className='ui-chip ui-chip-red'>{t('pos.outOfStock')}</span>
        </div>
      )}
    </button>
  );
}
