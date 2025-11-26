// src/main/types/common.ts
import type { Database as BetterSqliteDB } from 'better-sqlite3';
import type { Dialog, Shell } from 'electron';

/**
 * Simple key/value store backed by your meta table.
 * We’ll map this to getMeta / setMeta in index.ts.
 */
export interface KVStore {
  get(key: string): any;
  set(key: string, value: any): void;
  delete(key: string): void;
}

/** Secure secrets wrapper (device_token etc.) */
export interface SecretService {
  saveSecret(key: string, value: string): Promise<void> | void;
  loadSecret(key: string): Promise<string | null> | string | null;
}

/** Direct meta access if needed (same as store but explicit) */
export interface MetaService {
  get(key: string): any;
  set(key: string, value: any): void;
}

/** Machine / device info */
export interface MachineService {
  readOrCreateMachineId(): Promise<string>;
}

/**
 * Thin DB wrapper.
 * raw: gives access to the original better-sqlite3 instance when needed.
 */
export interface DatabaseService {
  raw: BetterSqliteDB;

  get<T = any>(sql: string, params?: any): T | undefined;
  all<T = any>(sql: string, params?: any): T[];
  run(sql: string, params?: any): void;
}

/** Settings abstraction (app_settings + meta fallbacks) */
export interface SettingsService {
  /** Raw string or null if not set */
  getRaw(key: string): string | null;

  /** Boolean conversion with fallback */
  getBool(key: string, fallback?: boolean): boolean;

  /** Number conversion with fallback */
  getNumber(key: string, fallback?: number): number;

  /** All app_settings rows (used by settings:all) */
  getAll(): { key: string; value: string | null }[];
}

/**
 * This is what every handler will receive.
 * We’ll construct this object in src/main/index.ts.
 */
export interface MainServices {
  db: DatabaseService;
  rawDb: BetterSqliteDB;
  settings: SettingsService;
  store: KVStore;
  meta: MetaService;
  secrets: SecretService;
  machine: MachineService;
  dialog: Dialog;
  shell: Shell;
}
