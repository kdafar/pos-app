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

  // One segmented-strip style for both rows; selected = surface + shadow
  // (aria-pressed), so "selected" reads the same wherever it appears.
  const segRow = 'ui-seg max-w-full overflow-x-auto chip-scroll';
  const segItem = 'ui-seg-item shrink-0';

  return (
    <div className='flex flex-col overflow-hidden min-w-0'>
      {/* Filters */}
      {/* Search and categories share one row from 768px: one row of height
          back for the dishes. On a phone the search keeps its own row. */}
      <div className='sticky top-0 z-10 flex flex-col gap-2 bg-surface px-3 py-2.5 lg:px-4 border-b border-line md:flex-row md:items-center md:gap-3'>
        {/* Search */}
        <div className='shrink-0 md:w-56 xl:w-72'>
          <Input
            value={searchQuery}
            onValueChange={(v) => {
              console.debug('[CatalogPanel] setSearchQuery:', v);
              setSearchQuery(v);
            }}
            placeholder={t('pos.searchPlaceholder')}
            aria-label={t('pos.searchPlaceholder')}
            // Compact on a mouse; the touch rule in portal.css keeps it
            // finger-sized on touch screens.
            size='md'
            classNames={{ inputWrapper: 'ui-input pointer-coarse:min-h-11' }}
            isClearable
            onClear={() => setSearchQuery('')}
            startContent={<Search size={18} strokeWidth={1.8} className='ink-2' />}
          />
        </div>

        {/* Categories */}
        <div className='min-w-0 flex-1'>
          {isSearching && (
            <div className='mb-1.5 pos-xs font-medium ink-2'>
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
          <div className={segRow}>
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All Categories');
                setSearchQuery('');
                setSelectedCategoryId(null);
              }}
              aria-pressed={!selCat && !isSearching}
              className={segItem}
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
                aria-pressed={selCat === String(cat.id) && !isSearching}
                className={segItem}
              >
                {localName(cat)}
              </button>
            ))}
          </div>

        {/* Subcategories: under the categories, in the same column */}
        {filteredSubcategories.length > 0 && (
          <div className={`${segRow} mt-2`}>
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All subcategories');
                setSearchQuery('');
                setSelectedSubcategoryId(null);
              }}
              aria-pressed={!selectedSubcategoryId && !isSearching}
              className={segItem}
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
                aria-pressed={selectedSubcategoryId === String(sub.id) && !isSearching}
                className={segItem}
              >
                {localName(sub)}
              </button>
            ))}
          </div>
        )}
        </div>
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
        <div className='grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2.5 p-3 lg:p-4'>
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
          <div className='ui-notice mx-3 mb-3'>
            <AlertTriangle size={16} strokeWidth={1.8} className='shrink-0 text-warning' />
            <span className='pos-xs font-medium text-foreground'>
              {t('pos.showingOf', { shown: items.length, total: totalItems })}
            </span>
          </div>
        )}

        {items.length === 0 && (
          <div className='flex flex-col items-center justify-center h-56 ink-2'>
            <Package size={40} strokeWidth={1.8} className='mb-3' />
            <p className='pos-base font-medium'>{t('pos.noItems')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
