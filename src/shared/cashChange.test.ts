import { describe, expect, it } from 'vitest';
import {
  CASH_ROUNDING_UNIT,
  computeChangeBlock,
  isCashPayment,
  isTenderable,
  roundChange,
  suggestTenders,
  tenderForWire,
} from './cashChange';

/** The happy path, so each case below only has to vary what it is about. */
const CASH = { paymentSlug: 'cash', enabled: true };

describe('roundChange', () => {
  it('rounds to the nearest 5 fils', () => {
    expect(roundChange(1.667)).toBeCloseTo(1.665, 6);
    expect(roundChange(1.668)).toBeCloseTo(1.67, 6);
    expect(roundChange(1.663)).toBeCloseTo(1.665, 6);
  });

  it('leaves an amount that is already payable alone', () => {
    expect(roundChange(2)).toBeCloseTo(2, 6);
    expect(roundChange(0.005)).toBeCloseTo(0.005, 6);
    expect(roundChange(1.235)).toBeCloseTo(1.235, 6);
  });

  it('never drifts on binary fractions', () => {
    // 0.1 + 0.2 !== 0.3 in float. Done in fils, this is exact.
    expect(roundChange(0.1 + 0.2)).toBeCloseTo(0.3, 6);
  });

  // The 1 fils coin has not been minted since 1988. Every reachable amount
  // must land on a coin that exists, and never move further than half a coin
  // to get there.
  it('never produces an amount the drawer cannot pay out', () => {
    for (let fils = 0; fils <= 10_000; fils++) {
      const rounded = roundChange(fils / 1000);
      expect(Math.round(rounded * 1000) % 5).toBe(0);
      expect(Math.abs(rounded - fils / 1000)).toBeLessThanOrEqual(
        CASH_ROUNDING_UNIT / 2 + 1e-9
      );
    }
  });

  it('does not drift through float arithmetic', () => {
    // The naive float form of this rule returns 1.6649999999999998, which
    // formats as 1.664 — a coin that does not exist.
    expect(roundChange(5 - 3.335)).toBeCloseTo(1.665, 6);
    expect(roundChange(1.667).toFixed(3)).toBe('1.665');
  });

  it('agrees with the documented formula', () => {
    for (let fils = 0; fils <= 5000; fils++) {
      const raw = fils / 1000;
      const documented =
        Math.round(raw / CASH_ROUNDING_UNIT) * CASH_ROUNDING_UNIT;
      expect(roundChange(raw)).toBeCloseTo(documented, 6);
    }
  });
});

