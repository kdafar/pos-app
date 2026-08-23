// src/main/index.ts

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

import type { Database as BetterSqliteDB } from 'better-sqlite3';

// DB + meta
import db, {
  migrate,
  enforcePosLockKillSwitch,
  repairOrderSyncDamage,
  guardLegacyOutbox,
  getMeta,
  setMeta,
} from './db';

// Services + handlers
import { createMainServices } from './services';
import { registerAllHandlers } from './handlers';

// Protocols / printing
import { registerAppImgScheme, registerAppImgProtocol } from './protocols';
import { registerLocalPrintHandlers } from './print';
import { registerUpdater } from './updater';
// Socket server currently not used
// import { createSocketServer } from './socket';

process.env.APP_ROOT = path.join(__dirname, '../..');

let mainWindow: BrowserWindow | null = null;

// ─────────────────────────────────────────────────────────────
// Create BrowserWindow
// ─────────────────────────────────────────────────────────────

/**
 * Window icon. Packaged Windows builds take it from the exe, but in dev (and
 * on Linux) we point at the build resource — only if it is actually there, so
 * a missing file degrades to the default icon instead of an ugly blank one.
 */
function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(process.env.APP_ROOT!, 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'build', 'icon.png'),
  ];
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Majestic POS',
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Prevent the web page from changing the title
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow!.setTitle('Majestic POS'); // enforce our title
  });

  // electron-vite exposes the dev server as ELECTRON_RENDERER_URL.
  // VITE_DEV_SERVER_URL is the older vite-plugin-electron name (still used by
  // the legacy electron/main.ts) — kept only as a fallback. Reading just the
  // old name meant `npm run dev` either loaded a stale build or, if the old
  // variable lingered in the shell, hit a port nothing was serving.
  const devServerUrl =
    process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    console.log('[window] loading dev server:', devServerUrl);
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Surface load failures in the terminal instead of only in the window.
  mainWindow.webContents.on(
    'did-fail-load',
    (_e, code, desc, url) =>
      console.error(`[window] failed to load ${url}: ${desc} (${code})`)
  );

  // Renderer errors otherwise only exist in DevTools, which nobody has open on
  // a till. Forwarding warnings and errors to the main process means a bug
  // report can be read off the terminal, or a log, instead of reproduced blind.
  mainWindow.webContents.on(
    'console-message',
    (_e, level, message, line, sourceId) => {
      if (level < 2) return; // 0 verbose, 1 info — only warn (2) and error (3)
      const where = sourceId ? ` (${sourceId.split('/').pop()}:${line})` : '';
      const tag = level === 3 ? '[renderer:error]' : '[renderer:warn]';
      console.log(`${tag} ${message}${where}`);
    }
  );

  // An unhandled crash in the renderer leaves a frozen window with no clue why.
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    console.error('[renderer] process gone:', details.reason, details.exitCode)
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─────────────────────────────────────────────────────────────
// Boot sequence
// ─────────────────────────────────────────────────────────────

async function boot() {
  // 1) Migrate local DB
  try {
    migrate();
    console.log('[db] migrate done');
  } catch (e) {
    console.error('[db] migrate failed:', e);
  }

  // 2) Restore your old default meta values (from previous app.on('ready'))
  try {
    if (getMeta('pos.mode') == null) setMeta('pos.mode', 'live');
    if (getMeta('sync.disabled') == null) setMeta('sync.disabled', '0');
    if (getMeta('pos.locked') == null) setMeta('pos.locked', '0');
    if (getMeta('security.kill_after_days') == null) {
      setMeta('security.kill_after_days', '14');
    }
  } catch (e) {
    console.error('[db] meta init failed:', e);
  }

  // 2.5) Repair rows damaged by the old order-sync bugs (runs once).
  try {
    repairOrderSyncDamage();
    guardLegacyOutbox();
  } catch (e) {
    console.error('[db] order sync repair failed:', e);
  }

  // 3) Lock policy: a locked / too-long-offline device is unpaired (and, when
  //    the server locked it, its local data is wiped). The app keeps running
  //    and lands on the Pair screen — it never exits on its own.
  try {
    const outcome = enforcePosLockKillSwitch();
    if (outcome.action !== 'none') {
      console.log('[pos] lock policy applied at boot:', outcome);
    }
  } catch (e) {
    console.error('[pos] lock policy check failed:', e);
  }

  // 4) Build MainServices facade
  const services = createMainServices(db as BetterSqliteDB);

  // 5) Custom protocols (images, etc.) – app is ready now
  registerAppImgProtocol();

  // 6) IPC handlers (store, settings, orders, cart, sync, dev, ...)
  registerAllHandlers(ipcMain, services);

  // 7) Local print handlers (uses raw SQLite DB)
  registerLocalPrintHandlers(ipcMain, db as BetterSqliteDB, services);

  // 8) Optional socket server (if you re-enable later)
  // try {
  //   createSocketServer({ port: 0, db: db as BetterSqliteDB });
  // } catch (e) {
  //   console.warn('[socket] server not started:', (e as any)?.message);
  // }

  // 9) Finally create main window
  createMainWindow();

  // 10) Auto-update (no-op in dev / portable builds)
  try {
    if (mainWindow) registerUpdater(mainWindow);
  } catch (e) {
    console.error('[updater] failed to register:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────

// Must be called BEFORE app.whenReady()
registerAppImgScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(boot)
    .catch((err) => {
      console.error('[main] boot failed:', err);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createMainWindow();
    }
  });
}
