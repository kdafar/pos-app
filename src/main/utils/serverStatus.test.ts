import { describe, it, expect } from 'vitest';
import {
  SERVER_STATUS,
  pushStatusForLocal,
  isTerminalServerStatus,
  safePushStatus,
  isAllowedPosTransition,
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

describe('isAllowedPosTransition', () => {
  const S = SERVER_STATUS;

  it('allows only the documented forward flow and idempotent repeats', () => {
    expect(isAllowedPosTransition(S.RECEIVED, S.PREPARING)).toBe(true);
    expect(isAllowedPosTransition(S.PREPARING, S.READY)).toBe(true);
    expect(isAllowedPosTransition(S.READY, S.AWAITING_PICKUP)).toBe(true);
    expect(isAllowedPosTransition(S.READY, S.DONE)).toBe(true);
    expect(isAllowedPosTransition(S.AWAITING_PICKUP, S.DONE)).toBe(true);
    expect(isAllowedPosTransition(S.READY, S.READY)).toBe(true);
  });

  it('blocks backward, skipped, terminal, cancellation and unknown moves', () => {
    expect(isAllowedPosTransition(S.READY, S.PREPARING)).toBe(false);
    expect(isAllowedPosTransition(S.RECEIVED, S.READY)).toBe(false);
    expect(isAllowedPosTransition(S.DONE, S.READY)).toBe(false);
    expect(isAllowedPosTransition(S.READY, S.CANCELLED_ADMIN)).toBe(false);
    expect(isAllowedPosTransition(123, S.DONE)).toBe(false);
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

describe('safePushStatus — the server owns status', () => {
  const S = SERVER_STATUS;

  it('never drags a delivered order back to received', () => {
    // The scenario: an order is marked done on the dashboard, then the cashier
    // changes its payment method on the till. That re-queues a push, which
    // would otherwise resend the local `placed` and un-deliver it.
    expect(safePushStatus('placed', S.DONE)).toBe(S.DONE);
    expect(safePushStatus('open', S.DONE)).toBe(S.DONE);
    expect(safePushStatus('prepared', S.DONE)).toBe(S.DONE);
  });

  it('never revives a cancelled or rejected order', () => {
    for (const terminal of [
      S.CANCELLED_CLIENT,
      S.CANCELLED_ADMIN,
      S.REJECTED_AUTO,
      S.REJECTED,
    ]) {
      for (const local of ['open', 'placed', 'prepared', 'ready', 'closed']) {
        expect(safePushStatus(local, terminal)).toBe(terminal);
      }
    }
  });

  it('still lets the till move an order forward', () => {
    expect(safePushStatus('prepared', S.RECEIVED)).toBe(S.PREPARING);
    expect(safePushStatus('ready', S.PREPARING)).toBe(S.READY);
    expect(safePushStatus('closed', S.READY)).toBe(S.DONE);
    expect(safePushStatus('closed', S.AWAITING_PICKUP)).toBe(S.DONE);
  });

  it('treats awaiting-pickup as level with ready, not beyond done', () => {
    // 7 is numerically above 4 but is not further along; closing must still win.
    expect(safePushStatus('closed', S.AWAITING_PICKUP)).toBe(S.DONE);
    expect(safePushStatus('prepared', S.AWAITING_PICKUP)).toBe(S.AWAITING_PICKUP);
  });

  it('uses the local status when the order has never synced', () => {
    for (const unknown of [null, undefined, '', NaN]) {
      expect(safePushStatus('prepared', unknown)).toBe(S.PREPARING);
    }
  });
});
