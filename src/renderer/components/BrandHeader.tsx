// src/renderer/components/BrandHeader.tsx
// The Majestic wordmark (same artwork as the app icon), cropped to its ink.
// It has its own white ground, so it reads the same in both themes.
import logoUrl from '../assets/logo-majestic.png';
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
          className='h-10 w-auto shrink-0 rounded-[11px] border border-line bg-white object-contain'
          draggable={false}
        />
        <div className={`${align === 'center' ? 'hidden' : 'block'}`}>
          <h1 className='text-xl font-semibold tracking-tight ink'>
            {title}
          </h1>
          <p className='text-xs ink-2'>{sub}</p>
        </div>
      </div>

      {align === 'center' && (
        <>
          <h1 className='text-2xl font-semibold tracking-tight ink'>
            {title}
          </h1>
          <p className='text-xs ink-2 max-w-sm'>{sub}</p>
        </>
      )}
    </div>
  );
}
