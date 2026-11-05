import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  BOOTSTRAP_EVERY_MS,
  FAILED_CHANGES_DDL,
  MAX_FAILED_ATTEMPTS,
  bootstrapDue,
  loadFailedChanges,
  recordFailedChange,
  removeServerOrder,
  settleReplay,
} from './pullRetry';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE orders (id TEXT PRIMARY KEY);
    CREATE TABLE order_lines (id TEXT PRIMARY KEY, order_id TEXT, FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE active_orders (order_id TEXT PRIMARY KEY, FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE order_lines_pending (id TEXT PRIMARY KEY, order_id TEXT);
    CREATE TABLE order_paid_actions (action_id TEXT PRIMARY KEY, order_id TEXT);
  `);
  db.exec(FAILED_CHANGES_DDL);
  return db;
}

describe('failed change store', () => {
  let db: any;
  beforeEach(() => (db = freshDb()));

  it('keeps a failed change and replays it', () => {
    recordFailedChange(db, { table: 'items', op: 'upsert', data: { id: 1 } }, 'boom');
    const list = loadFailedChanges(db);
    expect(list).toHaveLength(1);
    expect(list[0].change.data.id).toBe(1);
    expect(settleReplay(db, list[0].id, null)).toBe('applied');
    expect(loadFailedChanges(db)).toHaveLength(0);
  });

  it('counts attempts and drops after the limit', () => {
    recordFailedChange(db, { table: 'x' }, 'e');
    const id = loadFailedChanges(db)[0].id;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 2; i++) {
      expect(settleReplay(db, id, 'e')).toBe('kept');
    }
    expect(settleReplay(db, id, 'e')).toBe('dropped');
    expect(loadFailedChanges(db)).toHaveLength(0);
  });
});

describe('removeServerOrder', () => {
  it('removes a server order with its children, never an own order', () => {
    const db = freshDb();
    const uuid = '0b0f1c5e-1111-4222-8333-444455556666';
    db.exec(`
      INSERT INTO orders VALUES ('123'), ('${uuid}');
      INSERT INTO order_lines VALUES ('l1','123'), ('l2','${uuid}');
      INSERT INTO active_orders VALUES ('123');
      INSERT INTO order_lines_pending VALUES ('p1','123');
      INSERT INTO order_paid_actions VALUES ('a1','123');
    `);
    expect(removeServerOrder(db, uuid)).toBe(false);
    expect(removeServerOrder(db, 123)).toBe(true);
    expect(db.prepare('SELECT id FROM orders').pluck().all()).toEqual([uuid]);
    expect(db.prepare('SELECT COUNT(*) FROM order_lines').pluck().get()).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM order_paid_actions').pluck().get()).toBe(0);
    expect(removeServerOrder(db, 999)).toBe(false);
    expect(removeServerOrder(db, null)).toBe(false);
  });
});

describe('bootstrapDue', () => {
  const now = 10 * BOOTSTRAP_EVERY_MS;
  it('runs with no cursor, on first run, and after 6 hours only', () => {
    expect(bootstrapDue({ hasCursor: false, lastAt: now, now, doneThisRun: true })).toBe(true);
    expect(bootstrapDue({ hasCursor: true, lastAt: now, now, doneThisRun: false })).toBe(true);
    expect(bootstrapDue({ hasCursor: true, lastAt: now - 1000, now, doneThisRun: true })).toBe(false);
    expect(
      bootstrapDue({ hasCursor: true, lastAt: now - BOOTSTRAP_EVERY_MS, now, doneThisRun: true })
    ).toBe(true);
    expect(bootstrapDue({ hasCursor: true, lastAt: 0, now, doneThisRun: true })).toBe(true);
  });
});
