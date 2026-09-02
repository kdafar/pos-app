import axios from 'axios';
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

const {
  addonsToCsv,
  classifyAuthFailure,
  countTenders,
  extractPaymentMethod,
  isTerminalLocalOrder,
  normalizeAppVersion,
  normOrderSeed,
  normPullLine,
  normPullOrder,
} = await import('./sync');

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

/**
 * The back office decides which tills are too old to enforce a feature gate
 * by running these through PHP's version_compare. A malformed string does not
 * fail loudly there — it sorts wrong and mis-gates a live till.
 */
describe('normalizeAppVersion', () => {
  it('passes a bare semver through untouched', () => {
    expect(normalizeAppVersion('0.4.22')).toBe('0.4.22');
    expect(normalizeAppVersion('0.4.8')).toBe('0.4.8');
  });

  it('strips a leading v, which version_compare sorts wrong', () => {
    expect(normalizeAppVersion('v0.4.22')).toBe('0.4.22');
    expect(normalizeAppVersion('V0.4.22')).toBe('0.4.22');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeAppVersion('  0.4.22 ')).toBe('0.4.22');
  });

  it('keeps a prerelease suffix rather than promoting a beta to a release', () => {
    // Trimming this would put a beta in the field wearing a release number,
    // which is worse than sorting oddly.
    expect(normalizeAppVersion('0.4.23-beta.1')).toBe('0.4.23-beta.1');
  });

  it('survives an empty or absent version without throwing', () => {
    expect(normalizeAppVersion('')).toBe('');
    expect(normalizeAppVersion(undefined as any)).toBe('');
  });
});

/**
 * Every order this till rings up is pushed with `payment.method_slug` and
 * `payments[].method`, so the backend holds the method — but neither feed's
 * normaliser read it on the way back, which is why a live till had 100+ orders
 * printing as "Unknown" on the closing report. The down-feed key is not
 * documented, so every plausible shape is accepted.
 */
describe('extractPaymentMethod', () => {
  it('reads the flat columns the local schema uses', () => {
    expect(
      extractPaymentMethod({
        payment_method_id: '1',
        payment_method_slug: 'cash',
      })
    ).toEqual({ payment_method_id: '1', payment_method_slug: 'cash' });
  });

  it('reads the nested shape the till itself pushes', () => {
    expect(
      extractPaymentMethod({ payment: { method_id: 2, method_slug: 'knet' } })
    ).toEqual({ payment_method_id: '2', payment_method_slug: 'knet' });
  });

  it('reads a payments[] tender line', () => {
    expect(
      extractPaymentMethod({ payments: [{ method: 'cash', amount: 3 }] })
    ).toEqual({ payment_method_id: null, payment_method_slug: 'cash' });
  });

  it('reads a payment_method object and a bare payment_method string', () => {
    expect(
      extractPaymentMethod({ payment_method: { id: 3, slug: 'online' } })
    ).toEqual({ payment_method_id: '3', payment_method_slug: 'online' });
    expect(extractPaymentMethod({ payment_method: 'talabat' })).toEqual({
      payment_method_id: null,
      payment_method_slug: 'talabat',
    });
  });

  it('returns nulls rather than empty strings when nothing is there', () => {
    // NULL is what lets the upsert's COALESCE keep the value this till already
    // knows; '' would overwrite a real method with a blank.
    for (const payload of [{}, { payment: {} }, { payment_method_slug: '  ' }]) {
      expect(extractPaymentMethod(payload)).toEqual({
        payment_method_id: null,
        payment_method_slug: null,
      });
    }
  });

  it('never stringifies an object into the column', () => {
    const out = extractPaymentMethod({ payment_method_id: { nested: true } });
    expect(out.payment_method_id).toBeNull();
    expect(JSON.stringify(out)).not.toContain('object Object');
  });

  /**
   * The exact block SyncController.php returns, verified against branch 7 on
   * 2026-08-31: paymentPayload() emits {method_id, method_slug, type} on
   * /bootstrap orders_seed, /pull changes[].data and /orders/{id}, or null.
   * If the backend ever reshapes this, this test is what says so.
   */
  it('reads the block the Laravel backend actually sends', () => {
    expect(
      extractPaymentMethod({
        id: 433,
        payment_type: 0,
        payment: { method_id: 1, method_slug: 'cash', type: 0 },
      })
    ).toEqual({ payment_method_id: '1', payment_method_slug: 'cash' });

    // A code with no catalogue row comes down as null, and null must leave
    // whatever this till already knows untouched.
    expect(extractPaymentMethod({ id: 9, payment: null })).toEqual({
      payment_method_id: null,
      payment_method_slug: null,
    });
  });

  it('puts the method onto the normalised pull row', () => {
    const row = normPullOrder({
      id: '1',
      number: 'A-1',
      customer: {},
      totals: {},
      payment: { method_slug: 'knet', method_id: 2 },
    });
    expect(row.payment_method_slug).toBe('knet');
    expect(row.payment_method_id).toBe('2');
  });
});

/**
 * The POS credits a whole order to one method. That is right if a sale is
 * always settled one way and quietly wrong if it is not — 5 cash + the rest on
 * KNET would post the lot to cash. Nobody could say for certain whether this
 * shop splits payments, so the till counts them and says so rather than
 * guessing either way.
 */
