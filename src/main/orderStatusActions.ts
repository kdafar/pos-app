// src/main/orderStatusActions.ts
//
// Changing an order this till did not create: POST /orders/{id}/status
// (docs/POS-ORDER-STATUS-WIRE-CONTRACT.md in the server repo).
//
// Unlike /push this one asks. The local copy only changes from the server's
// reply, so a refused or unsent change leaves the till showing the truth.
//
// There is deliberately no background queue. The change needs a connection, and
// staff are told at once when there is none. A close sent an hour later, onto an
// order that has moved on, would surprise everyone and leave nobody watching.
// The action id is kept for a change that got no answer, so trying again cannot
// apply it twice: the server replays the first result.
import type { AxiosInstance } from 'axios';
import { posError } from '../shared/errorCodes';
import { newUlid } from '../shared/paid';
import { remoteOrderId } from './paidMarks';

export type OrderChange = {
  status?: number;
  payment_method?: string;
  amount_tendered?: number;
  closed_at?: number;
  approval?: Record<string, unknown>;
};

export type OrderChangeDeps = {
  api: () => AxiosInstance | null;
  isLive: () => boolean;
  /** Replace the local copy with the server's order. */
  applyOrder: (localId: string, order: any) => void;
};

export type OrderChangeResult = { applied: boolean; replayed: boolean };

/** Codes the contract declares, shown to staff as they are. */
const DECLARED_REFUSALS = new Set([
  'POS_PAID_ALREADY_PAID',
  'POS_PUSH_ORDER_FINALIZED',
  'POS_ORDER_STATUS_CONFLICT',
  'POS_ORDER_ACTION_REUSED',
  'POS_PAID_METHOD_LOCKED',
  'POS_ORDER_STATUS_NOT_PERMITTED',
  'POS_PUSH_CANCEL_NOT_PERMITTED',
  'POS_PUSH_APPROVAL_INVALID',
  'POS_ORDER_STATUS_INPUT',
]);

/** Action ids of changes that got no answer, by what they were changing. */
const unanswered = new Map<string, string>();

function keyFor(orderId: string, c: OrderChange): string {
  return [orderId, c.status ?? '', c.payment_method ?? '', c.amount_tendered ?? ''].join('|');
}

export async function sendOrderChange(
  deps: OrderChangeDeps,
  order: { id: string; server_id?: string | null; status_code?: unknown },
  by: number | null,
  change: OrderChange
): Promise<OrderChangeResult> {
  const expected = order.status_code == null ? NaN : Number(order.status_code);
  const out = await post(deps, order, by, 'status', keyFor(String(order.id), change), {
    ...change,
    ...(change.status != null && Number.isInteger(expected) ? { expected_status: expected } : {}),
  });
  return { applied: out.applied, replayed: out.replayed };
}

/**
 * Add lines to an order this till did not create (POST /orders/{id}/lines).
 * Returns the added lines as the server stored them, in the /pull line shape.
 */
export async function sendOrderLines(
  deps: OrderChangeDeps,
  order: { id: string; server_id?: string | null; status_code?: unknown },
  by: number | null,
  lines: Array<Record<string, unknown> & { temp_line_id: string }>
): Promise<OrderChangeResult & { lines: any[] }> {
  const expected = order.status_code == null ? NaN : Number(order.status_code);
  const key = [String(order.id), 'lines', ...lines.map((l) => l.temp_line_id)].join('|');
  return post(deps, order, by, 'lines', key, {
    lines,
    ...(Number.isInteger(expected) ? { expected_status: expected } : {}),
  });
}

async function post(
  deps: OrderChangeDeps,
  order: { id: string; server_id?: string | null },
  by: number | null,
  route: 'status' | 'lines',
  key: string,
  payload: Record<string, unknown>
): Promise<OrderChangeResult & { lines: any[] }> {
  const remote = remoteOrderId(order);
  if (!remote) throw posError('POS_VAL_ORDER_NOT_FOUND');
  if (by == null) throw posError('POS_ORDER_STATUS_NOT_PERMITTED');

  const api = deps.api();
  if (!api || !deps.isLive()) throw posError('POS_ORDER_CHANGE_UNSENT');

  const actionId = unanswered.get(key) ?? newUlid();
  const body = { action_id: actionId, by, ...payload };

  try {
    const { data } = await api.post(`/orders/${encodeURIComponent(remote)}/${route}`, body);
    unanswered.delete(key);
    if (data?.order) deps.applyOrder(String(order.id), data.order);
    return {
      applied: Boolean(data?.applied),
      replayed: Boolean(data?.replayed),
      lines: Array.isArray(data?.lines) ? data.lines : [],
    };
  } catch (err: any) {
    const status = Number(err?.response?.status ?? 0);
    const data = err?.response?.data ?? {};
    const code = String(data?.code ?? '').trim();

    // No answer, throttled or a server fault: it may or may not have landed.
    // Nothing changes here, and the id is kept in case it did.
    if (!status || status === 408 || status === 429 || status >= 500) {
      unanswered.set(key, actionId);
      throw posError('POS_ORDER_CHANGE_UNSENT');
    }

    // A real answer: a refusal stores nothing on the server.
    unanswered.delete(key);
    if (data?.order) deps.applyOrder(String(order.id), data.order);

    if (status === 404 && code === 'POS_ORDER_NOT_FOUND') {
      throw posError('POS_VAL_ORDER_NOT_FOUND');
    }
    if (code === 'POS_PUSH_CANCEL_NOT_PERMITTED' && data?.needs_approval) {
      throw posError('POS_APPROVAL_REQUIRED', {
        params: { action: String(data.needs_approval) },
      });
    }
    if (DECLARED_REFUSALS.has(code)) throw posError(code as any);
    // A bare 404 is a server without this route. Anything else undeclared (a
    // revoked device's 401/403) is not about this order; let the caller see it.
    if (status === 404) throw posError('POS_ORDER_CHANGE_UNAVAILABLE');
    throw err;
  }
}

/** For tests. */
export function resetOrderChanges() {
  unanswered.clear();
}
