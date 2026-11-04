// src/renderer/screens/AuthedGate.tsx
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { useI18n, type StringKey } from '../i18n';

import { useErrorLine } from '../utils/posError';
type PosStatus = {
  paired: boolean;
  session_open: boolean;
  branch_name?: string | null;
};

// Keys rather than literals: the tip is picked once per mount, but must still
// re-render in the new language if the operator flips the toggle mid-wait.
const tipKeys: StringKey[] = [
  'gate.tip1',
  'gate.tip2',
  'gate.tip3',
  'gate.tip4',
  'gate.tip5',
];

export function AuthedGate() {
  const nav = useNavigate();
  const { t } = useI18n();
  const errLine = useErrorLine();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<PosStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipKey] = useState(
    () => tipKeys[Math.floor(Math.random() * tipKeys.length)]
  );

  async function refresh() {
    try {
      setError(null);
      const s = (await (window as any).pos.auth.status()) as PosStatus;

      setStatus(s);

      if (!s.paired) {
        nav('/pair', { replace: true });
      } else if (!s.session_open) {
        nav('/login', { replace: true });
      } else {
        setReady(true);
      }
    } catch (e: any) {
      console.error('[AuthedGate] status error', e);
      setError(errLine(e));
    }
  }

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    (window as any).electronAPI?.on?.('pos:status-changed', handler);
    return () =>
      (window as any).electronAPI?.off?.('pos:status-changed', handler);
  }, []);

  if (!ready) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-canvas px-4'>
        <div className='ui-card w-full max-w-md'>
          <div className='py-6 px-6 flex flex-col items-center gap-3 text-center'>
            <Spinner size='lg' color='primary' />
            <div className='text-base font-semibold ink'>
              {t('gate.preparing')}
            </div>

            <div className='text-xs ink-2'>
              {error ? t('gate.statusError') : t('gate.checking')}
            </div>

            {status?.branch_name && !error && (
              <div className='text-xs ink-3'>
                {t('gate.currentBranch')}{' '}
                <span className='font-medium ink'>
                  {status.branch_name}
                </span>
              </div>
            )}

            {!error && (
              <div className='mt-2 text-xs ink-3 italic max-w-sm'>
                {t(tipKey)}
              </div>
            )}

            {error && (
              <button
                className='ui-btn ui-btn-outline mt-3'
                onClick={refresh}
              >
                {t('common.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
