// src/main/services/index.ts

import type { Database as BetterSqliteDB } from 'better-sqlite3';
import { getMeta, setMeta } from '../db';
import type { DatabaseService, KVStore, MainServices } from '../types/common';
import { createSettingsService } from './settings';

/**
 * Thin wrapper around better-sqlite3 so everything uses the same API.
 */
function createDatabaseService(rawDb: BetterSqliteDB): DatabaseService {
  return {
    get<T = any>(sql: string, ...params: any[]): T | undefined {
      return rawDb.prepare(sql).get(...params) as T | undefined;
    },
    all<T = any>(sql: string, ...params: any[]): T[] {
      return rawDb.prepare(sql).all(...params) as T[];
    },
    run(sql: string, ...params: any[]): void {
      rawDb.prepare(sql).run(...params);
    },
    transaction<T>(fn: () => T): T {
      const trx = rawDb.transaction(fn);
      return trx();
    },
  };
}

/**
 * KV store backed by sync_state (via getMeta / setMeta).
 */
function createKVStore(): KVStore {
  return {
    get(key: string): any {
      return getMeta(key);
    },
    set(key: string, value: any): void {
      if (value === undefined) return;
      setMeta(key, String(value));
    },
    delete(key: string): void {
      // simplest: store empty string
      setMeta(key, '');
    },
  };
}

/**
 * Meta helper used by utils/orderNumbers, sync handlers, etc.
 */
function createMetaService() {
  return {
    get(key: string): string | undefined {
      const v = getMeta(key);
      return v === null || v === undefined ? undefined : String(v);
    },
    set(key: string, value: string | number | null | undefined): void {
      if (value === null || value === undefined) {
        setMeta(key, '');
      } else {
        setMeta(key, String(value));
      }
    },
  };
}

/**
 * Build the MainServices object shared across handlers.
 */
export function createMainServices(rawDb: BetterSqliteDB): MainServices {
  const db = createDatabaseService(rawDb);
  const store = createKVStore();
  const meta = createMetaService();

  const settings = createSettingsService({
    db,
    store,
  });

  const services: MainServices = {
    rawDb,
    db,
    store,
    meta,
    settings,
  };

  return services;
}
