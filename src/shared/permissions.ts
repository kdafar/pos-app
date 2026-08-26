export const PERMISSIONS = [
  'orders.create', 'orders.view_own', 'orders.view_all', 'orders.kitchen_view', 'orders.edit_unpaid',
  'orders.change_status', 'orders.cancel', 'orders.reopen', 'orders.refund',
  'reports.view', 'reports.export', 'catalog.manage', 'payments.manage',
  'locations.manage', 'tables.manage', 'settings.manage', 'updates.manage',
  'users.permissions',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Roles that bypass order locks and see other operators' orders.
 * Kept beside ROLE_DEFAULTS on purpose: the two lists lived in separate files
 * and drifted, so an `owner` counted as admin for locks while resolving to
 * zero permissions and was denied by every gated handler.
 */
export const ADMIN_ROLES = [
  'admin',
  'owner',
  'manager',
  'super_admin',
  'superadmin',
] as const;

export function isAdminRole(role?: string | null): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(
    String(role || '').toLowerCase()
  );
}

const ALL = [...PERMISSIONS];
export const ROLE_DEFAULTS: Record<string, Permission[]> = {
  admin: ALL,
  manager: ALL.filter((p) => p !== 'users.permissions'),
  accountant: ['orders.view_all', 'reports.view', 'reports.export'],
  pos: ['orders.create', 'orders.view_own', 'orders.edit_unpaid', 'orders.cancel', 'tables.manage'],
  branch: ['orders.create', 'orders.view_own', 'orders.edit_unpaid', 'orders.cancel', 'tables.manage'],
  kitchen: ['orders.view_all', 'orders.kitchen_view', 'orders.change_status'],
};

export function rolePermissions(role?: string | null): Permission[] {
  const key = String(role || '').toLowerCase();
  const defaults = ROLE_DEFAULTS[key];
  if (defaults) return defaults;
  // An admin-tier role with no row above still gets full rights rather than
  // none, so adding one to ADMIN_ROLES can never silently lock it out again.
  return isAdminRole(key) ? ALL : [];
}
