
import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../../../services/elasticsearchService.js', () => ({
  default: {
    isConnected: jest.fn(),
    searchProducts: jest.fn(),
  }
}));

jest.unstable_mockModule('../../../services/categoryMappingService.js', () => ({
  default: {
    initialized: true,
    initialize: jest.fn(),
    findCategory: jest.fn(),
    getAllCategoryIdsIncludingChildren: jest.fn(),
  }
}));

jest.unstable_mockModule('../../../models/Product.js', () => ({
  default: {
    find: jest.fn(),
    countDocuments: jest.fn(),
  }
}));

// Import the module under test using dynamic import to apply mocks
const { default: SearchService } = await import('../../../services/searchService.js');
const { default: elasticsearchService } = await import('../../../services/elasticsearchService.js');
const { default: categoryMappingService } = await import('../../../services/categoryMappingService.js');
const { default: Product } = await import('../../../models/Product.js');

describe('SearchService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mocks setup
    elasticsearchService.isConnected.mockResolvedValue(false); // Default to MongoDB fallback
    
    // Mock Product.find chain
    const mockFind = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]), // Default empty result
    };
    Product.find.mockReturnValue(mockFind);
    Product.countDocuments.mockResolvedValue(0);
  });

  describe('searchProducts', () => {
    it('should use Elasticsearch when available', async () => {
      elasticsearchService.isConnected.mockResolvedValue(true);
      elasticsearchService.searchProducts.mockResolvedValue({
        products: [],
        pagination: { total: 0, page: 1, pages: 0 }
      });

      const params = { q: 'test' };
      await SearchService.searchProducts(params);

      expect(elasticsearchService.isConnected).toHaveBeenCalled();
      expect(elasticsearchService.searchProducts).toHaveBeenCalledWith(expect.objectContaining({ q: 'test' }));
      expect(Product.find).not.toHaveBeenCalled();
    });

    it('should fall back to MongoDB when Elasticsearch is unavailable', async () => {
      elasticsearchService.isConnected.mockResolvedValue(false);
      
      const params = { search: 'test' };
      await SearchService.searchProducts(params);

      expect(elasticsearchService.isConnected).toHaveBeenCalled();
      expect(Product.find).toHaveBeenCalled();
    });

    it('should fall back to MongoDB when Elasticsearch throws error', async () => {
      elasticsearchService.isConnected.mockResolvedValue(true);
      elasticsearchService.searchProducts.mockRejectedValue(new Error('ES Error'));

      const params = { search: 'test' };
      await SearchService.searchProducts(params);

      expect(elasticsearchService.searchProducts).toHaveBeenCalled();
      // Should catch error and call Product.find
      expect(Product.find).toHaveBeenCalled();
    });

    it('should apply brand filter in MongoDB query', async () => {
      const params = { brand: 'Toyota' };
      await SearchService.searchProducts(params);

      expect(Product.find).toHaveBeenCalledWith(expect.objectContaining({
        brand: expect.any(Object) // Regex or $in
      }));
    });

    it('should apply price range filter in MongoDB query', async () => {
      const params = { minPrice: '100', maxPrice: '500' };
      await SearchService.searchProducts(params);

      expect(Product.find).toHaveBeenCalledWith(expect.objectContaining({
        price: { $gte: 100, $lte: 500 }
      }));
    });

    it('should apply pagination', async () => {
      const params = { page: '2', limit: '20' };
      await SearchService.searchProducts(params);

      const mockFind = Product.find.mock.results[0].value;
      expect(mockFind.skip).toHaveBeenCalledWith(20); // (2-1) * 20
      expect(mockFind.limit).toHaveBeenCalledWith(20);
    });
    
    it('should handle category filtering correctly', async () => {
        const params = { category: 'tires' };
        
        // Mock category mapping
        categoryMappingService.findCategory.mockReturnValue({ _id: 'cat123' });
        categoryMappingService.getAllCategoryIdsIncludingChildren.mockResolvedValue(['cat123', 'cat456']);
        
        await SearchService.searchProducts(params);
        
        expect(categoryMappingService.findCategory).toHaveBeenCalledWith('tires');
        expect(Product.find).toHaveBeenCalledWith(expect.objectContaining({
            categories: { $in: ['cat123', 'cat456'] }
        }));
    });
  });
});
