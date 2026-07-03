
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

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
    buildChildIndex: jest.fn(() => new Map()),
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
    it('should use Elasticsearch when available and it returns hits', async () => {
      elasticsearchService.isConnected.mockResolvedValue(true);
      elasticsearchService.searchProducts.mockResolvedValue({
        products: [{ _id: '1', name: 'Test Product' }],
        pagination: { total: 1, page: 1, pages: 1 }
      });

      const params = { q: 'test' };
      await SearchService.searchProducts(params);

      expect(elasticsearchService.isConnected).toHaveBeenCalled();
      expect(elasticsearchService.searchProducts).toHaveBeenCalledWith(expect.objectContaining({ q: 'test' }));
      expect(Product.find).not.toHaveBeenCalled();
    });

    it('should fall back to MongoDB when Elasticsearch returns zero hits (empty-index guard)', async () => {
      // ES does not throw on an empty/wiped index; it returns zero hits. The
      // service must treat that as a fallback trigger, not surface "no results".
      elasticsearchService.isConnected.mockResolvedValue(true);
      elasticsearchService.searchProducts.mockResolvedValue({
        products: [],
        pagination: { total: 0, page: 1, pages: 0 }
      });

      const params = { search: 'test' };
      await SearchService.searchProducts(params);

      expect(elasticsearchService.searchProducts).toHaveBeenCalled();
      expect(Product.find).toHaveBeenCalled();
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
      // synonym regexes are anchored to whole words (\b…\b) so "led" doesn't match "installed"
      const nameBranch = queryArg.$or.find((c) => c.name instanceof RegExp);
      expect(nameBranch.name.source.startsWith('\\b')).toBe(true);
      expect(nameBranch.name.source.endsWith('\\b')).toBe(true);
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
      categoryMappingService.buildChildIndex.mockReturnValue(new Map());
      Product.aggregate
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([{ _id: 'Auxbeam', count: 12 }, { _id: 'BMC', count: 3 }]) })
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([{ _id: 'cat1', ids: ['p1', 'p2', 'p3'] }]) });

      const facets = await SearchService.getFacets({ category: 'lighting' });

      expect(facets.brands).toEqual([
        { name: 'Auxbeam', count: 12 },
        { name: 'BMC', count: 3 },
      ]);
      expect(facets.categories).toEqual([{ categoryId: 'cat1', count: 3 }]);
    });

    it('getFacets rolls direct category id sets up the tree so a hub reflects its subtree', async () => {
      // Tree: hub -> [subA, subB]. Products are tagged on the leaves only, so
      // the hub has NO direct products — its badge must equal |subA ∪ subB|.
      categoryMappingService.findCategory.mockReturnValue(null);
      categoryMappingService.buildChildIndex.mockReturnValue(new Map([
        ['hub', [{ _id: 'subA' }, { _id: 'subB' }]],
      ]));
      Product.aggregate
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([
          { _id: 'subA', ids: ['p1', 'p2', 'p3'] },
          { _id: 'subB', ids: ['p4', 'p5'] },
        ]) });

      const facets = await SearchService.getFacets({});

      expect(facets.categories).toEqual([
        { categoryId: 'hub', count: 5 },
        { categoryId: 'subA', count: 3 },
        { categoryId: 'subB', count: 2 },
      ]);
    });

    it('getFacets counts a product ONCE when it is tagged with multiple categories in the subtree', async () => {
      // Regression: p1 is tagged with both the hub and subA (and p2 with subA
      // and subB). A sum-based rollup reported 132 vs the listing's 120; the
      // distinct union must count each product once → hub badge = |{p1,p2,p3}| = 3.
      categoryMappingService.findCategory.mockReturnValue(null);
      categoryMappingService.buildChildIndex.mockReturnValue(new Map([
        ['hub', [{ _id: 'subA' }, { _id: 'subB' }]],
      ]));
      Product.aggregate
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ option: jest.fn().mockResolvedValue([
          { _id: 'hub', ids: ['p1'] },
          { _id: 'subA', ids: ['p1', 'p2'] },
          { _id: 'subB', ids: ['p2', 'p3'] },
        ]) });

      const facets = await SearchService.getFacets({});

      expect(facets.categories).toEqual([
        { categoryId: 'hub', count: 3 },
        { categoryId: 'subA', count: 2 },
        { categoryId: 'subB', count: 2 },
      ]);
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

    it('casts valid category id strings to ObjectId (so facet aggregations match)', async () => {
        const hexId = '507f1f77bcf86cd799439011';
        categoryMappingService.findCategory.mockReturnValue({ _id: hexId });
        categoryMappingService.getAllCategoryIdsIncludingChildren.mockResolvedValue([hexId]);

        await SearchService.searchProducts({ category: hexId });

        const queryArg = Product.find.mock.calls[0][0];
        const ids = queryArg.categories.$in;
        expect(ids[0]).toBeInstanceOf(mongoose.Types.ObjectId);
        expect(String(ids[0])).toBe(hexId);
    });
  });

  describe('getSimilarProducts / getComplementaryProducts relevance', () => {
    const ID = '507f1f77bcf86cd799439011';

    // Chainable query mock whose terminal .maxTimeMS() resolves the candidates.
    function findChain(result) {
      const chain = {};
      ['select', 'limit', 'populate', 'sort'].forEach((m) => { chain[m] = jest.fn(() => chain); });
      chain.lean = jest.fn(() => chain);
      chain.maxTimeMS = jest.fn().mockResolvedValue(result);
      return chain;
    }
    // findById(...).select(...).populate(...).lean() resolver
    function byIdDoc(doc) {
      const chain = {};
      chain.select = jest.fn(() => chain);
      chain.populate = jest.fn(() => chain);
      chain.lean = jest.fn().mockResolvedValue(doc);
      return chain;
    }

    it('returns [] for similar when the product shares no structured signal (no random fill)', async () => {
      Product.findById = jest.fn().mockReturnValue(byIdDoc({
        _id: ID, name: 'Zzz Nondescript Thing', price: 100, brand: '', categories: [], compatibleVehicles: [],
      }));

      const result = await SearchService.getSimilarProducts(ID, 4);

      expect(result).toEqual([]);
      expect(Product.find).not.toHaveBeenCalled(); // never queries when nothing to relate on
    });

    it('ranks a shared-category candidate above a brand-only candidate', async () => {
      Product.findById = jest.fn().mockReturnValue(byIdDoc({
        _id: ID, name: 'Generic Item', price: 100, brand: 'BrandX',
        categories: ['catA'], compatibleVehicles: [],
      }));
      const sharedCategory = { _id: 'c1', name: 'Shared Cat', price: 100, brand: 'Other', categories: [{ _id: 'catA' }], compatibleVehicles: [] };
      const brandOnly      = { _id: 'c2', name: 'Brand Match', price: 100, brand: 'BrandX', categories: [{ _id: 'catZ' }], compatibleVehicles: [] };
      Product.find.mockReturnValue(findChain([brandOnly, sharedCategory])); // unsorted input

      const result = await SearchService.getSimilarProducts(ID, 4);

      expect(result.map((p) => p._id)).toEqual(['c1', 'c2']); // category (5) > brand (2)
    });

    it('returns [] for complementary when nothing is genuinely complementary (no last resort)', async () => {
      Product.findById = jest.fn().mockReturnValue(byIdDoc({
        _id: ID, name: 'Lonely Nondescript Thing', complementaryProducts: [], categories: [], compatibleVehicles: [],
      }));

      const result = await SearchService.getComplementaryProducts(ID, 4);

      expect(result).toEqual([]);
    });
  });
});
