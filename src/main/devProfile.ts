// src/main/devProfile.ts
//
// An isolated till for testing against another server, dev builds only.
//
//   POS_PROFILE=dev npm run dev
//
// Pairing a till to a different server wipes its restaurant data, and the
// device token lives in the OS credential vault under one machine-wide name.
// So testing against dev.trebianco on a developer's machine that is also
// paired to production would wipe the production orders AND overwrite the
// production device token. A profile moves both: userData (database, machine
// id, secrets fallback, logs) to "POS App (<profile>)", and the vault entry to
// "pos-app-<profile>".
//
// Ignored in packaged builds — a shop's till can never be switched by an
// environment variable. Must be imported before anything reads userData.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const raw = String(process.env.POS_PROFILE ?? '').trim().toLowerCase();

export const DEV_PROFILE: string | null =
  !app.isPackaged && /^[a-z0-9-]{1,32}$/.test(raw) ? raw : null;

if (DEV_PROFILE) {
  const dir = path.join(app.getPath('appData'), `POS App (${DEV_PROFILE})`);
  // db.ts opens pos.db at import time, before Electron would create the folder.
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
  console.warn(`[devProfile] isolated profile "${DEV_PROFILE}" at ${app.getPath('userData')}`);
}

/** The credential-vault service name for this run. */
export const SECRET_SERVICE = DEV_PROFILE ? `pos-app-${DEV_PROFILE}` : 'pos-app';
