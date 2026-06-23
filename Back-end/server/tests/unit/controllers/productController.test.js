import { jest } from '@jest/globals';

// Mock dependencies
const mockProduct = {
  find: jest.fn(),
  aggregate: jest.fn(),
};

const mockSearchService = {
  searchProducts: jest.fn(),
  getSearchSuggestions: jest.fn(),
  getSearchAnalytics: jest.fn(),
  getSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
};

const mockBrand = {
  find: jest.fn(),
};

const mockVehicle = {
  findById: jest.fn(),
  findOne: jest.fn(),
};

const mockMongoose = {
  Types: {
    ObjectId: {
      isValid: jest.fn(),
    }
  }
};

// Setup mocks
jest.unstable_mockModule('../../../models/Product.js', () => ({ default: mockProduct }));
jest.unstable_mockModule('../../../services/searchService.js', () => ({ default: mockSearchService }));
jest.unstable_mockModule('../../../models/Brand.js', () => ({ default: mockBrand }));
jest.unstable_mockModule('../../../models/Vehicle.js', () => ({ default: mockVehicle }));
jest.unstable_mockModule('mongoose', () => ({ default: mockMongoose }));

// Import controller
const { 
  getProducts, 
  getFeaturedProducts, 
  getOfferProducts, 
  getProductsByVehicle,
  getBrands
} = await import('../../../controllers/productController.js');

describe('ProductController Unit Tests', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    
    req = {
      query: {},
      params: {}
    };
    
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    
    // Default mock behavior for chaining
    mockProduct.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([]),
    });
  });

  describe('getProducts', () => {
    it('should call SearchService.searchProducts and return results', async () => {
      req.query = { q: 'test' };
      const mockResults = {
        products: [{ name: 'Test Product' }],
        pagination: { page: 1, pages: 1 },
        facets: {}
      };
      
      mockSearchService.searchProducts.mockResolvedValue(mockResults);
      
      await getProducts(req, res);
      
      expect(mockSearchService.searchProducts).toHaveBeenCalledWith(req.query);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        ...mockResults.pagination,
        products: mockResults.products,
        facets: mockResults.facets
      });
    });
  });

  describe('getFeaturedProducts', () => {
    it('should return featured products', async () => {
      const mockProducts = [{ name: 'Featured 1' }];
      
      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(mockProducts)
      };
      
      mockProduct.find.mockReturnValue(mockChain);
      
      req.query = { limit: '10' };
      await getFeaturedProducts(req, res);
      
      expect(mockProduct.find).toHaveBeenCalledWith({ isActive: true, isFeatured: true });
      expect(mockChain.populate).toHaveBeenCalledWith('categories', 'name slug');
      expect(mockChain.limit).toHaveBeenCalledWith(10);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        products: mockProducts
      });
    });
  });

  describe('getOfferProducts', () => {
    it('should return offer products', async () => {
      const mockProducts = [{ name: 'Offer 1' }];
      
      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(mockProducts)
      };
      
      mockProduct.find.mockReturnValue(mockChain);
      
      await getOfferProducts(req, res);
      
      expect(mockProduct.find).toHaveBeenCalledWith(expect.objectContaining({
        isActive: true,
        $and: expect.any(Array)
      }));
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        products: mockProducts
      });
    });
  });
  
  describe('getProductsByVehicle', () => {
    it('should handle invalid vehicle ID (slug lookup)', async () => {
      req.params.vehicleId = 'test-slug';
      mockMongoose.Types.ObjectId.isValid.mockReturnValue(false);
      
      mockVehicle.findOne.mockResolvedValue(null);
      
      await getProductsByVehicle(req, res);
      
      expect(mockMongoose.Types.ObjectId.isValid).toHaveBeenCalledWith('test-slug');
      expect(mockVehicle.findOne).toHaveBeenCalledWith({ slug: 'test-slug', isActive: true });
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return products for valid vehicle', async () => {
      req.params.vehicleId = 'valid-id';
      const mockVehicleDoc = { _id: 'valid-id', make: 'Toyota', model: 'Corolla', slug: 'toyota-corolla' };
      
      mockMongoose.Types.ObjectId.isValid.mockReturnValue(true);
      mockVehicle.findById.mockResolvedValue(mockVehicleDoc);
      
      const mockResults = {
        products: [],
        pagination: {},
        facets: {}
      };
      mockSearchService.searchProducts.mockResolvedValue(mockResults);
      
      await getProductsByVehicle(req, res);
      
      expect(mockVehicle.findById).toHaveBeenCalledWith('valid-id');
      expect(mockSearchService.searchProducts).toHaveBeenCalledWith(expect.objectContaining({
        vehicle: 'valid-id'
      }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        vehicle: expect.any(Object)
      }));
    });
  });

  describe('getBrands', () => {
    it('should return brands with product counts', async () => {
      const mockBrands = [
        { _id: 'b1', name: 'Brand A', slug: 'brand-a' },
        { _id: 'b2', name: 'Brand B', slug: 'brand-b' }
      ];
      
      mockBrand.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockBrands)
      });
      
      const mockCounts = [
        { _id: 'Brand A', count: 10 },
        { _id: 'Brand B', count: 5 }
      ];
      mockProduct.aggregate.mockResolvedValue(mockCounts);
      
      await getBrands(req, res);
      
      expect(mockBrand.find).toHaveBeenCalled();
      expect(mockProduct.aggregate).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        brands: expect.arrayContaining([
          expect.objectContaining({
            name: 'Brand A',
            productCount: 10
          }),
          expect.objectContaining({
            name: 'Brand B',
            productCount: 5
          })
        ])
      }));
    });

    it('should filter out brands with 0 products', async () => {
       const mockBrands = [
        { _id: 'b1', name: 'Brand A', slug: 'brand-a' }
      ];
      
      mockBrand.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockBrands)
      });
      
      mockProduct.aggregate.mockResolvedValue([]); // No products
      
      await getBrands(req, res);
      
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        brands: [] // Filtered out
      });
    });
  });
});
