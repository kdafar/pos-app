import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal stand-in for the orders table: applyPushResult only runs a handful of
// single-row UPDATEs and one SELECT keyed by id.
const rows = new Map<string, any>();
const fakeDb = {
  prepare(sql: string) {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      get: (id: string) => rows.get(id),
      run: (...a: any[]) => {
        const id = a[a.length - 1];
        const r = rows.get(id);
        if (!r) return { changes: 0 };
        if (s.includes('server_id = COALESCE') && !s.includes('synced_at')) {
          if (a[0] != null) r.server_id = a[0];
        } else if (s.startsWith('UPDATE orders SET status = ? WHERE')) {
          r.status = a[0];
        } else if (s.includes('synced_at')) {
          r.synced_at = 1;
          if (a[0] != null) r.server_id = a[0];
        }
        return { changes: 1 };
      },
    };
  },
  transaction: (fn: () => void) => fn,
};
vi.mock('../db', () => ({ default: fakeDb, getMeta: () => null, setMeta: () => {} }));
vi.mock('../services/settings', () => ({ createSettingsService: () => ({}) }));

const { applyPushResult } = await import('./orderNumbers');

const seed = (id: string, status: string, status_code: number | null = null) =>
  rows.set(id, { id, status, status_code, updated_at: 100 });

describe('applyPushResult statuses', () => {
  beforeEach(() => rows.clear());

  it('the placing till follows the automatic accept', () => {
    seed('a', 'placed');
    applyPushResult({ ack: { a: '9' }, statuses: { a: 2 } });
    expect(rows.get('a')).toMatchObject({ status: 'prepared', status_code: null, updated_at: 100 });
  });

  it('an order changed during the push stays queued, with its ids', () => {
    seed('f', 'closed');
    rows.get('f').updated_at = 200;
    applyPushResult({ ack: { f: '9' } }, [{ temp_id: 'f', timestamps: { updated_at: 100 } }]);
    expect(rows.get('f').synced_at).toBeUndefined();
    expect(rows.get('f').server_id).toBe('9');
  });

  it('an unchanged order is marked sent', () => {
    seed('g', 'placed');
    applyPushResult({ ack: { g: '9' } }, [{ temp_id: 'g', timestamps: { updated_at: 100 } }]);
    expect(rows.get('g').synced_at).toBe(1);
  });

  it('never moves an order back', () => {
    seed('b', 'ready', 3);
    applyPushResult({ ack: { b: '9' }, statuses: { b: 2 } });
    expect(rows.get('b').status).toBe('ready');
  });

  it('never reopens a local close', () => {
    seed('c', 'closed', 4);
    applyPushResult({ ack: { c: '9' }, statuses: { c: 2 } });
    expect(rows.get('c').status).toBe('closed');
  });

  it('a reply without statuses changes nothing', () => {
    seed('d', 'placed');
    applyPushResult({ ack: { d: '9' } });
    expect(rows.get('d').status).toBe('placed');
  });

  it('ignores a status for an order that was not acked', () => {
    seed('e', 'placed');
    applyPushResult({ ack: {}, statuses: { e: 2 } });
    expect(rows.get('e').status).toBe('placed');
  });
});
