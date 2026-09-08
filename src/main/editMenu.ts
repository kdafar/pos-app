// src/main/editMenu.ts
//
// Making copy, paste and select-all work at all.

import { Menu, clipboard, type BrowserWindow, type IpcMain } from 'electron';
import { getMeta } from './db';

/**
 * Electron routes the clipboard accelerators through the application menu.
 * This app never set one, so Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A did nothing in
 * any input in the app — the pairing screen was simply where it hurt most,
 * because a server URL and a pairing code are the two things nobody wants to
 * retype off a phone.
 *
 * The bar itself stays hidden: this is a till, not a desktop app. Only the
 * accelerators are wanted, and they work whether or not the bar is drawn.
 */
export function installEditMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          // Pastes as plain text. A code copied out of a web page otherwise
          // arrives carrying its markup, which the server then refuses.
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ],
      },
    ])
  );
}

const LABELS = {
  en: { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all' },
  ar: { cut: 'قص', copy: 'نسخ', paste: 'لصق', selectAll: 'تحديد الكل' },
};

/** The language the renderer is currently showing, as the toggle last stored it. */
function labels() {
  return getMeta('ui.lang') === 'ar' ? LABELS.ar : LABELS.en;
}

/**
 * Right-click cut/copy/paste.
 *
 * Not a duplicate of the accelerators above: plenty of these counters are
 * touch screens or have a keyboard the cashier cannot reach past the till
 * drawer, and a shortcut nobody can press is not a way to paste anything.
 */
export function attachContextMenu(win: BrowserWindow) {
  win.webContents.on('context-menu', (_e, params) => {
    const l = labels();
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (params.isEditable) {
      template.push(
        { role: 'cut', label: l.cut, enabled: params.editFlags.canCut },
        { role: 'copy', label: l.copy, enabled: params.editFlags.canCopy },
        { role: 'paste', label: l.paste, enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: l.selectAll }
      );
    } else if (params.selectionText.trim()) {
      template.push({
        role: 'copy',
        label: l.copy,
        enabled: params.editFlags.canCopy,
      });
    }

    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });
}

/**
 * Reading the clipboard without a keystroke.
 *
 * The last resort for a PC where paste is blocked outright — some of these
 * tills are locked down by whoever set them up, and the alternative is a
 * cashier copying a 30-minute pairing code by hand off a phone screen.
 */
export function registerClipboardHandlers(ipcMain: IpcMain) {
  ipcMain.handle('clipboard:readText', () => {
    try {
      return clipboard.readText().trim();
    } catch (err) {
      console.error('[pos] Could not read the clipboard:', err);
      return '';
    }
  });
}
