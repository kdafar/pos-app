export const PERMISSIONS = [
  'orders.create', 'orders.view_own', 'orders.view_all', 'orders.kitchen_view', 'orders.edit_unpaid',
  'orders.change_status', 'orders.cancel', 'orders.reopen', 'orders.refund',
  'reports.view', 'reports.export', 'catalog.manage', 'payments.manage',
  'locations.manage', 'tables.manage', 'settings.manage', 'updates.manage',
  'users.permissions',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

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
  return ROLE_DEFAULTS[String(role || '').toLowerCase()] || [];
}
