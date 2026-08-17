// src/renderer/pages/pos/CatalogPanel.tsx
import React from 'react';
import { Search, Package } from 'lucide-react';
import { fileUrl } from '../../utils/fileUrl';

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

  const bg = theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const inputBg =
    theme === 'dark'
      ? 'bg-white/5 border-white/10'
      : 'bg-white border-gray-300';

  const imgSrcFor = (it: Pick<Item, 'image' | 'image_local' | 'name'>) => {
    const local = it.image_local ? fileUrl(it.image_local) : null;
    return local ?? it.image ?? null;
  };

  return (
    <div className='flex flex-col overflow-hidden'>
      {/* Filters */}
      <div
        className={`sticky top-0 z-10 ${bg} backdrop-blur p-4 border-b ${border}`}
      >
        {/* Search */}
        <div className='mb-3'>
          <div className='relative'>
            <Search
              className={`absolute start-3 top-1/2 -translate-y-1/2 ${textMuted}`}
              size={18}
            />
            <input
              value={searchQuery}
              onChange={(e) => {
                console.debug('[CatalogPanel] setSearchQuery:', e.target.value);
                setSearchQuery(e.target.value);
              }}
              placeholder={t('pos.searchPlaceholder')}
              className={`w-full ps-10 pe-3 py-2.5 ${inputBg} rounded-xl ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                theme === 'dark'
                  ? 'focus:ring-blue-500/40'
                  : 'focus:ring-blue-500'
              }`}
            />
          </div>
        </div>

        {/* Categories */}
        <div className='mb-3'>
          {isSearching && (
            <div
              className={`mb-1.5 text-[11px] ${
                theme === 'dark' ? 'text-slate-400' : 'text-gray-500'
              }`}
            >
              {t('pos.searchAllCategories')}
            </div>
          )}
          <div
            className={`flex items-center gap-1.5 overflow-x-auto chip-scroll pb-1 transition-opacity ${
              isSearching ? 'opacity-50' : ''
            }`}
          >
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All Categories');
                setSearchQuery('');
                setSelectedCategoryId(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                !selCat && !isSearching
                  ? theme === 'dark'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-primary text-primary-foreground'
                  : theme === 'dark'
                  ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
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
                className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                  selCat === String(cat.id) && !isSearching
                    ? theme === 'dark'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-primary text-primary-foreground'
                    : theme === 'dark'
                    ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }`}
              >
                {localName(cat)}
              </button>
            ))}
          </div>
        </div>

        {/* Subcategories */}
        {filteredSubcategories.length > 0 && (
          <div
            className={`flex items-center gap-1.5 overflow-x-auto chip-scroll pb-1 transition-opacity ${
              isSearching ? 'opacity-50' : ''
            }`}
          >
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All subcategories');
                setSearchQuery('');
                setSelectedSubcategoryId(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                !selectedSubcategoryId && !isSearching
                  ? theme === 'dark'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'bg-blue-100 text-blue-700 border-blue-300'
                  : theme === 'dark'
                  ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
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
                className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                  selectedSubcategoryId === String(sub.id) && !isSearching
                    ? theme === 'dark'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-blue-100 text-blue-700 border-blue-300'
                    : theme === 'dark'
                    ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
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
          <div
            className={`mx-3 mb-3 rounded-lg px-3 py-2 text-[11px] ${
              theme === 'dark'
                ? 'bg-amber-500/10 text-amber-200 border border-amber-500/30'
                : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}
          >
            {t('pos.showingOf', { shown: items.length, total: totalItems })}
          </div>
        )}

        {items.length === 0 && (
          <div
            className={`flex flex-col items-center justify-center h-56 ${textMuted}`}
          >
            <Package size={40} className='mb-3 opacity-50' />
            <p>{t('pos.noItems')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
