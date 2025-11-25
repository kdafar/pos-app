// src/renderer/pages/pos/CatalogPanel.tsx
import React from 'react';
import { Search, Package } from 'lucide-react';
import { fileUrl } from '../../utils/fileUrl';

// Shared types
import { Item, Category } from './types';
import { ItemCard } from './components/ItemCard';

export default function CatalogPanel({
  theme, items, categories, subcategories,
  searchQuery, setSearchQuery,
  selectedCategoryId, setSelectedCategoryId,
  selectedSubcategoryId, setSelectedSubcategoryId,
  onAddItem,
}: {
  theme: 'light' | 'dark';
  items: Item[];
  categories: Category[];
  subcategories: Category[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;
  selectedSubcategoryId: string | null;
  setSelectedSubcategoryId: (id: string | null) => void;
  onAddItem: (it: Item) => void;
}) {
  /* ---------- Diagnostics & Normalization ---------- */
  const safeCats = React.useMemo(
    () => (categories ?? []).map(c => ({ ...c, id: String(c.id) })),
    [categories]
  );
  const safeSubs = React.useMemo(
    () => (subcategories ?? []).map(s => ({ ...s, id: String(s.id), category_id: String(s.category_id) })),
    [subcategories]
  );
  const selCat = selectedCategoryId == null ? null : String(selectedCategoryId);

  const itemCatSet = React.useMemo(() => {
    const s = new Set<string>();
    for (const it of items || []) if (it.category_id != null) s.add(String(it.category_id));
    return s;
  }, [items]);

  React.useEffect(() => {
    console.groupCollapsed('%c[CatalogPanel] props snapshot', 'color:#60a5fa');
    console.log('theme:', theme);
    console.log('items:', { count: items?.length, sample: (items || []).slice(0, 3) });
    console.log('categories(raw):', categories);
    console.log('categories(safe):', { count: safeCats.length, sample: safeCats.slice(0, 10) });
    console.log('subcategories(raw):', subcategories);
    console.log('subcategories(safe):', { count: safeSubs.length, sample: safeSubs.slice(0, 10) });
    console.log('selectedCategoryId:', selectedCategoryId, '->', selCat);
    console.log('selectedSubcategoryId:', selectedSubcategoryId);
    console.log('itemCatSet(from items):', Array.from(itemCatSet));
    if (!safeCats.length && (items?.length ?? 0) > 0) {
      console.warn('[CatalogPanel] items exist but categories array is empty. Check IPC: catalog:listCategories');
    }
    if (safeCats.length && !itemCatSet.size) {
      console.warn('[CatalogPanel] categories loaded but no items reference a category_id.');
    }
    console.groupEnd();
  }, [theme, items, categories, subcategories, selCat, selectedSubcategoryId, itemCatSet]);

  const filteredSubcategories = React.useMemo(() => {
    const out = safeSubs.filter(sub => !selCat || String(sub.category_id) === selCat);
    console.debug('[CatalogPanel] filteredSubcategories:', { selCat, outCount: out.length, sample: out.slice(0, 6) });
    return out;
  }, [safeSubs, selCat]);

  const bg = theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50';
  const border = theme === 'dark' ? 'border-white/5' : 'border-gray-200';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const inputBg = theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300';

  const imgSrcFor = (it: Pick<Item,'image'|'image_local'|'name'>) => {
    const local = it.image_local ? fileUrl(it.image_local) : null;
    return local ?? it.image ?? null;
  };

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Filters */}
      <div className={`sticky top-0 z-10 ${bg} backdrop-blur p-4 border-b ${border}`}>
        {/* Search */}
        <div className="mb-3">
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${textMuted}`} size={18} />
            <input
              value={searchQuery}
              onChange={e => {
                console.debug('[CatalogPanel] setSearchQuery:', e.target.value);
                setSearchQuery(e.target.value);
              }}
              placeholder="Search items, barcode, or Arabic name…"
              className={`w-full pl-10 pr-3 py-2.5 ${inputBg} rounded-xl ${text} placeholder-gray-500 focus:outline-none focus:ring-2 ${
                theme === 'dark' ? 'focus:ring-blue-500/40' : 'focus:ring-blue-500'
              }`}
            />
          </div>
        </div>

        {/* Categories */}
        <div className="mb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All Categories');
                setSelectedCategoryId(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                !selCat
                  ? theme === 'dark' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                                     : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                  : theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                                     : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
              }`}
            >
              All Categories
            </button>

            {safeCats.map(cat => (
              <button
                key={cat.id}
                onClick={() => {
                  console.debug('[CatalogPanel] click category', { id: cat.id, name: cat.name });
                  setSelectedCategoryId(String(cat.id));
                  setSelectedSubcategoryId(null);
                }}
                className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                  selCat === String(cat.id)
                    ? theme === 'dark' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                                       : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                    : theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                                       : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Subcategories */}
        {filteredSubcategories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              onClick={() => {
                console.debug('[CatalogPanel] click All subcategories');
                setSelectedSubcategoryId(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                !selectedSubcategoryId
                  ? theme === 'dark' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                     : 'bg-blue-100 text-blue-700 border-blue-300'
                  : theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                                     : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
              }`}
            >
              All
            </button>
            {filteredSubcategories.map(sub => (
              <button
                key={sub.id}
                onClick={() => {
                  console.debug('[CatalogPanel] click subcategory', { id: sub.id, name: sub.name, category_id: sub.category_id });
                  setSelectedSubcategoryId(String(sub.id));
                }}
                className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                  selectedSubcategoryId === String(sub.id)
                    ? theme === 'dark' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                       : 'bg-blue-100 text-blue-700 border-blue-300'
                    : theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                                       : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }`}
              >
                {sub.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 p-3">
          {items.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              theme={theme}
              onAddItem={onAddItem}
            />
          ))}
        </div>

        {items.length === 0 && (
          <div className={`flex flex-col items-center justify-center h-56 ${textMuted}`}>
            <Package size={40} className="mb-3 opacity-50" />
            <p>No items found</p>
          </div>
        )}
      </div>
    </div>
  );
}
