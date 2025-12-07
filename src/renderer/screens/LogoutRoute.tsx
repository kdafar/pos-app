// src/renderer/screens/LogoutRoute.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Spinner } from '@heroui/react';
import { useStore } from '../src/store'; // <--- 1. Import your store (adjust path if needed)

export function LogoutRoute() {
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // 1. Tell Backend to delete session file
        await (window as any).pos.auth.logout();
      } catch (e) {
        console.error('[LogoutRoute] logout failed', e);
      } finally {
        // 2. CRITICAL FIX: Wipe Frontend Memory
        // We use .setState directly to force-clear the data instantly
        useStore.setState({
          currentUser: null,
          tabs: [],
          order: null,
          currentId: null,
          lines: [],
        });

        // 3. Go to login
        nav('/login', { replace: true });

        // Optional: Force a hard reload if you want to be 100% sure
        // window.location.reload();
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
