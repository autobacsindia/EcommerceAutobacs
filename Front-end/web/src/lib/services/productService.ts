// ProductService for handling product data integration
// This service provides methods to work with both API-fetched products and static product data

import type { StockStatus } from '@/lib/stock';
import apiClient from '@/lib/api';
import { Product, ProductsData } from '@/lib/types';

// Type for our clean product data structure
interface CleanProductData {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category: {
    _id: string;
    name: string;
    slug?: string;
  } | string;
  brand?: string;
  images: Array<{
    url: string;
    alt?: string;
    isPrimary?: boolean;
  }>;
  stock: StockStatus;
  sku?: string;
  specifications?: Array<{
    key: string;
    value: string;
  }>;
  features?: string[];
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

class ProductService {
  // Fetch products from API (existing functionality)
  async fetchProductsFromAPI(params: Record<string, any> = {}): Promise<ProductsData> {
    try {
      const queryParams = new URLSearchParams();
      
      // Convert params to query string
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          queryParams.append(key, params[key].toString());
        }
      });
      
      const endpoint = `/products${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response: any = await apiClient.get(endpoint);
      
      return {
        products: response.products || [],
        pagination: {
          total: response.total,
          pages: response.pages,
          currentPage: response.currentPage,
          hasNext: response.hasNext,
          hasPrev: response.hasPrev,
          count: response.count
        }
      };
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Error fetching products from API:', error);
      }
      throw error;
    }
  }

  // Fetch a single product from API
  async fetchProductFromAPI(id: string): Promise<Product | null> {
    try {
      const response: any = await apiClient.get(`/products/${id}`);
      return response.product || null;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error(`Error fetching product ${id} from API:`, error);
      }
      return null;
    }
  }

  // Load products from static JSON file
  async loadStaticProducts(): Promise<CleanProductData[]> {
    try {
      // Load from static JSON file in public directory
      const response = await fetch('/data/products.json');
      if (!response.ok) {
        throw new Error(`Failed to load static products: ${response.status} ${response.statusText}`);
      }
      const products: CleanProductData[] = await response.json();
      return products;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Error loading static products:', error);
      }
      return [];
    }
  }

  // Get featured products (can use either API or static data)
  async getFeaturedProducts(limit: number = 6, useStaticData: boolean = false): Promise<CleanProductData[]> {
    if (useStaticData) {
      // Load from static data
      const staticProducts = await this.loadStaticProducts();
      return staticProducts
        .filter(product => product.isFeatured && product.isActive)
        .slice(0, limit);
    } else {
      // Fetch from API
      try {
        const response: any = await apiClient.get(`/products/featured?limit=${limit}`);
        return response.products || [];
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('Error fetching featured products from API:', error);
        }
        return [];
      }
    }
  }

  // Search products by keyword
  async searchProducts(
    keyword: string, 
    filters: {
      category?: string;
      brand?: string;
      minPrice?: number;
      maxPrice?: number;
      inStock?: boolean;
    } = {},
    useStaticData: boolean = false
  ): Promise<{ products: CleanProductData[], total: number }> {
    if (useStaticData) {
      // Search in static data
      const staticProducts = await this.loadStaticProducts();
      
      // Apply filters
      let filteredProducts = staticProducts.filter(product => {
        const matchesKeyword = product.name.toLowerCase().includes(keyword.toLowerCase()) ||
                             product.description.toLowerCase().includes(keyword.toLowerCase()) ||
                             (product.tags && product.tags.some(tag => tag.toLowerCase().includes(keyword.toLowerCase())));
        
        const matchesCategory = !filters.category || 
                               (typeof product.category === 'object' ? product.category._id === filters.category : product.category === filters.category);
        
        const matchesBrand = !filters.brand || product.brand === filters.brand;
        
        const matchesMinPrice = !filters.minPrice || product.price >= filters.minPrice;
        
        const matchesMaxPrice = !filters.maxPrice || product.price <= filters.maxPrice;
        
        const matchesInStock = !filters.inStock || product.stock !== 'out';
        
        return matchesKeyword && matchesCategory && matchesBrand && matchesMinPrice && matchesMaxPrice && matchesInStock;
      });
      
      return {
        products: filteredProducts,
        total: filteredProducts.length
      };
    } else {
      // Search via API
      try {
        const params: Record<string, any> = { search: keyword };
        
        if (filters.category) params.category = filters.category;
        if (filters.brand) params.brand = filters.brand;
        if (filters.minPrice) params.minPrice = filters.minPrice;
        if (filters.maxPrice) params.maxPrice = filters.maxPrice;
        if (filters.inStock) params.inStock = filters.inStock;
        
        const response = await this.fetchProductsFromAPI(params);
        return {
          products: response.products as CleanProductData[],
          total: response.pagination.total || response.products.length
        };
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('Error searching products via API:', error);
        }
        return { products: [], total: 0 };
      }
    }
  }

  // Get all brands
  async getBrands(limit: number = 50, useStaticData: boolean = false): Promise<{ name: string; _id: string; productCount?: number }[]> {
    if (useStaticData) {
      // Extract brands from static products
      const staticProducts = await this.loadStaticProducts();
      const brandCounts: Record<string, number> = {};
      
      staticProducts.forEach(product => {
        if (product.brand) {
          brandCounts[product.brand] = (brandCounts[product.brand] || 0) + 1;
        }
      });
      
      return Object.keys(brandCounts)
        .sort()
        .map(name => ({ 
          name, 
          _id: name.toLowerCase().replace(/\s+/g, '-'),
          productCount: brandCounts[name] 
        }));
    } else {
      try {
        // Product-brand filter only: exclude car makes (type:'make' — those belong
        // in the "My Vehicle" fitment section) and inactive brands.
        const response: any = await apiClient.get(`/brands?limit=${limit}&make=false&active=true`);
        const list: any[] = Array.isArray(response.brands) ? response.brands
                          : Array.isArray(response.data)   ? response.data
                          : [];
        return list
          // Drop stale brands that no longer have any live product.
          .filter((brand: any) => brand.productCount == null || brand.productCount > 0)
          .map((brand: any) => ({
            name: brand.name,
            _id: brand._id ?? brand.id ?? brand.slug ?? brand.name,
            productCount: brand.productCount
          }));
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('Error fetching brands from API:', error);
        }
        return [];
      }
    }
  }

  // Get products by category
  async getProductsByCategory(
    categoryId: string, 
    limit: number = 12,
    useStaticData: boolean = false
  ): Promise<CleanProductData[]> {
    if (useStaticData) {
      const staticProducts = await this.loadStaticProducts();
      return staticProducts
        .filter(product => 
          (typeof product.category === 'object' ? product.category._id === categoryId : product.category === categoryId)
        )
        .slice(0, limit);
    } else {
      try {
        const response = await this.fetchProductsFromAPI({ category: categoryId, limit });
        return response.products as CleanProductData[];
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(`Error fetching products for category ${categoryId}:`, error);
        }
        return [];
      }
    }
  }

  // Get products by brand
  async getProductsByBrand(
    brandName: string, 
    limit: number = 12,
    useStaticData: boolean = false
  ): Promise<CleanProductData[]> {
    if (useStaticData) {
      const staticProducts = await this.loadStaticProducts();
      return staticProducts
        .filter(product => product.brand === brandName)
        .slice(0, limit);
    } else {
      try {
        const response = await this.fetchProductsFromAPI({ brand: brandName, limit });
        return response.products as CleanProductData[];
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(`Error fetching products for brand ${brandName}:`, error);
        }
        return [];
      }
    }
  }

  // Clear product session/cache
  clearProductCache(): void {
    // In a real implementation, this would clear any cached product data
    // For now, we're just logging the action
    if (process.env.NODE_ENV !== 'test') {
      console.log('Product cache cleared');
    }
    
    // If using localStorage for caching, you might do something like:
    // localStorage.removeItem('cached_products');
    // localStorage.removeItem('featured_products');
  }

  // Format product data for display
  formatProductForDisplay(product: CleanProductData): Product {
    // Handle category which can be either an object or a string
    let formattedCategory: any;
    if (typeof product.category === 'object') {
      formattedCategory = {
        _id: product.category._id,
        name: product.category.name,
        slug: product.category.slug || '',
        isActive: true,
        order: 0
      };
    } else {
      // If category is a string, create a minimal category object
      formattedCategory = {
        _id: '',
        name: product.category as string,
        slug: '',
        isActive: true,
        order: 0
      };
    }
    
    return {
      _id: product._id,
      name: product.name,
      description: product.description,
      shortDescription: product.shortDescription,
      price: product.price,
      originalPrice: product.originalPrice,
      category: formattedCategory,
      brand: product.brand,
      images: product.images,
      stock: product.stock,
      sku: product.sku,
      specifications: product.specifications,
      features: product.features,
      isActive: product.isActive,
      isFeatured: product.isFeatured,
      averageRating: product.averageRating,
      totalReviews: product.totalReviews,
      tags: product.tags,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    };
  }

  // Get product placeholder image if none exists
  getProductPlaceholderImage(): string {
    // Return path to fallback image in public directory
    return '/images/fallback-product.png';
  }
}

// Create and export singleton instance
const productService = new ProductService();

export default productService;

// Export types for external use
export type { CleanProductData };