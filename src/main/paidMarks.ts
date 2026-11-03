// src/main/paidMarks.ts
//
// The outbox for "Mark paid" / "Undo paid" (contract §4).
//
// A tap becomes one row in order_paid_actions with its own action_id — the
// server's idempotency key — and that row is resent unchanged until the
// server answers 200 (done) or 4xx (refused, final). 5xx, a timeout or no
// network leave it queued. Two ordering rules, both from §4.4:
//
//  - the till's own order must be pushed and acked first, because the
//    endpoint addresses the SERVER order id and checks the amount against the
//    server's total; an unsent edit would make the mark refuse;
//  - one order's actions go out in tap order. If its first action cannot go
//    yet, nothing after it for that order goes either (an undo overtaking the
//    mark it undoes would be answered "nothing to undo" and lost).
import type BetterSqlite3 from 'better-sqlite3';
import type { AxiosInstance } from 'axios';
import { applyServerPaid } from './paidState';
import { newUlid } from '../shared/paid';

type Db = BetterSqlite3.Database;

export type PaidActionKind = 'mark' | 'undo';

export type PaidDeps = {
  db: Db;
  /** The /api/pos client, or null when the till is not configured. */
  api: () => AxiosInstance | null;
  /** False when the till is in offline mode. */
  isLive: () => boolean;
  /**
   * Store a server `order` payload locally (header where the till does not
   * own it, plus paid state). Defaults to the paid state alone.
   */
  applyOrder?: (localId: string, order: any) => void;
};

export type SendOutcome =
  | { kind: 'done'; replayed: boolean; notices: string[] }
  | { kind: 'refused'; code: string; params?: Record<string, string | number> }
  | { kind: 'waiting'; reason: 'no_server_id' | 'unsynced' | 'offline' }
  | { kind: 'retry'; error: string };

type OrderRow = {
  id: string;
  server_id: string | null;
  synced_at: number | string | null;
};

/** A locally rung order has a UUID id; server orders have integer ids. */
export function isOwnOrder(row: { id: string }): boolean {
  return !/^\d+$/.test(String(row.id));
}

/**
 * The SERVER order id for `{order}` in the path: the push ack for the till's
 * own orders, the id itself for orders that arrived over pull or the seed.
 */
export function remoteOrderId(row: { id: string; server_id?: string | null }): string | null {
  const sid = String(row.server_id ?? '').trim();
  if (/^\d+$/.test(sid)) return sid;
  return isOwnOrder(row) ? null : String(row.id);
}

