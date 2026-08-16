// src/renderer/utils/orderLabel.ts

/**
 * What a human should read off the screen or a receipt.
 *
 * Three numbers exist and they are not interchangeable:
 *
 *  - `reference_no` — the server's short running number ("0008"). This is the
 *    one a customer quotes back and staff search on. Allocated server-side
 *    after the push, so it does not exist for a sale taken offline.
 *  - `number` — the system key ("POS-1-8ZH56FG4"). Globally unique, needed for
 *    lookup and sync. Far too long to read aloud.
 *  - the last segment of `number` — short, and unique enough within a branch's
 *    day to identify a ticket at the counter.
 *
 * So: prefer the real reference, and fall back to the short tail rather than
 * putting the full key in front of anyone.
 */
export function shortOrderLabel(order: {
  reference_no?: string | null;
  number?: string | null;
  id?: string | null;
}): string {
  const ref = String(order?.reference_no ?? '').trim();
  if (ref) return `#${ref}`;

  const num = String(order?.number ?? '').trim();
  if (num) {
    // "POS-1-8ZH56FG4" -> "8ZH56FG4"
    const tail = num.split('-').filter(Boolean).pop() || num;
    return `#${tail}`;
  }

  const id = String(order?.id ?? '').trim();
  return id ? `#${id.slice(0, 8)}` : '#—';
}

/** True when the short label is a provisional local tail, not a real reference. */
export function isProvisionalLabel(order: {
  reference_no?: string | null;
}): boolean {
  return !String(order?.reference_no ?? '').trim();
}

/** The full system key, for tooltips, search and support. */
export function systemOrderNumber(order: {
  number?: string | null;
  id?: string | null;
}): string {
  return String(order?.number ?? order?.id ?? '').trim();
}
