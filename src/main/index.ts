// src/main/index.ts

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

import type { Database as BetterSqliteDB } from 'better-sqlite3';

// DB + meta
import db, { migrate } from './db';

// Services + handlers
import { createMainServices } from './services';
import { registerAllHandlers } from './handlers';

// Protocols / printing
import { registerAppImgScheme, registerAppImgProtocol } from './protocols';
import { registerLocalPrintHandlers } from './print';
// Socket server currently not used
// import { createSocketServer } from './socket';

process.env.APP_ROOT = path.join(__dirname, '../..');

let mainWindow: BrowserWindow | null = null;

// ─────────────────────────────────────────────────────────────
// Helper: resolve preload path
// ─────────────────────────────────────────────────────────────

function resolvePreloadPath(): string {
  const base = path.join(__dirname, '../preload');
  const js = path.join(base, 'index.js');
  const cjs = path.join(base, 'index.cjs');

  if (fs.existsSync(js)) {
    console.log('[main] Using preload:', js);
    return js;
  }
  if (fs.existsSync(cjs)) {
    console.log('[main] Using preload:', cjs);
    return cjs;
  }

  console.warn(
    '[main] Preload file not found at',
    js,
    'or',
    cjs,
    '— check your build config.'
  );
  // Return js as a fallback so Electron doesn’t crash on undefined
  return js;
}

// ─────────────────────────────────────────────────────────────
// Create BrowserWindow
// ─────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'), // ← .js in build
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

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

  // 2) Build MainServices facade
  const services = createMainServices(db as BetterSqliteDB);

  // 3) Custom protocols (images, etc.) – app is ready now
  registerAppImgProtocol();

  // 4) IPC handlers (store, settings, orders, cart, sync, dev, ...)
  registerAllHandlers(ipcMain, services);

  // 5) Local print handlers (uses raw SQLite DB)
  registerLocalPrintHandlers(ipcMain, db as BetterSqliteDB);

  // 6) Optional socket server (disabled for now)
  // try {
  //   createSocketServer({ port: 0, db: db as BetterSqliteDB });
  // } catch (e) {
  //   console.warn('[socket] server not started:', (e as any)?.message);
  // }

  // 7) Finally create main window
  createMainWindow();
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
