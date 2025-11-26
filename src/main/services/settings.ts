// src/main/services/settings.ts
import type {
  DatabaseService,
  KVStore,
  SettingsService,
} from '../types/common';

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
    throw new Error(
      'SettingsService not initialized. Call initSettingsService() first.'
    );
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