describe('computeChangeBlock', () => {
  it('returns the block for an ordinary cash sale', () => {
    const block = computeChangeBlock({
      ...CASH,
      grandTotal: 3,
      amountTendered: 5,
    });
    expect(block).toEqual({
      tendered: 5,
      grandTotal: 3,
      rawChange: 2,
      rounding: 0,
      change: 2,
    });
  });

  it('rounds the change and reports what the rounding did', () => {
    const block = computeChangeBlock({
      ...CASH,
      grandTotal: 3.333,
      amountTendered: 5,
    })!;
    // 1.667 owed, 1.665 payable: the two odd fils stay in the drawer.
    expect(block.rawChange).toBeCloseTo(1.667, 6);
    expect(block.change).toBeCloseTo(1.665, 6);
    expect(block.rounding).toBeCloseTo(0.002, 6);
  });

  it('signs the rounding negative when the shop pays the odd fils', () => {
    const block = computeChangeBlock({
      ...CASH,
      grandTotal: 3.337,
      amountTendered: 5,
    })!;
    // 1.663 owed, 1.665 paid out: the shop is 2 fils down, and the slip says so.
    expect(block.rawChange).toBeCloseTo(1.663, 6);
    expect(block.change).toBeCloseTo(1.665, 6);
    expect(block.rounding).toBeCloseTo(-0.002, 6);
  });

  it('keeps the three printed figures adding up', () => {
    for (let fils = 1; fils <= 2000; fils++) {
      const block = computeChangeBlock({
        ...CASH,
        grandTotal: 3,
        amountTendered: 3 + fils / 1000,
      })!;
      expect(block.rawChange - block.rounding).toBeCloseTo(block.change, 6);
      // Never more than 2 fils either way — the whole point of a 5 fils unit.
      expect(Math.abs(block.rounding)).toBeLessThanOrEqual(0.002 + 1e-9);
    }
  });

  it('never rounds the bill itself', () => {
    const block = computeChangeBlock({
      ...CASH,
      grandTotal: 3.333,
      amountTendered: 5,
    })!;
    expect(block.grandTotal).toBeCloseTo(3.333, 6);
    expect(block.tendered).toBeCloseTo(5, 6);
  });

  it('is silent unless the branch has switched it on', () => {
    expect(
      computeChangeBlock({
        paymentSlug: 'cash',
        enabled: false,
        grandTotal: 3,
        amountTendered: 5,
      })
    ).toBeNull();
  });

  it('is silent on anything but cash', () => {
    for (const paymentSlug of ['knet', 'visa', 'card', 'online', 'link']) {
      expect(
        computeChangeBlock({
          ...CASH,
          paymentSlug,
          grandTotal: 3,
          amountTendered: 5,
        })
      ).toBeNull();
    }
  });

  it('is silent when no tender was recorded', () => {
    for (const amountTendered of [null, undefined, 0, NaN]) {
      expect(
        computeChangeBlock({ ...CASH, grandTotal: 3, amountTendered })
      ).toBeNull();
    }
  });

  it('is silent on an exact payment rather than printing Change 0.000', () => {
    expect(
      computeChangeBlock({ ...CASH, grandTotal: 3.25, amountTendered: 3.25 })
    ).toBeNull();
  });

  /**
   * 2 fils over the bill: there is no coin for it, so the customer gets
   * nothing back and the shop is 2 fils up.
   *
   * The block still prints. This is not the "exact payment" the contract says
   * to omit — the customer did hand over more — and a slip reading
   * 5.000 / Rounding 0.002 / Change 0.000 says where the 2 fils went, which
   * silence does not.
   */
  it('keeps the block when the change rounds away to nothing', () => {
    const block = computeChangeBlock({
      ...CASH,
      grandTotal: 4.998,
      amountTendered: 5,
    })!;
    expect(block.rawChange).toBeCloseTo(0.002, 6);
    expect(block.change).toBe(0);
    expect(block.rounding).toBeCloseTo(0.002, 6);
  });

  it('is silent on a short tender — that is a partial payment', () => {
    expect(
      computeChangeBlock({ ...CASH, grandTotal: 5, amountTendered: 3 })
    ).toBeNull();
  });
});

/**
 * The backend's own verified boundary table, reproduced exactly.
 *
 * Both ends derive the change independently from the same tender, so nothing
 * fails loudly when they drift — the slip in the customer's hand and the copy
 * in the back office simply disagree by a few fils. This table is the contract
 * between them: the backend pins the same rows, and a change to the guard or
 * the sign on either side breaks one of these first.
 *
 * Fixed 2 September 2026: the server's guard was `raw >= 0.005`, one whole
 * rounding unit, which swallowed exactly the 1–4 fils overpayments — the only
 * ones that can round to zero, and so the only ones that need explaining. It
 * is now `raw >= 0.0005`, which is this build's "any overpayment at all".
 */
