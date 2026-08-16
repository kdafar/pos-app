import { describe, it, expect } from 'vitest';
import { clampQty } from '../../../components/QtyStepper';

/**
 * Direct numeric entry is far easier to break than +/- stepping: the field can
 * hold junk, be blanked, or be given a number well past the group's limit.
 */
describe('clampQty', () => {
  it('passes through a valid value', () => {
    expect(clampQty(5, 0, 10)).toBe(5);
    expect(clampQty(5, 1)).toBe(5);
  });

  it('clamps below min', () => {
    expect(clampQty(0, 1, 999)).toBe(1);
    expect(clampQty(-7, 0, 10)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clampQty(50, 0, 3)).toBe(3);
    expect(clampQty(1000, 1, 999)).toBe(999);
  });

  it('is unbounded above when max is null/undefined', () => {
    expect(clampQty(10_000, 0, null)).toBe(10_000);
    expect(clampQty(10_000, 0)).toBe(10_000);
  });

  it('falls back to min for junk (NaN from an empty or "abc" field)', () => {
    expect(clampQty(NaN, 1, 999)).toBe(1);
    expect(clampQty(NaN, 0, 5)).toBe(0);
    expect(clampQty(Infinity, 1, 999)).toBe(1);
  });

  it('truncates decimals — you cannot order 2.7 of something', () => {
    expect(clampQty(2.9, 0, 10)).toBe(2);
    expect(clampQty(2.1, 0, 10)).toBe(2);
  });

  // A group whose siblings already consume the whole allowance yields max 0,
  // which must win over min rather than producing an impossible 1.
  it('handles a fully-consumed group allowance (max 0)', () => {
    expect(clampQty(3, 0, 0)).toBe(0);
    expect(clampQty(1, 0, 0)).toBe(0);
  });

  it('ignores a max below min instead of inverting the range', () => {
    expect(clampQty(5, 1, 0)).toBe(5);
  });
});
