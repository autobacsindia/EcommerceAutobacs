
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
    aggregate: jest.fn(),
  }
}));

jest.unstable_mockModule('../../../models/Vehicle.js', () => ({
  default: {
    find: jest.fn(),
  }
}));

// Import the module under test using dynamic import to apply mocks
const { default: SearchService } = await import('../../../services/searchService.js');
const { default: elasticsearchService } = await import('../../../services/elasticsearchService.js');
const { default: categoryMappingService } = await import('../../../services/categoryMappingService.js');
const { default: Product } = await import('../../../models/Product.js');
const { default: Vehicle } = await import('../../../models/Vehicle.js');

describe('SearchService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mocks setup
    elasticsearchService.isConnected.mockResolvedValue(false); // Default to MongoDB fallback
    
    // Mock Product.find chain. The service terminates the chain with
    // `.lean().maxTimeMS(ms)`, so maxTimeMS (not lean) resolves the documents.
    const mockFind = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      maxTimeMS: jest.fn().mockResolvedValue([]), // Default empty result
    };
    Product.find.mockReturnValue(mockFind);
    // countDocuments is also chained with `.maxTimeMS(ms)`.
    Product.countDocuments.mockReturnValue({ maxTimeMS: jest.fn().mockResolvedValue(0) });
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
    
    it('should build a broad $or matching text fields and the category branch for a search term', async () => {
      // "lights" resolves to the Lighting category tree via synonyms + category lookup.
      categoryMappingService.findCategory.mockImplementation((t) =>
        t === 'lighting' || t === 'lights' ? { _id: 'lightingCat' } : null
      );
      categoryMappingService.getAllCategoryIdsIncludingChildren.mockResolvedValue([
        'lightingCat',
        'ambientCat',
      ]);

      await SearchService.searchProducts({ search: 'lights' });

      const queryArg = Product.find.mock.calls[0][0];
      expect(Array.isArray(queryArg.$or)).toBe(true);
      // text-field branches present
      expect(queryArg.$or).toEqual(
        expect.arrayContaining([{ name: expect.any(RegExp) }])
      );
      // category-tree branch OR'd in (this is what restores "lights" -> all lights)
      expect(queryArg.$or).toEqual(
        expect.arrayContaining([
          { categories: { $in: ['lightingCat', 'ambientCat'] } },
        ])
      );
    });

    it('should not set $text (broad regex path replaces the text-index-first approach)', async () => {
      await SearchService.searchProducts({ search: 'anything' });
      const queryArg = Product.find.mock.calls[0][0];
      expect(queryArg.$text).toBeUndefined();
    });

    it('should resolve vehicleMake/vehicleModel to compatibleVehicles ids', async () => {
      Vehicle.find.mockReturnValue({
        select: () => ({ lean: () => ({ maxTimeMS: jest.fn().mockResolvedValue([{ _id: 'v1' }, { _id: 'v2' }]) }) }),
      });

      await SearchService.searchProducts({ vehicleMake: 'Toyota', vehicleModel: 'Fortuner' });

      expect(Vehicle.find).toHaveBeenCalledWith(expect.objectContaining({
        make: expect.any(RegExp),
        model: expect.any(RegExp),
      }));
      expect(Product.find).toHaveBeenCalledWith(expect.objectContaining({
        compatibleVehicles: { $in: ['v1', 'v2'] },
      }));
    });

    it('getFacets returns per-brand and per-category counts', async () => {
      categoryMappingService.findCategory.mockReturnValue({ _id: 'lightingCat' });
      categoryMappingService.getAllCategoryIdsIncludingChildren.mockResolvedValue(['lightingCat']);
      Product.aggregate
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([{ _id: 'Auxbeam', count: 12 }, { _id: 'BMC', count: 3 }]) })
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([{ _id: 'cat1', count: 44 }]) });

      const facets = await SearchService.getFacets({ category: 'lighting' });

      expect(facets.brands).toEqual([
        { name: 'Auxbeam', count: 12 },
        { name: 'BMC', count: 3 },
      ]);
      expect(facets.categories).toEqual([{ categoryId: 'cat1', count: 44 }]);
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
