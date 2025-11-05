// src/renderer/screens/AuthedGate.tsx
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

export function AuthedGate() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);

  async function refresh() {
    const s = await window.pos.auth.status();
    if (!s.paired) nav('/pair', { replace: true });
    else if (!s.session_open) nav('/login', { replace: true });
    else setReady(true);
  }

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.electronAPI?.on?.('pos:status-changed', handler); // optional if you broadcast
    return () => window.electronAPI?.off?.('pos:status-changed', handler);
  }, []);

  if (!ready) {
    return (
      <div className="h-screen grid place-items-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  return <Outlet />;
}
