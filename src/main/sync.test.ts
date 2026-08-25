import { describe, expect, it, vi } from 'vitest';

// sync.ts opens the SQLite database and reaches for Electron at import time;
// the four functions under test are pure and touch neither.
vi.mock('./db', () => ({ default: {}, getMeta: () => null, setMeta: () => {} }));
vi.mock('./secureStore', () => ({
  deleteSecret: () => {},
  loadSecret: () => null,
  saveSecret: () => {},
}));
vi.mock('./imageCache', () => ({ prefetchItemImages: async () => {} }));
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }));

const { addonsToCsv, isTerminalLocalOrder, normPullLine, normPullOrder } =
  await import('./sync');

/**
 * The server refuses to move an order out of DONE / CANCELLED_* / REJECTED_*
 * and answers PUSH_ORDER_FINALIZED. This is the mirror of that rule, and it is
 * what stops an office edit made while a till was offline from reopening a
 * ticket the till already finished.
 */
describe('isTerminalLocalOrder', () => {
  it('holds every status a sale cannot come back out of', () => {
    for (const status_code of [4, 5, 6, 8, 9]) {
      expect(isTerminalLocalOrder({ status_code }), String(status_code)).toBe(
        true
      );
    }
  });

  it('lets a live order through', () => {
    for (const status_code of [0, 1, 2, 3, 7]) {
      expect(isTerminalLocalOrder({ status_code }), String(status_code)).toBe(
        false
      );
    }
  });

  it('reads the local word vocabulary too, not just server codes', () => {
    // Locally-rung orders carry strings and no status_code at all.
    for (const status of [
      'completed',
      'cancelled',
      'canceled',
      'closed',
      'done',
      'cancelled by admin',
      'rejected (auto)',
    ]) {
      expect(isTerminalLocalOrder({ status }), status).toBe(true);
    }
    for (const status of ['open', 'preparing', 'ready', 'draft']) {
      expect(isTerminalLocalOrder({ status }), status).toBe(false);
    }
  });

  it('treats a missing row as not terminal, so a new order still applies', () => {
    expect(isTerminalLocalOrder(null)).toBe(false);
    expect(isTerminalLocalOrder({})).toBe(false);
  });
});

/**
 * /pull sends add-ons already parsed; the local columns and the renderer that
 * reads them hold the server's five parallel CSVs. A pulled line has to be
 * indistinguishable from one this till rang up.
 */
describe('addonsToCsv', () => {
  it('folds parsed add-ons back into positionally-aligned CSVs', () => {
    expect(
      addonsToCsv([
        { id: 12, name: 'Cheese', price: '0.500', qty: 1 },
        { id: 15, name: 'Bacon', price: '0.750', qty: 2 },
      ])
    ).toEqual({
      addons_id: '12,15',
      addons_name: 'Cheese,Bacon',
      addons_price: '0.500,0.750',
      addons_qty: '1,2',
    });
  });

  it('keeps positions aligned when one add-on is missing a field', () => {
    // A hole must stay a hole: dropping it would shift every later add-on onto
    // the wrong price.
    const csv = addonsToCsv([
      { id: 1, name: 'A', price: '0.100', qty: 1 },
      { id: 2, name: 'B', qty: 3 },
    ]);
    expect(csv.addons_price).toBe('0.100,');
    expect(csv.addons_qty).toBe('1,3');
  });

  it('writes NULL rather than empty strings for a line with no add-ons', () => {
    for (const empty of [[], null, undefined]) {
      expect(addonsToCsv(empty)).toEqual({
        addons_id: null,
        addons_name: null,
        addons_price: null,
        addons_qty: null,
      });
    }
  });
});

