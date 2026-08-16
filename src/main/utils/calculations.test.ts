import { describe, it, expect } from 'vitest';
import {
  parseNumList,
  addonsUnitTotal,
  baseUnitPrice,
  calcLineTotal,
  variationEffectivePrice,
  computePromoDiscount,
  type PromoRow,
} from './calculations';

const promo = (p: Partial<PromoRow>): PromoRow => ({
  id: 'p1',
  code: 'X',
  type: 'percent',
  value: 10,
  ...p,
});

describe('parseNumList', () => {
  it('reads JSON arrays, CSV, bare numbers and empties', () => {
    expect(parseNumList('[1,2,3]')).toEqual([1, 2, 3]);
    expect(parseNumList('1,2,3')).toEqual([1, 2, 3]);
    expect(parseNumList(5)).toEqual([5]);
    expect(parseNumList('5')).toEqual([5]);
    expect(parseNumList(null)).toEqual([]);
    expect(parseNumList('')).toEqual([]);
    expect(parseNumList('   ')).toEqual([]);
  });

  it('does not throw on malformed input', () => {
    expect(() => parseNumList('{oops')).not.toThrow();
    expect(parseNumList('a,b')).toEqual([0, 0]);
  });
});

describe('addonsUnitTotal', () => {
  it('multiplies each addon price by its quantity', () => {
    expect(addonsUnitTotal('[0.5,0.75]', '[2,1]')).toBeCloseTo(1.75, 3);
  });

  it('assumes qty 1 when quantities are absent', () => {
    expect(addonsUnitTotal('[0.5,0.75]', null)).toBeCloseTo(1.25, 3);
  });

  it('is zero when there are no addons', () => {
    expect(addonsUnitTotal(null, null)).toBe(0);
    expect(addonsUnitTotal('[]', '[]')).toBe(0);
  });

  it('falls back to qty 1 when the qty list is shorter than the price list', () => {
    expect(addonsUnitTotal('[1,2]', '[3]')).toBeCloseTo(1 * 3 + 2 * 1, 3);
  });
});

describe('variationEffectivePrice', () => {
  const item = { price: 2.5 };

  it('prefers a real sale_price', () => {
    expect(variationEffectivePrice({ price: 3, sale_price: 2.75 }, item)).toBe(
      2.75
    );
  });

  it('ignores a zero sale_price and uses price', () => {
    expect(variationEffectivePrice({ price: 4.5, sale_price: 0 }, item)).toBe(
      4.5
    );
  });

  // Regression: `Number(sale_price || price || 0)` returned 0 here, so a
  // variation with no prices of its own was handed out FREE.
  it('falls back to the item price when the variation has no price at all', () => {
    expect(
      variationEffectivePrice({ price: null, sale_price: null }, item)
    ).toBe(2.5);
    expect(variationEffectivePrice({}, item)).toBe(2.5);
  });

  it('never returns NaN for junk input', () => {
    expect(
      variationEffectivePrice({ price: 'abc', sale_price: 'x' }, item)
    ).toBe(2.5);
    expect(variationEffectivePrice(null, null)).toBe(0);
  });
});

describe('baseUnitPrice / calcLineTotal', () => {
  it('uses variation_price over price when present', () => {
    expect(baseUnitPrice({ price: 2.5, variation_price: 4 })).toBe(4);
  });

  it('uses price when variation_price is absent or zero', () => {
    expect(baseUnitPrice({ price: 2.5, variation_price: 0 })).toBe(2.5);
    expect(baseUnitPrice({ price: 2.5 })).toBe(2.5);
  });

  it('adds addons on top of the base', () => {
    expect(
      baseUnitPrice({
        price: 2.5,
        variation_price: 4,
        addons_price: '[0.5]',
        addons_qty: '[2]',
      })
    ).toBeCloseTo(5, 3);
  });

  it('multiplies by qty and rounds to 3dp', () => {
    expect(calcLineTotal({ price: 1.115, qty: 3 })).toBe(3.345);
    expect(calcLineTotal({ price: 2.5, qty: 0 })).toBe(0);
  });
});

describe('computePromoDiscount', () => {
  it('is zero without a promo', () => {
    expect(computePromoDiscount(10, null)).toBe(0);
  });

  it('applies a percentage', () => {
    expect(computePromoDiscount(10, promo({ type: 'percent', value: 10 }))).toBe(
      1
    );
  });

  it('applies a flat amount', () => {
    expect(computePromoDiscount(10, promo({ type: 'amount', value: 2.5 }))).toBe(
      2.5
    );
  });

  it('respects min_total', () => {
    expect(
      computePromoDiscount(5, promo({ type: 'amount', value: 2, min_total: 10 }))
    ).toBe(0);
  });

  it('caps at max_discount', () => {
    expect(
      computePromoDiscount(
        100,
        promo({ type: 'percent', value: 50, max_discount: 5 })
      )
    ).toBe(5);
  });

  // A discount larger than the basket must not produce a negative total.
  it('never exceeds the subtotal', () => {
    expect(
      computePromoDiscount(3, promo({ type: 'amount', value: 999 }))
    ).toBe(3);
  });

  it('never returns a negative discount', () => {
    expect(
      computePromoDiscount(10, promo({ type: 'amount', value: -5 }))
    ).toBe(0);
  });
});
