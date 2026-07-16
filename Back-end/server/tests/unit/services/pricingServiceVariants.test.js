import { jest } from '@jest/globals';

/**
 * DB-free unit tests for variable-product pricing in the pricing engine.
 * Verifies that priceItems (the authoritative recompute) resolves the SELECTED
 * variant, charges the variant's price (never the parent/range-min), snapshots the
 * variant id + label, and rejects missing / unknown / out-of-stock variants.
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

const { default: pricingService } = await import('../../../services/pricingService.js');

// A variable product: parent price = range min (7299); two variants at 7299 / 10499.
function variableProduct() {
  return {
    _id: 'v-prod',
    name: 'BMC Air Filter For Toyota',
    productType: 'variable',
    price: 7299,               // parent = priceMin (must NOT be charged directly)
    priceMin: 7299,
    priceMax: 10499,
    stock: 'in',
    images: [{ url: 'x' }],
    categories: [],
    brandSlug: null,
    variants: [
      { _id: 'var-cheap', label: 'GLANZA 1.2', price: 7299, stock: 'in' },
      { _id: 'var-dear', label: 'INNOVA, FORTUNER 2.5/3.0', price: 10499, stock: 'in' },
      { _id: 'var-oos', label: 'CAMRY 2.5', price: 8299, stock: 'out' },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLoyaltyConfig.mockResolvedValue({
    enabled: true, earnRatePercent: 2, pointsExpiryDays: null,
    pointValueInRupees: 1, redeemMaxPercent: 20, minRedeemPoints: 100,
  });
  mockCouponUserUsageRepo.findByCouponUser.mockResolvedValue(null);
  mockOrderRepo.countActiveByUser.mockResolvedValue(0);
  mockUserRepo.getKarma.mockResolvedValue({ karmaPoints: 0 });
});

describe('priceItems — variable products', () => {
  test('charges the SELECTED variant price, not the parent range-min', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(variableProduct());
    const { orderItems, subtotalPaise } = await pricingService.priceItems([
      { product: 'v-prod', variantId: 'var-dear', quantity: 2 },
    ]);
    expect(orderItems[0].price).toBe(10499);
    expect(orderItems[0].variantId).toBe('var-dear');
    expect(orderItems[0].variantLabel).toBe('INNOVA, FORTUNER 2.5/3.0');
    expect(subtotalPaise).toBe(10499 * 100 * 2);
  });

  test('rejects a variable line with no variant selected', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(variableProduct());
    await expect(
      pricingService.priceItems([{ product: 'v-prod', quantity: 1 }])
    ).rejects.toThrow(/select a variant/i);
  });

  test('rejects an unknown variant id', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(variableProduct());
    await expect(
      pricingService.priceItems([{ product: 'v-prod', variantId: 'does-not-exist', quantity: 1 }])
    ).rejects.toThrow(/no longer available/i);
  });

  test('rejects an out-of-stock variant', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(variableProduct());
    await expect(
      pricingService.priceItems([{ product: 'v-prod', variantId: 'var-oos', quantity: 1 }])
    ).rejects.toThrow(/out of stock/i);
  });

  test('computeQuote prices a variable line at the variant price', async () => {
    mockProductRepo.findActiveById.mockResolvedValue(variableProduct());
    const q = await pricingService.computeQuote({
      items: [{ product: 'v-prod', variantId: 'var-cheap', quantity: 1 }],
    });
    expect(q.subtotal).toBe(7299);
    expect(q.totalAmount).toBe(7299);
    expect(q.orderItems[0].variantLabel).toBe('GLANZA 1.2');
  });
});
