import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLES,
  PERMISSIONS,
  ROLE_DEFAULTS,
  isAdminRole,
  rolePermissions,
} from './permissions';

describe('the admin role list and the permission table', () => {
  // These two lists used to live in different files. `owner` and
  // `super_admin` were admins for order locks but had no ROLE_DEFAULTS row,
  // so rolePermissions returned [] and assertPermission denied them
  // everything — an owner could unlock a printed order yet not open a report.
  it('never leaves an admin role with zero permissions', () => {
    for (const role of ADMIN_ROLES) {
      expect(rolePermissions(role), role).not.toHaveLength(0);
    }
  });

  it('gives an admin-tier role with no explicit row the full set', () => {
    expect(ROLE_DEFAULTS.owner).toBeUndefined();
    expect(rolePermissions('owner')).toEqual([...PERMISSIONS]);
    expect(rolePermissions('SUPER_ADMIN')).toEqual([...PERMISSIONS]);
  });

  it('still gives an unknown non-admin role nothing', () => {
    expect(rolePermissions('courier')).toEqual([]);
    expect(rolePermissions('')).toEqual([]);
    expect(rolePermissions(null)).toEqual([]);
    expect(rolePermissions(undefined)).toEqual([]);
  });

  it('reads roles case-insensitively', () => {
    expect(isAdminRole('Admin')).toBe(true);
    expect(isAdminRole('OWNER')).toBe(true);
    expect(isAdminRole('pos')).toBe(false);
  });
});

describe('the till roles', () => {
  // Today's Orders is routed behind 'orders.view_own'. Its first IPC call was
  // gated on 'reports.view', which these roles do not hold, so every cashier
  // reached the page and then saw an empty table. The route guard and the
  // handler guard must agree; this pins the gap that made them disagree.
  it('can reach their own orders without holding reports.view', () => {
    for (const role of ['pos', 'branch']) {
      expect(rolePermissions(role), role).toContain('orders.view_own');
      expect(rolePermissions(role), role).not.toContain('reports.view');
    }
  });

  it('keeps reports.view on the roles that read money', () => {
    for (const role of ['admin', 'manager', 'accountant']) {
      expect(rolePermissions(role), role).toContain('reports.view');
    }
  });
});

