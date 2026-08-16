// src/main/updater.ts
//
// electron-updater was already a dependency, `publish` already points at the
// GitHub repo, and every build already emits latest.yml + .blockmap — but
// autoUpdater was never imported, so the whole pipeline was dead. This wires
// it up and reports progress to the renderer.

import { app, ipcMain, type BrowserWindow } from 'electron';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);

/** Why updating is impossible. A code, not a sentence — the till is bilingual
 *  and the renderer owns the wording. */
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

/** What the renderer receives — the state plus the context needed to render a
 *  whole screen without a second round trip. */
export type UpdateSnapshot = {
  state: UpdateState;
  currentVersion: string;
  lastCheckedAt: number | null;
};

let state: UpdateState = { status: 'idle' };
let lastCheckedAt: number | null = null;
let updater: any = null;
let win: BrowserWindow | null = null;

/** Tills run unattended; check periodically, not just at boot. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

function snapshot(): UpdateSnapshot {
  return { state, currentVersion: app.getVersion(), lastCheckedAt };
}

function push(next: UpdateState) {
  state = next;
  // A check has concluded, one way or another. 'ready' arrives long after the
  // check that found it, so it does not count.
  if (next.status === 'none' || next.status === 'available' || next.status === 'error') {
    lastCheckedAt = Date.now();
  }
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:state', snapshot());
    }
  } catch {
    // renderer may not be ready yet — state is still readable via update:status
  }
}

/** GitHub release bodies arrive as HTML (or an array of them). The screen shows
 *  them as plain text, so flatten and strip here rather than handing markup to
 *  the renderer. */
function notesOf(info: any): string | undefined {
  const raw = info?.releaseNotes;
  const joined = Array.isArray(raw)
    ? raw.map((n: any) => (typeof n === 'string' ? n : n?.note ?? '')).join('\n\n')
    : typeof raw === 'string'
    ? raw
    : '';

  const text = joined
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text ? text.slice(0, 4000) : undefined;
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
  ipcMain.handle('update:status', () => snapshot());
  ipcMain.handle('update:check', async () => {
    await checkNow(true);
    return snapshot();
  });
  ipcMain.handle('update:install', () => {
    if (state.status !== 'ready') return { ok: false, reason: state.status };
    // Persist nothing here — quitAndInstall restarts the app.
    updater?.quitAndInstall(false, true);
    return { ok: true };
  });

  if (!app.isPackaged) {
    push({ status: 'disabled', reason: 'dev' });
    return;
  }

  const au = loadUpdater();
  if (!au) {
    push({ status: 'disabled', reason: 'unavailable' });
    return;
  }

  au.autoDownload = true;
  // Never restart a till mid-service; the operator chooses when to apply.
  au.autoInstallOnAppQuit = true;
  au.logger = { info: console.log, warn: console.warn, error: console.error };

  au.on('checking-for-update', () => push({ status: 'checking' }));
  au.on('update-available', (i: any) =>
    push({ status: 'available', version: i?.version ?? '?', notes: notesOf(i) })
  );
  au.on('update-not-available', (i: any) =>
    push({ status: 'none', version: i?.version })
  );
  au.on('download-progress', (p: any) =>
    push({
      status: 'downloading',
      percent: Math.round(p?.percent ?? 0),
      transferred: Number(p?.transferred ?? 0),
      total: Number(p?.total ?? 0),
      bytesPerSecond: Number(p?.bytesPerSecond ?? 0),
    })
  );
  au.on('update-downloaded', (i: any) =>
    push({ status: 'ready', version: i?.version ?? '?', notes: notesOf(i) })
  );
  au.on('error', (err: any) =>
    push({ status: 'error', message: err?.message || String(err) })
  );

  // Kick off shortly after boot so it never competes with the first sync.
  setTimeout(() => void checkNow(false), 15_000);
  setInterval(() => void checkNow(false), CHECK_INTERVAL_MS);
}

let inFlight = false;

async function checkNow(manual: boolean) {
  if (!app.isPackaged) {
    if (manual) push({ status: 'disabled', reason: 'dev' });
    return;
  }
  const au = loadUpdater();
  if (!au) {
    if (manual) push({ status: 'disabled', reason: 'unavailable' });
    return;
  }

  // A portable .exe cannot replace itself in place.
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    push({ status: 'disabled', reason: 'portable' });
    return;
  }

  // A download already finished or is running — re-checking would only reset a
  // perfectly good 'ready' back to 'checking' and re-download the same file.
  if (state.status === 'ready' || state.status === 'downloading') return;
  if (inFlight) return;

  inFlight = true;
  try {
    await au.checkForUpdates();
  } catch (e: any) {
    // Offline is the normal case for a till, not an error worth shouting about.
    console.warn('[updater] check failed:', e?.message || e);
    push({ status: 'error', message: e?.message || String(e) });
  } finally {
    inFlight = false;
  }
}
