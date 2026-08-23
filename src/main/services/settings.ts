// src/main/services/settings.ts
import type {
  DatabaseService,
  KVStore,
  SettingsService,
} from '../types/common';
import { posError } from '../../shared/errorCodes';

interface SettingsDeps {
  db: DatabaseService;
  store: KVStore; // backed by getMeta / setMeta
}

/**
 * Pure factory: given a db + store, build a SettingsService instance.
 */
export function createSettingsService({
  db,
  store,
}: SettingsDeps): SettingsService {
  function getRaw(key: string): string | null {
    // 1) Try app_settings table
    try {
      const row = db.get<{ value: any }>(
        'SELECT value FROM app_settings WHERE key = ?',
        key
      );
      if (row && row.value !== undefined && row.value !== null) {
        return String(row.value);
      }
    } catch {
      // ignore if table missing
    }

    // 2) Fallback: meta direct
    const direct = store.get(key);
    if (direct !== undefined && direct !== null) {
      return String(direct);
    }

    // 3) Fallback: meta "settings.*"
    const prefixed = store.get(`settings.${key}`);
    if (prefixed !== undefined && prefixed !== null) {
      return String(prefixed);
    }

    return null;
  }

  function getBool(key: string, fallback = false): boolean {
    const raw = (getRaw(key) ?? '').trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return fallback;
  }

  function getNumber(key: string, fallback = 0): number {
    const raw = getRaw(key);
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function getAll(): { key: string; value: string | null }[] {
    try {
      const rows = db.all<{ key: string; value: any }>(
        'SELECT key, value FROM app_settings ORDER BY key ASC'
      );
      return rows.map((r) => ({
        key: r.key,
        value:
          r.value === undefined || r.value === null ? null : String(r.value),
      }));
    } catch {
      // If table doesn't exist yet, just return empty list
      return [];
    }
  }

  return {
    getRaw,
    getBool,
    getNumber,
    getAll,
  };
}

/* ----------------------------------------------------------------------
 * Global singleton helpers (for easy use inside handlers)
 * --------------------------------------------------------------------*/

let settingsSingleton: SettingsService | null = null;

/**
 * Call this once from index.ts after you create dbService + kvStore.
 */
export function initSettingsService(deps: SettingsDeps): SettingsService {
  settingsSingleton = createSettingsService(deps);
  return settingsSingleton;
}

export function getSettingsService(): SettingsService {
  if (!settingsSingleton) {
    throw posError('POS_CFG_SETTINGS_NOT_READY');
  }
  return settingsSingleton;
}

/**
 * Shorthand helpers so handlers can import them directly.
 */
export function readSettingRaw(key: string): string | null {
  return getSettingsService().getRaw(key);
}

export function readSettingBool(key: string, fallback = false): boolean {
  return getSettingsService().getBool(key, fallback);
}

export function readSettingNumber(key: string, fallback = 0): number {
  return getSettingsService().getNumber(key, fallback);
}

export function readAllSettings(): { key: string; value: string | null }[] {
  return getSettingsService().getAll();
}

/* ---------------------------------------------------------------
   Delivery on/off
   ---------------------------------------------------------------
   The backend namespaces every setting as `category.name`, so the key is
   `general.enable_delivery` — the bare `enable_delivery` has never existed and
   reading it would silently return the caller's own default. For delivery that
   default is "on", which is precisely the state a shop that turned delivery off
   did not want, so the wrong key produces a gate that looks like it works.

   Absent and empty are deliberately not the same answer:
     - absent  → the till has not synced settings yet, and we cannot know.
                 Fail OPEN: hiding delivery from a shop that does deliver blocks
                 real sales, which is worse than showing one extra button.
     - ""      → the row exists and the operator cleared it. Treat as off, per
                 the backend contract.
*/
export const ENABLE_DELIVERY_KEY = 'general.enable_delivery';

/** Pure so the truth table can be tested without a database. */
export function deliveryEnabledFrom(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const v = String(raw).trim().toLowerCase();
  if (v === '') return false;
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

export function isDeliveryEnabled(): boolean {
  try {
    return deliveryEnabledFrom(readSettingRaw(ENABLE_DELIVERY_KEY));
  } catch {
    // Settings service not up yet — same reasoning as an absent key.
    return true;
  }
}
