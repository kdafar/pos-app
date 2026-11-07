import { describe, expect, it } from 'vitest';
import { largerPart, splitParts } from './splitPayment';

describe('splitParts', () => {
  it('splits 10.000 into 7.000 cash and 3.000 knet', () => {
    expect(splitParts(10, 7, 'knet')).toEqual([
      { method: 'cash', amount: 7 },
      { method: 'knet', amount: 3 },
    ]);
  });
  it('keeps fils exact', () => {
    expect(splitParts(5.75, 2.105, 'card')).toEqual([
      { method: 'cash', amount: 2.105 },
      { method: 'card', amount: 3.645 },
    ]);
  });
  it.each([
    [10, 0, 'knet'],
    [10, 10, 'knet'],
    [10, 11, 'knet'],
    [10, -1, 'knet'],
    [10, 5, 'cash'],
    [10, 5, ''],
    [10, Number.NaN, 'knet'],
  ])('refuses %s split as %s cash + %s', (total, cash, slug) => {
    expect(splitParts(total, cash, slug)).toBeNull();
  });
});

describe('largerPart', () => {
  it('is the bigger amount, cash on a tie', () => {
    expect(largerPart([{ method: 'cash', amount: 3 }, { method: 'knet', amount: 7 }]).method).toBe('knet');
    expect(largerPart([{ method: 'cash', amount: 5 }, { method: 'knet', amount: 5 }]).method).toBe('cash');
  });
});
