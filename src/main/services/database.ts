// src/main/services/database.ts
import type { Database as BetterSqliteDB } from 'better-sqlite3';
import type { DatabaseService } from '../types/common';

function normalizeParams(params?: any): any[] {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params;
  // Object or scalar → pass as single argument (better-sqlite3 supports both)
  return [params];
}

export function createDatabaseService(rawDb: BetterSqliteDB): DatabaseService {
  return {
    raw: rawDb,

    get<T = any>(sql: string, params?: any): T | undefined {
      const stmt = rawDb.prepare(sql);
      const norm = normalizeParams(params);

      return stmt.get(...norm) as T | undefined;
    },

    all<T = any>(sql: string, params?: any): T[] {
      const stmt = rawDb.prepare(sql);
      const norm = normalizeParams(params);

      return stmt.all(...norm) as T[];
    },

    run(sql: string, params?: any): void {
      const stmt = rawDb.prepare(sql);
      const norm = normalizeParams(params);

      stmt.run(...norm);
    },
  };
}
