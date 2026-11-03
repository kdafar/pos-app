// src/main/handlers/paid.ts
//
// "Mark paid" and "Undo paid" at the till (contract: Mark order paid).
//
// Both checks run here first, offline, against the till's own copy — the same
// refusals the server would give, so a cashier with no network is told now
// rather than when the queue drains. The server stays the authority: whatever
// it answers later replaces the local state (paidMarks.ts).
import type { IpcMain } from 'electron';
import type { MainServices } from '../types/common';
import { posError } from '../../shared/errorCodes';
import {
  isCancelledForPaid,
  isClosedForPaid,
  newUlid,
  paidAmountMatches,
  paidMethodNeedsReference,
  PAID_REFERENCE_MAX,
} from '../../shared/paid';
import {
  getCurrentPosUser,
  getEffectivePermissions,
} from '../utils/permissions';
import { resolveApprover, type ApprovalInput } from '../utils/approvals';
import { logAction } from '../utils/logging';
import { serverRecordsPayment } from '../paidState';
import {
  isOwnOrder,
  queuePaidAction,
  queuedAction,
  sendPaidAction,
  withdrawPaidAction,
  type SendOutcome,
} from '../paidMarks';
import { paidDeps, pushOrderNowIfPending, toServerUserId } from './sync';

export type MarkPaidInput = {
  payment_method_id: string | number;
  /** The total the cashier confirmed. Re-checked against the order's. */
  amount: number;
  /** Card-machine slip reference; required for KNET. */
  reference?: string | null;
  note?: string | null;
};

export type PaidResult = {
  /** done = the server has it; queued = waiting in the outbox. */
  state: 'done' | 'queued';
  notices: string[];
};

type OrderRow = {
  id: string;
  status: string | null;
  status_code: number | null;
  grand_total: number | null;
  payment_method_id: string | null;
  paid_status: string | null;
  paid_how: string | null;
  synced_at: number | null;
};

const money = (n: unknown) => Number(n ?? 0).toFixed(3);

