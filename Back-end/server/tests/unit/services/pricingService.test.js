import { jest } from '@jest/globals';

/**
 * DB-free unit tests for the pricing engine — the single source of truth for an
 * order's money breakdown. Repositories and the loyalty config are mocked so the
 * discount/karma arithmetic (incl. integer-paise rounding and the stacking order) is
 * exercised deterministically without a database or transactions.
 */

const mockProductRepo = { findActiveById: jest.fn() };
const mockCouponRepo = { findByCode: jest.fn() };
const mockCouponUserUsageRepo = { findByCouponUser: jest.fn() };
const mockOrderRepo = { countActiveByUser: jest.fn() };
const mockUserRepo = { getKarma: jest.fn() };
const mockGetLoyaltyConfig = jest.fn();

jest.unstable_mockModule('../../../repositories/productRepository.js', () => ({ default: mockProductRepo }));
jest.unstable_mockModule('../../../repositories/couponRepository.js', () => ({ default: mockCouponRepo }));
jest.unstable_mockModule('../../../repositories/couponUserUsageRepository.js', () => ({ default: mockCouponUserUsageRepo }));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../repositories/userRepository.js', () => ({ default: mockUserRepo }));
jest.unstable_mockModule('../../../services/loyaltyConfigService.js', () => ({
  getLoyaltyConfig: mockGetLoyaltyConfig,
  invalidateLoyaltyConfig: jest.fn()
}));

const { default: pricingService, effectivePrice } = await import('../../../services/pricingService.js');

// Default config: 1 pt = ₹1, redeem up to 20% of the order, min 100 pts, earn 2%.
const CONFIG = {
  enabled: true, earnRatePercent: 2, pointsExpiryDays: null,
  pointValueInRupees: 1, redeemMaxPercent: 20, minRedeemPoints: 100
};

function product(id, price, extra = {}) {
  return { _id: id, name: `P-${id}`, price, stock: 'in', images: [{ url: 'x' }], categories: [], brandSlug: null, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLoyaltyConfig.mockResolvedValue({ ...CONFIG });
  mockCouponUserUsageRepo.findByCouponUser.mockResolvedValue(null);
  mockOrderRepo.countActiveByUser.mockResolvedValue(0);
  mockUserRepo.getKarma.mockResolvedValue({ karmaPoints: 0 });
});

