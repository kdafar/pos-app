import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  MAX_PER_RUN,
  RECHECK_MS,
  resetStaleSweep,
  staleCandidates,
  sweepStaleOrders,
} from './staleOrders';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE orders (
    id TEXT PRIMARY KEY, server_id TEXT, synced_at INTEGER, order_type INTEGER,
    status TEXT, status_code INTEGER, opened_at INTEGER, created_at TEXT)`);
  return db;
}
const add = (db: any, o: Record<string, unknown>) =>
  db
    .prepare(
      `INSERT INTO orders (id, server_id, synced_at, order_type, status, status_code, opened_at, created_at)
       VALUES (@id, @server_id, @synced_at, @order_type, @status, @status_code, @opened_at, @created_at)`
    )
    .run({
      server_id: null,
      synced_at: null,
      order_type: 2,
      status: 'preparing',
      status_code: 2,
      opened_at: NOW - 30 * HOUR,
      created_at: '2026-11-07T08:07:53.000Z',
      ...o,
    });
const notFound = () => Object.assign(new Error('x'), { code: 'POS_VAL_ORDER_NOT_FOUND' });

function deps(db: any, fetchOrder: (id: string) => Promise<{ order: any }>) {
  const closed: string[] = [];
  const removed: string[] = [];
  return {
    closed,
    removed,
    d: {
      db,
      fetchOrder: vi.fn(fetchOrder),
      applyClosed: (id: string, o: any) => (o.status === 4 ? (closed.push(id), true) : false),
      removeOrder: (id: string) => (removed.push(id), true),
      isLive: () => true,
      now: () => NOW,
    },
  };
}

describe('stale open orders', () => {
  beforeEach(() => resetStaleSweep());

  it('asks only about old open orders the server knows, oldest first', () => {
    const db = makeDb();
    add(db, { id: '107865', opened_at: NOW - 30 * HOUR }); // server order, old
    add(db, { id: '107900', opened_at: NOW - 1 * HOUR }); // too recent
    add(db, { id: '107901', status: 'closed', status_code: 4 }); // already closed
    add(db, { id: 'uuid-sent', server_id: '107950', synced_at: 5, opened_at: NOW - 40 * HOUR });
    add(db, { id: 'uuid-unsent', server_id: '107951', synced_at: null }); // waiting to go up
    add(db, { id: 'uuid-noid', server_id: null, synced_at: 5 }); // server never numbered it
    expect(staleCandidates(db, NOW).map((r) => r.id)).toEqual(['uuid-sent', '107865']);
  });

  it('asks about table orders before older pickups', () => {
    const db = makeDb();
    add(db, { id: '100001', order_type: 2, opened_at: NOW - 200 * HOUR });
    add(db, { id: '100002', order_type: 3, opened_at: NOW - 150 * HOUR });
    expect(staleCandidates(db, NOW).map((r) => r.id)).toEqual(['100002', '100001']);
  });

  it('closes what the server closed, own orders included, and leaves open ones', async () => {
    const db = makeDb();
    add(db, { id: '107865' });
    add(db, { id: 'uuid-sent', server_id: '107950', synced_at: 5 });
    add(db, { id: '107866' });
    const answers: Record<string, any> = {
      '107865': { id: 107865, status: 4 },
      '107950': { id: 107950, status: 4 },
      '107866': { id: 107866, status: 2 },
    };
    const { d, closed } = deps(db, async (id) => ({ order: answers[id] }));
    const r = await sweepStaleOrders(d);
    expect(r).toMatchObject({ checked: 3, closed: 2, removed: 0, failed: 0 });
    expect(closed.sort()).toEqual(['107865', 'uuid-sent']);
    // Asked by the server's id for our own order.
    expect(d.fetchOrder.mock.calls.map((c) => c[0]).sort()).toEqual(['107865', '107866', '107950']);
  });

  it('removes a server order the server no longer has, never one of ours', async () => {
    const db = makeDb();
    add(db, { id: '107865' });
    add(db, { id: 'uuid-sent', server_id: '107950', synced_at: 5 });
    const { d, removed } = deps(db, async () => {
      throw notFound();
    });
    const r = await sweepStaleOrders(d);
    expect(removed).toEqual(['107865']);
    expect(r).toMatchObject({ checked: 2, removed: 1, failed: 0 });
  });

  it('asks about the same order once per recheck window, a few per run', async () => {
    const db = makeDb();
    for (let i = 0; i < MAX_PER_RUN + 5; i++) add(db, { id: String(200000 + i) });
    const { d } = deps(db, async () => ({ order: { status: 2 } }));
    expect((await sweepStaleOrders(d)).checked).toBe(MAX_PER_RUN);
    expect((await sweepStaleOrders(d)).checked).toBe(5);
    expect((await sweepStaleOrders(d)).checked).toBe(0);
    const later = { ...d, now: () => NOW + RECHECK_MS };
    expect((await sweepStaleOrders(later)).checked).toBe(MAX_PER_RUN);
  });

  it('stops at the first sign of no connection and tries again next time', async () => {
    const db = makeDb();
    add(db, { id: '107865' });
    add(db, { id: '107866' });
    const { d } = deps(db, async () => {
      throw new Error('network');
    });
    const r = await sweepStaleOrders(d);
    expect(r).toMatchObject({ checked: 1, failed: 1 });
    expect((await sweepStaleOrders(d)).checked).toBe(1);
  });

  it('does nothing offline', async () => {
    const db = makeDb();
    add(db, { id: '107865' });
    const { d } = deps(db, async () => ({ order: { status: 4 } }));
    expect((await sweepStaleOrders({ ...d, isLive: () => false })).checked).toBe(0);
  });
});
