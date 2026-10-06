import { DEEP_DISCOUNT_RATIO, isDeepDiscount, deepDiscountLines, deepDiscountWarning } from './offerGuard';

const money = (n: number) => `₹${n}`;

describe('isDeepDiscount', () => {
  it('flags the dropped zero', () => {
    expect(isDeepDiscount(10000, 10)).toBe(true);
  });

  it('leaves an ordinary phone offer alone', () => {
    expect(isDeepDiscount(10000, 9000)).toBe(false);
    expect(isDeepDiscount(10000, 6000)).toBe(false);
  });

  it('does not flag exactly half — the threshold is below it', () => {
    expect(isDeepDiscount(10000, 5000)).toBe(false);
    expect(isDeepDiscount(10000, 4999)).toBe(true);
  });

  it('matches the stated ratio', () => {
    expect(isDeepDiscount(100, 100 * DEEP_DISCOUNT_RATIO - 0.01)).toBe(true);
  });

  it('ignores a line with no usable numbers rather than blocking on it', () => {
    // An empty / half-typed box is already caught as a validation problem; the
    // guard must not also throw a confirm at it.
    expect(isDeepDiscount(10000, NaN)).toBe(false);
    expect(isDeepDiscount(0, 0)).toBe(false);
  });

  it('does not flag full price', () => {
    expect(isDeepDiscount(8500, 8500)).toBe(false);
  });
});

describe('deepDiscountLines', () => {
  const lines = [
    { name: 'Seat cover', listPrice: 8500, offer: 7999, quantity: 1 },
    { name: 'Body kit', listPrice: 215000, offer: 10, quantity: 1 },
    { name: 'Mats', listPrice: 2000, offer: 1000, quantity: 2 },
  ];

  it('returns only the suspicious lines, in order', () => {
    expect(deepDiscountLines(lines).map((l) => l.name)).toEqual(['Body kit']);
  });

  it('returns nothing when every price is sensible', () => {
    expect(deepDiscountLines([lines[0], lines[2]])).toEqual([]);
  });
});

describe('deepDiscountWarning', () => {
  it('names the product and both prices so the numbers get read', () => {
    const text = deepDiscountWarning([{ name: 'Body kit', listPrice: 215000, offer: 10, quantity: 1 }], money);
    expect(text).toContain('Body kit');
    expect(text).toContain('₹215000');
    expect(text).toContain('₹10');
    expect(text).toContain('missed a zero');
  });

  it('reads correctly for more than one line', () => {
    const text = deepDiscountWarning(
      [
        { name: 'A', listPrice: 100, offer: 1, quantity: 1 },
        { name: 'B', listPrice: 200, offer: 2, quantity: 1 },
      ],
      money,
    );
    expect(text).toContain('these prices are');
    expect(text).toContain('A');
    expect(text).toContain('B');
  });
});
