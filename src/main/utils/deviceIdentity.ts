// src/main/utils/deviceIdentity.ts
//
// Recovering the one value a broken till needs to re-pair itself.

/** The slice of better-sqlite3 this needs, so a test can stand in for it. */
export type OrdersReader = {
  prepare(sql: string): { pluck(): { get(): unknown } };
};

/**
 * The device id is not only in meta.
 *
 * `orders.device_id` is written where this till rings up a sale of its own
 * (handlers/orders.ts) and the pull feed never sets it, so a non-empty value
 * can only ever be this device's own id — never a neighbouring till's arriving
 * through /pull. The empty guard matters: a row written while the till was
 * unpaired carries '', and sending that to /reclaim would be answered
 * POS_RECLAIM_INPUT_MISSING instead of falling through to a pairing code.
 *
 * Most recent first, so a till later re-paired onto a new device row does not
 * reach back past that to an id the server no longer knows.
 */
export const RECOVER_DEVICE_ID_SQL = `SELECT device_id FROM orders
   WHERE device_id IS NOT NULL AND device_id <> ''
   ORDER BY created_at DESC
   LIMIT 1`;

/**
 * Last resort for a till the old sync interceptor already broke.
 *
 * That bug did `setMeta('device_id', '')` on its way out, so the very tills
 * silent re-pair exists to rescue are the ones with nothing left in meta to
 * reclaim with — and `server.device_id`, which several call sites read as a
 * fallback, is written nowhere and is always empty.
 *
 * Read-only by design. What comes back is handed to /reclaim as a claim for
 * the server to check against machine_id, never written back into meta as if
 * the till were paired again.
 */
export function recoverDeviceIdFromOrders(db: OrdersReader): string {
  try {
    const found = db.prepare(RECOVER_DEVICE_ID_SQL).pluck().get();
    return typeof found === 'string' ? found.trim() : '';
  } catch (err) {
    // A till missing the orders table entirely is a till with nothing to
    // recover, not a reason to fail the whole reclaim attempt.
    console.error('[pos] Could not read device id from orders:', err);
    return '';
  }
}

/**
 * Whether a silent re-pair should be attempted at all.
 *
 * Reclaim exists to rescue a till that lost its token by accident — a
 * reinstall, a blanked meta row, the old interceptor bug. A *manual* unpair is
 * not an accident: somebody stood at the till and said this machine is no
 * longer that device, usually because it is about to be enrolled somewhere
 * else. Trading its old identity back for a fresh token undoes that, and it
 * undoes it on the next restart, when nobody is watching.
 *
 * It is also the case that produces the confusing refusal. After a manual
 * unpair `device_id` is blank, so the claim falls through to the last device
 * this machine rang a sale under — which, now that enrolment always creates a
 * new device row, is by definition a device this machine no longer is. The
 * server answers POS_RECLAIM_MACHINE_MISMATCH, correctly, and the log fills
 * with a failure that was never going to succeed.
 *
 * Every other reason still reclaims: 'offline_too_long', 'server_locked', and
 * the empty reason a till carries when something broke without recording why.
 */
export function shouldAttemptReclaim(
  unpairedReason: string | null | undefined
): boolean {
  return (unpairedReason ?? '').trim() !== 'manual';
}
