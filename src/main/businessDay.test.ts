import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  drainEndDays,
  isOutsideHours,
  localBusinessDay,
  localDayAt,
  parseBusinessDay,
  queueEndDay,
  resolveBusinessDay,
  sendEndDay,
  shiftDateAt,
  type BusinessDayDeps,
} from './businessDay';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// Every expectation below is in local time; the till runs in Asia/Kuwait.
const t = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0, 0).getTime();

let db: any;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE time (id INTEGER PRIMARY KEY, day TEXT, open_time TEXT, close_time TEXT, always_close INTEGER);
    CREATE TABLE business_days (date TEXT PRIMARY KEY, from_ms INTEGER NOT NULL, to_ms INTEGER NOT NULL,
      open_ms INTEGER, close_ms INTEGER, fetched_at INTEGER NOT NULL);
    CREATE TABLE day_close_actions (action_id TEXT PRIMARY KEY, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, refusal_code TEXT, created_at INTEGER NOT NULL, finished_at INTEGER);
  `);
  // Salmiya: 12:00–02:00 every day.
  const ins = db.prepare(`INSERT INTO time (id, day, open_time, close_time, always_close) VALUES (?, ?, '12:00', '02:00', 0)`);
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].forEach((d, i) => ins.run(i + 1, d));
});

/** The server's own answer for 3 Nov, as dev.trebianco sent it. */
const SERVER_3_NOV = {
  date: '2026-11-03',
  from: '2026-11-03T03:00:00+03:00',
  to: '2026-11-04T03:00:00+03:00',
  open: '2026-11-03T12:00:00+03:00',
  close: '2026-11-04T02:00:00+03:00',
  outside_hours: null,
  timezone: 'Asia/Kuwait',
  branch_id: 1,
};

function fakeApi(handlers: { get?: (p: string, c: any) => any; post?: (p: string, b: any) => any }) {
  const calls: any[] = [];
  return {
    calls,
    api: {
      get: async (path: string, cfg: any) => (calls.push(['get', path, cfg?.params]), handlers.get!(path, cfg)),
      post: async (path: string, body: any) => (calls.push(['post', path, body]), handlers.post!(path, body)),
    } as any,
  };
}

const deps = (api: any, live = true): BusinessDayDeps => ({ db, api: () => api, isLive: () => live });

describe('the local rule matches the backend’s table (nobody ended the day)', () => {
  it.each([
    ['3 Nov 01:30', t(3, 1, 30), '2026-11-02', false],
    ['3 Nov 02:30', t(3, 2, 30), '2026-11-02', true],
    ['3 Nov 11:17', t(3, 11, 17), '2026-11-03', true],
    ['3 Nov 12:00', t(3, 12, 0), '2026-11-03', false],
  ])('%s', (_label, sale, date, outside) => {
    expect(localDayAt(db, sale).date).toBe(date);
    expect(isOutsideHours(db, sale)).toBe(outside);
  });

  it('runs 3 Nov 03:00 → 4 Nov 03:00, as the server does', () => {
    const day = localBusinessDay(db, '2026-11-03');
    expect([day.fromMs, day.toMs]).toEqual([t(3, 3), t(4, 3)]);
  });
});

describe('resolveBusinessDay', () => {
  it('asks the server and keeps its answer for offline use', async () => {
    const { api, calls } = fakeApi({ get: () => ({ data: SERVER_3_NOV }) });
    const day = await resolveBusinessDay(deps(api), { date: '2026-11-03' });
    expect(day).toMatchObject({ date: '2026-11-03', fromMs: t(3, 3), toMs: t(4, 3), source: 'server' });
    expect(calls[0]).toEqual(['get', '/business-day', { date: '2026-11-03' }]);

    const offline = await resolveBusinessDay(deps(null, false), { date: '2026-11-03' });
    expect(offline).toMatchObject({ fromMs: t(3, 3), source: 'cache' });
  });

  it('sends at= for an instant and nothing for now', async () => {
    const { api, calls } = fakeApi({ get: () => ({ data: SERVER_3_NOV }) });
    await resolveBusinessDay(deps(api), { at: t(3, 11, 17) });
    await resolveBusinessDay(deps(api));
    expect(calls[0][2].at).toBe(new Date(t(3, 11, 17)).toISOString());
    expect(calls[1][2]).toEqual({});
  });

  it('falls back to the local rule when the server fails', async () => {
    const { api } = fakeApi({
      get: () => {
        throw new Error('timeout');
      },
    });
    const day = await resolveBusinessDay(deps(api), { date: '2026-11-03' });
    expect(day).toMatchObject({ fromMs: t(3, 3), toMs: t(4, 3), source: 'local' });
  });

  it('ignores an unusable answer', () => {
    expect(parseBusinessDay({ date: 'x', from: 'y' })).toBeNull();
    expect(parseBusinessDay({ ...SERVER_3_NOV, to: SERVER_3_NOV.from })).toBeNull();
  });
});

describe('End day', () => {
  it('closes the shift that opened last: 02:40 and 11:30 end 2 Nov, 23:00 ends 3 Nov', () => {
    expect(shiftDateAt(db, t(3, 2, 40))).toBe('2026-11-02');
    expect(shiftDateAt(db, t(3, 11, 30))).toBe('2026-11-02');
    expect(shiftDateAt(db, t(3, 23, 0))).toBe('2026-11-03');
  });

  it('applies at once: a sale after End day lands on the next day', () => {
    const { closedDay, nextDay } = queueEndDay(db, { closedAt: t(3, 2, 40) });
    expect(closedDay).toMatchObject({ date: '2026-11-02', toMs: t(3, 2, 40) });
    expect(nextDay).toMatchObject({ date: '2026-11-03', fromMs: t(3, 2, 40) });
    expect(localDayAt(db, t(3, 2, 41)).date).toBe('2026-11-03');
    expect(localDayAt(db, t(3, 2, 39)).date).toBe('2026-11-02');
  });

  it('late End day keeps the morning sales on the old day', () => {
    queueEndDay(db, { closedAt: t(3, 11, 30) });
    expect(localDayAt(db, t(3, 11, 17)).date).toBe('2026-11-02');
    expect(localDayAt(db, t(3, 11, 31)).date).toBe('2026-11-03');
  });

  it('leaves business_date to the server unless the cashier picked one', () => {
    const { actionId } = queueEndDay(db, { closedAt: t(3, 2, 40), closedBy: 12 });
    const body = JSON.parse(db.prepare('SELECT body FROM day_close_actions WHERE action_id = ?').pluck().get(actionId));
    expect(body).toEqual({ action_id: actionId, closed_at: new Date(t(3, 2, 40)).toISOString(), closed_by: 12 });
  });

  it('sends through the outbox, keeps the action_id on failure, stores the server days', async () => {
    const { actionId } = queueEndDay(db, { closedAt: t(3, 2, 40) });
    let fail = true;
    const { api, calls } = fakeApi({
      post: () => {
        if (fail) throw Object.assign(new Error('503'), { response: { status: 503, data: {} } });
        return {
          data: {
            replayed: false,
            closed_day: { date: '2026-11-02', from: '2026-11-02T03:00:00+03:00', to: '2026-11-03T02:40:00+03:00' },
            next_day: { date: '2026-11-03', from: '2026-11-03T02:40:00+03:00', to: '2026-11-04T03:00:00+03:00' },
          },
        };
      },
    });
    expect(await sendEndDay(deps(api, false), actionId)).toEqual({ kind: 'offline' });
    expect((await sendEndDay(deps(api), actionId)).kind).toBe('retry');
    fail = false;
    expect(await drainEndDays(deps(api))).toBe(1);
    expect(new Set(calls.map((c) => c[2].action_id))).toEqual(new Set([actionId]));
    const next = await resolveBusinessDay(deps(null, false), { date: '2026-11-03' });
    expect(next).toMatchObject({ fromMs: Date.parse('2026-11-03T02:40:00+03:00'), source: 'cache' });
  });

  it('drops a 422 input refusal', async () => {
    const { actionId } = queueEndDay(db, { closedAt: t(3, 2, 40) });
    const { api } = fakeApi({
      post: () => {
        throw Object.assign(new Error('422'), {
          response: { status: 422, data: { code: 'POS_DAY_CLOSE_INPUT_INVALID' } },
        });
      },
    });
    expect(await sendEndDay(deps(api), actionId)).toEqual({ kind: 'refused', code: 'POS_DAY_CLOSE_INPUT_INVALID' });
  });
});
