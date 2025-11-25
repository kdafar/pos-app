// components/ItemCard.tsx
import React from 'react';
import { Package } from 'lucide-react';
import { fileUrl } from '../../../utils/fileUrl';
import { Item } from '../types';

export function ItemCard({
  item,
  theme,
  onAddItem,
}: {
  item: Item;
  theme: 'light' | 'dark';
  onAddItem: (it: Item) => void;
}) {
  const [imgError, setImgError] = React.useState(false);

  // Logic to determine the image source
  const localSrc = item.image_local ? fileUrl(item.image_local) : null;
  const remoteSrc = item.image ?? null;
  const src = localSrc ?? remoteSrc; // Prioritize local image

  // Add this useEffect to log the source and reset errors when item changes
  React.useEffect(() => {
    setImgError(false); // Reset error state when item changes
    
    // FOR DEBUGGING:
    // console.log(`[ItemCard: ${item.name}] Image Source:`, src);

  }, [src, item.name]);

  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';

  return (
    <button
      key={item.id}
      onClick={() => onAddItem(item)}
      disabled={item.is_outofstock === 1}
      className={`group relative p-3 rounded-xl border text-left transition ${
        item.is_outofstock === 1
          ? (theme === 'dark' ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed' : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed')
          : (theme === 'dark' ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-blue-500/40' : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md')
      }`}
    >
      <div className="mb-2">
        <div className={`w-full h-24 rounded-lg mb-2 overflow-hidden border ${theme === 'dark' ? 'bg-slate-900 border-white/5' : 'bg-gray-100 border-gray-200'}`}>
          
          {/* This is the robust image logic */}
          {src && !imgError ? (
            <img
              src={src}
              alt={item.name}
              loading="lazy"
              className="w-full h-full object-cover object-center"
              onError={() => {
                console.warn(`[ItemCard] FAILED to load image: ${src}`);
                setImgError(true);
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package size={30} className={theme === 'dark' ? 'text-slate-600' : 'text-gray-400'} />
            </div>
          )}
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
  );
}