describe('pricingService.computeQuote', () => {
  test('plain cart: subtotal, total, and GST extraction', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1180));
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 2 }] });

    expect(q.subtotal).toBe(2360);
    expect(q.discount).toBe(0);
    expect(q.totalAmount).toBe(2360);
    // GST is embedded (÷1.18): 2360 − 2360/1.18 = 360
    expect(q.tax).toBeCloseTo(360, 2);
    expect(q.couponError).toBeNull();
  });

  test('percentage coupon respects maxDiscountAmount cap', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 10000));
    mockCouponRepo.findByCode.mockResolvedValue({
      _id: 'c1', code: 'SAVE10', type: 'percentage', value: 10, maxDiscountAmount: 500,
      isActive: true, minCartValue: 0, appliesTo: {}, usedCount: 0, usageLimit: null
    });
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 1 }], couponCode: 'SAVE10' });

    // 10% of 10000 = 1000, capped at 500
    expect(q.couponDiscount).toBe(500);
    expect(q.totalAmount).toBe(9500);
    expect(q.appliedCoupon.code).toBe('SAVE10');
  });

  test('fixed coupon cannot exceed subtotal', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 300));
    mockCouponRepo.findByCode.mockResolvedValue({
      _id: 'c2', code: 'FLAT500', type: 'fixed', value: 500,
      isActive: true, minCartValue: 0, appliesTo: {}, usedCount: 0, usageLimit: null
    });
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 1 }], couponCode: 'FLAT500' });
    expect(q.couponDiscount).toBe(300);
    expect(q.totalAmount).toBe(0 + 0); // 300 − 300, no shipping
    expect(q.totalAmount).toBe(0);
  });

  test('free_shipping waives the shipping cost, not goods', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1000));
    mockCouponRepo.findByCode.mockResolvedValue({
      _id: 'c3', code: 'FREESHIP', type: 'free_shipping', value: 0,
      isActive: true, minCartValue: 0, appliesTo: {}, usedCount: 0, usageLimit: null
    });
    const q = await pricingService.computeQuote({
      items: [{ product: 'a', quantity: 1 }], couponCode: 'FREESHIP', shippingCost: 99
    });
    expect(q.couponDiscount).toBe(0);
    expect(q.freeShippingApplied).toBe(true);
    expect(q.shippingCost).toBe(0);
    expect(q.totalAmount).toBe(1000);
  });

  test('minCartValue not met → couponError, no discount', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1000));
    mockCouponRepo.findByCode.mockResolvedValue({
      _id: 'c4', code: 'BIG', type: 'fixed', value: 200,
      isActive: true, minCartValue: 50000, appliesTo: {}, usedCount: 0, usageLimit: null
    });
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 1 }], couponCode: 'BIG' });
    expect(q.couponDiscount).toBe(0);
    expect(q.appliedCoupon).toBeNull();
    expect(q.couponError).toMatch(/minimum/i);
  });

  test('firstOrderOnly rejected when the user has prior orders', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1000));
    mockOrderRepo.countActiveByUser.mockResolvedValue(3);
    mockCouponRepo.findByCode.mockResolvedValue({
      _id: 'c5', code: 'WELCOME', type: 'percentage', value: 10,
      isActive: true, minCartValue: 0, firstOrderOnly: true, appliesTo: {}, usedCount: 0, usageLimit: null
    });
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 1 }], couponCode: 'WELCOME', userId: 'u1' });
    expect(q.couponError).toMatch(/first order/i);
  });

  test('global usage limit reached → couponError', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1000));
    mockCouponRepo.findByCode.mockResolvedValue({
      _id: 'c6', code: 'GONE', type: 'fixed', value: 100,
      isActive: true, minCartValue: 0, appliesTo: {}, usedCount: 5, usageLimit: 5
    });
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 1 }], couponCode: 'GONE' });
    expect(q.couponError).toMatch(/usage limit/i);
  });

  test('karma clamps to redeemMaxPercent of the order', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1000));
    mockUserRepo.getKarma.mockResolvedValue({ karmaPoints: 100000 }); // huge balance
    // Cap = 20% of 1000 = ₹200 = 200 points (1pt=₹1)
    const q = await pricingService.computeQuote({
      items: [{ product: 'a', quantity: 1 }], redeemKarmaPoints: 100000, userId: 'u1'
    });
    expect(q.karmaPointsUsed).toBe(200);
    expect(q.karmaDiscount).toBe(200);
    expect(q.totalAmount).toBe(800);
    expect(q.maxRedeemablePoints).toBe(200);
  });

  test('karma below minRedeemPoints threshold is ignored', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 5000));
    mockUserRepo.getKarma.mockResolvedValue({ karmaPoints: 50 });
    const q = await pricingService.computeQuote({
      items: [{ product: 'a', quantity: 1 }], redeemKarmaPoints: 50, userId: 'u1'
    });
    expect(q.karmaPointsUsed).toBe(0);
    expect(q.totalAmount).toBe(5000);
  });

  test('coupon then karma stack on the remaining amount', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 10000));
    mockUserRepo.getKarma.mockResolvedValue({ karmaPoints: 5000 });
    mockCouponRepo.findByCode.mockResolvedValue({
      _id: 'c7', code: 'TEN', type: 'percentage', value: 10, maxDiscountAmount: null,
      isActive: true, minCartValue: 0, appliesTo: {}, usedCount: 0, usageLimit: null
    });
    const q = await pricingService.computeQuote({
      items: [{ product: 'a', quantity: 1 }], couponCode: 'TEN', redeemKarmaPoints: 5000, userId: 'u1'
    });
    // coupon: 10% of 10000 = 1000 → after-coupon 9000; karma cap 20% of 9000 = 1800
    expect(q.couponDiscount).toBe(1000);
    expect(q.karmaPointsUsed).toBe(1800);
    expect(q.karmaDiscount).toBe(1800);
    expect(q.discount).toBe(2800);
    expect(q.totalAmount).toBe(7200);
  });

  test('fractional point value rounds in paise without drift', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1000));
    mockUserRepo.getKarma.mockResolvedValue({ karmaPoints: 1000 });
    mockGetLoyaltyConfig.mockResolvedValue({ ...CONFIG, pointValueInRupees: 0.5, minRedeemPoints: 1, redeemMaxPercent: 100 });
    const q = await pricingService.computeQuote({
      items: [{ product: 'a', quantity: 1 }], redeemKarmaPoints: 300, userId: 'u1'
    });
    // 300 pts × ₹0.5 = ₹150
    expect(q.karmaDiscount).toBe(150);
    expect(q.totalAmount).toBe(850);
  });

  test('out-of-stock item throws', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 1000, { stock: 'out' }));
    await expect(pricingService.computeQuote({ items: [{ product: 'a', quantity: 1 }] }))
      .rejects.toThrow(/out of stock/i);
  });

  test('assertCouponApplied turns a rejection into a hard error', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(product('a', 100));
    mockCouponRepo.findByCode.mockResolvedValue(null);
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 1 }], couponCode: 'NOPE' });
    expect(q.couponError).toMatch(/invalid coupon/i);
    expect(() => pricingService.assertCouponApplied(q, 'NOPE')).toThrow(/invalid coupon/i);
  });
});

describe('effectivePrice — time-boxed sale expiry guard', () => {
  const FUTURE = new Date(Date.now() + 60 * 60 * 1000);   // +1h
  const PAST   = new Date(Date.now() - 60 * 60 * 1000);    // -1h

  test('no sale window: returns the stored price', () => {
    expect(effectivePrice({ price: 800, originalPrice: 1000 })).toBe(800);
  });

  test('live sale: charges the (lower) sale price', () => {
    expect(effectivePrice({ price: 800, originalPrice: 1000, saleEndsAt: FUTURE })).toBe(800);
  });

  test('expired sale: reverts UP to originalPrice even before the sweep runs', () => {
    expect(effectivePrice({ price: 800, originalPrice: 1000, saleEndsAt: PAST })).toBe(1000);
  });

  test('expired window without a real discount: keeps the stored price', () => {
    // originalPrice not higher than price → nothing to revert to
    expect(effectivePrice({ price: 800, originalPrice: 800, saleEndsAt: PAST })).toBe(800);
    expect(effectivePrice({ price: 800, saleEndsAt: PAST })).toBe(800);
  });
});

describe('computeQuote honours an expired sale window', () => {
  test('expired sale is priced at originalPrice in the quote', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(
      product('a', 800, { originalPrice: 1000, saleEndsAt: new Date(Date.now() - 1000) })
    );
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 2 }] });
    expect(q.subtotal).toBe(2000);          // 1000 × 2, not 800 × 2
    expect(q.orderItems[0].price).toBe(1000);
  });

  test('live sale is priced at the sale price in the quote', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(
      product('a', 800, { originalPrice: 1000, saleEndsAt: new Date(Date.now() + 3600_000) })
    );
    const q = await pricingService.computeQuote({ items: [{ product: 'a', quantity: 2 }] });
    expect(q.subtotal).toBe(1600);          // 800 × 2
    expect(q.orderItems[0].price).toBe(800);
  });
});
