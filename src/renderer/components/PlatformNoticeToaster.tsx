// src/renderer/components/PlatformNoticeToaster.tsx
//
// POS_PUSH_PLATFORM_ONLY_PAYMENT: the server kept a sale holding a dish sold
// only on Talabat or Keeta that was paid another way. After each sync, every
// such order not announced yet gets one toast, on whatever screen is open.
// The words come from the order and this till's copies; the server's own
// `error` text is never shown.

import { useEffect } from 'react';
import { useToast } from './ToastProvider';
import { useI18n } from '../i18n';
import { SYNCED_EVENT } from '../utils/syncEvents';
import { ERROR_CATALOG, interpolate } from '../../shared/errorCatalog';
import { localizeParams } from '../../shared/platformOnly';

const CODE = 'POS_PUSH_PLATFORM_ONLY_PAYMENT';

export function PlatformNoticeToaster() {
  const toast = useToast();
  const { lang } = useI18n();

  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const notices: { orderId: string; params: Record<string, string> }[] =
          (await window.api.invoke('catalog:takePlatformNotices')) ?? [];
        const copy = ERROR_CATALOG[CODE][lang];
        for (const n of notices) {
          const params = localizeParams(n.params, lang);
          toast({
            tone: 'danger',
            code: CODE,
            title: interpolate(copy.title, params),
            message: interpolate(copy.body, params),
            // Read across a counter: long enough to read twice.
            durationMs: 15000,
          });
        }
      } catch {
        // Signed out or not paired yet: the notice stays on the order.
      } finally {
        busy = false;
      }
    };
    void check();
    window.addEventListener(SYNCED_EVENT, check);
    return () => window.removeEventListener(SYNCED_EVENT, check);
  }, [toast, lang]);

  return null;
}