describe('agreement with the server', () => {
  const CASES: {
    total: number;
    tender: number;
    raw: number;
    change: number;
    rounding: number;
    prints: boolean;
  }[] = [
    { total: 4.998, tender: 5, raw: 0.002, change: 0, rounding: 0.002, prints: true },
    { total: 4.999, tender: 5, raw: 0.001, change: 0, rounding: 0.001, prints: true },
    { total: 4.997, tender: 5, raw: 0.003, change: 0.005, rounding: -0.002, prints: true },
    { total: 3, tender: 5, raw: 2, change: 2, rounding: 0, prints: true },
    { total: 5, tender: 5, raw: 0, change: 0, rounding: 0, prints: false },
    { total: 5, tender: 4, raw: -1, change: 0, rounding: 0, prints: false },
  ];

  it.each(CASES)(
    'total $total tendered $tender → prints: $prints',
    ({ total, tender, raw, change, rounding, prints }) => {
      const block = computeChangeBlock({
        ...CASH,
        grandTotal: total,
        amountTendered: tender,
      });

      if (!prints) {
        expect(block).toBeNull();
        return;
      }

      expect(block!.rawChange).toBeCloseTo(raw, 6);
      expect(block!.change).toBeCloseTo(change, 6);
      expect(block!.rounding).toBeCloseTo(rounding, 6);
    }
  );

  /**
   * The sign convention, stated as the backend states it: change = raw −
   * rounding. A positive rounding is fils the shop kept, a negative one is
   * fils the shop handed over. Flipping it would still satisfy every
   * magnitude assertion above, so it is asserted on its own.
   */
  it('holds change = raw − rounding, the agreed sign', () => {
    for (const { total, tender, prints } of CASES) {
      if (!prints) continue;
      const block = computeChangeBlock({
        ...CASH,
        grandTotal: total,
        amountTendered: tender,
      })!;
      expect(block.rawChange - block.rounding).toBeCloseTo(block.change, 6);
    }
  });

  /**
   * The live payment catalogue, confirmed 2 September 2026. It is one global
   * table — web_payment_methods has no branch_id — so "which methods are cash"
   * is not a per-branch question and cannot become one.
   *
   * The two ends do not share a rule: the till matches the slug, the server
   * keys on legacy_code == 0, because an order row carries only the numeric
   * code. Both select exactly one method today. They would diverge the moment
   * a cash-shaped slug is added with a non-zero code — this till would capture
   * a tender the server discards, and print change where the web receipt
   * prints none. The backend has the mirror of this test.
   */
  it('classifies the live catalogue the way the server does', () => {
    const catalogue: { slug: string; legacyCode: number }[] = [
      { slug: 'cash', legacyCode: 0 },
      { slug: 'knet', legacyCode: 1 },
      { slug: 'online', legacyCode: 2 },
      { slug: 'talabat', legacyCode: 3 },
      { slug: 'keeta', legacyCode: 4 },
      { slug: 'delivero', legacyCode: 5 },
      { slug: 'snoonu', legacyCode: 6 },
      { slug: 'jaheez', legacyCode: 7 },
    ];

    for (const { slug, legacyCode } of catalogue) {
      expect([slug, isCashPayment(slug)]).toEqual([slug, legacyCode === 0]);
    }
  });
});

describe('isTenderable', () => {
  it('accepts amounts that can be made from real coins and notes', () => {
    for (const n of [0.005, 0.25, 0.5, 0.755, 1, 3.25, 20]) {
      expect(isTenderable(n)).toBe(true);
    }
  });

  /**
   * The bug this guard exists for: the capture field stepped in 1 fils, so the
   * spinner offered 0.005 → 0.006 → 0.007 against a 0.500 bill. There is no
   * 1 or 2 fils coin in Kuwait; none of those amounts can be handed over.
   */
  it('rejects amounts no combination of coins can make', () => {
    for (const n of [0.001, 0.003, 0.007, 0.501, 3.333]) {
      expect(isTenderable(n)).toBe(false);
    }
  });

  it('rejects nothing-at-all rather than treating it as valid', () => {
    for (const n of [0, -5, null, undefined, NaN]) {
      expect(isTenderable(n as any)).toBe(false);
    }
  });
});

describe('suggestTenders', () => {
  /** What a customer physically hands over for a half-dinar bill. */
  it('offers the exact money, then the notes above it', () => {
    expect(suggestTenders(0.5)).toEqual([0.5, 1, 5, 10]);
  });

  /**
   * Nobody hands 4.000 for a 3.250 bill — there is no 4 KD note, and the
   * customer reaches for the 5 in their wallet. An earlier version offered the
   * "next whole dinar" here, which is increment thinking, not money thinking.
   */
  it('never invents an amount that is not a note', () => {
    expect(suggestTenders(3.25)).toEqual([3.25, 5, 10, 20]);
    expect(suggestTenders(0.75)).toEqual([0.75, 1, 5, 10]);
    expect(suggestTenders(1.2)).toEqual([1.2, 5, 10, 20]);
  });

  /**
   * A bill that is not itself payable in coins. "Exact" has to round UP to the
   * nearest 5 fils — offering 3.333 would put an impossible amount on a button.
   */
  it('rounds the exact button up to something payable', () => {
    const [exact] = suggestTenders(3.333);
    expect(exact).toBe(3.335);
    expect(isTenderable(exact)).toBe(true);
  });

  /** Past the 20 KD note, people hand over stacks of them. */
  it('builds stacks of big notes above the largest one', () => {
    expect(suggestTenders(21)).toEqual([21, 25, 30, 40]);
    expect(suggestTenders(45)).toEqual([45, 50, 60]);
  });

  it('only ever offers real money that covers the bill', () => {
    const notes = [0.25, 0.5, 1, 5, 10, 20];
    for (const total of [0.5, 0.75, 3.25, 7.999, 12.5, 21, 45]) {
      const [exact, ...rest] = suggestTenders(total);
      expect(exact).toBeGreaterThanOrEqual(total);
      expect(isTenderable(exact)).toBe(true);
      for (const s of rest) {
        expect(s).toBeGreaterThan(total);
        // Either a single note, or a whole number of 5s, 10s or 20s.
        const isNote = notes.includes(s);
        const isStack = [5, 10, 20].some((u) => Math.round(s * 1000) % (u * 1000) === 0);
        expect(isNote || isStack).toBe(true);
      }
    }
  });

  it('does not repeat the exact amount as a note', () => {
    // 1.000 is exact AND a note; it must appear once, as "Exact".
    expect(suggestTenders(1)).toEqual([1, 5, 10, 20]);
  });

  it('has nothing to suggest for an empty bill', () => {
    expect(suggestTenders(0)).toEqual([]);
    expect(suggestTenders(NaN)).toEqual([]);
  });
});

