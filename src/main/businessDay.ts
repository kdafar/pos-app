// src/main/businessDay.ts
//
// Which business day an order belongs to — the server's rule, not the till's
// (backend contract: docs/BUSINESS-DAY-WIRE-CONTRACT.md, branch fix/business-day).
//
//   - A day ends when a till sends End day (the latest in the branch counts),
//     or else automatically at closing time + grace (60 min by default).
//   - The next day starts where the previous one ended.
//   - An order belongs to the day whose [from, to) holds its sale time.
//   - Outside hours = not within open–close of the order's calendar day or of
//     the day before. Asia/Kuwait. always_close is ignored.
//
// The server is asked for every window (GET /business-day). Answers are kept
// in `business_days` so an offline till still has them. Only when a till is
// offline AND has never seen that day does it compute one itself, with the
// automatic cut-off above — the same answer the server gives for a day nobody
// ended, which is the only kind a till that has been offline can know about.
import type BetterSqlite3 from 'better-sqlite3';
import type { AxiosInstance } from 'axios';
import { newUlid } from '../shared/paid';

type Db = BetterSqlite3.Database;

export type BusinessDay = {
  /** YYYY-MM-DD, the business date. */
  date: string;
  fromMs: number;
  /** Exclusive. The End day time once the day was ended. */
  toMs: number;
  openMs: number | null;
  closeMs: number | null;
  source: 'server' | 'cache' | 'local';
};

export type BusinessDayDeps = {
  db: Db;
  api: () => AxiosInstance | null;
  isLive: () => boolean;
  now?: () => number;
};

/** Default grace after closing time when nobody ends the day (server default). */
export const DEFAULT_GRACE_MIN = 60;

