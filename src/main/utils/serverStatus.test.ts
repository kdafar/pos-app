import { describe, it, expect } from 'vitest';
import {
  SERVER_STATUS,
  pushStatusForLocal,
  isTerminalServerStatus,
} from './serverStatus';

describe('pushStatusForLocal', () => {
  it('reports an order still being made as PREPARING, not READY', () => {
    // The regression this guards: `prepared` reported READY, which the
    // dashboard shows as with-a-driver or ready-to-collect — telling the
    // customer their food was on its way while it was still on the pass.
    expect(pushStatusForLocal('prepared')).toBe(SERVER_STATUS.PREPARING);
    expect(pushStatusForLocal('prepared')).not.toBe(SERVER_STATUS.READY);
  });

  it('maps the rest of the till lifecycle onto the backend enum', () => {
    expect(pushStatusForLocal('open')).toBe(SERVER_STATUS.RECEIVED);
    expect(pushStatusForLocal('pending')).toBe(SERVER_STATUS.RECEIVED);
    expect(pushStatusForLocal('placed')).toBe(SERVER_STATUS.RECEIVED);
    expect(pushStatusForLocal('ready')).toBe(SERVER_STATUS.READY);
    expect(pushStatusForLocal('closed')).toBe(SERVER_STATUS.DONE);
    expect(pushStatusForLocal('completed')).toBe(SERVER_STATUS.DONE);
  });

  it('only DONE closes the sale, because that is what posts revenue', () => {
    // postVoucherIfComplete() returns early unless status === DONE, so nothing
    // short of it may map there by accident.
    const shouldNotBeDone = ['open', 'pending', 'placed', 'prepared', 'ready'];
    for (const s of shouldNotBeDone) {
      expect(pushStatusForLocal(s)).not.toBe(SERVER_STATUS.DONE);
    }
  });

  it('falls back to RECEIVED for anything unrecognised', () => {
    for (const s of ['', 'nonsense', undefined as any, null as any]) {
      expect(pushStatusForLocal(s)).toBe(SERVER_STATUS.RECEIVED);
    }
  });
});

describe('isTerminalServerStatus', () => {
  it('treats done, both cancels and both rejects as terminal', () => {
    for (const c of [4, 5, 6, 8, 9]) expect(isTerminalServerStatus(c)).toBe(true);
  });

  it('leaves the working statuses editable', () => {
    for (const c of [0, 1, 2, 3, 7]) expect(isTerminalServerStatus(c)).toBe(false);
  });
});
