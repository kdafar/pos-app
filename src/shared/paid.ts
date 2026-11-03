// src/shared/paid.ts
//
// "Mark order paid" (backend contract: Mark order paid, branch feat/mark-paid).
//
// The server records who took the money, how much, by which method and when,
// and sends it back on every order payload as a `paid` object. This module is
// the pure half of that: reading the wire object into local columns, and the
// two rules the till must apply exactly as the server does (the amount
// tolerance and the idempotency key format). No database, no network.

/** Local columns the `paid` object is stored in. All nullable. */
export type PaidColumns = {
  paid_status: 'paid' | 'unpaid';
  paid_how: 'gateway' | 'by_hand' | null;
  /**
   * ISO time of the tap or the provider confirmation.
   *
   * Deliberately NOT named `paid_at`: the closing report picks its timestamp
   * column by probing for `completed_at`, then `paid_at`, and adding a
   * `paid_at` column would silently move every order in the report onto its
   * payment time — the very change the contract's open question 4 says not to
   * make yet.
   */
  paid_time: string | null;
  paid_by_id: number | null;
  paid_by_name: string | null;
  paid_amount: number | null;
  paid_method_id: string | null;
  /** The slip reference from the card machine (KNET marks); up to 64 chars. */
  paid_reference: string | null;
  paid_link_open: 0 | 1;
};

/**
 * Read `order.paid` off a server payload.
 *
 * Returns `undefined` when the key is absent: a server without the migration
 * sends no `paid` at all, which means "this server does not record payment",
 * and the till must keep today's inferred badge rather than write "unpaid".
 * A present-but-garbled object is read as unpaid, never as paid — claiming
 * money was taken is the one direction that must not fail open.
 */
export function normPaid(raw: unknown): PaidColumns | undefined {
  if (raw === undefined) return undefined;
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;

  const paid = String(p.status ?? '').trim().toLowerCase() === 'paid';
  const howRaw = String(p.how ?? '').trim().toLowerCase();
  const how = howRaw === 'gateway' || howRaw === 'by_hand' ? howRaw : null;

  const byId = Number(p.paid_by?.id);
  const amount = p.amount == null || p.amount === '' ? NaN : Number(p.amount);
  const text = (v: unknown) => {
    const s = v == null ? '' : String(v).trim();
    return s ? s : null;
  };

  return {
    paid_status: paid ? 'paid' : 'unpaid',
    paid_how: paid ? how : null,
    paid_time: paid ? text(p.paid_at) : null,
    paid_by_id: paid && Number.isFinite(byId) && byId > 0 ? byId : null,
    paid_by_name: paid ? text(p.paid_by?.name) : null,
    paid_amount: paid && Number.isFinite(amount) ? amount : null,
    paid_method_id: paid ? text(p.payment_method_id) : null,
    paid_reference: paid ? text(p.reference) : null,
    paid_link_open: p.link_open ? 1 : 0,
  };
}

/** Longest slip reference the server accepts. */
export const PAID_REFERENCE_MAX = 64;

/**
 * Whether a mark by this method must carry the card-machine slip reference.
 * The server keys on the method's slug (`knet`), never its number: legacy
 * payment codes differ between sites and are being renumbered.
 */
export function paidMethodNeedsReference(slug: unknown): boolean {
  return String(slug ?? '').trim().toLowerCase() === 'knet';
}

/** The server's tolerance: the amount must equal the total within 0.0005. */
export const PAID_AMOUNT_TOLERANCE = 0.0005;

export function paidAmountMatches(amount: unknown, total: unknown): boolean {
  const a = Number(amount);
  const t = Number(total);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return false;
  // A hair of slack on top of the server's own: 4.5 - 4.4995 in binary floats
  // is 0.000500000000000167, which a strict `<=` would refuse while the server
  // (decimal arithmetic) accepts it.
  return Math.abs(a - t) <= PAID_AMOUNT_TOLERANCE + 1e-9;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID: 48-bit millisecond time + 80 random bits, Crockford base32, 26
 * characters. The contract asks for one per tap as the idempotency key.
 * `random` is injectable so tests are deterministic; production passes
 * crypto.getRandomValues-backed bytes.
 */
export function newUlid(
  now: number = Date.now(),
  random: (n: number) => Uint8Array = defaultRandom
): string {
  let time = '';
  let t = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Statuses that mean the order can never be marked paid. */
export function isCancelledForPaid(status: unknown, statusCode: unknown): boolean {
  const code = Number(statusCode);
  if (statusCode != null && statusCode !== '' && [5, 6, 8, 9].includes(code)) return true;
  const s = String(status ?? '').trim().toLowerCase();
  return s.startsWith('cancel') || s.startsWith('reject');
}

/** Closed for the purpose of the method lock (§5) and the report lines (§10). */
export function isClosedForPaid(status: unknown, statusCode: unknown): boolean {
  if (statusCode != null && statusCode !== '' && Number(statusCode) === 4) return true;
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'closed' || s === 'completed' || s === 'done';
}
