// src/main/handlers/dev.ts

import type { IpcMain } from 'electron';
import type { MainServices } from '../types/common';
import { withLogging } from '../utils/logging';
import db, { getMeta } from '../db';

/**
 * Development / debug-only IPC handlers.
 *
 * NOTE:
 * - We auto-disable these in production.
 * - Use only for local debugging / QA tools in the renderer.
 */
export function registerDevHandlers(ipcMain: IpcMain, services: MainServices) {
  const isDev =
    process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === '1';

  if (!isDev) {
    // In production we don't expose any dev channels at all.
    return;
  }

  const { meta } = services;

  // Simple health check from renderer
  ipcMain.handle(
    'dev:ping',
    withLogging('dev:ping', async () => {
      return {
        pong: true,
        ts: Date.now(),
        node: process.version,
      };
    })
  );

  // Dump a few meta keys (safe preview, no secrets)
  ipcMain.handle(
    'dev:metaPreview',
    withLogging('dev:metaPreview', async () => {
      const keys = [
        'server.base_url',
        'device_id',
        'branch_id',
        'branch.name',
        'pos.mode',
        'bootstrap.done',
        'sync.last_at',
      ];

      const out: Record<string, any> = {};
      for (const k of keys) {
        out[k] = meta.get(k) ?? getMeta(k) ?? null;
      }

      return out;
    })
  );

  // Quick DB stats – useful in DevTools
  ipcMain.handle(
    'dev:dbStats',
    withLogging('dev:dbStats', async () => {
      try {
        const orders =
          (db.prepare(`SELECT COUNT(*) FROM orders`).pluck().get() as number) ||
          0;

        const unsynced =
          (db
            .prepare(
              `SELECT COUNT(*)
               FROM orders
               WHERE status = 'completed'
                 AND (synced_at IS NULL OR synced_at = 0)`
            )
            .pluck()
            .get() as number) || 0;

        const items =
          (db.prepare(`SELECT COUNT(*) FROM items`).pluck().get() as number) ||
          0;

        const tables =
          (db.prepare(`SELECT COUNT(*) FROM tables`).pluck().get() as number) ||
          0;

        return {
          ok: true,
          orders,
          unsynced,
          items,
          tables,
        };
      } catch (e: any) {
        return {
          ok: false,
          error: e?.message ?? String(e),
        };
      }
    })
  );

  // OPTIONAL: if you had any old dev handlers, paste them here
  // and wrap with withLogging('dev:whatever', handler)
}
