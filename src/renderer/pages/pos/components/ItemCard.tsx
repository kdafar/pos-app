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
  /**
   * No longer read: every colour on this card is a HeroUI semantic token that
   * resolves correctly under both themes. Kept on the type so existing call
   * sites still compile until they are cleaned up.
   */
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
      /*
        The whole card used to drop to opacity-50 when out of stock, which faded
        the "out of stock" label itself along with the name and the price — the
        one card on the grid that has something to say was the hardest to read.
        The card now stays at full strength and only the image dims; the state
        is stated by a solid danger pill instead.
      */
      className={`group relative flex flex-col rounded-xl border text-start transition-colors
        ${
          outOfStock
            ? 'bg-default-100 border-default-200 cursor-not-allowed'
            : 'bg-content1 border-default-200 hover:bg-default-100 hover:border-primary'
        } p-2.5`}
    >
      {/* IMAGE + ADDONS BADGE */}
      <div
        className={`relative w-full pos-thumb rounded-lg overflow-hidden border border-default-200 mb-2
          bg-default-100 ${outOfStock ? 'opacity-40' : ''}`}
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
            <Package size={30} className='text-default-700' />
          </div>
        )}

        {needsOptions && (
          // Both badges are solid fills paired with their own `-foreground`
          // token, which is the only combination that is guaranteed legible on
          // either theme — the previous four-way light/dark branch put white on
          // amber, which is under 2:1.
          <span
            className={`absolute start-1.5 bottom-1.5 inline-flex items-center gap-1 pos-xs px-1.5 py-0.5 rounded-full font-semibold shadow-sm
              ${
                hasVariations
                  ? 'bg-warning text-warning-foreground'
                  : 'bg-primary text-primary-foreground'
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
        <h3 className='font-semibold text-foreground pos-sm leading-snug line-clamp-2'>
          {localName(item)}
        </h3>
        <p className='pos-xs text-default-700 line-clamp-1'>
          {isRTL ? item.name : item.name_ar}
        </p>
      </div>

      {/* PRICE ONLY */}
      <div className='mt-1 flex items-baseline justify-end gap-1'>
        {hasVariations && (
          <span className='pos-xs font-medium text-default-700'>
            {t('pos.from')}
          </span>
        )}
        {/*
          `text-foreground`, not `text-primary`, and this is not a style
          preference: theme/brand.ts writes the operator's brand hex straight
          into --heroui-primary and shares that one ramp between the light and
          the dark theme. Only `-foreground` is recomputed per brand, so
          `bg-primary text-primary-foreground` is always safe while bare
          `text-primary` is only as legible as the shop's brand colour happens
          to be — a navy or maroon brand hides it on the dark theme. The price
          is the number the card exists to show, so it does not get to depend on
          that. Same call PageShell's StatCard makes for its headline figure.
        */}
        <span className='pos-price font-bold text-foreground'>
          <span className='money'>{money(displayPrice)}</span>
        </span>
      </div>

      {outOfStock && (
        // A scrim in `content1` rather than black: on the light theme a black
        // wash turned a pale card into a dark one, so the grid read as if the
        // unavailable items were the selected ones.
        <div className='absolute inset-0 flex items-center justify-center rounded-xl bg-content1/70'>
          <span className='rounded-md bg-danger px-2.5 py-1 pos-sm font-bold text-danger-foreground shadow-sm'>
            {t('pos.outOfStock')}
          </span>
        </div>
      )}
    </button>
  );
}
