import { describe, expect, it, vi } from 'vitest';

// The module opens the SQLite database at import time; the two classifiers
// under test are pure and touch none of it.
vi.mock('../db', () => ({ default: {} }));

const {
  isSold,
  isCancelled,
  rowMoney,
  classifyRow,
  clampRangeToWindow,
  soldFilterSql,
} = await import('./reports_operational');

/**
 * These two functions decide what a shop's daily takings are. Every case below
 * is one that was previously counted wrong, and each wrong answer moved real
 * money in the report.
 */
describe('isCancelled', () => {
  it('catches every form a cancellation actually arrives in', () => {
    // The old exact-match list had only the first three. The rest fell through
    // to isSold() and were reported as revenue — a cancelled order counted as
    // a sale is the worst direction for this bug to fail in.
    for (const status of [
      'cancelled',
      'canceled',
      'rejected',
      'cancelled_client', // local, ORDER_STATUS.CANCELLED_CLIENT
      'cancelled by customer', // server status_code 5
      'cancelled by admin', // server status_code 6
      'rejected (auto)', // server status_code 8
    ]) {
      expect(isCancelled({ status }), status).toBe(true);
    }
  });

  it('uses the server status code when the label is missing or unknown', () => {
    for (const status_code of [5, 6, 8, 9]) {
      expect(isCancelled({ status: '', status_code }), String(status_code)).toBe(true);
    }
    for (const status_code of [0, 1, 2, 3, 4, 7]) {
      expect(isCancelled({ status: '', status_code }), String(status_code)).toBe(false);
    }
  });

  it('leaves live orders alone', () => {
    for (const status of ['open', 'placed', 'preparing', 'ready', 'done', 'closed']) {
      expect(isCancelled({ status }), status).toBe(false);
    }
  });
});

describe('isSold', () => {
  it('does not count a ticket the cashier has not put through', () => {
    // The regression: isSold was `grand_total > 0`, because the paid_at and
    // completed_at columns it checked first are selected as literal NULL.
    // A ticket sitting on screen with items on it was reported as revenue.
    for (const status of ['open', 'pending', 'draft', 'pending payment']) {
      expect(isSold({ status, grand_total: 12.8 }), status).toBe(false);
    }
  });

  it('counts an order that has been put through', () => {
    for (const status of ['placed', 'preparing', 'ready', 'done', 'closed', 'completed']) {
      expect(isSold({ status, grand_total: 12.8 }), status).toBe(true);
    }
  });

  it('never counts a zero or missing total as a sale', () => {
    expect(isSold({ status: 'closed', grand_total: 0 })).toBe(false);
    expect(isSold({ status: 'closed', grand_total: null })).toBe(false);
    expect(isSold({ status: 'closed' })).toBe(false);
  });

  it('is case- and whitespace-tolerant, because the status comes from two sources', () => {
    // Local code writes lowercase; the server seed writes labels through
    // mapServerStatus. Neither guarantees the exact casing.
    expect(isSold({ status: ' Open ', grand_total: 5 })).toBe(false);
    expect(isCancelled({ status: ' Cancelled ' })).toBe(true);
  });
});

