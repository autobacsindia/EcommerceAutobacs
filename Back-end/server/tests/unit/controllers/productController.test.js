import { jest } from '@jest/globals';

// Mock dependencies
const mockProduct = {
  find: jest.fn(),
  aggregate: jest.fn(),
};

const mockSearchService = {
  searchProducts: jest.fn(),
  addToSearchHistory: jest.fn().mockResolvedValue({ success: true }),
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

// getProducts wraps SearchService in a cache-aside read; without mocking the cache
// the real one runs and can short-circuit the call entirely, so searchProducts
// records zero invocations and the failure looks like a broken controller.
const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
  wrap: jest.fn((key, fn) => fn()),
  // getProducts uses getWithLock (single-flight against a cold cache), not wrap.
  // Omitting it left the call returning undefined, so fetchList never ran and
  // SearchService recorded zero invocations.
  getWithLock: jest.fn((key, fn) => fn()),
  generateKey: jest.fn(() => 'k'),
};

const mockProductService = {
  getProductsByVehicle: jest.fn(),
  getFeaturedProducts: jest.fn(),
  getOfferProducts: jest.fn(),
  getBrandsWithCounts: jest.fn(),
};

// Setup mocks
jest.unstable_mockModule('../../../models/Product.js', () => ({ default: mockProduct }));
jest.unstable_mockModule('../../../services/searchService.js', () => ({ default: mockSearchService }));
jest.unstable_mockModule('../../../models/Brand.js', () => ({ default: mockBrand }));
jest.unstable_mockModule('../../../models/Vehicle.js', () => ({ default: mockVehicle }));
jest.unstable_mockModule('../../../services/productService.js', () => ({ default: mockProductService }));
jest.unstable_mockModule('../../../services/cacheService.js', () => ({
  default: mockCacheService,
  CACHE_VERSION: 'v1',
  TTL: { PRODUCT_LIST: 300, PRODUCT_FEATURED: 3600, PRODUCT_OFFERS: 1800, BRANDS: 7200 },
}));

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
    
    // jest.config.js sets `resetMocks: true`, which strips the implementations the
    // mock factories supplied. getWithLock then returns undefined instead of
    // invoking fetchList, so SearchService is never called and the failure reads as
    // "Number of calls: 0" with no error anywhere.
    mockCacheService.get.mockResolvedValue(null);
    mockCacheService.getWithLock.mockImplementation((key, fn) => fn());
    mockCacheService.wrap.mockImplementation((key, fn) => fn());
    mockCacheService.generateKey.mockReturnValue('k');

    // `originalUrl` and `headers` are required by buildResponseKey (it splits the
    // URL on '?' and reads accept-language); without them getProducts threw
    // "Cannot read properties of undefined (reading 'split')" before ever calling
    // SearchService, which surfaced only as "Number of calls: 0".
    req = {
      query: {},
      params: {},
      originalUrl: '/api/v1/products',
      headers: {},
    };

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
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
        // Always present, on both engines, so the storefront never branches on
        // undefined when deciding whether to show "showing related results".
        relaxed: false,
        // The search page reads corrections from HERE now, not from a second call
        // to /products/suggestions — one probe per search instead of two, and one
        // fewer round trip on every zero-result search.
        corrections: [],
        count: 1,
        ...mockResults.pagination,
        products: mockResults.products,
        facets: mockResults.facets
      });
    });

    it('records the search, with its result count, for analytics', async () => {
      // The write half of search analytics did not exist: addToSearchHistory had no
      // callers anywhere, so the popular-terms counters were never written and the
      // admin analytics screen had always been empty.
      mockSearchService.searchProducts.mockResolvedValue({
        products: [], pagination: { total: 0 }, facets: {},
      });
      req.query = { search: 'roof tent' };

      await getProducts(req, res);

      // A zero-result search is the one worth recording — it is the merchandising
      // worklist. The count must be threaded, not dropped.
      expect(mockSearchService.addToSearchHistory).toHaveBeenCalledWith('roof tent', 0, null);
    });

    it('does not log anything for a filters-only browse', async () => {
      mockSearchService.searchProducts.mockResolvedValue({
        products: [], pagination: { total: 5 }, facets: {},
      });
      req.query = { brand: 'Auxbeam' };

      await getProducts(req, res);
      expect(mockSearchService.addToSearchHistory).not.toHaveBeenCalled();
    });

    it('still answers the request when analytics logging throws', async () => {
      // Analytics must never be able to fail a search. A synchronous throw here
      // previously escaped into the request and turned the listing into a 500.
      mockSearchService.searchProducts.mockResolvedValue({
        products: [], pagination: { total: 1 }, facets: {},
      });
      mockSearchService.addToSearchHistory.mockImplementationOnce(() => {
        throw new Error('redis exploded');
      });
      req.query = { search: 'winch' };

      await getProducts(req, res);

      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getFeaturedProducts', () => {
    it('should return featured products', async () => {
      // Query-building moved into productService (which caches); the controller
      // just parses `limit` and shapes the response. Asserting on Product.find
      // here tested the pre-service architecture.
      const mockProducts = [{ name: 'Featured 1' }];
      mockProductService.getFeaturedProducts.mockResolvedValue(mockProducts);

      req.query = { limit: '10' };
      await getFeaturedProducts(req, res);

      expect(mockProductService.getFeaturedProducts).toHaveBeenCalledWith(10);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        products: mockProducts
      });
    });
  });

  describe('getOfferProducts', () => {
    it('should return offer products with pagination metadata', async () => {
      const mockProducts = [{ name: 'Sale 1', price: 100, originalPrice: 200 }];
      mockProductService.getOfferProducts.mockResolvedValue({ products: mockProducts, total: 1 });

      req.query = { limit: '10' };
      await getOfferProducts(req, res);

      expect(mockProductService.getOfferProducts).toHaveBeenCalledWith({ page: 1, limit: 10 });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        total: 1,
        pages: 1,
        currentPage: 1,
        hasNext: false,
        hasPrev: false,
        products: mockProducts
      });
    });

    it('passes the requested page through and computes hasNext/hasPrev off the total', async () => {
      const mockProducts = [{ name: 'Sale Page 2' }];
      // 25 total items at limit 10 → 3 pages; page 2 has both a next and a prev.
      mockProductService.getOfferProducts.mockResolvedValue({ products: mockProducts, total: 25 });

      req.query = { limit: '10', page: '2' };
      await getOfferProducts(req, res);

      expect(mockProductService.getOfferProducts).toHaveBeenCalledWith({ page: 2, limit: 10 });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        currentPage: 2,
        pages: 3,
        hasNext: true,
        hasPrev: true,
      }));
    });

    it('caps an oversized client-supplied limit rather than passing it straight to the query', async () => {
      mockProductService.getOfferProducts.mockResolvedValue({ products: [], total: 0 });

      req.query = { limit: '999999' };
      await getOfferProducts(req, res);

      expect(mockProductService.getOfferProducts).toHaveBeenCalledWith({ page: 1, limit: 100 });
    });

    it('floors a page below 1 to page 1 instead of computing a negative skip', async () => {
      mockProductService.getOfferProducts.mockResolvedValue({ products: [], total: 0 });

      req.query = { page: '0' };
      await getOfferProducts(req, res);

      expect(mockProductService.getOfferProducts).toHaveBeenCalledWith({ page: 1, limit: 24 });
    });
  });

  describe('getProductsByVehicle', () => {
    // Vehicle resolution (ObjectId vs slug vs prefix vs make) lives in
    // productRepository.findVehicleByIdOrSlug now; the controller only reacts to
    // the service returning null. Asserting on Vehicle.findOne / ObjectId.isValid
    // here tested an architecture that no longer exists.
    it('404s when the service cannot resolve the vehicle', async () => {
      req.params.vehicleId = 'test-slug';
      mockProductService.getProductsByVehicle.mockResolvedValue(null);

      await getProductsByVehicle(req, res);

      expect(mockProductService.getProductsByVehicle).toHaveBeenCalledWith('test-slug', req.query);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns the service payload for a resolved vehicle', async () => {
      req.params.vehicleId = 'valid-id';
      mockProductService.getProductsByVehicle.mockResolvedValue({
        vehicle: { _id: 'valid-id', make: 'Toyota', model: 'Corolla', slug: 'toyota-corolla' },
        products: [],
        pagination: {},
        facets: {},
      });

      await getProductsByVehicle(req, res);

      expect(mockProductService.getProductsByVehicle).toHaveBeenCalledWith('valid-id', req.query);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getBrands', () => {
    // Brand aggregation + the zero-count filter live in
    // productService.getBrandsWithCounts now, so the controller is a pass-through.
    it('should return brands with product counts', async () => {
      const brands = [
        { id: '1', name: 'Brand A', slug: 'brand-a', productCount: 5, logo: null, description: null },
      ];
      mockProductService.getBrandsWithCounts.mockResolvedValue(brands);

      await getBrands(req, res);

      expect(mockProductService.getBrandsWithCounts).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, brands });
    });

    it('passes through whatever the service returns, including an empty list', async () => {
      // The 0-count filter is the service's job — this asserts the controller does
      // not second-guess it.
      mockProductService.getBrandsWithCounts.mockResolvedValue([]);

      await getBrands(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, brands: [] });
    });
  });
});