/** Recompute orders.paid_pending from the queue: the newest queued kind, or NULL. */
export function refreshPaidPending(db: Db, orderId: string): void {
  const latest = db
    .prepare(
      `SELECT kind FROM order_paid_actions
        WHERE order_id = ? AND state = 'queued'
        ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .pluck()
    .get(orderId) as string | undefined;
  db.prepare(`UPDATE orders SET paid_pending = ? WHERE id = ?`).run(latest ?? null, orderId);
}

export function queuedAction(db: Db, orderId: string, kind: PaidActionKind) {
  return db
    .prepare(
      `SELECT action_id FROM order_paid_actions
        WHERE order_id = ? AND kind = ? AND state = 'queued'
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(orderId, kind) as { action_id: string } | undefined;
}

/** Put one tap in the outbox. The body is stored exactly as it will be sent. */
export function queuePaidAction(
  db: Db,
  orderId: string,
  kind: PaidActionKind,
  body: Record<string, unknown>,
  now = Date.now()
): string {
  const actionId = String(body.action_id ?? newUlid(now));
  const wire = { ...body, action_id: actionId };
  db.transaction(() => {
    db.prepare(
      `INSERT INTO order_paid_actions (action_id, order_id, kind, body, state, created_at)
       VALUES (?, ?, ?, ?, 'queued', ?)`
    ).run(actionId, orderId, kind, JSON.stringify(wire), now);
    // A new tap supersedes whatever the last background refusal said.
    db.prepare(`UPDATE orders SET paid_refusal = NULL WHERE id = ?`).run(orderId);
    refreshPaidPending(db, orderId);
  })();
  return actionId;
}

/** Withdraw a queued action that never reached the server. */
export function withdrawPaidAction(db: Db, actionId: string): void {
  const row = db
    .prepare(`SELECT order_id FROM order_paid_actions WHERE action_id = ? AND state = 'queued'`)
    .get(actionId) as { order_id: string } | undefined;
  if (!row) return;
  db.transaction(() => {
    db.prepare(`DELETE FROM order_paid_actions WHERE action_id = ?`).run(actionId);
    refreshPaidPending(db, row.order_id);
  })();
}

/** 4xx answers that are about the request, not about this till's credentials. */
function isFinalRefusal(status: number, code: string): boolean {
  if (status < 400 || status >= 500) return false;
  // 401: credentials; 408: timeout; 423: device locked; 429: throttled. None
  // says anything about this mark, so it stays queued.
  if ([401, 408, 423, 429].includes(status)) return false;
  // A 403 without one of this feature's codes is the device being refused
  // (revoked, wrong branch), not the cashier — dropping the mark for it would
  // lose a payment record over an unrelated outage.
  if (status === 403) return code.startsWith('POS_PAID_');
  // A bare 404 is a missing route (a proxy, or a server without the feature),
  // not "no such order"; only the declared code drops the action.
  if (status === 404) return code === 'POS_ORDER_NOT_FOUND';
  return true;
}

function codeFor(serverCode: string): string {
  // The app renders this condition with its own code (see errorCatalog).
  if (serverCode === 'POS_ORDER_NOT_FOUND') return 'POS_VAL_ORDER_NOT_FOUND';
  return serverCode || 'POS_UNKNOWN';
}

/** Send one queued action. Never throws; the outcome says what happened. */
export async function sendPaidAction(deps: PaidDeps, actionId: string): Promise<SendOutcome> {
  const { db } = deps;
  const action = db
    .prepare(`SELECT * FROM order_paid_actions WHERE action_id = ? AND state = 'queued'`)
    .get(actionId) as
    | { action_id: string; order_id: string; kind: PaidActionKind; body: string }
    | undefined;
  if (!action) return { kind: 'done', replayed: true, notices: [] };

  const order = db
    .prepare(`SELECT id, server_id, synced_at FROM orders WHERE id = ?`)
    .get(action.order_id) as OrderRow | undefined;
  if (!order) {
    // The order is gone locally (a wipe would have taken the queue too). There
    // is nothing to address; drop it rather than retry forever.
    finish(db, action, 'refused', 'POS_VAL_ORDER_NOT_FOUND');
    return { kind: 'refused', code: 'POS_VAL_ORDER_NOT_FOUND' };
  }

  const remote = remoteOrderId(order);
  if (!remote) return { kind: 'waiting', reason: 'no_server_id' };
  if (isOwnOrder(order) && !Number(order.synced_at ?? 0)) {
    return { kind: 'waiting', reason: 'unsynced' };
  }

  const api = deps.api();
  if (!api || !deps.isLive()) return { kind: 'waiting', reason: 'offline' };

  const applyOrder =
    deps.applyOrder ?? ((localId: string, o: any) => applyServerPaid(db, localId, o?.paid));
  const body = JSON.parse(action.body);
  const path = `/orders/${encodeURIComponent(remote)}/paid`;

  try {
    const res =
      action.kind === 'mark'
        ? await api.post(path, body)
        : await api.delete(path, { data: body });
    const data = res?.data ?? {};
    if (data.order) applyOrder(order.id, data.order);
    finish(db, action, 'done', null);
    const notices = (Array.isArray(data.notices) ? data.notices : [])
      .map((n: any) => String(typeof n === 'string' ? n : n?.code ?? ''))
      .filter(Boolean);
    return { kind: 'done', replayed: Boolean(data.replayed), notices };
  } catch (err: any) {
    const status = Number(err?.response?.status ?? 0);
    const data = err?.response?.data ?? {};
    const serverCode = String(data?.code ?? '').trim();

    if (!isFinalRefusal(status, serverCode)) {
      const message = String(err?.message ?? err ?? 'error').slice(0, 300);
      db.prepare(
        `UPDATE order_paid_actions SET attempts = attempts + 1, last_error = ? WHERE action_id = ?`
      ).run(status ? `HTTP ${status} ${serverCode} ${message}`.trim() : message, action.action_id);
      return { kind: 'retry', error: message };
    }

    // Refused: nothing changed on the server. The body still carries the
    // order as it stands, so the till shows the truth (who did pay, the new
    // total) whatever the answer.
    if (data?.order) {
      try {
        applyOrder(order.id, data.order);
      } catch (e) {
        console.error('[paid] could not store order from refusal', e);
      }
    }
    const code = codeFor(serverCode);
    finish(db, action, 'refused', code);

    const params: Record<string, string | number> = {};
    if (data?.grand_total != null && Number.isFinite(Number(data.grand_total))) {
      params.grand_total = Number(data.grand_total);
      // A pulled order's local total is the stale one; the server's is right.
      if (!isOwnOrder(order)) {
        db.prepare(`UPDATE orders SET grand_total = ? WHERE id = ?`).run(
          Number(data.grand_total),
          order.id
        );
      }
    }
    return { kind: 'refused', code, params };
  }
}

function finish(
  db: Db,
  action: { action_id: string; order_id: string },
  state: 'done' | 'refused',
  code: string | null
) {
  db.transaction(() => {
    db.prepare(
      `UPDATE order_paid_actions SET state = ?, refusal_code = ?, finished_at = ? WHERE action_id = ?`
    ).run(state, code, Date.now(), action.action_id);
    // "Someone else got there first" is not a failure (§11): the order now
    // shows who did. Every other refusal stays on the order until dismissed,
    // because a background send has nobody watching it fail.
    const shown = state === 'refused' && code !== 'POS_PAID_ALREADY_PAID' ? code : null;
    db.prepare(`UPDATE orders SET paid_refusal = ? WHERE id = ?`).run(shown, action.order_id);
    refreshPaidPending(db, action.order_id);
  })();
}

/**
 * Send everything that can go now, oldest first. Called after each sync's
 * push, so a till's own order is acked before its mark is sent.
 */
export async function drainPaidActions(deps: PaidDeps): Promise<{
  sent: number;
  refused: number;
  waiting: number;
}> {
  const queued = deps.db
    .prepare(
      `SELECT action_id, order_id FROM order_paid_actions
        WHERE state = 'queued' ORDER BY created_at ASC, rowid ASC`
    )
    .all() as Array<{ action_id: string; order_id: string }>;

  const blocked = new Set<string>();
  let sent = 0;
  let refused = 0;
  let waiting = 0;

  for (const a of queued) {
    if (blocked.has(a.order_id)) {
      waiting++;
      continue;
    }
    const out = await sendPaidAction(deps, a.action_id);
    if (out.kind === 'done') sent++;
    else if (out.kind === 'refused') refused++;
    else {
      waiting++;
      blocked.add(a.order_id);
      // No network (or a failing server) for one is the same for all; stop
      // rather than wait out a 15 s timeout once per queued tap.
      if (out.kind === 'retry' || (out.kind === 'waiting' && out.reason === 'offline')) break;
    }
  }
  if (sent || refused) console.log('[paid] outbox drained', { sent, refused, waiting });
  return { sent, refused, waiting };
}
