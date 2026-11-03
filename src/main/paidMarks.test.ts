import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  drainPaidActions,
  queuePaidAction,
  remoteOrderId,
  sendPaidAction,
  withdrawPaidAction,
  type PaidDeps,
} from './paidMarks';
import { applyServerPaid } from './paidState';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, server_id TEXT, synced_at INTEGER,
      status TEXT, status_code INTEGER, grand_total REAL,
      payment_method_id TEXT, payment_method_slug TEXT,
      paid_status TEXT, paid_how TEXT, paid_time TEXT, paid_by_id INTEGER,
      paid_by_name TEXT, paid_amount REAL, paid_method_id TEXT,
      paid_method_name TEXT, paid_method_name_ar TEXT,
      paid_link_open INTEGER DEFAULT 0, paid_reference TEXT, paid_pending TEXT, paid_refusal TEXT
    );
    CREATE TABLE payment_methods (id TEXT PRIMARY KEY, slug TEXT, name_en TEXT, name_ar TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE order_paid_actions (
      action_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL,
      body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, refusal_code TEXT,
      created_at INTEGER NOT NULL, finished_at INTEGER
    );
    INSERT INTO payment_methods VALUES ('1','cash','Cash','نقداً',1), ('3','knet','KNET','كي نت',1);
  `);
  return db;
}

type Call = { method: 'post' | 'delete'; path: string; body: any };

/** An axios stand-in answering from a queue of scripted responses. */
function fakeApi(script: Array<(c: Call) => any>) {
  const calls: Call[] = [];
  const answer = async (c: Call) => {
    calls.push(c);
    const next = script.shift();
    if (!next) throw new Error('unexpected call');
    return next(c);
  };
  return {
    calls,
    api: {
      post: (path: string, body: any) => answer({ method: 'post', path, body }),
      delete: (path: string, cfg: any) => answer({ method: 'delete', path, body: cfg?.data }),
    } as any,
  };
}

const paidOrder = (extra: any = {}) => ({
  id: 107753,
  number: 'X',
  paid: {
    status: 'paid',
    how: 'by_hand',
    paid_at: '2026-11-03T09:41:12Z',
    paid_by: { id: 12, name: 'Sara' },
    amount: 12,
    payment_method_id: '3',
    link_open: false,
  },
  ...extra,
});

const httpError = (status: number, data: any) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

let db: any;
let live = true;
const deps = (api: any): PaidDeps => ({ db, api: () => api, isLive: () => live });

beforeEach(() => {
  db = freshDb();
  live = true;
  // A web order that came through pull (integer id), and one of this till's.
  db.prepare(
    `INSERT INTO orders (id, status, status_code, grand_total, payment_method_id, payment_method_slug)
     VALUES ('107753', 'preparing', 2, 12, '1', 'cash')`
  ).run();
  db.prepare(
    `INSERT INTO orders (id, server_id, synced_at, status, grand_total, payment_method_id)
     VALUES ('a1b2c3d4-uuid', NULL, NULL, 'placed', 16, '1')`
  ).run();
});

const row = (id: string) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const action = (id: string) =>
  db.prepare('SELECT * FROM order_paid_actions WHERE action_id = ?').get(id);

describe('remoteOrderId', () => {
  it('uses the ack for own orders and the id for pulled ones', () => {
    expect(remoteOrderId({ id: '107753' })).toBe('107753');
    expect(remoteOrderId({ id: 'a1b2-uuid', server_id: null })).toBeNull();
    expect(remoteOrderId({ id: 'a1b2-uuid', server_id: '107733' })).toBe('107733');
  });
});

describe('sending a mark', () => {
  it('posts the stored body and replaces the local paid state from the answer', async () => {
    const id = queuePaidAction(db, '107753', 'mark', { paid_by: 12, amount: 12, payment_method_id: '3' });
    expect(row('107753').paid_pending).toBe('mark');

    const { api, calls } = fakeApi([() => ({ data: { replayed: false, order: paidOrder(), notices: [] } })]);
    const out = await sendPaidAction(deps(api), id);

    expect(out).toEqual({ kind: 'done', replayed: false, notices: [] });
    expect(calls[0].method).toBe('post');
    expect(calls[0].path).toBe('/orders/107753/paid');
    expect(calls[0].body.action_id).toBe(id);
    const r = row('107753');
    expect(r).toMatchObject({
      paid_status: 'paid',
      paid_how: 'by_hand',
      paid_by_name: 'Sara',
      paid_method_name: 'KNET',
      paid_pending: null,
      // §5: an open order follows the method it was paid with.
      payment_method_id: '3',
      payment_method_slug: 'knet',
    });
    expect(action(id).state).toBe('done');
  });

  it('passes notices through', async () => {
    const id = queuePaidAction(db, '107753', 'mark', { amount: 12 });
    const { api } = fakeApi([
      () => ({ data: { order: paidOrder(), notices: [{ code: 'POS_PAID_LINK_STILL_OPEN' }] } }),
    ]);
    const out = await sendPaidAction(deps(api), id);
    expect(out).toMatchObject({ kind: 'done', notices: ['POS_PAID_LINK_STILL_OPEN'] });
  });

  it('waits for the push ack on the till’s own order', async () => {
    const id = queuePaidAction(db, 'a1b2c3d4-uuid', 'mark', { amount: 16 });
    const { api, calls } = fakeApi([]);
    expect(await sendPaidAction(deps(api), id)).toEqual({ kind: 'waiting', reason: 'no_server_id' });

    // Acked once, then edited again: still waits, the server total is stale.
    db.prepare(`UPDATE orders SET server_id = '107733', synced_at = NULL WHERE id = 'a1b2c3d4-uuid'`).run();
    expect(await sendPaidAction(deps(api), id)).toEqual({ kind: 'waiting', reason: 'unsynced' });
    expect(calls).toHaveLength(0);
  });

  it('addresses the server id once acked', async () => {
    db.prepare(`UPDATE orders SET server_id = '107733', synced_at = 1 WHERE id = 'a1b2c3d4-uuid'`).run();
    const id = queuePaidAction(db, 'a1b2c3d4-uuid', 'mark', { amount: 16 });
    const { api, calls } = fakeApi([() => ({ data: { order: { id: 107733, paid: { status: 'paid', how: 'by_hand' } } } })]);
    await sendPaidAction(deps(api), id);
    expect(calls[0].path).toBe('/orders/107733/paid');
    expect(row('a1b2c3d4-uuid').paid_status).toBe('paid');
  });

  it('keeps the action on 5xx and network errors, with the same action_id', async () => {
    const id = queuePaidAction(db, '107753', 'mark', { amount: 12 });
    const { api, calls } = fakeApi([
      () => {
        throw httpError(503, {});
      },
      () => {
        throw new Error('timeout of 15000ms exceeded');
      },
      () => ({ data: { replayed: true, order: paidOrder() } }),
    ]);
    expect((await sendPaidAction(deps(api), id)).kind).toBe('retry');
    expect((await sendPaidAction(deps(api), id)).kind).toBe('retry');
    expect(action(id)).toMatchObject({ state: 'queued', attempts: 2 });
    expect(row('107753').paid_pending).toBe('mark');

    const out = await sendPaidAction(deps(api), id);
    expect(out).toMatchObject({ kind: 'done', replayed: true });
    expect(new Set(calls.map((c) => c.body.action_id))).toEqual(new Set([id]));
  });

  it('does not drop a mark over a device-level 401/403 or a bare 404', async () => {
    const id = queuePaidAction(db, '107753', 'mark', { amount: 12 });
    const { api } = fakeApi([
      () => {
        throw httpError(401, {});
      },
      () => {
        throw httpError(403, { code: 'POS_DEVICE_REVOKED' });
      },
      () => {
        throw httpError(404, { message: 'Not Found' });
      },
    ]);
    for (let i = 0; i < 3; i++) expect((await sendPaidAction(deps(api), id)).kind).toBe('retry');
    expect(action(id).state).toBe('queued');
  });

  it('drops on a 4xx refusal, stores the order it carries, and shows the refusal', async () => {
    const id = queuePaidAction(db, '107753', 'mark', { amount: 10 });
    const { api } = fakeApi([
      () => {
        throw httpError(422, {
          code: 'POS_PAID_AMOUNT_MISMATCH',
          grand_total: 12.5,
          order: { id: 107753, paid: { status: 'unpaid', how: null, link_open: false } },
        });
      },
    ]);
    const out = await sendPaidAction(deps(api), id);
    expect(out).toEqual({ kind: 'refused', code: 'POS_PAID_AMOUNT_MISMATCH', params: { grand_total: 12.5 } });
    expect(action(id)).toMatchObject({ state: 'refused', refusal_code: 'POS_PAID_AMOUNT_MISMATCH' });
    expect(row('107753')).toMatchObject({
      paid_status: 'unpaid',
      paid_pending: null,
      paid_refusal: 'POS_PAID_AMOUNT_MISMATCH',
      grand_total: 12.5,
    });
  });

  it('treats "already paid" as information, not a failure', async () => {
    const id = queuePaidAction(db, '107753', 'mark', { amount: 12 });
    const { api } = fakeApi([
      () => {
        throw httpError(409, { code: 'POS_PAID_ALREADY_PAID', order: paidOrder() });
      },
    ]);
    const out = await sendPaidAction(deps(api), id);
    expect(out.kind).toBe('refused');
    expect(row('107753')).toMatchObject({ paid_status: 'paid', paid_by_name: 'Sara', paid_refusal: null });
  });

  it('renders POS_ORDER_NOT_FOUND as the app’s own code', async () => {
    const id = queuePaidAction(db, '107753', 'mark', { amount: 12 });
    const { api } = fakeApi([
      () => {
        throw httpError(404, { code: 'POS_ORDER_NOT_FOUND' });
      },
    ]);
    expect(await sendPaidAction(deps(api), id)).toMatchObject({
      kind: 'refused',
      code: 'POS_VAL_ORDER_NOT_FOUND',
    });
  });

  it('sends an undo as DELETE with the body', async () => {
    const id = queuePaidAction(db, '107753', 'undo', { requested_by: 3, reason: 'Card declined' });
    const { api, calls } = fakeApi([() => ({ data: { order: { id: 107753, paid: { status: 'unpaid' } } } })]);
    await sendPaidAction(deps(api), id);
    expect(calls[0]).toMatchObject({ method: 'delete', path: '/orders/107753/paid' });
    expect(calls[0].body.reason).toBe('Card declined');
  });
});

describe('draining the outbox', () => {
  it('waits while offline, then sends in tap order', async () => {
    const m = queuePaidAction(db, '107753', 'mark', { amount: 12 }, 1000);
    const u = queuePaidAction(db, '107753', 'undo', { requested_by: 3 }, 2000);
    expect(row('107753').paid_pending).toBe('undo');

    live = false;
    const { api, calls } = fakeApi([
      () => ({ data: { order: paidOrder() } }),
      () => ({ data: { order: { id: 107753, paid: { status: 'unpaid' } } } }),
    ]);
    expect(await drainPaidActions(deps(api))).toEqual({ sent: 0, refused: 0, waiting: 1 });
    expect(calls).toHaveLength(0);

    live = true;
    expect(await drainPaidActions(deps(api))).toEqual({ sent: 2, refused: 0, waiting: 0 });
    expect(calls.map((c) => c.body.action_id)).toEqual([m, u]);
    expect(row('107753')).toMatchObject({ paid_status: 'unpaid', paid_pending: null });
  });

  it('holds an order’s later actions behind one that cannot go yet', async () => {
    queuePaidAction(db, 'a1b2c3d4-uuid', 'mark', { amount: 16 }, 1000);
    queuePaidAction(db, 'a1b2c3d4-uuid', 'undo', { requested_by: 3 }, 2000);
    const other = queuePaidAction(db, '107753', 'mark', { amount: 12 }, 3000);
    const { api, calls } = fakeApi([() => ({ data: { order: paidOrder() } })]);
    expect(await drainPaidActions(deps(api))).toEqual({ sent: 1, refused: 0, waiting: 2 });
    expect(calls.map((c) => c.body.action_id)).toEqual([other]);
  });
});

describe('withdrawing', () => {
  it('removes a queued action and clears the pending badge', () => {
    const id = queuePaidAction(db, '107753', 'mark', { amount: 12 });
    withdrawPaidAction(db, id);
    expect(action(id)).toBeUndefined();
    expect(row('107753').paid_pending).toBeNull();
  });
});

describe('applyServerPaid', () => {
  it('writes nothing when the server sends no paid key', () => {
    expect(applyServerPaid(db, '107753', undefined)).toBe(false);
    expect(row('107753').paid_status).toBeNull();
  });

  it('never moves a closed order’s method', () => {
    db.prepare(`UPDATE orders SET status = 'done', status_code = 4 WHERE id = '107753'`).run();
    applyServerPaid(db, '107753', paidOrder().paid);
    expect(row('107753')).toMatchObject({ paid_status: 'paid', payment_method_id: '1' });
  });

  it('records a gateway payment without touching the method', () => {
    applyServerPaid(db, '107753', { status: 'paid', how: 'gateway', payment_method_id: null });
    expect(row('107753')).toMatchObject({ paid_how: 'gateway', payment_method_id: '1' });
  });
});
