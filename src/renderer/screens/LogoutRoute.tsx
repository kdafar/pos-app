// src/renderer/screens/LogoutRoute.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { useStore } from '../src/store'; // <--- 1. Import your store (adjust path if needed)
import { useI18n } from '../i18n';

export function LogoutRoute() {
  const nav = useNavigate();
  const { t } = useI18n();

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
    <div className='min-h-screen flex items-center justify-center bg-canvas px-4'>
      <div className='ui-card w-full max-w-sm'>
        <div className='py-6 px-6 flex flex-col items-center gap-3 text-center'>
          <Spinner size='lg' color='primary' />
          <div className='text-base font-semibold ink'>
            {t('auth.signingOut')}
          </div>
          <div className='text-xs ink-2 max-w-xs'>
            {t('auth.signingOutBody')}
          </div>
        </div>
      </div>
    </div>
  );
}
