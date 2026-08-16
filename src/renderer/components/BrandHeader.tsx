// src/renderer/components/BrandHeader.tsx
import logoUrl from '../assets/logo-pos.svg'; // adjust if svg
import { useI18n } from '../i18n';

type BrandHeaderProps = {
  title?: string;
  subtitle?: string;
  align?: 'left' | 'center';
};

export function BrandHeader({
  title = 'Majestic POS',
  subtitle,
  align = 'center',
}: BrandHeaderProps) {
  const { t } = useI18n();

  // `align='left'` means "start of the reading direction", so the class is the
  // logical `text-start` — under RTL it lines up on the right automatically.
  const alignClass =
    align === 'center' ? 'items-center text-center' : 'items-start text-start';

  const sub = subtitle ?? t('auth.brandTagline');

  return (
    <div className={`flex flex-col gap-2 ${alignClass}`}>
      <div className='flex items-center gap-3'>
        <img
          src={logoUrl}
          alt={title}
          className='h-10 w-10 rounded-xl border border-slate-200 bg-white shadow-sm object-contain'
          draggable={false}
        />
        <div className={`${align === 'center' ? 'hidden' : 'block'}`}>
          <h1 className='text-xl font-semibold tracking-tight text-slate-900'>
            {title}
          </h1>
          <p className='text-xs text-slate-500'>{sub}</p>
        </div>
      </div>

      {align === 'center' && (
        <>
          <h1 className='text-2xl font-semibold tracking-tight text-slate-900'>
            {title}
          </h1>
          <p className='text-xs text-slate-500 max-w-sm'>{sub}</p>
        </>
      )}
    </div>
  );
}