describe('normPullOrder', () => {
  const payload = {
    id: 464,
    number: 'POS-5-7JF6HMDV',
    reference_number: '0042',
    branch_id: 5,
    order_type: 1,
    status: 2,
    payment_type: 1,
    customer: { full_name: 'Sara', mobile: '55512345', email: null },
    totals: {
      subtotal: 3.5,
      discount: 0.25,
      discount_pr: 0,
      delivery_fee: 0.4,
      grand_total: 3.9,
      promocode: 'WELCOME',
    },
    created_at: '2026-08-25 11:32:09',
    created_at_ms: 1787657529000,
  };

  it('flattens customer and totals into the local column names', () => {
    const row = normPullOrder(payload);
    expect(row.full_name).toBe('Sara');
    expect(row.mobile).toBe('55512345');
    expect(row.subtotal).toBe(3.5);
    expect(row.discount_amount).toBe(0.25);
    expect(row.delivery_fee).toBe(0.4);
    expect(row.grand_total).toBe(3.9);
    expect(row.promocode).toBe('WELCOME');
  });

  it('splits the numeric server status into label and code', () => {
    // Writing the raw number into `status` is what surfaced as "2.0" in the UI.
    const row = normPullOrder(payload);
    expect(row.status).toBe('preparing');
    expect(row.status_code).toBe(2);
  });

  it('prefers created_at_ms, which the bare MySQL datetime cannot give', () => {
    // "2026-08-25 11:32:09" is not ISO 8601; strict parsers fall to epoch zero,
    // which is where the 1970 dates came from.
    expect(normPullOrder(payload).opened_at).toBe(1787657529000);
  });

  it('carries the branch the seed feed never sent', () => {
    expect(normPullOrder(payload).branch_id).toBe(5);
  });

  it('normalises the bare MySQL datetime the feed sends into ISO', () => {
    // orders_seed sends ISO for this same field and locally-rung orders write
    // epoch ms as text. Three formats in one column is how a date filter that
    // casts the column silently drops rows.
    expect(normPullOrder(payload).created_at).toBe('2026-08-25T11:32:09.000Z');
  });

  it('takes the customer keys the server actually sends', () => {
    // Confirmed against a live response: exactly full_name, email, mobile,
    // always present, any may be null. There is no `name` column upstream.
    const row = normPullOrder({
      ...payload,
      customer: { full_name: null, email: null, mobile: null },
    });
    expect(row.full_name).toBe('');
    expect(row.mobile).toBe('');
    expect(row.email).toBeNull();
  });
});

describe('normPullLine', () => {
  const line = {
    id: 465,
    order_id: 464,
    item_id: 88,
    name: 'Kunafa',
    name_ar: 'كنافة',
    qty: 2,
    unit_price: 1.75,
    line_total: 5.0,
    variation_id: 'v9',
    variation: 'Large',
    variation_price: 0.5,
    addons: [{ id: 12, name: 'Cheese', price: '0.500', qty: 1 }],
    item_notes: 'no nuts',
    created_at_ms: 1787657529000,
  };

  it('binds the line to the LOCAL order id, not the server one', () => {
    // order_lines.order_id is an FK to orders(id); using the server id for an
    // order stored under a local UUID throws and poisons the whole pull page.
    expect(normPullLine(line, 'local-uuid-1').order_id).toBe('local-uuid-1');
  });

  it('maps item_notes onto the local notes column', () => {
    expect(normPullLine(line, 'x').notes).toBe('no nuts');
  });

  it('keeps the stored line_total instead of qty x unit_price', () => {
    // 2 x 1.75 = 3.50, but the real total is 5.00 once the add-on is counted.
    // Recomputing here would silently drop add-on money from every line.
    expect(normPullLine(line, 'x').line_total).toBe(5.0);
  });

  it('flattens add-ons into the CSV columns the renderer reads', () => {
    expect(normPullLine(line, 'x').addons_name).toBe('Cheese');
  });

  it('coerces variation_id to a string, since the server column is varchar', () => {
    expect(normPullLine(line, 'x').variation_id).toBe('v9');
    expect(normPullLine({ ...line, variation_id: 9 }, 'x').variation_id).toBe('9');
  });
});
