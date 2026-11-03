import { describe, expect, it } from 'vitest';
import {
  isCancelledForPaid,
  isClosedForPaid,
  newUlid,
  normPaid,
  paidAmountMatches, paidMethodNeedsReference } from './paid';

describe('normPaid', () => {
  it('treats a missing key as "server does not record payment"', () => {
    expect(normPaid(undefined)).toBeUndefined();
  });

  it('reads a hand mark', () => {
    expect(
      normPaid({
        status: 'paid',
        how: 'by_hand',
        paid_at: '2026-11-03T09:41:12.000000Z',
        paid_by: { id: 12, name: 'Sara' },
        amount: 4.5,
        payment_method_id: '3',
        reference: ' 778812 ',
        link_open: false,
      })
    ).toEqual({
      paid_status: 'paid',
      paid_how: 'by_hand',
      paid_time: '2026-11-03T09:41:12.000000Z',
      paid_by_id: 12,
      paid_by_name: 'Sara',
      paid_amount: 4.5,
      paid_method_id: '3',
      paid_reference: '778812',
      paid_link_open: 0,
    });
  });

  it('asks for the slip reference on KNET only, by slug', () => {
    expect(paidMethodNeedsReference('knet')).toBe(true);
    expect(paidMethodNeedsReference(' KNET ')).toBe(true);
    expect(paidMethodNeedsReference('cash')).toBe(false);
    expect(paidMethodNeedsReference('online')).toBe(false);
    expect(paidMethodNeedsReference(null)).toBe(false);
  });

  it('clears everything on unpaid but keeps link_open', () => {
    const p = normPaid({ status: 'unpaid', how: null, link_open: true, paid_by: { id: 3 } });
    expect(p?.paid_status).toBe('unpaid');
    expect(p?.paid_how).toBeNull();
    expect(p?.paid_by_id).toBeNull();
    expect(p?.paid_link_open).toBe(1);
  });

  it('never reads a garbled object as paid', () => {
    expect(normPaid(null)?.paid_status).toBe('unpaid');
    expect(normPaid('paid')?.paid_status).toBe('unpaid');
    expect(normPaid({ status: 'PAID ', how: 'magic' })).toMatchObject({
      paid_status: 'paid',
      paid_how: null,
    });
  });
});

describe('paidAmountMatches', () => {
  it('accepts within 0.0005 and refuses beyond', () => {
    expect(paidAmountMatches(4.5, 4.5)).toBe(true);
    expect(paidAmountMatches(4.4995, 4.5)).toBe(true);
    expect(paidAmountMatches(4.499, 4.5)).toBe(false);
    expect(paidAmountMatches(10, 12)).toBe(false);
    expect(paidAmountMatches('x', 12)).toBe(false);
  });
});

describe('newUlid', () => {
  it('is 26 Crockford characters with the time first', () => {
    const id = newUlid(1_700_000_000_000, (n) => new Uint8Array(n));
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(id.endsWith('0'.repeat(16))).toBe(true);
    // Later time sorts later.
    expect(newUlid(1_700_000_000_001, (n) => new Uint8Array(n)) > id).toBe(true);
  });

  it('differs per call with real randomness', () => {
    expect(newUlid()).not.toBe(newUlid());
  });
});

describe('status rules', () => {
  it('cancelled covers every cancel/reject shape', () => {
    expect(isCancelledForPaid('cancelled_client', null)).toBe(true);
    expect(isCancelledForPaid('rejected (auto)', 8)).toBe(true);
    expect(isCancelledForPaid('preparing', 2)).toBe(false);
    expect(isCancelledForPaid('x', 9)).toBe(true);
  });

  it('closed is local closed/completed or server done', () => {
    expect(isClosedForPaid('closed', null)).toBe(true);
    expect(isClosedForPaid('done', 4)).toBe(true);
    expect(isClosedForPaid('placed', null)).toBe(false);
    expect(isClosedForPaid('ready', 3)).toBe(false);
  });
});
