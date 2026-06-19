
import productService from './productService';
import apiClient from '@/lib/api';

// Mock API Client
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
}));

describe('ProductService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchProductsFromAPI', () => {
    it('fetches products successfully', async () => {
      const mockResponse = {
        products: [{ id: 1, name: 'Product 1' }],
        total: 10,
        pages: 2,
        currentPage: 1,
        hasNext: true,
        hasPrev: false,
        count: 1,
      };

      (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await productService.fetchProductsFromAPI({ page: 1 });

      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/products?page=1'));
      expect(result.products).toEqual(mockResponse.products);
      expect(result.pagination.total).toBe(10);
    });

    it('handles errors during fetch', async () => {
      const error = new Error('API Error');
      (apiClient.get as jest.Mock).mockRejectedValue(error);

      await expect(productService.fetchProductsFromAPI()).rejects.toThrow('API Error');
    });
  });

  describe('fetchProductFromAPI', () => {
    it('fetches a single product successfully', async () => {
      const mockProduct = { id: 'p1', name: 'Product 1' };
      (apiClient.get as jest.Mock).mockResolvedValue({ product: mockProduct });

      const result = await productService.fetchProductFromAPI('p1');

      expect(apiClient.get).toHaveBeenCalledWith('/products/p1');
      expect(result).toEqual(mockProduct);
    });

    it('returns null on error', async () => {
      (apiClient.get as jest.Mock).mockRejectedValue(new Error('Not Found'));

      const result = await productService.fetchProductFromAPI('p1');

      expect(result).toBeNull();
    });
  });

  describe('getFeaturedProducts', () => {
    it('fetches featured products from API', async () => {
      const mockProducts = [{ id: 'p1', isFeatured: true }];
      (apiClient.get as jest.Mock).mockResolvedValue({ products: mockProducts });

      const result = await productService.getFeaturedProducts(4, false);

      expect(apiClient.get).toHaveBeenCalledWith('/products/featured?limit=4');
      expect(result).toEqual(mockProducts);
    });

    it('returns empty array on API error', async () => {
      (apiClient.get as jest.Mock).mockRejectedValue(new Error('API Error'));

      const result = await productService.getFeaturedProducts(4, false);

      expect(result).toEqual([]);
    });
  });

  describe('searchProducts', () => {
    it('searches products via API', async () => {
      const mockProducts = [{ id: 'p1', name: 'Test Product' }];
      
      // Since searchProducts calls fetchProductsFromAPI, we need to mock the response 
      // structure expected by fetchProductsFromAPI
      (apiClient.get as jest.Mock).mockResolvedValue({
          products: mockProducts,
          total: 1,
          pages: 1,
          currentPage: 1,
          hasNext: false,
          hasPrev: false,
          count: 1
      });

      const result = await productService.searchProducts('test', { category: 'cat1' }, false);

      // Verify the calls. Note that searchProducts constructs params and calls fetchProductsFromAPI
      // which then calls apiClient.get with constructed query string.
      // We check if apiClient.get was called with something containing our params.
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/products'));
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('search=test'));
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('category=cat1'));
      expect(result.products).toEqual(mockProducts);
    });
  });

  describe('formatProductForDisplay', () => {
    it('formats product with object category correctly', () => {
      const mockProduct: any = {
        _id: 'p1',
        name: 'Product 1',
        description: 'Desc',
        price: 100,
        category: { _id: 'c1', name: 'Cat 1', slug: 'cat-1' },
        brand: 'Brand 1',
        images: [],
        stock: 'in',
        isActive: true,
        isFeatured: false,
        averageRating: 0,
        totalReviews: 0,
        createdAt: '2023-01-01',
        updatedAt: '2023-01-01',
      };

      const result = productService.formatProductForDisplay(mockProduct);

      expect(result._id).toBe('p1');
      expect(result.category).toEqual({
        _id: 'c1',
        name: 'Cat 1',
        slug: 'cat-1',
        isActive: true,
        order: 0,
      });
    });

    it('formats product with string category correctly', () => {
      const mockProduct: any = {
        _id: 'p1',
        name: 'Product 1',
        description: 'Desc',
        price: 100,
        category: 'Cat String', // String category
        brand: 'Brand 1',
        images: [],
        stock: 'in',
        isActive: true,
        isFeatured: false,
        averageRating: 0,
        totalReviews: 0,
        createdAt: '2023-01-01',
        updatedAt: '2023-01-01',
      };

      const result = productService.formatProductForDisplay(mockProduct);

      expect(result._id).toBe('p1');
      expect(result.category).toEqual({
        _id: '',
        name: 'Cat String',
        slug: '',
        isActive: true,
        order: 0,
      });
    });
  });

  describe('getProductPlaceholderImage', () => {
    it('returns correct placeholder path', () => {
      expect(productService.getProductPlaceholderImage()).toBe('/images/fallback-product.png');
    });
  });
});
