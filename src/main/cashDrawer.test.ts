import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module pulls in electron and the SQLite handle at import time, neither of
// which exists under vitest. Only the pure logic is under test here — the
// winspool call is not something a unit test can prove anyway.
const meta = new Map<string, string>();

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
// getSetting is mocked to throw rather than return null: the drawer must read
// device metadata only, so any reintroduced server fallback fails loudly here
// instead of quietly making a remote setting able to open tills.
vi.mock('./db', () => ({
  default: {},
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => void meta.set(k, v),
  getSetting: () => {
    throw new Error('drawer settings must not fall back to server settings');
  },
}));
vi.mock('./utils/permissions', () => ({ assertPermission: vi.fn() }));

const { buildKickCommand, getDrawerConfig, isCashPayment } = await import(
  './cashDrawer'
);

beforeEach(() => meta.clear());

describe('drawer kick command', () => {
  it('is the ESC/POS pulse on pin 2 by default', () => {
    expect([...buildKickCommand()]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it('addresses pin 5 when the drawer is wired the other way', () => {
    expect([...buildKickCommand(1)]).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });
});

describe('cash payment detection', () => {
  it.each(['cash', 'CASH', 'cash_kd', 'cash-counter', 'petty_cash'])(
    'treats %s as cash',
    (slug) => expect(isCashPayment(slug)).toBe(true)
  );

  it.each(['knet', 'visa', 'card', 'cashew', 'online', '', null, undefined])(
    'does not treat %s as cash',
    (slug) => expect(isCashPayment(slug)).toBe(false)
  );
});

describe('drawer config', () => {
  it('is off until a shop turns it on, so upgrades change nothing', () => {
    expect(getDrawerConfig()).toEqual({ enabled: false, pin: 0, cashOnly: true });
  });

  it('defaults cash-only to on rather than off when unset', () => {
    meta.set('drawer.enabled', '1');
    expect(getDrawerConfig().cashOnly).toBe(true);
  });

  it('lets cash-only be turned off explicitly', () => {
    meta.set('drawer.enabled', '1');
    meta.set('drawer.cash_only', '0');
    expect(getDrawerConfig()).toEqual({ enabled: true, pin: 0, cashOnly: false });
  });

  it('falls back to pin 2 for an unrecognised stored pin', () => {
    meta.set('drawer.pin', 'nonsense');
    expect(getDrawerConfig().pin).toBe(0);
  });

  it('ignores server settings entirely, so no push can open a till remotely', () => {
    // getSetting throws in this suite's db mock. Reading the config at all is
    // the assertion; a server fallback would take the throw instead.
    expect(() => getDrawerConfig()).not.toThrow();
    expect(getDrawerConfig().enabled).toBe(false);
  });
});