describe('tenderForWire', () => {
  it('sends a real tender', () => {
    expect(tenderForWire(5, 3)).toBe(5);
  });

  it('sends an exact payment — the server still records the tender', () => {
    expect(tenderForWire(3, 3)).toBe(3);
  });

  it('omits rather than sending 0, which reads as "paid nothing"', () => {
    expect(tenderForWire(0, 3)).toBeNull();
    expect(tenderForWire(null, 3)).toBeNull();
    expect(tenderForWire(undefined, 3)).toBeNull();
  });

  it('omits a short tender, which the server discards anyway', () => {
    expect(tenderForWire(3, 5)).toBeNull();
  });
});

describe('isCashPayment', () => {
  it.each(['cash', 'CASH', 'cash_kd', 'cash-counter', 'petty_cash'])(
    'treats %s as cash',
    (slug) => expect(isCashPayment(slug)).toBe(true)
  );

  it.each(['knet', 'visa', 'card', 'cashew', 'online', '', null, undefined])(
    'does not treat %s as cash',
    (slug) => expect(isCashPayment(slug)).toBe(false)
  );
});

/**
 * The backend's own verified boundary table, 1 September 2026, reproduced
 * exactly. Their guard was `raw >= 0.005` and is now `raw >= 0.0005`, which is
 * what lets the 1–4 fils overpayments through — the only ones that can round
 * to zero change, and so the only ones that need a slip to explain them.
 *
 * The sign convention was agreed in the same exchange and is stated here as an
 * identity rather than left implicit in the numbers:
 *
 *     change = raw - rounding
 *
 * Positive rounding = fils the shop kept. Negative = fils the shop handed over
 * out of its own pocket. Anyone who "fixes" that sign breaks these rows, which
 * is the point of writing them down.
 */
describe('agreement with the server', () => {
  const ROWS = [
    { total: 4.998, tender: 5, raw: 0.002, change: 0, rounding: 0.002 },
    { total: 4.999, tender: 5, raw: 0.001, change: 0, rounding: 0.001 },
    { total: 4.997, tender: 5, raw: 0.003, change: 0.005, rounding: -0.002 },
    { total: 3, tender: 5, raw: 2, change: 2, rounding: 0 },
  ];

  it.each(ROWS)('$total paid with $tender', (row) => {
    const block = computeChangeBlock({
      ...CASH,
      grandTotal: row.total,
      amountTendered: row.tender,
    });

    expect(block).not.toBeNull();
    expect(block!.rawChange).toBeCloseTo(row.raw, 6);
    expect(block!.change).toBeCloseTo(row.change, 6);
    expect(block!.rounding).toBeCloseTo(row.rounding, 6);
    expect(block!.rawChange - block!.rounding).toBeCloseTo(block!.change, 6);
  });

  it.each([
    { total: 5, tender: 5, why: 'an exact payment' },
    { total: 5, tender: 4, why: 'a short tender' },
  ])('stays silent on $why', (row) => {
    expect(
      computeChangeBlock({
        ...CASH,
        grandTotal: row.total,
        amountTendered: row.tender,
      })
    ).toBeNull();
  });
});
