// src/main/staleOrders.ts
//
// Orders still open on this till that the server has already finished.
//
// Every close made online reaches every till through /pull, except one: the
// sales report's "Close old orders" wrote no feed row until the server fixed
// it (2026-11, Beirutuna: 53 till orders closed on 11-07, the tables freed,
// the orders left open on the tills for days). Closes before 2026-11-04 also
// missed a branch's other tills. Any other gap in the feed would leave an
// order open here the same way, and nothing else prunes local orders.
//
// After each sync, ask the server about a few of the oldest such orders and
// follow it: closed or cancelled there → closed here; unknown there and not
// ours → removed, as a /pull delete would (orders are hard-deleted, and
// another branch's order also answers 404). Still open → left alone, asked
// again in an hour, and once a day after three open answers in a row. Never
// touches an order with something unsent, and never reopens anything.

import { activeOrderSql } from './utils/orderStatus';

/** Only orders opened this long ago are asked about. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
/** The same order is asked about at most this often. */
export const RECHECK_MS = 60 * 60 * 1000;
/** At most this many GETs per sync. */
export const MAX_PER_RUN = 10;
/** After this many "still open" answers in a row, ask only once a day. */
export const OPEN_ANSWERS_BEFORE_BACKOFF = 3;
export const BACKOFF_MS = 24 * 60 * 60 * 1000;

type Db = { prepare: (sql: string) => any };

export type StaleDeps = {
  db: Db;
  /** GET /orders/{id}; throws a POS_VAL_ORDER_NOT_FOUND AppError on 404. */
  fetchOrder: (remoteId: string) => Promise<{ order: any | null }>;
  /**
   * When the server has finished the order (closed or cancelled), write its
   * header over the local row and return true; otherwise change nothing.
   */
  applyClosed: (localId: string, serverOrder: any) => boolean;
  /** Delete a server order this till holds a copy of. */
  removeOrder: (localId: string) => boolean;
  isLive: () => boolean;
  now?: () => number;
};

export type SweepResult = { checked: number; closed: number; removed: number; failed: number };

/** Per order: when it was last asked about, and how many "still open" answers in a row. */
const lastChecked = new Map<string, { at: number; open: number }>();

/** For tests. */
export function resetStaleSweep() {
  lastChecked.clear();
  running = false;
}

const isOwnId = (id: unknown) => /\D/.test(String(id ?? ''));

type Row = {
  id: string;
  server_id: string | null;
  synced_at: number | null;
};

/**
 * Open orders old enough to ask about, that the server knows. Table orders
 * first (they hold a table and sit on the running-orders bar), then oldest.
 */
export function staleCandidates(db: Db, now: number): Row[] {
  const rows = db
    .prepare(
      `SELECT o.id, o.server_id, o.synced_at, o.order_type
         FROM orders o
        WHERE ${activeOrderSql('o')}
          AND CAST(COALESCE(NULLIF(o.opened_at, 0), o.created_at) AS REAL) < @older
        ORDER BY (o.order_type = 3) DESC,
                 CAST(COALESCE(NULLIF(o.opened_at, 0), o.created_at) AS REAL) ASC
        LIMIT 500`
    )
    .all({ older: now - STALE_AFTER_MS }) as Row[];
  return rows.filter((r) => {
    if (!isOwnId(r.id)) return true; // the server's own id
    // Ours: only once the server has it and nothing is waiting to go up.
    return /^\d+$/.test(String(r.server_id ?? '')) && Number(r.synced_at ?? 0) > 0;
  });
}

const remoteIdOf = (r: Row) =>
  isOwnId(r.id) ? String(r.server_id) : String(r.id);

let running = false;

export async function sweepStaleOrders(deps: StaleDeps): Promise<SweepResult> {
  const out: SweepResult = { checked: 0, closed: 0, removed: 0, failed: 0 };
  // A sync runs every 15 s; a slow sweep must not overlap the next one.
  if (running || !deps.isLive()) return out;
  running = true;
  try {
    return await sweep(deps, out);
  } finally {
    running = false;
  }
}

async function sweep(deps: StaleDeps, out: SweepResult): Promise<SweepResult> {
  const now = (deps.now ?? Date.now)();

  const due = staleCandidates(deps.db, now)
    .filter((r) => {
      const seen = lastChecked.get(r.id);
      if (!seen) return true;
      // An order the server keeps answering open for is most likely really
      // open (or a leftover nobody closes): ask once a day, not every hour.
      const wait = seen.open >= OPEN_ANSWERS_BEFORE_BACKOFF ? BACKOFF_MS : RECHECK_MS;
      return now - seen.at >= wait;
    })
    .slice(0, MAX_PER_RUN);

  for (const r of due) {
    const prevOpen = lastChecked.get(r.id)?.open ?? 0;
    lastChecked.set(r.id, { at: now, open: prevOpen });
    out.checked++;
    try {
      const { order } = await deps.fetchOrder(remoteIdOf(r));
      // applyClosed writes only when the server has finished the order.
      if (order && deps.applyClosed(r.id, order)) {
        out.closed++;
        lastChecked.delete(r.id);
      } else if (order) {
        lastChecked.set(r.id, { at: now, open: prevOpen + 1 });
      }
    } catch (e: any) {
      const notFound = /POS_VAL_ORDER_NOT_FOUND/.test(String(e?.code ?? e?.message ?? ''));
      if (notFound && !isOwnId(r.id)) {
        // A server order the server no longer has: gone, as a /pull delete.
        if (deps.removeOrder(r.id)) out.removed++;
      } else if (!notFound) {
        out.failed++;
        // Offline or throttled: stop here, the next sync tries again.
        const status = Number(e?.response?.status ?? 0);
        if (!status || status === 429 || status >= 500) {
          lastChecked.delete(r.id);
          break;
        }
      }
    }
  }
  if (out.closed || out.removed || out.failed) {
    console.log('[sync] stale open orders checked with the server', out);
  }
  return out;
}
