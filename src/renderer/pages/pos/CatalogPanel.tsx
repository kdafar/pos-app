import React from 'react';
import { Search, Package } from 'lucide-react';
import { fileUrl } from '../../utils/fileUrl';

interface Item { id: string; name: string; name_ar: string; barcode: string; price: number; is_outofstock: number; image?: string | null; image_local?: string | null; category_id: string; subcategory_id: string; }
interface Category { id: string; name: string; name_ar: string; category_id?: string; }

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
  const filteredSubcategories = React.useMemo(
    () => subcategories.filter(sub => !selectedCategoryId || sub.category_id === selectedCategoryId),
    [subcategories, selectedCategoryId]
  );

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
              onChange={e => setSearchQuery(e.target.value)}
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
              onClick={() => setSelectedCategoryId(null)}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                !selectedCategoryId
                  ? theme === 'dark' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                                     : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                  : theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                                     : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
              }`}
            >
              All Categories
            </button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                  selectedCategoryId === cat.id
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
              onClick={() => setSelectedSubcategoryId(null)}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                !selectedSubcategoryId
                  ? theme === 'dark' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                     : 'bg-blue-100 text-blue-700 border border-blue-300'
                  : theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                                     : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
              }`}
            >
              All
            </button>
            {filteredSubcategories.map(sub => (
              <button key={sub.id} onClick={() => setSelectedSubcategoryId(sub.id)}
                className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                  selectedSubcategoryId === sub.id
                    ? theme === 'dark' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                       : 'bg-blue-100 text-blue-700 border border-blue-300'
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
            <button
              key={item.id}
              onClick={() => onAddItem(item)}
              disabled={item.is_outofstock === 1}
              className={`group relative p-3 rounded-xl border text-left transition ${
                item.is_outofstock === 1
                  ? theme === 'dark' ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
                                     : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                  : theme === 'dark' ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-blue-500/40'
                                     : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md'
              }`}
            >
              <div className="mb-2">
                <div className={`w-full h-24 rounded-lg mb-2 overflow-hidden border ${
                  theme === 'dark' ? 'bg-slate-900 border-white/5' : 'bg-gray-100 border-gray-200'
                }`}>
                  {(() => {
                    const src = imgSrcFor(item);
                    if (!src) {
                      return (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package size={30} className={theme === 'dark' ? 'text-slate-600' : 'text-gray-400'} />
                        </div>
                      );
                    }
                    return (
                      <img
                        src={src} alt={item.name} loading="lazy"
                        className="w-full h-full object-cover object-center"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).onerror = null;
                          (e.currentTarget as HTMLImageElement).src = '/assets/placeholder.png';
                        }}
                      />
                    );
                  })()}
                </div>

                <h3 className={`font-semibold ${text} line-clamp-2 leading-snug`}>{item.name}</h3>
                <p className={`text-xs ${textMuted} line-clamp-1`}>{item.name_ar}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-[11px] ${theme === 'dark' ? 'text-slate-500 bg-white/5' : 'text-gray-500 bg-gray-100'} px-1.5 py-0.5 rounded`}>
                  {item.barcode || '—'}
                </span>
                <span className={`text-[15px] font-bold ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>
                  {item.price.toFixed(3)}
                </span>
              </div>
              {item.is_outofstock === 1 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
                  <span className="text-red-400 font-semibold text-sm">Out of Stock</span>
                </div>
              )}
            </button>
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
