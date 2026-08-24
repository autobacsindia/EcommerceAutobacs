/**
 * Product Service Tests - WITHOUT MongoDB!
 *
 * This demonstrates how Clean Architecture makes testing 10x easier.
 * We mock the repository layer, so NO database needed!
 *
 * NOTE ON THE MOCKING STYLE
 * -------------------------
 * These used `jest.mock()`, which is a NO-OP under ESM (`--experimental-vm-modules`).
 * The mock factories never ran, so the suite imported the REAL cacheService and
 * failed with "cacheService.wrap.mockResolvedValue is not a function" — every test
 * in the file. ESM needs `jest.unstable_mockModule()` plus a DYNAMIC import after
 * the mock is registered, because static imports are hoisted above it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../repositories/productRepository.js', () => ({
  default: {
    findFeatured: jest.fn(),
    findOnOffer: jest.fn(),
    findVehicleByIdOrSlug: jest.fn(),
    findAllBrands: jest.fn(),
    countProductsByBrand: jest.fn(),
    findBySlug: jest.fn(),
    getStock: jest.fn(),
    updateStock: jest.fn(),
  },
}));

jest.unstable_mockModule('../../services/cacheService.js', () => ({
  default: {
    get: jest.fn(),
    set: jest.fn(),
    wrap: jest.fn(),
    generateKey: jest.fn((prefix, params) => {
      const parts = [prefix];
      for (const key of Object.keys(params).sort()) {
        const value = params[key];
        if (value !== undefined && value !== null) parts.push(`${key}=${value}`);
      }
      return parts.join(':');
    }),
  },
  CACHE_VERSION: 'v1',
  // Mirrors services/cache/config.js — the service reads TTL.PRODUCT_FEATURED
  // etc., so a partial mock silently yields `ttl: undefined`.
  TTL: { PRODUCT_FEATURED: 3600, PRODUCT_OFFERS: 1800, BRANDS: 7200 },
}));

jest.unstable_mockModule('../../services/elasticsearchService.js', () => ({
  default: { enabled: false }, // Force the MongoDB path
}));

// Dynamic imports AFTER the mocks are registered — this is the part `jest.mock()`
// cannot express in ESM.
const { default: productService } = await import('../../services/productService.js');
const { default: productRepository } = await import('../../repositories/productRepository.js');
const { default: cacheService } = await import('../../services/cacheService.js');

describe('ProductService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // jest.config.js sets `resetMocks: true`, which wipes the implementation the
    // mock factory supplied. Without restoring it here generateKey returns
    // undefined and every cache-key assertion compares against `undefined`.
    cacheService.generateKey.mockImplementation((prefix, params) => {
      const parts = [prefix];
      for (const key of Object.keys(params).sort()) {
        const value = params[key];
        if (value !== undefined && value !== null) parts.push(`${key}=${value}`);
      }
      return parts.join(':');
    });
  });

  describe('getFeaturedProducts', () => {
    it('should use cache wrap with SWR strategy', async () => {
      const mockProducts = [
        { name: 'Product 1', isFeatured: true },
        { name: 'Product 2', isFeatured: true }
      ];
      cacheService.wrap.mockResolvedValue(mockProducts);

      const result = await productService.getFeaturedProducts(6);

      expect(result).toEqual(mockProducts);
      expect(cacheService.wrap).toHaveBeenCalledWith(
        'products:limit=6:type=featured', // generateKey sorts its params
        expect.any(Function),
        { ttl: 3600, strategy: 'swr', tags: ['products', 'products:featured'] }
      );
    });
  });

  describe('getOfferProducts', () => {
    it('should use cache wrap with SWR strategy', async () => {
      const offerResult = {
        products: [{ name: 'Sale Item', originalPrice: 5000, price: 3500 }],
        total: 1,
      };
      cacheService.wrap.mockResolvedValue(offerResult);

      const result = await productService.getOfferProducts({ page: 1, limit: 24 });

      expect(result).toEqual(offerResult);
      expect(cacheService.wrap).toHaveBeenCalledWith(
        'products:limit=24:page=1:type=offers',
        expect.any(Function),
        { ttl: 1800, strategy: 'swr', tags: ['products', 'products:offers'] }
      );
    });

    it('keys page 2 separately from page 1 so pages never collide in the shared cache', async () => {
      cacheService.wrap.mockResolvedValue({ products: [], total: 0 });

      await productService.getOfferProducts({ page: 2, limit: 24 });

      expect(cacheService.wrap).toHaveBeenCalledWith(
        'products:limit=24:page=2:type=offers',
        expect.any(Function),
        expect.anything()
      );
    });
  });

  describe('getProductsByVehicle', () => {
    it('should return null if vehicle not found', async () => {
      productRepository.findVehicleByIdOrSlug.mockResolvedValue(null);

      const result = await productService.getProductsByVehicle('invalid-id', {});

      expect(result).toBeNull();
      expect(productRepository.findVehicleByIdOrSlug).toHaveBeenCalledWith('invalid-id');
    });

    it('should return products for valid vehicle', async () => {
      const mockVehicle = {
        _id: 'vehicle123',
        make: 'Toyota',
        model: 'Fortuner',
        slug: 'toyota-fortuner'
      };
      productRepository.findVehicleByIdOrSlug.mockResolvedValue(mockVehicle);

      // Mock search results
      jest.spyOn(productService, '_searchWithMongoDB').mockResolvedValue({
        products: [{ name: 'Compatible Product' }],
        pagination: { total: 1, page: 1, limit: 12, pages: 1 },
        facets: {}
      });

      const result = await productService.getProductsByVehicle('toyota-fortuner', {
        page: 1,
        limit: 12
      });

      expect(result).not.toBeNull();
      expect(result.vehicle.name).toBe('Toyota Fortuner');
      expect(result.products).toHaveLength(1);
    });
  });

  describe('getBrandsWithCounts', () => {
    it('should use cache wrap with basic strategy', async () => {
      const mockBrands = [
        { id: 'brand1', name: 'Brembo', slug: 'brembo', productCount: 50 }
      ];
      cacheService.wrap.mockResolvedValue(mockBrands);

      const result = await productService.getBrandsWithCounts();

      expect(result).toEqual(mockBrands);
      expect(cacheService.wrap).toHaveBeenCalledWith(
        'brands:withCounts=true',
        expect.any(Function),
        { ttl: 7200, strategy: 'basic', tags: ['brands'] }
      );
    });
  });

  describe('checkStock', () => {
    it('reports fulfillable when status is in stock', async () => {
      productRepository.getStock.mockResolvedValue('in');

      const result = await productService.checkStock('product123', 5);

      expect(result).toEqual({
        status: 'in',
        requested: 5,
        inStock: true,
        canFulfill: true
      });
    });

    it('reports fulfillable when status is low stock', async () => {
      productRepository.getStock.mockResolvedValue('low');

      const result = await productService.checkStock('product123', 5);

      expect(result).toEqual({
        status: 'low',
        requested: 5,
        inStock: true,
        canFulfill: true
      });
    });

    it('reports not fulfillable when out of stock', async () => {
      productRepository.getStock.mockResolvedValue('out');

      const result = await productService.checkStock('product123', 5);

      expect(result).toEqual({
        status: 'out',
        requested: 5,
        inStock: false,
        canFulfill: false
      });
    });

    it('reports not fulfillable when on backorder (enquiry-only)', async () => {
      productRepository.getStock.mockResolvedValue('backorder');

      const result = await productService.checkStock('product123', 5);

      expect(result).toEqual({
        status: 'backorder',
        requested: 5,
        inStock: false,
        canFulfill: false
      });
    });
  });
});
