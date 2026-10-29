/**
 * The quotation percentage discount (utils/quoteDiscount.js) — pure maths.
 *
 * What must hold:
 *   - amount = subtotal × percent, rounded to the nearest WHOLE rupee; total = subtotal − amount
 *   - prices are GST-inclusive, so the GST inside the total falls by the same percent
 *   - no discount for empty / 0; at most 2 decimals; below 100%; a reason is required
 *   - a discount that leaves less than ₹1 to pay is refused
 */
import {
  applyDiscount, cleanDiscountInput, priceWithDiscount, discountLabel, DISCOUNT_MAX_PERCENT,
} from '../utils/quoteDiscount.js';

describe('applyDiscount', () => {
  it('takes the percent off and rounds to whole rupees', () => {
    expect(applyDiscount(11800, 5)).toEqual({ subtotal: 11800, amount: 590, total: 11210 });
    // ₹589.95 → ₹590 (half-up to the rupee)
    expect(applyDiscount(11799, 5)).toEqual({ subtotal: 11799, amount: 590, total: 11209 });
    // ₹589.45 → ₹589
    expect(applyDiscount(11789, 5)).toEqual({ subtotal: 11789, amount: 589, total: 11200 });
  });

  it('keeps paise of the subtotal in the total and stays exact in paise', () => {
    const r = applyDiscount(4999.5, 10); // 499.95 → 500
    expect(r).toEqual({ subtotal: 4999.5, amount: 500, total: 4499.5 });
    expect(Number.isInteger(Math.round(r.total * 100))).toBe(true);
  });

  it('handles 2-decimal percents and crore-sized totals without float drift', () => {
    expect(applyDiscount(1000, 2.5)).toEqual({ subtotal: 1000, amount: 25, total: 975 });
    expect(applyDiscount(31594480, 7.25)).toEqual({ subtotal: 31594480, amount: 2290600, total: 29303880 });
  });

  it('no percent → no discount', () => {
    expect(applyDiscount(500, 0)).toEqual({ subtotal: 500, amount: 0, total: 500 });
    expect(applyDiscount(500, null)).toEqual({ subtotal: 500, amount: 0, total: 500 });
  });

  it('the GST inside an inclusive total falls by the same percent (before = after GST)', () => {
    // ₹10,000 + 18% GST = ₹11,800 inclusive.
    const { total } = applyDiscount(11800, 5);
    const gstAfter = Math.round((total - total / 1.18) * 100) / 100;
    expect(total).toBe(11210);
    expect(Math.round((total / 1.18) * 100) / 100).toBe(9500); // 5% off ₹10,000
    expect(gstAfter).toBe(1710); // 5% off ₹1,800
  });
});

describe('cleanDiscountInput', () => {
  it('empty, absent and 0 mean no discount', () => {
    expect(cleanDiscountInput(undefined)).toBeNull();
    expect(cleanDiscountInput(null)).toBeNull();
    expect(cleanDiscountInput({})).toBeNull();
    expect(cleanDiscountInput({ percent: '' })).toBeNull();
    expect(cleanDiscountInput({ percent: 0, reason: '' })).toBeNull();
  });

  it('accepts a percent with a reason, tidying the reason', () => {
    expect(cleanDiscountInput({ percent: '5', reason: '  repeat   customer ' })).toEqual({ percent: 5, reason: 'repeat customer' });
    expect(cleanDiscountInput({ percent: 7.25, reason: 'Diwali offer' })).toEqual({ percent: 7.25, reason: 'Diwali offer' });
    expect(cleanDiscountInput({ percent: DISCOUNT_MAX_PERCENT, reason: 'Sample unit' })).toEqual({ percent: 99.99, reason: 'Sample unit' });
  });

  it('requires a reason', () => {
    expect(() => cleanDiscountInput({ percent: 5 })).toThrow(/reason/);
    expect(() => cleanDiscountInput({ percent: 5, reason: ' a ' })).toThrow(/reason/);
    expect(() => cleanDiscountInput({ percent: 5, reason: 'x'.repeat(301) })).toThrow(/300/);
  });

  it('refuses 100% and more, negatives, junk and more than 2 decimals', () => {
    for (const percent of [100, 150, -5, 'abc', 'NaN']) {
      expect(() => cleanDiscountInput({ percent, reason: 'because' })).toThrow();
    }
    expect(() => cleanDiscountInput({ percent: 7.125, reason: 'because' })).toThrow(/2 decimals/);
  });

  it('every refusal is a 400 the seller can read', () => {
    expect(() => cleanDiscountInput({ percent: 100, reason: 'free' }))
      .toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/less than 100%/) }));
  });
});

describe('priceWithDiscount', () => {
  it('refuses a discount that leaves less than ₹1 to pay', () => {
    // ₹10 at 99.99% → ₹9.999 → ₹10 off → ₹0.
    expect(() => priceWithDiscount(10, { percent: 99.99, reason: 'x y z' })).toThrow(/nothing to pay/);
    expect(priceWithDiscount(10, null)).toEqual({ subtotal: 10, amount: 0, total: 10 });
    expect(priceWithDiscount(10000, { percent: 99.99, reason: 'x y z' })).toEqual({ subtotal: 10000, amount: 9999, total: 1 });
  });
});

it('the customer-facing label shows only the percent', () => {
  expect(discountLabel(5)).toBe('Discount (5%)');
  expect(discountLabel(2.5)).toBe('Discount (2.5%)');
  expect(discountLabel(7.25)).toBe('Discount (7.25%)');
});