export function registerPaidHandlers(ipcMain: IpcMain, services: MainServices) {
  const db = services.rawDb;

  const loadOrder = (orderId: string) => {
    const id = String(orderId ?? '').trim();
    if (!id) throw posError('POS_VAL_ORDER_ID_MISSING');
    const row = db
      .prepare(
        `SELECT id, status, status_code, grand_total, payment_method_id,
                paid_status, paid_how, synced_at
           FROM orders WHERE id = ?`
      )
      .get(id) as OrderRow | undefined;
    if (!row) throw posError('POS_VAL_ORDER_NOT_FOUND');
    return row;
  };

  /** Try to send now; a refusal is thrown, anything else leaves it queued. */
  const sendNow = async (order: OrderRow, actionId: string): Promise<PaidResult> => {
    // §4.4: the till's own order must be pushed and acked first.
    if (isOwnOrder(order)) await pushOrderNowIfPending(order.id);
    let out: SendOutcome;
    try {
      out = await sendPaidAction(paidDeps(), actionId);
    } catch (e) {
      console.warn('[paid] send failed; stays queued', e);
      return { state: 'queued', notices: [] };
    }
    if (out.kind === 'refused') {
      const params =
        out.params?.grand_total != null
          ? { grand_total: money(out.params.grand_total) }
          : undefined;
      throw posError(out.code as any, { params });
    }
    if (out.kind === 'done') return { state: 'done', notices: out.notices };
    return { state: 'queued', notices: [] };
  };

  ipcMain.handle(
    'orders:markPaid',
    async (_e, orderId: string, input: MarkPaidInput): Promise<PaidResult> => {
      if (!getEffectivePermissions(services).includes('orders.mark_paid')) {
        throw posError('POS_PAID_NOT_PERMITTED');
      }
      const order = loadOrder(orderId);

      if (isCancelledForPaid(order.status, order.status_code)) {
        throw posError('POS_PAID_ORDER_CANCELLED');
      }

      // Tapping Mark paid while an Undo is still queued just takes the undo
      // back: the server never heard it, and the order is paid there already.
      const pendingUndo = queuedAction(db, order.id, 'undo');
      if (pendingUndo) {
        withdrawPaidAction(db, pendingUndo.action_id);
        logAction(services, order.id, 'orders.markPaid', { withdrew_undo: true });
        return { state: 'done', notices: [] };
      }

      if (order.paid_status === 'paid' || queuedAction(db, order.id, 'mark')) {
        throw posError('POS_PAID_ALREADY_PAID');
      }

      if (!paidAmountMatches(input?.amount, order.grand_total)) {
        throw posError('POS_PAID_AMOUNT_MISMATCH', {
          params: { grand_total: money(order.grand_total) },
        });
      }

      const method = db
        .prepare(
          `SELECT id, slug FROM payment_methods WHERE CAST(id AS TEXT) = ? AND COALESCE(is_active, 1) = 1`
        )
        .get(String(input?.payment_method_id ?? '')) as { id: string; slug: string | null } | undefined;
      if (!method) throw posError('POS_PAY_METHOD_UNAVAILABLE', { field: 'payment_method' });

      // §5: a closed order is already posted to the accounts by its method.
      if (
        isClosedForPaid(order.status, order.status_code) &&
        order.payment_method_id &&
        String(order.payment_method_id) !== String(method.id)
      ) {
        throw posError('POS_PAID_METHOD_LOCKED', { field: 'payment_method' });
      }

      // A KNET mark needs the reference printed on the card-machine slip; the
      // server refuses it without one (POS_PAID_REFERENCE_MISSING). Checked
      // here too so the cashier is asked at the counter, not after an offline
      // mark has sat in the queue and been refused.
      const reference = String(input?.reference ?? '').trim();
      if (paidMethodNeedsReference(method.slug) && !reference) {
        throw posError('POS_PAID_REFERENCE_MISSING', { field: 'reference' });
      }
      if (reference.length > PAID_REFERENCE_MAX) {
        // The dialog caps the field at 64, so this is a bug, not a cashier slip.
        throw posError('POS_PAID_INPUT_MISSING', { field: 'reference' });
      }

      const paidBy = toServerUserId(getCurrentPosUser(services).id);
      if (paidBy == null) throw posError('POS_PAID_NOT_PERMITTED');

      const note = String(input?.note ?? '').trim().slice(0, 500);
      const actionId = queuePaidAction(db, order.id, 'mark', {
        action_id: newUlid(),
        paid_by: paidBy,
        amount: Number(order.grand_total ?? 0),
        payment_method_id: String(method.id),
        paid_at: new Date().toISOString(),
        ...(reference ? { reference } : {}),
        ...(note ? { note } : {}),
      });
      logAction(services, order.id, 'orders.markPaid', {
        action_id: actionId,
        amount: Number(order.grand_total ?? 0),
        payment_method_id: String(method.id),
      });

      return sendNow(order, actionId);
    }
  );

  ipcMain.handle(
    'orders:markUnpaid',
    async (
      _e,
      orderId: string,
      input: { reason?: string | null } | null,
      approval?: ApprovalInput
    ): Promise<PaidResult> => {
      const order = loadOrder(orderId);

      if (order.paid_how === 'gateway') throw posError('POS_PAID_VERIFIED_LOCKED');

      const pendingMark = queuedAction(db, order.id, 'mark');
      // Undo is idempotent (§7): nothing to undo is a success, not an error.
      if (!pendingMark && order.paid_status !== 'paid') return { state: 'done', notices: [] };

      // Throws POS_APPROVAL_REQUIRED for a cashier without orders.mark_unpaid;
      // the renderer's approval dialog retries this call with the code.
      const approver = await resolveApprover(services, 'mark_unpaid', approval);
      const reason = String(input?.reason ?? '').trim() || approver.reason || null;

      // A mark the server never received is simply withdrawn.
      if (pendingMark) {
        withdrawPaidAction(db, pendingMark.action_id);
        logAction(services, order.id, 'orders.markUnpaid', { withdrew_mark: true, reason });
        return { state: 'done', notices: [] };
      }

      const requestedBy = toServerUserId(approver.requestedBy);
      if (requestedBy == null) throw posError('POS_PAID_UNDO_NOT_PERMITTED');
      const approvedBy = toServerUserId(approver.approvedBy);
      const now = new Date().toISOString();

      const actionId = queuePaidAction(db, order.id, 'undo', {
        action_id: newUlid(),
        requested_by: requestedBy,
        ...(reason ? { reason: reason.slice(0, 500) } : {}),
        unpaid_at: now,
        // Only when someone else approved: approving your own request needs
        // only orders.mark_unpaid, which the server checks on requested_by.
        ...(approvedBy != null && approvedBy !== requestedBy
          ? { approval: { id: `ap-${newUlid()}`, approved_by: approvedBy, approved_at: now } }
          : {}),
      });
      logAction(services, order.id, 'orders.markUnpaid', {
        action_id: actionId,
        approved_by: approvedBy,
        reason,
      });

      return sendNow(order, actionId);
    }
  );

  /** What the renderer needs to decide which buttons to show. */
  ipcMain.handle('orders:paidSupport', async () => {
    const perms = getEffectivePermissions(services);
    return {
      supported: serverRecordsPayment(db),
      canMark: perms.includes('orders.mark_paid'),
      canUndoAlone: perms.includes('orders.mark_unpaid'),
    };
  });

  /** Clear the "refused" notice the cashier has now read. */
  ipcMain.handle('orders:dismissPaidRefusal', async (_e, orderId: string) => {
    db.prepare(`UPDATE orders SET paid_refusal = NULL WHERE id = ?`).run(String(orderId ?? ''));
    return { ok: true };
  });
}
