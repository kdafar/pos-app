// src/renderer/components/MenuPanel.tsx
import { useState, useEffect } from 'react';
import { Category, Subcategory, Item } from '../types';

interface MenuPanelProps {
  onAddItem: (itemId: string) => void;
}

export default function MenuPanel({ onAddItem }: MenuPanelProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      loadSubcategories(selectedCategory);
    } else {
      setSubcategories([]);
      setSelectedSubcategory(null);
    }
    loadItems();
  }, [selectedCategory]);

  useEffect(() => {
    loadItems();
  }, [selectedSubcategory, searchQuery]);

  const loadCategories = async () => {
    try {
      const data = await window.api.invoke('catalog:listCategories');
      setCategories(data);
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  };

  const loadSubcategories = async (categoryId: string) => {
    try {
      const data = await window.api.invoke('catalog:listSubcategories', categoryId);
      setSubcategories(data);
    } catch (error) {
      console.error('Failed to load subcategories:', error);
    }
  };

  const loadItems = async () => {
    setLoading(true);
    try {
      const data = await window.api.invoke('catalog:listItems', {
        category_id: selectedCategory,
        subcategory_id: selectedSubcategory,
        search: searchQuery || null
      });
      setItems(data);
    } catch (error) {
      console.error('Failed to load items:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Search Bar */}
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="relative">
          <input
            type="search"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            🔍
          </span>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200 overflow-x-auto scrollbar-thin">
        <button
          onClick={() => {
            setSelectedCategory(null);
            setSelectedSubcategory(null);
          }}
          className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
            selectedCategory === null
              ? 'bg-blue-500 text-white shadow'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All Items
        </button>
        
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              setSelectedCategory(cat.id);
              setSelectedSubcategory(null);
            }}
            className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
              selectedCategory === cat.id
                ? 'bg-blue-500 text-white shadow'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Subcategory Pills */}
      {subcategories.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setSelectedSubcategory(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              selectedSubcategory === null
                ? 'bg-blue-500 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:border-gray-400'
            }`}
          >
            All
          </button>
          
          {subcategories.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setSelectedSubcategory(sub.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                selectedSubcategory === sub.id
                  ? 'bg-blue-500 text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* Items Grid */}
      <div className="flex-1 overflow-y-auto nice-scroll nice-scroll p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <div className="text-3xl mb-2">⏳</div>
              <div className="text-sm">Loading items...</div>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <div className="text-3xl mb-2">📦</div>
              <div className="text-sm">No items found</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => !item.is_outofstock && onAddItem(item.id)}
                disabled={item.is_outofstock === 1}
                className={`bg-white rounded-xl p-3 card-shadow hover:shadow-lg transition-all text-left ${
                  item.is_outofstock
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:scale-105 hover:border-blue-200 active:scale-95'
                } border border-transparent`}
              >
                <div className="mb-2">
                  <div className="font-semibold text-sm line-clamp-2 min-h-[2.5rem]">
                    {item.name}
                  </div>
                  {item.name_ar && (
                    <div className="text-xs text-gray-500 line-clamp-1 mt-1">
                      {item.name_ar}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div className="font-bold text-emerald-600">
                    {item.price.toFixed(3)}
                  </div>
                  
                  {item.barcode && (
                    <div className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {item.barcode}
                    </div>
                  )}
                </div>

                {item.is_outofstock === 1 && (
                  <div className="mt-2 text-xs font-semibold text-red-500 text-center bg-red-50 py-1 rounded">
                    Out of Stock
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}