describe('countTenders', () => {
  it('counts one method however it was sent', () => {
    expect(countTenders({ payments: [{ method: 'cash', amount: 5 }] })).toBe(1);
    // Two lines, one method (a part payment) is still a single method.
    expect(
      countTenders({
        payments: [
          { method: 'cash', amount: 5 },
          { method: 'cash', amount: 2 },
        ],
      })
    ).toBe(1);
  });

  it('spots a genuine split', () => {
    expect(
      countTenders({
        payments: [
          { method: 'cash', amount: 5 },
          { method: 'knet', amount: 7.5 },
        ],
      })
    ).toBe(2);
  });

  it('is unbothered by an absent or malformed payments array', () => {
    for (const payload of [
      {},
      { payments: null },
      { payments: [] },
      { payments: [{}, { amount: 3 }] },
      { payment: { method_slug: 'cash' } },
    ]) {
      expect(countTenders(payload)).toBe(0);
    }
  });

  it('ignores case and padding, which two feeds disagree on', () => {
    expect(
      countTenders({
        payments: [{ method: 'Cash' }, { method: ' cash ' }],
      })
    ).toBe(1);
  });
});

/**
 * The seed feed is how most server orders enter a till. It has always sent
 * branch_id and the normaliser never read it, so every seeded order landed
 * branch-less — and the closing report, which deliberately keeps branch-less
 * rows, counted another branch's orders into this branch's takings.
 */
describe('normOrderSeed', () => {
  it('keeps the branch the order belongs to', () => {
    const row = normOrderSeed({
      id: '433',
      number: 'POS-1-ABC',
      branch_id: 1,
      grand_total: 12.5,
      payment: { method_id: 1, method_slug: 'cash', type: 0 },
    });

    expect(row.branch_id).toBe(1);
    expect(row.payment_method_slug).toBe('cash');
  });

  it('leaves branch_id null when the server omits it, so nothing is invented', () => {
    expect(normOrderSeed({ id: '1', number: 'A' }).branch_id).toBeNull();
  });
});

/**
 * The response interceptor used to delete the device token and blank device_id
 * on every 401 and 403, so one rejected request unpaired the till for good —
 * the reinstall complaint, where the first sync on a new build met a refusal
 * and the cashier was handed the Pair screen.
 *
 * Every body below is the backend's verbatim answer to §2.1 of
 * docs/BACKEND-pairing-recovery.md, taken off the live server. Exactly one of
 * them may unpair a till.
 */
describe('classifyAuthFailure', () => {
  const rejected = (status: number, data: unknown = {}) =>
    new axios.AxiosError('rejected', 'ERR_BAD_REQUEST', undefined, undefined, {
      status,
      data,
      statusText: '',
      headers: {},
      config: {} as any,
    } as any);

  it('unpairs on a revoke, the one permanent refusal', () => {
    expect(
      classifyAuthFailure(
        rejected(401, { code: 'POS_DEVICE_REVOKED', message: 'Device revoked' })
      )
    ).toBe('revoked');
  });

  it('unpairs when a revoke is met while pairing', () => {
    expect(
      classifyAuthFailure(
        rejected(403, {
          code: 'POS_PAIR_DEVICE_REVOKED',
          message: 'Device revoked',
        })
      )
    ).toBe('revoked');
  });

  /**
   * The backend fixed this on their side: an unknown device used to answer
   * POS_DEVICE_REVOKED. A missing row most often means the till is pointed at
   * the wrong base_url or at a restored database — not that anyone revoked it.
   */
  it.each([
    ['POS_DEVICE_UNKNOWN', 'Unknown device', 401],
    ['POS_TOKEN_INVALID', 'Invalid token', 401],
    ['POS_AUTH_MISSING', 'Unauthorized', 401],
    ['POS_RECLAIM_DISABLED', 'Self-service re-pairing is not enabled', 403],
    ['POS_RECLAIM_MACHINE_MISMATCH', 'This machine is not the one', 403],
  ])('keeps the pairing on %s', (code, message, status) => {
    expect(classifyAuthFailure(rejected(status, { code, message }))).toBe(
      'unauthorized'
    );
  });

  /**
   * The property the backend committed to: POS_DEVICE_REVOKED is the only
   * device-auth response that may unpair. A code, once present, is never
   * second-guessed by the message — otherwise a reworded body could quietly
   * reintroduce the bug.
   */
  it('lets the code override even a message that says revoked', () => {
    expect(
      classifyAuthFailure(
        rejected(401, {
          code: 'POS_DEVICE_UNKNOWN',
          message: 'Unknown device (previously revoked)',
        })
      )
    ).toBe('unauthorized');
  });

  it('falls back to the message only on a server too old to send a code', () => {
    expect(classifyAuthFailure(rejected(401, { message: 'Device revoked' }))).toBe(
      'revoked'
    );
    expect(classifyAuthFailure(rejected(401, { message: 'Invalid token' }))).toBe(
      'unauthorized'
    );
    expect(classifyAuthFailure(rejected(401, {}))).toBe('unauthorized');
    // A WAF or proxy answering instead of the API — no JSON body at all.
    expect(classifyAuthFailure(rejected(403, '<html>403 Forbidden</html>'))).toBe(
      'unauthorized'
    );
  });

  it('says nothing about statuses that are not an auth rejection', () => {
    // 423 is a lock and 404 is "not your order" — both survivable, and neither
    // this function's business.
    for (const status of [404, 423, 429, 500, 200]) {
      expect(
        classifyAuthFailure(
          rejected(status, { code: 'POS_DEVICE_REVOKED', message: 'revoked' })
        ),
        String(status)
      ).toBeNull();
    }
  });

  it('says nothing about a network failure with no response at all', () => {
    expect(classifyAuthFailure(new Error('ECONNREFUSED'))).toBeNull();
    expect(classifyAuthFailure(undefined)).toBeNull();
  });
});
