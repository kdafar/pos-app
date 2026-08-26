import { describe, expect, it, vi } from 'vitest';

// The module pulls in electron via authContext; nothing under test touches it.
vi.mock('electron', () => ({ app: { isPackaged: true } }));

const { permissionsForRole } = await import('./permissions');

type Row = { permission: string; allowed: number };

/**
 * A stand-in for better-sqlite3 covering just the two statements
 * permissionsForRole issues: the role's rows, and the server-ownership flag.
 */
function fakeDb(rows: Row[], source: string | null) {
  return {
    prepare(sql: string) {
      if (sql.includes('permissions.source')) {
        return { pluck: () => ({ get: () => source }) };
      }
      return { all: () => rows };
    },
  } as any;
}

/**
 * The back office revokes a role down to nothing by sending every slug with
 * allowed: false, rather than deleting the rows — deletes would leave the role
 * with no rows at all, which the client reads as "unmanaged" and answers with
 * the built-in defaults. That safeguard only works if rows are counted BEFORE
 * they are filtered to the granted ones. Get it backwards and "revoke
 * everything" silently becomes "restore everything", in the fail-open
 * direction.
 */
describe('permissionsForRole under server management', () => {
  it('grants nothing when every row is allowed:false', () => {
    const rows = [
      { permission: 'orders.create', allowed: 0 },
      { permission: 'orders.print', allowed: 0 },
      { permission: 'tables.manage', allowed: 0 },
    ];
    expect(permissionsForRole(fakeDb(rows, 'server'), 'pos')).toEqual([]);
  });

  it('returns exactly the granted rows, ignoring the built-in defaults', () => {
    // 'pos' defaults include orders.create and tables.manage. Neither is
    // granted here, so neither may survive.
    const rows = [
      { permission: 'reports.view', allowed: 1 },
      { permission: 'orders.create', allowed: 0 },
      { permission: 'tables.manage', allowed: 0 },
    ];
    expect(permissionsForRole(fakeDb(rows, 'server'), 'pos')).toEqual([
      'reports.view',
    ]);
  });

  it('falls back to the built-in defaults when the server sent no rows at all', () => {
    // A backend that publishes only the roles it customised must not strip
    // every other role bare.
    const result = permissionsForRole(fakeDb([], 'server'), 'kitchen');
    expect(result).toContain('orders.kitchen_view');
  });

  it('drops a slug this build does not know', () => {
    const rows = [
      { permission: 'reports.view', allowed: 1 },
      { permission: 'orders.teleport', allowed: 1 },
    ];
    expect(permissionsForRole(fakeDb(rows, 'server'), 'pos')).toEqual([
      'reports.view',
    ]);
  });
});

/**
 * Without server ownership the same table means the opposite thing: a delta
 * against the compiled defaults, so that a later change to those defaults
 * still reaches roles nobody has edited.
 */
describe('permissionsForRole with local edits only', () => {
  it('applies rows as a delta against the defaults', () => {
    const rows = [
      { permission: 'orders.print', allowed: 1 }, // add
      { permission: 'tables.manage', allowed: 0 }, // remove
    ];
    const result = permissionsForRole(fakeDb(rows, null), 'pos');
    expect(result).toContain('orders.print');
    expect(result).not.toContain('tables.manage');
    // Untouched defaults survive.
    expect(result).toContain('orders.create');
  });

  it('keeps the defaults when the table is empty', () => {
    const result = permissionsForRole(fakeDb([], null), 'pos');
    expect(result).toContain('orders.create');
    expect(result).not.toContain('orders.print');
  });
});
