// src/renderer/components/useConfirmUnpair.tsx
import React, { useRef, useState } from 'react';
import { Checkbox } from '@heroui/react';
import { AlertTriangle } from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialogProvider';
import { useI18n } from '../i18n';

/**
 * The one unpair confirmation, shared by the Login and Pair screens.
 *
 * Resolves to `null` when cancelled, otherwise to whether the operator also
 * asked for this device's data to be deleted.
 */
export function useConfirmUnpair() {
  const confirm = useConfirmDialog();
  const { t } = useI18n();
  const wipe = useRef(false);

  return async (): Promise<{ wipe: boolean } | null> => {
    wipe.current = false;
    const unsent = Number(
      (await (window as any).pos.auth.unsentCount().catch(() => 0)) || 0
    );

    const ok = await confirm({
      title: t('auth.unpairConfirmTitle'),
      message: (
        <div className='space-y-2 text-sm'>
          <p>{t('auth.unpairConfirmBody')}</p>
          <p className='text-xs ink-2'>
            {t('auth.unpairConfirmNote')}
          </p>
          <WipeChoice
            unsent={unsent}
            onChange={(v) => {
              wipe.current = v;
            }}
          />
        </div>
      ),
      confirmLabel: t('auth.unpairConfirmYes'),
      cancelLabel: t('auth.unpairConfirmNo'),
      tone: 'danger',
    });

    return ok ? { wipe: wipe.current } : null;
  };
}

/**
 * Unpair, and on "delete all data" also forget the remembered sign-in email —
 * it lives in the renderer's localStorage, out of reach of the main-process
 * wipe, and would otherwise greet the next restaurant with the last one's admin.
 */
export async function unpairDevice(wipe: boolean) {
  await (window as any).pos.auth.unpair({ wipe });
  if (wipe) {
    try {
      localStorage.removeItem('pos.last_login');
    } catch {
      // storage unavailable — nothing remembered to forget
    }
  }
}

/**
 * Owns its own state: the dialog renders the message it was handed once, so
 * a checkbox controlled from the caller would never repaint.
 */
function WipeChoice({
  unsent,
  onChange,
}: {
  unsent: number;
  onChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [on, setOn] = useState(false);

  return (
    <div className='space-y-2'>
      <div className='rounded-[11px] border border-line-strong bg-surface-2 px-3 py-2 space-y-1'>
        <Checkbox
          color='danger'
          isSelected={on}
          onValueChange={(v) => {
            setOn(v);
            onChange(v);
          }}
        >
          <span className='text-sm font-semibold ink'>{t('auth.unpairWipe')}</span>
        </Checkbox>
        <p className='text-xs ink-2'>{t('auth.unpairWipeHint')}</p>
      </div>
      {on && unsent > 0 && (
        <div className='ui-notice'>
          <AlertTriangle
            className='mt-0.5 h-4 w-4 shrink-0 text-[var(--st-amber)]'
            strokeWidth={1.8}
          />
          <p className='min-w-0 text-xs font-medium ink'>
            {t('auth.unpairWipeUnsent', { count: unsent })}
          </p>
        </div>
      )}
    </div>
  );
}
