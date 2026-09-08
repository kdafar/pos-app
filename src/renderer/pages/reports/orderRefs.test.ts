import { describe, expect, it } from 'vitest';
import { hoistCommonPrefix } from './orderRefs';

/**
 * The prefix is what makes the order list too wide to pair into two columns,
 * so getting this wrong costs either the paper saving or — far worse — a
 * reference the shop cannot match back to an order.
 */

const refs = (n: number, prefix = 'POS-5-') =>
  Array.from({ length: n }, (_, i) => `${prefix}7JF6BA${String(i).padStart(2, '0')}`);

describe('hoisting the shared half of a column of references', () => {
  it('lifts the branch prefix out of every line', () => {
    const got = hoistCommonPrefix(refs(3));
    expect(got.prefix).toBe('POS-5-');
    expect(got.rest).toEqual(['7JF6BA00', '7JF6BA01', '7JF6BA02']);
  });

  it('never hoists a branch the references do not share', () => {
    // A report covering two branches stops at the part they genuinely have in
    // common. Lifting "POS-5-" here would print one branch's number above a
    // list that is half another branch's orders — the heading would be a lie,
    // and the branch is exactly what this report exists to attribute.
    const got = hoistCommonPrefix(['POS-5-7JF6BA7Z', 'POS-7-7JF6PZTO']);
    expect(got.prefix).toBe('POS-');
    expect(got.rest).toEqual(['5-7JF6BA7Z', '7-7JF6PZTO']);
    got.rest.forEach((r, i) =>
      expect(got.prefix + r).toBe(['POS-5-7JF6BA7Z', 'POS-7-7JF6PZTO'][i])
    );
  });

  it('never stops in the middle of a code', () => {
    // These share "POS-5-7JF6" by chance, but only the separator proves where
    // a whole token ends. Cutting at the coincidence would leave references
    // that no longer look like references.
    const got = hoistCommonPrefix(['POS-5-7JF6AAAA', 'POS-5-7JF6BBBB']);
    expect(got.prefix).toBe('POS-5-');
    expect(got.rest).toEqual(['7JF6AAAA', '7JF6BBBB']);
  });

  it('refuses to strip a reference down to a stub', () => {
    // Two references that differ only in their last character would be left
    // as "1" and "2" — technically shorter, useless on paper.
    const got = hoistCommonPrefix(['ORDER-A-1', 'ORDER-A-2']);
    expect(got.prefix).toBe('');
  });

  it('does nothing for a single order, or a blank reference', () => {
    expect(hoistCommonPrefix(['POS-5-7JF6BA7Z']).prefix).toBe('');
    expect(hoistCommonPrefix(['POS-5-7JF6BA7Z', '']).prefix).toBe('');
  });

  it('leaves references with no separator at all alone', () => {
    expect(hoistCommonPrefix(['7JF6BA7Z', '7JF6PZTO']).prefix).toBe('');
  });

  it('keeps every line matched to its order', () => {
    const input = refs(200);
    const got = hoistCommonPrefix(input);
    expect(got.rest).toHaveLength(200);
    got.rest.forEach((r, i) => expect(got.prefix + r).toBe(input[i]));
  });
});
