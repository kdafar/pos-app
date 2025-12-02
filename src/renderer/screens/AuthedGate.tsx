// src/renderer/screens/AuthedGate.tsx
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Card, CardBody, Spinner } from '@heroui/react';

type PosStatus = {
  paired: boolean;
  session_open: boolean;
  branch_name?: string | null;
};

const tips = [
  'Tip: You can switch to Offline mode and keep taking orders even if internet is down.',
  'Tip: Use quick users on the login screen so staff don’t have to type emails.',
  'Tip: Run “Sync now” before closing to push all pending orders to the server.',
  'Tip: Admins can log in from any paired branch. Staff can only log into their own branch.',
  'Tip: If this device moves to another restaurant, use “Pair device” again.',
];

export function AuthedGate() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<PosStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tip] = useState(() => tips[Math.floor(Math.random() * tips.length)]);

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
      setError(e?.message || 'Unable to check device status');
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
      <div className='min-h-screen flex items-center justify-center bg-slate-100 px-4'>
        <Card className='w-full max-w-md shadow-lg border border-slate-200 bg-white'>
          <CardBody className='py-6 px-6 flex flex-col items-center gap-3 text-center'>
            <Spinner size='lg' color='primary' />
            <div className='text-base font-semibold text-slate-900'>
              Getting your POS ready…
            </div>

            <div className='text-xs text-slate-500'>
              {error
                ? 'We had trouble checking the device status. You can try again below.'
                : 'Checking device pairing, branch and active session.'}
            </div>

            {status?.branch_name && !error && (
              <div className='text-[11px] text-slate-500'>
                Current branch:{' '}
                <span className='font-medium text-slate-900'>
                  {status.branch_name}
                </span>
              </div>
            )}

            {!error && (
              <div className='mt-2 text-[11px] text-slate-500 italic max-w-sm'>
                {tip}
              </div>
            )}

            {error && (
              <button
                className='mt-3 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50'
                onClick={refresh}
              >
                Try again
              </button>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  return <Outlet />;
}
