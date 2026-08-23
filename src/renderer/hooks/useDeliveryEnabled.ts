// src/renderer/hooks/useDeliveryEnabled.ts
//
// Whether this branch takes delivery orders, read from `general.enable_delivery`.
//
// This has to keep watching, not just read once at boot. The setting now
// propagates down the pull feed, so the office can switch delivery off while
// the till is mid-shift — and a till that runs for weeks would otherwise never
// find out. It is one indexed read of a local SQLite row, so polling it costs
// nothing next to being wrong.
//
// The value is resolved in the main process (services/settings.ts) rather than
// here, because "absent" and "empty" have to mean different things and that
// rule belongs in one place.

import { useEffect, useState } from 'react';

const POLL_MS = 60_000;

export function useDeliveryEnabled(): boolean {
  // Starts true so the first paint never hides Delivery from a shop that does
  // deliver. Same reasoning as the absent-key fallback: showing one button too
  // many for a moment beats blocking a sale.
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let alive = true;

    const read = async () => {
      try {
        const v = await window.api.invoke('settings:deliveryEnabled');
        if (alive) setEnabled(v !== false);
      } catch {
        // Leave the last known answer alone rather than flipping the UI on a
        // transient IPC failure.
      }
    };

    void read();
    const id = window.setInterval(read, POLL_MS);
    // A cashier coming back to the till is the moment a stale answer is most
    // likely and most visible.
    window.addEventListener('focus', read);

    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('focus', read);
    };
  }, []);

  return enabled;
}
