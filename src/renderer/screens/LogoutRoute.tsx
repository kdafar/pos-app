// src/renderer/screens/LogoutRoute.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Spinner } from '@heroui/react';

export function LogoutRoute() {
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        await (window as any).pos.auth.logout();
      } catch (e) {
        console.error('[LogoutRoute] logout failed', e);
      } finally {
        nav('/login', { replace: true });
      }
    })();
  }, [nav]);

  return (
    <div className='min-h-screen flex items-center justify-center bg-slate-100 px-4'>
      <Card className='w-full max-w-sm shadow-lg border border-slate-200 bg-white'>
        <CardBody className='py-6 px-6 flex flex-col items-center gap-3 text-center'>
          <Spinner size='lg' color='primary' />
          <div className='text-base font-semibold text-slate-900'>
            Signing you out…
          </div>
          <div className='text-xs text-slate-500 max-w-xs'>
            We’re closing your POS session and clearing local access. You’ll be
            back on the login screen in a moment.
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
