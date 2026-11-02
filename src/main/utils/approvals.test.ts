import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

// Who is signed in, what they may do, and what each approver's role may do —
// the three answers resolveApprover takes from the permissions module.
const state = {
  user: { id: '13' as string | null, isAdmin: false },
  cashierPerms: [] as string[],
  rolePerms: {} as Record<string, string[]>,
};
vi.mock('./permissions', () => ({
  getCurrentPosUser: () => state.user,
  getEffectivePermissions: () => state.cashierPerms,
  permissionsForRole: (_db: unknown, role: string) => state.rolePerms[role] ?? [],
}));
vi.mock('electron', () => ({ app: { isPackaged: true } }));

const { resolveApprover, resetApprovalLockout } = await import('./approvals');

// Laravel stores $2y$; the till must read it.
const hash = (code: string) => bcrypt.hashSync(code, 4).replace(/^\$2[ab]\$/, '$2y$');

function services(managers: Array<{ id: number; name: string; role: string; code: string }>) {
  const rows = managers.map((m) => ({ ...m, approval_code_hash: hash(m.code) }));
  return { rawDb: { prepare: () => ({ all: () => rows }) } } as any;
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e: any) {
    return e?.posError?.code ?? e?.code ?? String(e?.message ?? e);
  }
};

describe('manager approval at the till', () => {
  beforeEach(() => {
    resetApprovalLockout();
    state.user = { id: '13', isAdmin: false };
    state.cashierPerms = ['orders.create'];
    state.rolePerms = {
      manager: ['orders.approve', 'orders.void_sent_line', 'orders.cancel_sent', 'tables.force_close'],
      supervisor: ['orders.void_sent_line'], // may void, may not approve
    };
  });

  it('lets a user who holds the permission act directly, as their own approver', async () => {
    state.cashierPerms = ['orders.void_sent_line'];
    const a = await resolveApprover(services([]), 'void_sent_line', null);
    expect(a).toEqual({ approvedBy: 13, requestedBy: 13, reason: null });
  });

  it('asks for a manager when the cashier lacks the permission and gave no code', async () => {
    expect(await codeOf(resolveApprover(services([]), 'void_sent_line', null))).toBe(
      'POS_APPROVAL_REQUIRED'
    );
  });

  it("accepts a manager's code — typed or scanned — and records who approved", async () => {
    const svc = services([{ id: 4, name: 'Manager', role: 'manager', code: '482913' }]);
    const a = await resolveApprover(svc, 'cancel_sent_order', {
      code: '482913',
      reason: ' Customer left ',
    });
    expect(a).toEqual({ approvedBy: 4, requestedBy: 13, reason: 'Customer left' });
  });

  it('refuses a right code from someone who may not approve this', async () => {
    const svc = services([{ id: 7, name: 'Sara', role: 'supervisor', code: '111222' }]);
    expect(await codeOf(resolveApprover(svc, 'void_sent_line', { code: '111222' }))).toBe(
      'POS_APPROVAL_NOT_ALLOWED'
    );
  });

  it('says so when no manager on the till has a code yet', async () => {
    expect(await codeOf(resolveApprover(services([]), 'void_sent_line', { code: '123456' }))).toBe(
      'POS_APPROVAL_NO_APPROVERS'
    );
  });

  it('locks for 5 minutes after 5 wrong codes, and refuses even the right one meanwhile', async () => {
    const svc = services([{ id: 4, name: 'Manager', role: 'manager', code: '482913' }]);
    for (let i = 0; i < 4; i++) {
      expect(await codeOf(resolveApprover(svc, 'void_sent_line', { code: '000000' }))).toBe(
        'POS_APPROVAL_CODE_WRONG'
      );
    }
    expect(await codeOf(resolveApprover(svc, 'void_sent_line', { code: '000000' }))).toBe(
      'POS_APPROVAL_LOCKED'
    );
    expect(await codeOf(resolveApprover(svc, 'void_sent_line', { code: '482913' }))).toBe(
      'POS_APPROVAL_LOCKED'
    );
  });

  it('does not count a right code from the wrong manager toward the lockout', async () => {
    const svc = services([
      { id: 7, name: 'Sara', role: 'supervisor', code: '111222' },
      { id: 4, name: 'Manager', role: 'manager', code: '482913' },
    ]);
    for (let i = 0; i < 6; i++) await codeOf(resolveApprover(svc, 'void_sent_line', { code: '111222' }));
    expect(await codeOf(resolveApprover(svc, 'void_sent_line', { code: '482913' }))).toBe('OK');
  });
});
