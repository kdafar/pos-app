/**
 * Taking the repeated half out of a column of order references.
 *
 * Every reference on a closing report reads `POS-5-7JF6BA7Z` — the branch is
 * the same for every line, and it is already printed in the report's header.
 * On a 200-order day that prefix is six characters repeated two hundred times,
 * which is what makes the order list too wide to pair into two columns.
 *
 * Deliberately derived from the references themselves rather than composed
 * from the branch id: this has to stay correct if the reference format changes,
 * if a report ever covers more than one branch, or if a till is mid-migration
 * and carrying references minted under two schemes. In any of those cases the
 * references stop sharing a prefix and nothing is hoisted.
 */

/** Below this a prefix is not worth a heading of its own. */
const MIN_PREFIX = 3;

/**
 * What has to survive on every line. A reference cut down to two or three
 * characters is no longer something a person can match against an order.
 */
const MIN_REMAINDER = 4;

/** Only these end a token; a prefix never stops in the middle of a code. */
const SEPARATORS = ['-', '/', '_', ':'];

export type HoistedRefs = {
  /** The shared opening, including its trailing separator. '' when there is none. */
  prefix: string;
  /** Each reference with that opening removed — the originals when prefix is ''. */
  rest: string[];
};

export function hoistCommonPrefix(refs: string[]): HoistedRefs {
  const unchanged: HoistedRefs = { prefix: '', rest: refs };

  // One order has nothing to share, and a blank reference would make the
  // common prefix empty anyway — bail before doing the work.
  if (refs.length < 2 || refs.some((r) => !r)) return unchanged;

  let prefix = refs[0];
  for (const ref of refs) {
    let i = 0;
    while (i < prefix.length && i < ref.length && prefix[i] === ref[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return unchanged;
  }

  // Cut back to the last separator. Two references can share the first two
  // characters of a random code by chance; only a separator proves the shared
  // run is a whole token and not a coincidence.
  const cut = Math.max(...SEPARATORS.map((s) => prefix.lastIndexOf(s)));
  if (cut < 0) return unchanged;
  prefix = prefix.slice(0, cut + 1);

  if (prefix.length < MIN_PREFIX) return unchanged;
  if (refs.some((r) => r.length - prefix.length < MIN_REMAINDER)) {
    return unchanged;
  }

  return { prefix, rest: refs.map((r) => r.slice(prefix.length)) };
}