const DAY_MS = 86_400_000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDateKey(key: string): Date | null {
  const m = String(key ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(key: string, n: number): string {
  const d = parseDateKey(key)!;
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

const ms = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/** Read a server window ({date, from, to, open, close, …}); null if unusable. */
export function parseBusinessDay(raw: any): BusinessDay | null {
  if (!raw || typeof raw !== 'object') return null;
  const date = String(raw.date ?? '').trim();
  const fromMs = ms(raw.from);
  const toMs = ms(raw.to);
  if (!parseDateKey(date) || fromMs == null || toMs == null || toMs <= fromMs) return null;
  return { date, fromMs, toMs, openMs: ms(raw.open), closeMs: ms(raw.close), source: 'server' };
}

/* ───────────────────────────── cache ───────────────────────────── */

export function cacheBusinessDay(db: Db, day: BusinessDay): void {
  db.prepare(
    `INSERT INTO business_days (date, from_ms, to_ms, open_ms, close_ms, fetched_at)
     VALUES (@date, @fromMs, @toMs, @openMs, @closeMs, @now)
     ON CONFLICT(date) DO UPDATE SET
       from_ms = excluded.from_ms, to_ms = excluded.to_ms,
       open_ms = excluded.open_ms, close_ms = excluded.close_ms,
       fetched_at = excluded.fetched_at`
  ).run({ ...day, now: Date.now() });
}

function fromRow(r: any): BusinessDay | null {
  if (!r) return null;
  return {
    date: r.date,
    fromMs: Number(r.from_ms),
    toMs: Number(r.to_ms),
    openMs: r.open_ms == null ? null : Number(r.open_ms),
    closeMs: r.close_ms == null ? null : Number(r.close_ms),
    source: 'cache',
  };
}

export function cachedByDate(db: Db, date: string): BusinessDay | null {
  return fromRow(db.prepare(`SELECT * FROM business_days WHERE date = ?`).get(date));
}

export function cachedAt(db: Db, atMs: number): BusinessDay | null {
  return fromRow(
    db
      .prepare(`SELECT * FROM business_days WHERE from_ms <= ? AND to_ms > ? ORDER BY fetched_at DESC LIMIT 1`)
      .get(atMs, atMs)
  );
}

/* ─────────────────────── local (offline) rule ─────────────────────── */

type Hours = { open: string; close: string };

function hoursFor(db: Db, d: Date): Hours | null {
  try {
    const name = DAY_NAMES[d.getDay()];
    const row = db
      .prepare(
        `SELECT open_time, close_time FROM time
          WHERE lower(day) IN (lower(?), lower(?)) OR day IN (?, ?) LIMIT 1`
      )
      .get(name, name.slice(0, 3), d.getDay(), String(d.getDay())) as any;
    if (!row?.open_time || !row?.close_time) return null;
    return { open: toHhmm(row.open_time), close: toHhmm(row.close_time) };
  } catch {
    return null;
  }
}

/** '9:00am' | '09:00' | '09:00:00' → 'HH:MM'. */
function toHhmm(v: string): string {
  const s = String(v).trim().toLowerCase();
  const ap = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (ap) {
    let h = Number(ap[1]) % 12;
    if (ap[3] === 'pm') h += 12;
    return `${pad(h)}:${ap[2]}`;
  }
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : '00:00';
}

function at(d: Date, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const x = new Date(d);
  x.setHours(h || 0, m || 0, 0, 0);
  return x.getTime();
}

/** Open and close of a calendar date, close rolling past midnight. */
export function openCloseFor(db: Db, date: string): { openMs: number; closeMs: number } | null {
  const d = parseDateKey(date);
  if (!d) return null;
  const h = hoursFor(db, d);
  if (!h) return null;
  const openMs = at(d, h.open);
  let closeMs = at(d, h.close);
  if (closeMs <= openMs) closeMs += DAY_MS;
  return { openMs, closeMs };
}

/** The automatic cut-off for a date: closing + grace, or 03:00 next day if hours are unknown. */
function autoEnd(db: Db, date: string, graceMin: number): number {
  const oc = openCloseFor(db, date);
  if (oc) return oc.closeMs + graceMin * 60_000;
  return at(parseDateKey(addDays(date, 1))!, '03:00');
}

/**
 * Compute a window locally. Starts where the previous day ended — the cached
 * one when the till knows it (an End day it saw), else that day's automatic
 * cut-off — and ends at this day's cached end or automatic cut-off.
 */
export function localBusinessDay(db: Db, date: string, graceMin = DEFAULT_GRACE_MIN): BusinessDay {
  const prev = cachedByDate(db, addDays(date, -1));
  const own = cachedByDate(db, date);
  const fromMs = own?.fromMs ?? prev?.toMs ?? autoEnd(db, addDays(date, -1), graceMin);
  const toMs = own?.toMs ?? autoEnd(db, date, graceMin);
  const oc = openCloseFor(db, date);
  return {
    date,
    fromMs,
    toMs: Math.max(toMs, fromMs + 1),
    openMs: oc?.openMs ?? null,
    closeMs: oc?.closeMs ?? null,
    source: 'local',
  };
}

/** The local window holding an instant: today's calendar date, or a neighbour. */
export function localDayAt(db: Db, atMs: number, graceMin = DEFAULT_GRACE_MIN): BusinessDay {
  const cached = cachedAt(db, atMs);
  if (cached) return cached;
  let key = dateKey(new Date(atMs));
  for (let i = 0; i < 3; i++) {
    const day = localBusinessDay(db, key, graceMin);
    if (atMs < day.fromMs) key = addDays(key, -1);
    else if (atMs >= day.toMs) key = addDays(key, 1);
    else return day;
  }
  return localBusinessDay(db, key, graceMin);
}

/**
 * Outside hours: not within open–close of the sale's calendar day or of the
 * day before (the day before covers the stretch after midnight).
 */
export function isOutsideHours(db: Db, saleMs: number): boolean {
  const today = dateKey(new Date(saleMs));
  for (const key of [today, addDays(today, -1)]) {
    const oc = openCloseFor(db, key);
    if (oc && saleMs >= oc.openMs && saleMs < oc.closeMs) return false;
  }
  return true;
}

/* ───────────────────────────── server ───────────────────────────── */

/**
 * The window for a date (`date`), for an instant (`at`), or for now. Asks the
 * server when live; falls back to the cache, then to the local rule.
 */
export async function resolveBusinessDay(
  deps: BusinessDayDeps,
  query: { date?: string; at?: number } = {}
): Promise<BusinessDay> {
  const now = deps.now?.() ?? Date.now();
  const api = deps.api();
  if (api && deps.isLive()) {
    try {
      const params: Record<string, string> = {};
      if (query.date) params.date = query.date;
      else if (query.at != null) params.at = new Date(query.at).toISOString();
      const { data } = await api.get('/business-day', { params, timeout: 8000 });
      const day = parseBusinessDay(data);
      if (day) {
        cacheBusinessDay(deps.db, day);
        return day;
      }
    } catch (e: any) {
      console.warn('[business-day] server lookup failed; using the local copy', e?.message);
    }
  }
  if (query.date) return cachedByDate(deps.db, query.date) ?? localBusinessDay(deps.db, query.date);
  return localDayAt(deps.db, query.at ?? now);
}

/* ───────────────────────────── End day ───────────────────────────── */

/**
 * The shift an End day at `atMs` closes: the one that opened most recently.
 * An End day at 02:40 or at 11:30 on 3 Nov (before the 12:00 opening) ends
 * 2 Nov — the backend's two examples — and one at 23:00 on 3 Nov ends 3 Nov.
 * Only the offline guess; the server's answer replaces it.
 */
export function shiftDateAt(db: Db, atMs: number): string {
  const today = dateKey(new Date(atMs));
  for (const key of [today, addDays(today, -1)]) {
    const oc = openCloseFor(db, key);
    if (oc && oc.openMs <= atMs) return key;
  }
  return localDayAt(db, atMs).date;
}

export type EndDayResult = {
  state: 'done' | 'queued';
  closedDay: BusinessDay | null;
  nextDay: BusinessDay | null;
};

/**
 * Record End day locally and queue it. The local cut-off applies at once — a
 * closing report printed now must cover exactly up to this moment, and an
 * offline till's next sales must land on the new day — and is replaced by the
 * server's answer when it comes.
 */
export function queueEndDay(
  db: Db,
  input: { closedAt: number; businessDate?: string | null; closedBy?: number | null }
): { actionId: string; closedDay: BusinessDay; nextDay: BusinessDay } {
  const actionId = newUlid(input.closedAt);
  const date = input.businessDate || shiftDateAt(db, input.closedAt);
  const current = cachedByDate(db, date) ?? localBusinessDay(db, date);
  // business_date only when the caller chose one: which day a late End day
  // closes is the server's decision, and this till's guess must not override it.
  const body = {
    action_id: actionId,
    closed_at: new Date(input.closedAt).toISOString(),
    ...(input.businessDate ? { business_date: input.businessDate } : {}),
    ...(input.closedBy != null ? { closed_by: input.closedBy } : {}),
  };
  const closedDay: BusinessDay = { ...current, toMs: input.closedAt, source: 'local' };
  const nextDate = addDays(current.date, 1);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO day_close_actions (action_id, body, state, created_at) VALUES (?, ?, 'queued', ?)`
    ).run(actionId, JSON.stringify(body), Date.now());
    cacheBusinessDay(db, closedDay);
    // The next day starts here; its end stays the automatic one until known.
    db.prepare(`DELETE FROM business_days WHERE date = ?`).run(nextDate);
  })();
  const nextDay = { ...localBusinessDay(db, nextDate), fromMs: input.closedAt };
  cacheBusinessDay(db, nextDay);
  return { actionId, closedDay, nextDay };
}

/** Send one queued End day. Never throws. */
export async function sendEndDay(
  deps: BusinessDayDeps,
  actionId: string
): Promise<
  | { kind: 'done'; replayed: boolean; closedDay: BusinessDay | null; nextDay: BusinessDay | null }
  | { kind: 'refused'; code: string }
  | { kind: 'retry' }
  | { kind: 'offline' }
> {
  const { db } = deps;
  const row = db
    .prepare(`SELECT action_id, body FROM day_close_actions WHERE action_id = ? AND state = 'queued'`)
    .get(actionId) as { action_id: string; body: string } | undefined;
  if (!row) return { kind: 'done', replayed: true, closedDay: null, nextDay: null };

  const api = deps.api();
  if (!api || !deps.isLive()) return { kind: 'offline' };

  const finish = (state: 'done' | 'refused', code: string | null) =>
    db
      .prepare(
        `UPDATE day_close_actions SET state = ?, refusal_code = ?, finished_at = ? WHERE action_id = ?`
      )
      .run(state, code, Date.now(), actionId);

  try {
    const { data } = await api.post('/day-close', JSON.parse(row.body));
    const closedDay = parseBusinessDay(data?.closed_day);
    const nextDay = parseBusinessDay(data?.next_day);
    db.transaction(() => {
      if (closedDay) cacheBusinessDay(db, closedDay);
      if (nextDay) cacheBusinessDay(db, nextDay);
      finish('done', null);
    })();
    return { kind: 'done', replayed: Boolean(data?.replayed), closedDay, nextDay };
  } catch (err: any) {
    const status = Number(err?.response?.status ?? 0);
    const code = String(err?.response?.data?.code ?? '').trim();
    // Only a declared input refusal is final; credentials, throttling and
    // outages leave End day queued with the same action_id.
    if (status === 422 || code === 'POS_DAY_CLOSE_INPUT_INVALID') {
      finish('refused', code || 'POS_DAY_CLOSE_INPUT_INVALID');
      return { kind: 'refused', code: code || 'POS_DAY_CLOSE_INPUT_INVALID' };
    }
    db.prepare(
      `UPDATE day_close_actions SET attempts = attempts + 1, last_error = ? WHERE action_id = ?`
    ).run(String(err?.message ?? err).slice(0, 300), actionId);
    return { kind: 'retry' };
  }
}

/** Send every queued End day, oldest first. Called from each sync. */
export async function drainEndDays(deps: BusinessDayDeps): Promise<number> {
  const queued = deps.db
    .prepare(`SELECT action_id FROM day_close_actions WHERE state = 'queued' ORDER BY created_at ASC`)
    .pluck()
    .all() as string[];
  let sent = 0;
  for (const id of queued) {
    const out = await sendEndDay(deps, id);
    if (out.kind === 'done') sent++;
    else if (out.kind !== 'refused') break; // offline or failing: keep order, try next sync
  }
  return sent;
}

/** Unsent End day for the current till, if any (for the screen). */
export function pendingEndDay(db: Db): { action_id: string; closed_at: string } | null {
  const row = db
    .prepare(`SELECT action_id, body FROM day_close_actions WHERE state = 'queued' ORDER BY created_at DESC LIMIT 1`)
    .get() as { action_id: string; body: string } | undefined;
  if (!row) return null;
  try {
    return { action_id: row.action_id, closed_at: JSON.parse(row.body).closed_at };
  } catch {
    return null;
  }
}
