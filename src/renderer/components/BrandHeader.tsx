// src/renderer/components/BrandHeader.tsx
import React from 'react';
import logoUrl from '../assets/logo-pos.svg'; // adjust if svg

type BrandHeaderProps = {
  title?: string;
  subtitle?: string;
  align?: 'left' | 'center';
};

export function BrandHeader({
  title = 'Majestic POS',
  subtitle = 'Offline-first restaurant & retail point of sale',
  align = 'center',
}: BrandHeaderProps) {
  const alignClass =
    align === 'center' ? 'items-center text-center' : 'items-start text-left';

  return (
    <div className={`flex flex-col gap-2 ${alignClass}`}>
      <div className='flex items-center gap-3'>
        <img
          src={logoUrl}
          alt='Majestic POS'
          className='h-10 w-10 rounded-xl border border-slate-200 bg-white shadow-sm object-contain'
          draggable={false}
        />
        <div className={`${align === 'center' ? 'hidden' : 'block'}`}>
          <h1 className='text-xl font-semibold tracking-tight'>{title}</h1>
          <p className='text-xs text-slate-500'>{subtitle}</p>
        </div>
      </div>

      {align === 'center' && (
        <>
          <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
          <p className='text-xs text-slate-500 max-w-sm'>{subtitle}</p>
        </>
      )}
    </div>
  );
}
