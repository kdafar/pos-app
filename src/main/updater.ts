// src/main/updater.ts
//
// electron-updater was already a dependency, `publish` already points at the
// GitHub repo, and every build already emits latest.yml + .blockmap — but
// autoUpdater was never imported, so the whole pipeline was dead. This wires
// it up and reports progress to the renderer.

import { app, ipcMain, type BrowserWindow } from 'electron';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'none'; version?: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }
  | { status: 'disabled'; reason: string };

let state: UpdateState = { status: 'idle' };
let updater: any = null;
let win: BrowserWindow | null = null;

/** Tills run unattended; check periodically, not just at boot. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

function push(next: UpdateState) {
  state = next;
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:state', next);
    }
  } catch {
    // renderer may not be ready yet — state is still readable via update:status
  }
}

function loadUpdater(): any | null {
  if (updater) return updater;
  try {
    const mod = requireCjs('electron-updater');
    updater = mod.autoUpdater ?? mod.default?.autoUpdater ?? null;
    return updater;
  } catch (e: any) {
    console.error('[updater] electron-updater unavailable:', e?.message || e);
    return null;
  }
}

export function registerUpdater(mainWindow: BrowserWindow) {
  win = mainWindow;

  // Always expose the IPC surface so the renderer can render a sane state
  // even when updates are not possible (dev, or an unsigned portable build).
  ipcMain.handle('update:status', () => state);
  ipcMain.handle('update:check', async () => {
    await checkNow(true);
    return state;
  });
  ipcMain.handle('update:install', () => {
    if (state.status !== 'ready') return { ok: false, reason: state.status };
    // Persist nothing here — quitAndInstall restarts the app.
    updater?.quitAndInstall(false, true);
    return { ok: true };
  });

  if (!app.isPackaged) {
    push({ status: 'disabled', reason: 'Development build' });
    return;
  }

  const au = loadUpdater();
  if (!au) {
    push({ status: 'disabled', reason: 'Updater unavailable' });
    return;
  }

  au.autoDownload = true;
  // Never restart a till mid-service; the operator chooses when to apply.
  au.autoInstallOnAppQuit = true;
  au.logger = { info: console.log, warn: console.warn, error: console.error };

  au.on('checking-for-update', () => push({ status: 'checking' }));
  au.on('update-available', (i: any) =>
    push({ status: 'available', version: i?.version ?? '?' })
  );
  au.on('update-not-available', (i: any) =>
    push({ status: 'none', version: i?.version })
  );
  au.on('download-progress', (p: any) =>
    push({ status: 'downloading', percent: Math.round(p?.percent ?? 0) })
  );
  au.on('update-downloaded', (i: any) =>
    push({ status: 'ready', version: i?.version ?? '?' })
  );
  au.on('error', (err: any) =>
    push({ status: 'error', message: err?.message || String(err) })
  );

  // Kick off shortly after boot so it never competes with the first sync.
  setTimeout(() => void checkNow(false), 15_000);
  setInterval(() => void checkNow(false), CHECK_INTERVAL_MS);
}

async function checkNow(manual: boolean) {
  if (!app.isPackaged) {
    if (manual) push({ status: 'disabled', reason: 'Development build' });
    return;
  }
  const au = loadUpdater();
  if (!au) return;

  // A portable .exe cannot replace itself in place.
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    push({ status: 'disabled', reason: 'Portable build — download manually' });
    return;
  }

  try {
    await au.checkForUpdates();
  } catch (e: any) {
    // Offline is the normal case for a till, not an error worth shouting about.
    console.warn('[updater] check failed:', e?.message || e);
    push({ status: 'error', message: e?.message || String(e) });
  }
}
