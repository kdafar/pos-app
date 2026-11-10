import { useState, useEffect } from 'react';
import { Puzzle, Layers } from 'lucide-react';
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
  const { t, name: localName, money } = useI18n();
  const [localImageFailed, setLocalImageFailed] = useState(false);
  const [remoteImageFailed, setRemoteImageFailed] = useState(false);

  const localSrc = item.image_local ? fileUrl(item.image_local) : null;
  const remoteSrc = item.image && !remoteImageFailed ? item.image : null;
  const activeSrc = localSrc && !localImageFailed ? localSrc : remoteSrc;
  // No photo (or it failed to load): a compact text card, no empty image box.
  const compact = !activeSrc;

  useEffect(() => {
    setLocalImageFailed(false);
    setRemoteImageFailed(false);
  }, [item.id, item.image_local, item.image]);

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

  const optionsChip = needsOptions && (
    <span
      className={`ui-chip ${
        hasVariations ? (hasAddons ? 'ui-chip-options' : 'ui-chip-sizes') : 'ui-chip-addons'
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
  );

  return (
    <button
      key={item.id}
      onClick={handleClick}
      disabled={outOfStock}
      // Out of stock: the card SURFACE is dimmed and a solid red chip says why;
      // the text stays full strength.
      className={`ui-card ui-card-raise group relative flex flex-col text-start p-3
        ${outOfStock ? 'cursor-not-allowed !bg-[var(--surface-2)]' : 'hover:border-[var(--line-strong)] active:scale-[.99]'}`}
    >
      {/* IMAGE (only when there is one) */}
      {!compact && (
        <div className='relative w-full pos-thumb rounded-[14px] overflow-hidden bg-surface-2 mb-2'>
          <img
            src={activeSrc!}
            alt={item.name}
            loading='lazy'
            className={`w-full h-full object-cover object-center ${outOfStock ? 'opacity-50' : ''}`}
            onError={() => {
              if (activeSrc === localSrc) setLocalImageFailed(true);
              else setRemoteImageFailed(true);
            }}
          />
          {optionsChip && (
            <span className='absolute start-1.5 bottom-1.5 flex'>{optionsChip}</span>
          )}
          {outOfStock && (
            <span className='ui-chip ui-chip-red absolute start-1.5 top-1.5'>
              {t('pos.outOfStock')}
            </span>
          )}
        </div>
      )}

      {/* TITLE */}
      <div className='mb-1'>
        {/* Full names, never cut: a cashier must read the whole dish. */}
        <h3 className='font-semibold text-foreground pos-sm leading-snug break-words'>
          {localName(item)}
        </h3>
      </div>

      {/* Compact card: chips inline under the name */}
      {compact && (optionsChip || outOfStock) && (
        <div className='mb-1 flex flex-wrap gap-1'>
          {optionsChip}
          {outOfStock && (
            <span className='ui-chip ui-chip-red'>{t('pos.outOfStock')}</span>
          )}
        </div>
      )}

      {/* PRICE ONLY */}
      <div className='mt-auto pt-1 flex items-baseline justify-end gap-1'>
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
    </button>
  );
}
