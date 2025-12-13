// ProductService for handling product data integration
// This service provides methods to work with both API-fetched products and static product data

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
  stock: number;
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
      console.error('Error fetching products from API:', error);
      throw error;
    }
  }

  // Fetch a single product from API
  async fetchProductFromAPI(id: string): Promise<Product | null> {
    try {
      const response: any = await apiClient.get(`/products/${id}`);
      return response.product || null;
    } catch (error) {
      console.error(`Error fetching product ${id} from API:`, error);
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
      console.error('Error loading static products:', error);
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
        console.error('Error fetching featured products from API:', error);
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
        
        const matchesInStock = !filters.inStock || product.stock > 0;
        
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
        console.error('Error searching products via API:', error);
        return { products: [], total: 0 };
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
        console.error(`Error fetching products for category ${categoryId}:`, error);
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
        console.error(`Error fetching products for brand ${brandName}:`, error);
        return [];
      }
    }
  }

  // Clear product session/cache
  clearProductCache(): void {
    // In a real implementation, this would clear any cached product data
    // For now, we're just logging the action
    console.log('Product cache cleared');
    
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