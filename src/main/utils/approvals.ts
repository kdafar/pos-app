// src/main/utils/approvals.ts
//
// Manager approval at the till (contract: docs/POS-MANAGER-APPROVAL-PLAN.md).
//
// An action a cashier's permissions do not cover can still happen when a
// manager approves it with their 6-digit approval code, typed or scanned from
// a manager card. The code is checked here, offline, against the bcrypt hash
// the server shipped — the same way staff passwords are checked. Whoever holds
// the permission themselves acts directly and is recorded as their own
// approver. Every approved action is stored and sent with the order as
// approvals[].
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { MainServices } from '../types/common';
import { posError } from '../../shared/errorCodes';
import type { Permission } from '../../shared/permissions';
import {
  getCurrentPosUser,
  getEffectivePermissions,
  permissionsForRole,
} from './permissions';

export type ApprovalAction =
  | 'void_sent_line'
  | 'force_close_table'
  | 'cancel_sent_order';

/** The permission each action needs, from the approver or the cashier. */
export const APPROVAL_PERMISSION: Record<ApprovalAction, Permission> = {
  void_sent_line: 'orders.void_sent_line',
  force_close_table: 'tables.force_close',
  cancel_sent_order: 'orders.cancel_sent',
};

/** What the renderer sends back after the approval dialog. */
export type ApprovalInput = { code?: string | null; reason?: string | null } | null | undefined;

export type Approver = { approvedBy: number | null; requestedBy: number | null; reason: string | null };

const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;

// Per till, in memory. A restart clearing a lockout is acceptable: the lock
// exists to stop guessing at the counter, and restarting a till mid-service is
// not a quiet way to guess.
let failures = 0;
let lockedUntil = 0;

/** Laravel writes $2y$; bcryptjs reads $2a$/$2b$, and they are the same scheme. */
const normalizeHash = (h: string) => h.replace(/^\$2y\$/, '$2b$');

/**
 * Who approves `action` — the cashier, if they hold its permission, or the
 * manager whose code was given. Throws a coded error the approval dialog
 * understands; never performs or records anything itself.
 */
export async function resolveApprover(
  services: MainServices,
  action: ApprovalAction,
  approval: ApprovalInput
): Promise<Approver> {
  const permission = APPROVAL_PERMISSION[action];
  const user = getCurrentPosUser(services);
  const requestedBy = user.id != null ? Number(user.id) : null;
  const reason = approval?.reason?.trim() || null;

  if (getEffectivePermissions(services).includes(permission)) {
    return { approvedBy: requestedBy, requestedBy, reason };
  }

  const code = String(approval?.code ?? '').replace(/\D/g, '');
  if (!code) throw posError('POS_APPROVAL_REQUIRED', { params: { action } });

  if (lockedUntil > Date.now()) {
    const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
    throw posError('POS_APPROVAL_LOCKED', { params: { minutes: String(minutes) } });
  }

  const candidates = services.rawDb
    .prepare(
      `SELECT id, name, role, approval_code_hash
         FROM pos_users
        WHERE is_active = 1 AND approval_code_set = 1 AND approval_code_hash IS NOT NULL`
    )
    .all() as Array<{ id: number; name: string; role: string; approval_code_hash: string }>;

  if (!candidates.length) throw posError('POS_APPROVAL_NO_APPROVERS');

  let match: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    // Codes are unique among managers, so the code alone names the approver.
    if (await bcrypt.compare(code, normalizeHash(c.approval_code_hash))) {
      match = c;
      break;
    }
  }

  if (!match) {
    failures++;
    if (failures >= MAX_FAILURES) {
      failures = 0;
      lockedUntil = Date.now() + LOCK_MS;
      throw posError('POS_APPROVAL_LOCKED', {
        params: { minutes: String(Math.ceil(LOCK_MS / 60000)) },
      });
    }
    throw posError('POS_APPROVAL_CODE_WRONG', {
      params: { left: String(MAX_FAILURES - failures) },
    });
  }

  // A right code from someone who may not approve this is not a guess, so it
  // does not count toward the lockout.
  const approverPerms = permissionsForRole(services.rawDb, match.role);
  if (!approverPerms.includes('orders.approve') || !approverPerms.includes(permission)) {
    throw posError('POS_APPROVAL_NOT_ALLOWED', { params: { name: match.name } });
  }

  failures = 0;
  return { approvedBy: Number(match.id), requestedBy, reason };
}

/** Store one approved action. Call inside the same transaction as the action. */
export function recordApproval(
  services: MainServices,
  approver: Approver,
  detail: {
    action: ApprovalAction;
    orderId: string;
    lineId?: string | null;
    tableId?: string | null;
    qtyBefore?: number | null;
    qtyAfter?: number | null;
  }
): string {
  const id = crypto.randomUUID();
  services.rawDb
    .prepare(
      `INSERT INTO order_approvals
         (id, order_id, action, line_id, table_id, qty_before, qty_after,
          requested_by, approved_by, approved_at, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      detail.orderId,
      detail.action,
      detail.lineId ?? null,
      detail.tableId ?? null,
      detail.qtyBefore ?? null,
      detail.qtyAfter ?? null,
      approver.requestedBy,
      approver.approvedBy,
      new Date().toISOString(),
      approver.reason,
      Date.now()
    );
  return id;
}

/** approvals[] for an order's push payload, in the wire shape the server reads. */
export function approvalsForPush(db: MainServices['rawDb'], orderId: string) {
  try {
    const rows = db
      .prepare(`SELECT * FROM order_approvals WHERE order_id = ? ORDER BY created_at ASC`)
      .all(orderId) as any[];
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      ...(r.line_id ? { line_id: r.line_id } : {}),
      ...(r.table_id ? { table_id: r.table_id } : {}),
      ...(r.qty_before != null ? { qty_before: Number(r.qty_before) } : {}),
      ...(r.qty_after != null ? { qty_after: Number(r.qty_after) } : {}),
      requested_by: r.requested_by,
      approved_by: r.approved_by,
      approved_at: r.approved_at,
      reason: r.reason,
    }));
  } catch {
    // Table missing on a half-migrated install: an order with no approvals.
    return [];
  }
}

/** For tests: forget failures and any lockout. */
export function resetApprovalLockout() {
  failures = 0;
  lockedUntil = 0;
}
