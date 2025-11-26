// src/main/utils/permissions.ts
import type { MainServices } from '../types/common';

export type PosUserContext = {
  id: string | null;
  isAdmin: boolean;
  role?: string | null;
  branch_id?: number | null;
};

/**
 * Check whether a column exists on a table.
 */
export function hasColumn(
  services: MainServices,
  table: string,
  column: string
): boolean {
  try {
    const rows = services.rawDb
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

/**
 * Return the current POS user context based on meta + pos_users table.
 * Falls back gracefully if the table or row is missing.
 */
export function getCurrentPosUser(services: MainServices): PosUserContext {
  const store = services.store;
  const db = services.rawDb;

  // Try both keys for backward compatibility
  const rawId =
    store.get('pos.current_user_id') ?? store.get('auth.user_id') ?? null;
  const id = rawId != null && rawId !== '' ? String(rawId) : null;

  // If nobody is set, treat as admin (owner debugging / old DBs)
  if (!id) return { id: null, isAdmin: true };

  try {
    const row = db
      .prepare(
        `
        SELECT id, role, branch_id
        FROM pos_users
        WHERE id = ?
        LIMIT 1
      `
      )
      .get(id) as any;

    const role = (row?.role || '').toString().toLowerCase();
    const isAdmin = [
      'admin',
      'owner',
      'manager',
      'super_admin',
      'superadmin',
    ].includes(role);

    return {
      id,
      isAdmin,
      role: row?.role ?? null,
      branch_id: row?.branch_id ?? null,
    };
  } catch {
    // If pos_users table missing, don't block the app
    return { id, isAdmin: true };
  }
}

/**
 * Build a WHERE fragment to restrict orders to the current user (if not admin).
 * Usage:
 *   const { sql, params } = buildUserFilter('o', services);
 *   ... WHERE 1=1 ${sql}
 */
export function buildUserFilter(
  alias: string,
  services: MainServices
): { sql: string; params: Record<string, any> } {
  const { id, isAdmin } = getCurrentPosUser(services);
  const db = services.rawDb;

  const hasCreated = hasColumn(services, 'orders', 'created_by_user_id');
  const hasCompleted = hasColumn(services, 'orders', 'completed_by_user_id');

  if (!id || isAdmin || (!hasCreated && !hasCompleted)) {
    return { sql: '', params: {} };
  }

  let expr: string;
  if (hasCreated && hasCompleted) {
    expr = `COALESCE(${alias}.created_by_user_id, ${alias}.completed_by_user_id)`;
  } else if (hasCreated) {
    expr = `${alias}.created_by_user_id`;
  } else {
    expr = `${alias}.completed_by_user_id`;
  }

  // Quick sanity check for orders table presence
  try {
    db.prepare('SELECT 1 FROM orders LIMIT 1').get();
  } catch {
    return { sql: '', params: {} };
  }

  return {
    sql: ` AND ${expr} = @user_id `,
    params: { user_id: id },
  };
}

/**
 * Kill-switch: if pos.locked = 1/true, block mutations.
 */
export function isPosLocked(services: MainServices): boolean {
  const v = services.meta.get('pos.locked');
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true';
}

/**
 * Fetch a single order row by id (raw).
 */
function getOrderRow(services: MainServices, orderId: string): any | undefined {
  return services.rawDb
    .prepare(`SELECT * FROM orders WHERE id = ?`)
    .get(orderId) as any;
}

/**
 * Throw if order is not editable by the current user (non-admin).
 * Returns the order row if ok.
 */
export function assertOrderEditable(
  services: MainServices,
  orderId: string
): any {
  const order = getOrderRow(services, orderId);
  if (!order) throw new Error('Order not found');

  const { isAdmin } = getCurrentPosUser(services);
  const locked =
    hasColumn(services, 'orders', 'is_locked') &&
    Number(order.is_locked ?? 0) === 1;
  const status = (order.status || '').toString().toLowerCase();

  if (!isAdmin) {
    if (locked) throw new Error('Order is locked');
    if (['completed', 'cancelled', 'canceled'].includes(status)) {
      throw new Error('Completed/cancelled orders cannot be edited');
    }
  }

  return order;
}
