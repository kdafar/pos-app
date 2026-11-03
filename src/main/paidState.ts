// src/main/paidState.ts
//
// Write the server's `paid` object onto a local order row.
//
// Every feed that carries an order calls this — /pull, the bootstrap
// orders_seed, GET /orders/{id} and both paid endpoints — and it runs where
// the header upsert deliberately does NOT: on orders this till rang up (whose
// header the till owns) and on finalised orders (whose status must not
// regress). Payment is recorded after the fact by design, most often on a
// closed order or on another till's order, so skipping it there would lose
// exactly the marks the feature exists for.
import type BetterSqlite3 from 'better-sqlite3';
import { isCancelledForPaid, isClosedForPaid, normPaid } from '../shared/paid';

type Db = BetterSqlite3.Database;

/**
 * Apply `raw` (the payload's `paid` value) to order `localId`.
 * Returns false and writes nothing when the key was absent — a server without
 * the migration — so the till keeps its inferred badge.
 */
export function applyServerPaid(db: Db, localId: string | null | undefined, raw: unknown): boolean {
  const cols = normPaid(raw);
  if (!cols) return false;
  noteServerRecordsPayment(db);
  if (!localId) return false;

  const order = db
    .prepare(
      `SELECT id, status, status_code, payment_method_id FROM orders WHERE id = ?`
    )
    .get(String(localId)) as
    | { id: string; status: string | null; status_code: number | null; payment_method_id: string | null }
    | undefined;
  if (!order) return false;

  const method = cols.paid_method_id
    ? (db
        .prepare(`SELECT id, slug, name_en, name_ar FROM payment_methods WHERE CAST(id AS TEXT) = ?`)
        .get(String(cols.paid_method_id)) as
        | { id: string; slug: string | null; name_en: string | null; name_ar: string | null }
        | undefined)
    : undefined;

  db.prepare(
    `UPDATE orders
        SET paid_status         = @paid_status,
            paid_how            = @paid_how,
            paid_time           = @paid_time,
            paid_by_id          = @paid_by_id,
            paid_by_name        = @paid_by_name,
            paid_amount         = @paid_amount,
            paid_method_id      = @paid_method_id,
            paid_reference      = @paid_reference,
            paid_method_name    = @paid_method_name,
            paid_method_name_ar = @paid_method_name_ar,
            paid_link_open      = @paid_link_open
      WHERE id = @id`
  ).run({
    ...cols,
    paid_method_name: method?.name_en ?? method?.slug ?? null,
    paid_method_name_ar: method?.name_ar ?? null,
    id: order.id,
  });

  // §5: a hand mark on an OPEN order changes the order's payment method on the
  // server. Follow it here, or the till's next re-push of its own order would
  // send the old method back and quietly undo the change. synced_at is left
  // alone: the server already holds this method, so there is nothing to send.
  // Closed orders cannot differ (the server refuses with
  // POS_PAID_METHOD_LOCKED), and an unknown method id is left for the
  // payment-method backfill rather than written as a bare number.
  if (
    cols.paid_how === 'by_hand' &&
    method &&
    String(order.payment_method_id ?? '') !== String(method.id) &&
    !isClosedForPaid(order.status, order.status_code) &&
    !isCancelledForPaid(order.status, order.status_code)
  ) {
    db.prepare(
      `UPDATE orders SET payment_method_id = ?, payment_method_slug = ? WHERE id = ?`
    ).run(String(method.id), method.slug ?? null, order.id);
  }
  return true;
}

const SUPPORT_KEY = 'paid.supported';

/**
 * Remember that this server sends `paid`, i.e. has the mark-paid endpoints.
 * The button is offered only then: on a server without the migration the
 * endpoint is a bare 404, and a mark queued against it would never land.
 */
function noteServerRecordsPayment(db: Db) {
  // An upsert per order row, deliberately not cached in memory: a wipe
  // (clearRestaurantData) deletes the key, and the next shop's server has to
  // say so again.
  try {
    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`
    ).run(SUPPORT_KEY);
  } catch {
    // No sync_state (tests, half-migrated install): the button just stays off.
  }
}

export function serverRecordsPayment(db: Db): boolean {
  try {
    return (
      db.prepare(`SELECT value FROM sync_state WHERE key = ?`).pluck().get(SUPPORT_KEY) === '1'
    );
  } catch {
    return false;
  }
}
