// src/renderer/screens/AuthedGate.tsx
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Card, CardBody, Spinner } from '@heroui/react';
import { useI18n, type StringKey } from '../i18n';

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
      setError(e?.message || t('gate.statusFailed'));
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
      <div className='light min-h-screen flex items-center justify-center bg-slate-100 px-4'>
        <Card className='w-full max-w-md shadow-lg border border-slate-200 bg-white'>
          <CardBody className='py-6 px-6 flex flex-col items-center gap-3 text-center'>
            <Spinner size='lg' color='primary' />
            <div className='text-base font-semibold text-slate-900'>
              {t('gate.preparing')}
            </div>

            <div className='text-xs text-slate-500'>
              {error ? t('gate.statusError') : t('gate.checking')}
            </div>

            {status?.branch_name && !error && (
              <div className='text-[11px] text-slate-500'>
                {t('gate.currentBranch')}{' '}
                <span className='font-medium text-slate-900'>
                  {status.branch_name}
                </span>
              </div>
            )}

            {!error && (
              <div className='mt-2 text-[11px] text-slate-500 italic max-w-sm'>
                {t(tipKey)}
              </div>
            )}

            {error && (
              <button
                className='mt-3 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50'
                onClick={refresh}
              >
                {t('common.retry')}
              </button>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  return <Outlet />;
}
