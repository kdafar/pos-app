// src/renderer/hooks/useUpdate.ts
//
// One subscription to the main-process updater, shared by the Updates screen
// and the sidebar badge. Mirrors the types in src/main/updater.ts.

import { useCallback, useEffect, useRef, useState } from 'react';

import { errorLine } from '../utils/posError';
export type DisabledReason = 'dev' | 'portable' | 'unavailable';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; notes?: string }
  | { status: 'none'; version?: string }
  | {
      status: 'downloading';
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | { status: 'ready'; version: string; notes?: string }
  | { status: 'error'; message: string }
  | { status: 'disabled'; reason: DisabledReason };

export type UpdateSnapshot = {
  state: UpdateState;
  currentVersion: string;
  lastCheckedAt: number | null;
};

type UpdateBridge = {
  status: () => Promise<UpdateSnapshot>;
  check: () => Promise<UpdateSnapshot>;
  install: () => Promise<{ ok: boolean; reason?: string }>;
  onState: (cb: (s: UpdateSnapshot) => void) => () => void;
};

function bridge(): UpdateBridge | null {
  return (window as any).pos?.update ?? null;
}

const INITIAL: UpdateSnapshot = {
  state: { status: 'idle' },
  currentVersion: '',
  lastCheckedAt: null,
};

export function useUpdate() {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>(INITIAL);
  /** Manual check in flight — distinct from state.status, which stays 'idle'
   *  in dev and never reaches 'checking'. */
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const u = bridge();

    if (!u) {
      // An older preload, or the page opened outside Electron.
      setSnapshot({
        state: { status: 'disabled', reason: 'unavailable' },
        currentVersion: '',
        lastCheckedAt: null,
      });
      return;
    }

    u.status()
      .then((s) => {
        if (alive.current && s) setSnapshot(s);
      })
      .catch(() => {
        /* main answers on the next push */
      });

    const off = u.onState((s) => {
      if (alive.current && s) setSnapshot(s);
    });

    return () => {
      alive.current = false;
      off?.();
    };
  }, []);

  const check = useCallback(async () => {
    const u = bridge();
    if (!u) return;
    setBusy(true);
    try {
      const s = await u.check();
      if (alive.current && s) setSnapshot(s);
    } catch (e: any) {
      if (alive.current) {
        setSnapshot((prev) => ({
          ...prev,
          // electron-updater's own text ("net::ERR_INTERNET_DISCONNECTED",
          // "Cannot find latest.yml") is for the log, not for the shop floor.
          state: { status: 'error', message: errorLine(e) },
        }));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  /** Resolves only if the install was refused — on success the app quits. */
  const install = useCallback(async () => {
    const u = bridge();
    if (!u) return { ok: false, reason: 'unavailable' };
    return u.install();
  }, []);

  return { ...snapshot, busy, check, install };
}
