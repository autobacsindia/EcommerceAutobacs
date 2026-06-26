import { jest } from '@jest/globals';

// Constructor validates WordPress API config; stub it (we never make network calls here).
process.env.WORDPRESS_SITE_URL = process.env.WORDPRESS_SITE_URL || 'https://example.test';
process.env.WORDPRESS_API_KEY = process.env.WORDPRESS_API_KEY || 'test-key';
process.env.WORDPRESS_API_SECRET = process.env.WORDPRESS_API_SECRET || 'test-secret';

const BrandProductImportService = (await import('../services/brandProductImportService.js')).default;

// transformProductData is a pure mapping (no DB/network). We only exercise the
// price-mapping rules that drive the customer-facing price and the discount badge.
const svc = new BrandProductImportService();
const base = { name: 'Test Tyre', status: 'publish', images: [], attributes: [] };

describe('BrandProductImportService.transformProductData — price/originalPrice mapping', () => {
  test('on sale: price = sale_price, originalPrice = regular_price (badge shows)', () => {
    const out = svc.transformProductData({ ...base, regular_price: '5000', sale_price: '4000' });
    expect(out.price).toBe(4000);
    expect(out.originalPrice).toBe(5000);
    // badge condition the frontend uses
    expect(out.originalPrice > out.price).toBe(true);
  });

  test('not on sale: price = regular_price, originalPrice undefined (no badge)', () => {
    const out = svc.transformProductData({ ...base, regular_price: '5000', sale_price: '' });
    expect(out.price).toBe(5000);
    expect(out.originalPrice).toBeUndefined();
  });

  test('bad data (sale >= regular) is treated as not on sale — never overcharge, no fake badge', () => {
    const out = svc.transformProductData({ ...base, regular_price: '5000', sale_price: '5000' });
    expect(out.price).toBe(5000);
    expect(out.originalPrice).toBeUndefined();
  });

  test('only `price` present (no regular/sale) falls back to price', () => {
    const out = svc.transformProductData({ ...base, regular_price: '', sale_price: '', price: '3200' });
    expect(out.price).toBe(3200);
    expect(out.originalPrice).toBeUndefined();
  });
});