describe('rowMoney', () => {
  /**
   * The footer prints gross, discount, delivery and net as four independent
   * sums. They are only trustworthy if every row obeys one invariant, so this
   * is asserted on every shape a row arrives in rather than spot-checked.
   */
  const addsUp = (r: any) => {
    const m = rowMoney(r);
    expect(+(m.gross - m.discount + m.delivery).toFixed(3), JSON.stringify(r)).toBe(
      +m.net.toFixed(3)
    );
    return m;
  };

  it('uses the stored subtotal when the till calculated the row', () => {
    // subtotal 12.800 - 0 discount + 2.000 delivery = 14.800
    const m = addsUp({ subtotal: 12.8, discount_total: 0, delivery_fee: 2, grand_total: 14.8 });
    expect(m.gross).toBe(12.8);
    expect(m.delivery).toBe(2);
  });

  it('backs gross out of the total when subtotal is missing', () => {
    // A server-seeded lookup row: grand_total and nothing else. Gross must be
    // grand_total MINUS delivery. Substituting grand_total straight in — the
    // bug this test exists for — counts the 2.000 delivery fee inside gross
    // and again in the delivery line, inflating the printed report by 2.000
    // while net stays right, so the footer silently stops adding up.
    const m = addsUp({ subtotal: null, discount_total: 0, delivery_fee: 2, grand_total: 14.8 });
    expect(m.gross).toBe(12.8);
    expect(m.delivery).toBe(2);
  });

  it('holds the invariant with a discount as well', () => {
    const m = addsUp({ subtotal: null, discount_total: 1.5, delivery_fee: 2, grand_total: 13.3 });
    expect(m.gross).toBe(12.8);
  });

  it('reads discount_amount when discount_total is absent', () => {
    const m = rowMoney({ subtotal: 10, discount_amount: 1, delivery_fee: 0, grand_total: 9 });
    expect(m.discount).toBe(1);
    addsUp({ subtotal: 10, discount_amount: 1, delivery_fee: 0, grand_total: 9 });
  });

  it('treats every missing column as zero rather than NaN', () => {
    // A NaN here poisons the whole footer sum, turning the day's takings into
    // a blank. Nulls are normal on seeded rows.
    const m = rowMoney({});
    expect(m).toEqual({ gross: 0, discount: 0, delivery: 0, net: 0 });
    for (const v of Object.values(rowMoney({ subtotal: null, grand_total: null }))) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});

describe('classifyRow', () => {
  /**
   * The table highlights what this returns and the footer counts it. They read
   * the same decision, so a row can never be highlighted as skipped while the
   * totals quietly include it.
   */
  it('puts a real sale in the sale bucket', () => {
    expect(classifyRow({ status: 'closed', grand_total: 12.8 })).toEqual({
      counted: 'sale',
    });
  });

  it('counts a cancellation as cancelled, never as an uncounted row', () => {
    // Order matters: cancelled is checked first. A cancelled order with a
    // positive total would otherwise land in the sale bucket.
    expect(classifyRow({ status: 'cancelled by admin', grand_total: 12.8 })).toEqual({
      counted: 'cancelled',
    });
  });

  it('separates a ticket not put through from one with no total', () => {
    // Same highlight, different fix — so the badge has to tell them apart.
    expect(classifyRow({ status: 'open', grand_total: 12.8 })).toEqual({
      counted: 'uncounted',
      uncounted_reason: 'not_placed',
    });
    expect(classifyRow({ status: 'closed', grand_total: 0 })).toEqual({
      counted: 'uncounted',
      uncounted_reason: 'no_total',
    });
    expect(classifyRow({ status: 'done' })).toEqual({
      counted: 'uncounted',
      uncounted_reason: 'no_total',
    });
  });

  it('leaves every row in exactly one bucket', () => {
    // This is the property the report footer depends on: sales + cancelled +
    // uncounted must equal the number of rows in the table, which is what the
    // reconciliation line on screen asserts to the reader.
    const rows = [
      { status: 'closed', grand_total: 12.8 },
      { status: 'open', grand_total: 5 },
      { status: 'cancelled', grand_total: 3 },
      { status: 'done', grand_total: 0 },
      { status: 'rejected (auto)', grand_total: 9 },
      { status: 'preparing', grand_total: 7 },
    ];
    const tally = { sale: 0, cancelled: 0, uncounted: 0 };
    for (const r of rows) tally[classifyRow(r).counted] += 1;
    expect(tally.sale + tally.cancelled + tally.uncounted).toBe(rows.length);
    expect(tally).toEqual({ sale: 2, cancelled: 2, uncounted: 2 });
  });

  it('only ever gives a reason for an uncounted row', () => {
    for (const r of [
      { status: 'closed', grand_total: 1 },
      { status: 'cancelled', grand_total: 1 },
    ]) {
      expect(classifyRow(r).uncounted_reason).toBeUndefined();
    }
  });
});

/**
 * A cashier without 'reports.export' sees the shift they are standing in and
 * nothing else. The closing report hid the date controls from them, but the
 * range arrives over IPC — the renderer is not where that rule can live.
 */
describe('clampRangeToWindow', () => {
  const shift = { fromMs: 1_000, toMs: 2_000 };

  it('leaves a range that is already inside the shift exactly as asked', () => {
    expect(clampRangeToWindow(1_200, 1_800, shift)).toEqual({
      fromMs: 1_200,
      toMs: 1_800,
      clamped: false,
    });
  });

  it('pulls a range reaching into previous days back to the shift start', () => {
    expect(clampRangeToWindow(0, 1_500, shift)).toEqual({
      fromMs: 1_000,
      toMs: 1_500,
      clamped: true,
    });
  });

  it('refuses a range that lies entirely outside the shift', () => {
    // Last month collapses to a zero-width window at the shift edge rather
    // than quietly returning last month's takings.
    expect(clampRangeToWindow(-9_000, -8_000, shift)).toEqual({
      fromMs: 1_000,
      toMs: 1_000,
      clamped: true,
    });
  });

  it('clamps a range that swallows the shift on both sides', () => {
    expect(clampRangeToWindow(0, 9_999, shift)).toEqual({
      fromMs: 1_000,
      toMs: 2_000,
      clamped: true,
    });
  });
});

/**
 * The payment breakdown groups in SQL, so it cannot call isSold(). This is the
 * guard that the two definitions stay the same one: the breakdown used to
 * count open and cancelled tickets that the footer's net excluded, so the
 * "By Payment" totals never added up to the report's own bottom line.
 */
describe('soldFilterSql', () => {
  it('excludes every status isSold() refuses', () => {
    const sql = soldFilterSql('s');

    for (const status of ['open', 'pending', 'draft', 'pending payment']) {
      expect(isSold({ status, grand_total: 5 }), status).toBe(false);
      expect(sql, status).toContain(`'${status}'`);
    }
  });

  it('excludes cancellations by label and by server code', () => {
    const sql = soldFilterSql('s', { statusCode: true });

    expect(sql).toContain("NOT LIKE 'cancel%'");
    expect(sql).toContain("NOT LIKE 'reject%'");
    // The same four codes isCancelled() honours.
    for (const code of [5, 6, 8, 9]) {
      expect(isCancelled({ status: '', status_code: code })).toBe(true);
      expect(sql).toMatch(new RegExp(String.raw`NOT IN \([^)]*\b${code}\b`));
    }
  });

  it('requires money on the row, like isSold does', () => {
    expect(soldFilterSql('s')).toContain('COALESCE(s.grand_total, 0) > 0');
    expect(isSold({ status: 'closed', grand_total: 0 })).toBe(false);
  });

  it('only references columns the schema was said to have', () => {
    const bare = soldFilterSql('o');
    expect(bare).not.toContain('status_code');
    expect(bare).not.toContain('is_cancelled');

    const full = soldFilterSql('o', { statusCode: true, isCancelled: true });
    expect(full).toContain('o.status_code');
    expect(full).toContain('o.is_cancelled');
  });

  it('qualifies every column with the caller’s alias', () => {
    const sql = soldFilterSql('x', { statusCode: true, isCancelled: true });
    expect(sql).not.toMatch(/(?<![.\w])status\b(?!_)/);
    expect(sql.match(/\bx\./g)?.length).toBeGreaterThanOrEqual(4);
  });
});
