// src/main/handlers/sync.ts
import type { IpcMain } from 'electron';
import https from 'node:https';
import { URL } from 'node:url';
import db, { setMeta, getMeta } from '../db'; // adjust import to your actual helpers

type SyncStatus = {
  mode: 'live' | 'offline';
  last_sync_at: number;
  base_url: string;
  cursor: number;
  paired: boolean;
  token_present: boolean;
  device_id: string | null;
  branch_name: string;
  branch_id: number;
  online: boolean; // <-- extra flag if you want
};

const DEFAULT_CHECK_URL = 'https://www.google.com';

let syncState: SyncStatus = {
  mode: 'offline',
  last_sync_at: 0,
  base_url: '',
  cursor: 0,
  paired: false,
  token_present: false,
  device_id: null,
  branch_name: '',
  branch_id: 0,
  online: false,
};

function loadInitialState() {
  // If you already store these in sync_state table or meta, read them here.
  // This is just an example:
  try {
    const baseUrl = getMeta('sync.base_url') || '';
    const cursor = Number(getMeta('sync.cursor') || 0);
    const paired = !!getMeta('sync.paired');
    const tokenPresent = !!getMeta('sync.token_present');
    const deviceId = getMeta('sync.device_id') || null;
    const branchName = getMeta('sync.branch_name') || '';
    const branchId = Number(getMeta('sync.branch_id') || 0);

    syncState = {
      ...syncState,
      base_url: baseUrl,
      cursor,
      paired,
      token_present: tokenPresent,
      device_id: deviceId,
      branch_name: branchName,
      branch_id: branchId,
    };
  } catch (e) {
    console.warn('[sync] failed to load initial state', e);
  }
}

/**
 * Small helper to perform a HEAD request to check connectivity.
 */
function checkOnlineOnce(target: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const url = new URL(target);
      const req = https.request(
        {
          method: 'HEAD',
          hostname: url.hostname,
          path: url.pathname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          timeout: 5000,
        },
        res => {
          // 2xx / 3xx = ok enough
          resolve(res.statusCode !== undefined && res.statusCode < 400);
          req.destroy();
        },
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function updateConnectivity() {
  const target = syncState.base_url || DEFAULT_CHECK_URL;
  const online = await checkOnlineOnce(target);

  syncState.online = online;

  // Lock mode to real connectivity + pairing
  const shouldBeLive = online && syncState.paired && syncState.token_present && !!syncState.base_url;
  syncState.mode = shouldBeLive ? 'live' : 'offline';
}

/**
 * Call this from your main index when booting.
 */
export function registerSyncHandlers(ipcMain: IpcMain) {
  loadInitialState();

  // Initial connectivity check
  updateConnectivity().catch(err => console.warn('[sync] initial connectivity failed', err));

  // Periodic re-check: every 7s (tune as you like)
  setInterval(() => {
    updateConnectivity().catch(err => console.warn('[sync] connectivity check failed', err));
  }, 7000);

  // Expose status to renderer (read-only mode)
  ipcMain.handle('sync:status', async () => {
    return syncState;
  });

  // Keep your existing sync:run logic, but DO NOT allow changing mode from renderer.
  ipcMain.handle('sync:run', async () => {
    // Example: run your existing bootstrap + pull
    // await syncService.runFullSync();
    syncState.last_sync_at = Date.now();
    // after sync you might bump cursor etc.
    return syncState;
  });

  // Optional: keep this to avoid breaking old renderer calls, but make it no-op:
  ipcMain.handle('sync:setMode', async (_evt, _mode: 'live' | 'offline') => {
    console.log('[sync] sync:setMode called from renderer, ignoring (mode is now auto).');
    return syncState;
  });
}
