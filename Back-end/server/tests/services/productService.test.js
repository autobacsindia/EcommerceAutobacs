/**
 * Product Service Tests - WITHOUT MongoDB!
 * 
 * This demonstrates how Clean Architecture makes testing 10x easier.
 * We mock the repository layer, so NO database needed!
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import productService from '../services/productService.js';
import productRepository from '../repositories/productRepository.js';
import cacheService from '../services/cacheService.js';

// Mock repositories and services
jest.mock('../repositories/productRepository.js', () => ({
  findFeatured: jest.fn(),
  findOnOffer: jest.fn(),
  findVehicleByIdOrSlug: jest.fn(),
  findAllBrands: jest.fn(),
  countProductsByBrand: jest.fn(),
  findBySlug: jest.fn(),
  getStock: jest.fn(),
  updateStock: jest.fn(),
}));

jest.mock('../services/cacheService.js', () => ({
  get: jest.fn(),
  set: jest.fn(),
  wrap: jest.fn(),
  generateKey: jest.fn((prefix, params) => {
    const parts = [prefix];
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      const value = params[key];
      if (value !== undefined && value !== null) {
        parts.push(`${key}=${value}`);
      }
    }
    return parts.join(':');
  }),
}));

jest.mock('../services/elasticsearchService.js', () => ({
  enabled: false, // Force MongoDB fallback for testing
}));

describe('ProductService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
        'products:featured:limit=6',
        expect.any(Function),
        { ttl: 3600, strategy: 'swr' }
      );
    });
  });

  describe('getOfferProducts', () => {
    it('should use cache wrap with SWR strategy', async () => {
      const offerProducts = [
        { name: 'Sale Item', originalPrice: 5000, price: 3500 }
      ];
      cacheService.wrap.mockResolvedValue(offerProducts);

      const result = await productService.getOfferProducts(24);

      expect(result).toEqual(offerProducts);
      expect(cacheService.wrap).toHaveBeenCalledWith(
        'products:limit=24:type=offers',
        expect.any(Function),
        { ttl: 1800, strategy: 'swr' }
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
        { ttl: 7200, strategy: 'basic' }
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
  });
});
