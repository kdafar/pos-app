// src/main/index.ts

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
// If you're not using fs anywhere, you can remove this
// import fs from 'node:fs';

import type { Database as BetterSqliteDB } from 'better-sqlite3';

// DB + meta
import db, { migrate, enforcePosLockKillSwitch, getMeta, setMeta } from './db';

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
// Create BrowserWindow
// ─────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Majestic POS',
    icon: path.join(process.env.APP_ROOT!, 'build', 'icon.png'),
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

  // 3) Kill-switch: if this device is locked, format DB + restart
  enforcePosLockKillSwitch();

  // 4) Build MainServices facade
  const services = createMainServices(db as BetterSqliteDB);

  // 5) Custom protocols (images, etc.) – app is ready now
  registerAppImgProtocol();

  // 6) IPC handlers (store, settings, orders, cart, sync, dev, ...)
  registerAllHandlers(ipcMain, services);

  // 7) Local print handlers (uses raw SQLite DB)
  registerLocalPrintHandlers(ipcMain, db as BetterSqliteDB);

  // 8) Optional socket server (if you re-enable later)
  // try {
  //   createSocketServer({ port: 0, db: db as BetterSqliteDB });
  // } catch (e) {
  //   console.warn('[socket] server not started:', (e as any)?.message);
  // }

  // 9) Finally create main window
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
