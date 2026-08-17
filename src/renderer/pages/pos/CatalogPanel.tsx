// src/renderer/pages/pos/CatalogPanel.tsx
import React from 'react';
import { Input } from '@heroui/react';
import { Search, Package, AlertTriangle } from 'lucide-react';

// Shared types
import { Item, Category } from './types';
import { ItemCard } from './components/ItemCard';
import { useI18n } from '../../i18n';

export default function CatalogPanel({
  theme,
  items,
  categories,
  subcategories,
  searchQuery,
  setSearchQuery,
  selectedCategoryId,
  setSelectedCategoryId,
  selectedSubcategoryId,
  setSelectedSubcategoryId,
  onAddItem,
  onSelectWithAddons,
  totalItems,
}: {
  theme: 'light' | 'dark';
  items: Item[];
  /** True number of matches; when > items.length the grid is truncated. */
  totalItems?: number;
  categories: Category[];
  subcategories: Category[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;
  selectedSubcategoryId: string | null;
  setSelectedSubcategoryId: (id: string | null) => void;
  onAddItem: (it: Item) => void;
  onSelectWithAddons?: (it: Item) => void;
}) {
  const { t, name: localName } = useI18n();

  /* ---------- Diagnostics & Normalization ---------- */
  const safeCats = React.useMemo(
    () => (categories ?? []).map((c) => ({ ...c, id: String(c.id) })),
    [categories]
  );
  const safeSubs = React.useMemo(
    () =>
      (subcategories ?? []).map((s) => ({
        ...s,
        id: String(s.id),
        category_id: String(s.category_id),
      })),
    [subcategories]
  );
  const selCat = selectedCategoryId == null ? null : String(selectedCategoryId);

  // A search spans the whole catalogue, so while one is active the category
  // chips no longer describe what is on screen. Leaving one lit would claim a
  // scope the results do not have.
  const isSearching = searchQuery.trim().length > 0;

  const itemCatSet = React.useMemo(() => {
    const s = new Set<string>();
    for (const it of items || [])
      if (it.category_id != null) s.add(String(it.category_id));
    return s;
  }, [items]);

  React.useEffect(() => {
    console.groupCollapsed('%c[CatalogPanel] props snapshot', 'color:#60a5fa');
    console.log('theme:', theme);
    console.log('items:', {
      count: items?.length,
      sample: (items || []).slice(0, 3),
    });
    console.log('categories(raw):', categories);
    console.log('categories(safe):', {
      count: safeCats.length,
      sample: safeCats.slice(0, 10),
    });
    console.log('subcategories(raw):', subcategories);
    console.log('subcategories(safe):', {
      count: safeSubs.length,
      sample: safeSubs.slice(0, 10),
    });
    console.log('selectedCategoryId:', selectedCategoryId, '->', selCat);
    console.log('selectedSubcategoryId:', selectedSubcategoryId);
    console.log('itemCatSet(from items):', Array.from(itemCatSet));
    if (!safeCats.length && (items?.length ?? 0) > 0) {
      console.warn(
        '[CatalogPanel] items exist but categories array is empty. Check IPC: catalog:listCategories'
      );
    }
    if (safeCats.length && !itemCatSet.size) {
      console.warn(
        '[CatalogPanel] categories loaded but no items reference a category_id.'
      );
    }
    console.groupEnd();
  }, [
    theme,
    items,
    categories,
    subcategories,
    selCat,
    selectedSubcategoryId,
    itemCatSet,
  ]);

  const filteredSubcategories = React.useMemo(() => {
    const out = safeSubs.filter(
      (sub) => !selCat || String(sub.category_id) === selCat
    );
    console.debug('[CatalogPanel] filteredSubcategories:', {
      selCat,
      outCount: out.length,
      sample: out.slice(0, 6),
    });
    return out;
  }, [safeSubs, selCat]);

  /**
   * One chip style for both rows, so "selected" reads the same wherever it
   * appears. Every colour here is a HeroUI semantic token: the two hand-rolled
   * light/dark branches this replaced disagreed about which one was authoritative,
   * and the loser was always unreadable on one of the two themes.
   */
  const chipBase =
    'shrink-0 px-3.5 py-2 pos-sm font-medium rounded-lg whitespace-nowrap border transition-colors';
  const chipIdle =
    'bg-default-100 text-default-700 border-default-200 hover:bg-default-200';
  /**
   * Solid fill. `-foreground` is the one token theme/brand.ts recomputes from
   * the operator's brand luminance, so it is the only text colour guaranteed to
   * survive an arbitrary brand hex sitting underneath it.
   */
  const chipOnStrong = 'bg-primary text-primary-foreground border-primary';
  /**
   * Tinted fill, so a chosen subcategory reads as subordinate to its category.
   * The label stays `text-foreground` rather than `text-primary`: brand.ts
   * shares one primary ramp across both themes, so brand-coloured text on a
   * neutral surface is only legible for brands that happen to be mid-toned.
   * The selection is carried by the solid border and the wash instead.
   */
  const chipOnSoft = 'bg-primary/20 text-foreground border-primary';

  return (
    <div className='flex flex-col overflow-hidden'>
      {/* Filters */}
      <div className='sticky top-0 z-10 bg-content1 backdrop-blur p-4 border-b border-default-200'>
        {/* Search */}
        <div className='mb-3'>
          <Input
            value={searchQuery}
            onValueChange={(v) => {
              console.debug('[CatalogPanel] setSearchQuery:', v);
              setSearchQuery(v);
            }}
            placeholder={t('pos.searchPlaceholder')}
            aria-label={t('pos.searchPlaceholder')}
            // `lg`, not the default: this is the control a cashier hits most on
            // the busiest screen in the app, and it is aimed at with a finger.
            size='lg'
            isClearable
            onClear={() => setSearchQuery('')}
            startContent={<Search size={18} className='text-default-700' />}
          />
        </div>

        {/* Categories */}
        <div className='mb-3'>
          {isSearching && (
            <div className='mb-1.5 pos-xs font-medium text-default-700'>
              {t('pos.searchAllCategories')}
            </div>
          )}
          {/*
            The chips used to drop to opacity-50 while a search was running.
            They stay live controls in that state — tapping one clears the
            search and browses the category — so half-fading their labels hid
            the way out of the search instead of explaining it. The note above
            says the same thing without making anything harder to read; nothing
            being lit already shows that no category is in scope.
          */}
          <div className='flex items-center gap-1.5 overflow-x-auto chip-scroll pb-1'>
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All Categories');
                setSearchQuery('');
                setSelectedCategoryId(null);
              }}
              className={`${chipBase} ${
                !selCat && !isSearching ? chipOnStrong : chipIdle
              }`}
            >
              {t('pos.categories')}
            </button>

            {safeCats.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  console.debug('[CatalogPanel] click category', {
                    id: cat.id,
                    name: cat.name,
                  });
                  // Picking a category is a request to browse it, which the
                  // active search would otherwise override.
                  setSearchQuery('');
                  setSelectedCategoryId(String(cat.id));
                  setSelectedSubcategoryId(null);
                }}
                className={`${chipBase} ${
                  selCat === String(cat.id) && !isSearching
                    ? chipOnStrong
                    : chipIdle
                }`}
              >
                {localName(cat)}
              </button>
            ))}
          </div>
        </div>

        {/* Subcategories */}
        {filteredSubcategories.length > 0 && (
          <div className='flex items-center gap-1.5 overflow-x-auto chip-scroll pb-1'>
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All subcategories');
                setSearchQuery('');
                setSelectedSubcategoryId(null);
              }}
              className={`${chipBase} ${
                !selectedSubcategoryId && !isSearching ? chipOnSoft : chipIdle
              }`}
            >
              {t('common.all')}
            </button>
            {filteredSubcategories.map((sub) => (
              <button
                key={sub.id}
                onClick={() => {
                  console.debug('[CatalogPanel] click subcategory', {
                    id: sub.id,
                    name: sub.name,
                    category_id: sub.category_id,
                  });
                  setSearchQuery('');
                  setSelectedSubcategoryId(String(sub.id));
                }}
                className={`${chipBase} ${
                  selectedSubcategoryId === String(sub.id) && !isSearching
                    ? chipOnSoft
                    : chipIdle
                }`}
              >
                {localName(sub)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Product grid */}
      <div className='flex-1 overflow-y-auto nice-scroll'>
        {/*
          Column count follows the available width instead of being declared.
          The fixed `grid-cols-5` broke on exactly the screens it was meant to
          fill: Windows display scaling at 150% turns a 1920px monitor into
          1280 CSS px, so five cards plus the 420px order panel left each card
          around 130px — unreadable, with the price wrapping under the name.
          auto-fill + minmax gives four cards there and eight on a 4K panel
          without a single breakpoint.
        */}
        <div className='grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-3'>
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              theme={theme}
              onAddItem={onAddItem}
              onSelectWithAddons={onSelectWithAddons}
            />
          ))}
        </div>

        {typeof totalItems === 'number' && totalItems > items.length && (
          // The warning tone is carried by the icon and the border, not by the
          // sentence: `text-warning` on a warning tint is amber-on-amber, and
          // this line exists to tell a cashier that the item they cannot find
          // may simply not be on screen.
          <div className='mx-3 mb-3 flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/15 px-3 py-2'>
            <AlertTriangle size={16} className='shrink-0 text-warning' />
            <span className='pos-xs font-medium text-foreground'>
              {t('pos.showingOf', { shown: items.length, total: totalItems })}
            </span>
          </div>
        )}

        {items.length === 0 && (
          <div className='flex flex-col items-center justify-center h-56 text-default-700'>
            <Package size={40} className='mb-3' />
            <p className='pos-base font-medium'>{t('pos.noItems')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
