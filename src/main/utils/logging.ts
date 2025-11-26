// src/main/utils/logging.ts
import crypto from 'node:crypto';
import type { MainServices } from '../types/common';
import { getCurrentPosUser } from './permissions';

export type LogMode = 'unknown' | 'new' | 'old' | 'none';

let logMode: LogMode = 'unknown';

export const nowMs = () => Date.now();

/**
 * Detect which pos_action_log schema is present:
 * - "new" => meta_json column
 * - "old" => payload column
 * - "none" => table missing or unusable
 */
export function detectPosLogSchema(services: MainServices): LogMode {
  if (logMode !== 'unknown') return logMode;

  try {
    const cols = services.rawDb
      .prepare(`PRAGMA table_info(pos_action_log)`)
      .all() as Array<{ name: string }>;
    if (!cols || cols.length === 0) {
      logMode = 'none';
    } else {
      const names = cols.map((c) => c.name);
      if (names.includes('meta_json')) logMode = 'new';
      else if (names.includes('payload')) logMode = 'old';
      else logMode = 'none';
    }
  } catch {
    logMode = 'none';
  }

  return logMode;
}

function getCurrentUserIdForLog(services: MainServices): string | null {
  return getCurrentPosUser(services).id;
}

/**
 * Insert a log row into pos_action_log without ever crashing the POS.
 */
export function logAction(
  services: MainServices,
  orderId: string | null,
  action: string,
  payload: any
): void {
  try {
    const mode = detectPosLogSchema(services);
    if (mode === 'none') return;

    const userId = getCurrentUserIdForLog(services);
    const ts = nowMs();
    const meta = payload ? JSON.stringify(payload) : null;
    const db = services.rawDb;

    if (mode === 'new') {
      const id = crypto.randomUUID();
      db.prepare(
        `
          INSERT INTO pos_action_log (id, order_id, user_id, action, meta_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(id, orderId ?? null, userId ?? null, action, meta, ts);
    } else {
      db.prepare(
        `
          INSERT INTO pos_action_log (order_id, action, payload, performed_by_user_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      ).run(orderId ?? null, action, meta, userId ?? null, ts);
    }
  } catch {
    // Never crash POS if logging fails
  }
}

/**
 * Small wrapper for IPC and service handlers.
 * - Measures duration
 * - Logs to console in dev only
 * - Never swallows the error (rethrows)
 *
 * Usage:
 *   ipcMain.handle('foo', withLogging('foo', async (event, payload) => { ... }));
 */
export function withLogging<TArgs extends any[], TResult>(
  label: string,
  handler: (...args: TArgs) => Promise<TResult> | TResult
) {
  return async (...args: TArgs): Promise<TResult> => {
    const start = nowMs();

    try {
      const result = await handler(...args);

      if (
        process.env.NODE_ENV === 'development' ||
        process.env.ELECTRON_DEV === '1'
      ) {
        const dur = nowMs() - start;
        console.log(`[IPC] ${label} OK in ${dur}ms`);
      }

      return result;
    } catch (err) {
      const dur = nowMs() - start;
      console.error(`[IPC] ${label} FAILED in ${dur}ms`, err);
      throw err;
    }
  };
}
