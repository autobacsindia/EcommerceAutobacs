'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilters from '@/components/products/ProductFilters';
import ProductFetchError from '@/components/products/ProductFetchError';
import VehicleFilterSidebar from '@/components/vehicles/VehicleFilterSidebar';
import Pagination from '@/components/layout/Pagination';
import apiClient, { ApiError, ErrorCategory } from '@/lib/api';
import productService from '@/lib/services/productService';
import { Product, ProductsData, Pagination as PaginationType } from '@/lib/types';

// Enhanced function to fetch products with static data fallback
async function getProducts(searchParams: any, useStaticData: boolean = false): Promise<ProductsData> {
  // Try static data first if enabled
  if (useStaticData) {
    try {
      // Convert search params to filters for static data
      const filters: any = {};
      if (searchParams.category) filters.category = searchParams.category;
      if (searchParams.brand) filters.brand = searchParams.brand;
      if (searchParams.minPrice) filters.minPrice = parseFloat(searchParams.minPrice);
      if (searchParams.maxPrice) filters.maxPrice = parseFloat(searchParams.maxPrice);
      if (searchParams.inStock) filters.inStock = searchParams.inStock === 'true';
      
      const searchKeyword = searchParams.search || '';
      const page = searchParams.page ? parseInt(searchParams.page) : 1;
      const limit = searchParams.limit ? parseInt(searchParams.limit) : 12;
      
      // Search in static data
      const result = await productService.searchProducts(searchKeyword, filters, true);
      
      // Implement pagination for static data
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedProducts = result.products.slice(startIndex, endIndex);
      
      return {
        products: paginatedProducts.map(p => productService.formatProductForDisplay(p)),
        pagination: {
          total: result.total,
          pages: Math.ceil(result.total / limit),
          currentPage: page,
          hasNext: endIndex < result.total,
          hasPrev: page > 1,
          count: paginatedProducts.length
        }
      };
    } catch (error) {
      console.warn('Failed to load from static data, falling back to API:', error);
      // Fall through to API implementation
    }
  }
  
  // Original API implementation
  let lastError: any;
  const retries = 3;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Build query string from search params
      const queryParams = new URLSearchParams();
      
      // Handle multiple categories
      if (searchParams.category) {
        queryParams.append('category', searchParams.category);
      }
      
      if (searchParams.search) queryParams.append('search', searchParams.search);
      if (searchParams.page) queryParams.append('page', searchParams.page);
      if (searchParams.minPrice) queryParams.append('minPrice', searchParams.minPrice);
      if (searchParams.maxPrice) queryParams.append('maxPrice', searchParams.maxPrice);
      if (searchParams.inStock) queryParams.append('inStock', searchParams.inStock);
      
      // Handle multiple ratings
      if (searchParams.rating) {
        queryParams.append('rating', searchParams.rating);
      }
      
      if (searchParams.vehicleMake) queryParams.append('vehicleMake', searchParams.vehicleMake);
      if (searchParams.vehicleModel) queryParams.append('vehicleModel', searchParams.vehicleModel);
      
      // Handle multiple brands
      if (searchParams.brand) {
        queryParams.append('brand', searchParams.brand);
      }
      
      if (searchParams.showAll === 'true') queryParams.append('limit', '500'); // Show all products (increased limit for larger catalogs)
      
      // Map frontend sort values to backend parameters
      if (searchParams.sort) {
        const sortValue = searchParams.sort;
        switch (sortValue) {
          case 'price_asc':
            queryParams.append('sortBy', 'price');
            queryParams.append('order', 'asc');
            break;
          case 'price_desc':
            queryParams.append('sortBy', 'price');
            queryParams.append('order', 'desc');
            break;
          case 'name_asc':
            queryParams.append('sortBy', 'name');
            queryParams.append('order', 'asc');
            break;
          case 'rating_desc':
            queryParams.append('sortBy', 'averageRating');
            queryParams.append('order', 'desc');
            break;
          case 'createdAt_desc':
          default:
            queryParams.append('sortBy', 'createdAt');
            queryParams.append('order', 'desc');
            break;
        }
      }
      
      const queryString = queryParams.toString();
      const endpoint = `/products${queryString ? `?${queryString}` : ''}`;
      
      // Use the API client which has the increased timeout (30 seconds)
      const data: any = await apiClient.get(endpoint);
      
      // Fix: Backend returns pagination properties directly in response object
      if (data && data.products) {
        // Extract pagination properties from the response
        const { total, pages, currentPage, hasNext, hasPrev, count } = data;
        return {
          products: data.products,
          pagination: {
            total,
            pages,
            currentPage,
            hasNext,
            hasPrev,
            count
          }
        };
      }
      return { products: [], pagination: {} };
    } catch (error: any) {
      lastError = error;
      
      // Log error with more detailed context
      const errorInfo = {
        message: error.message || error.toString(),
        name: error.name,
        status: error.status,
        category: error.category,
        searchParams,
        timestamp: new Date().toISOString(),
        errorDetails: {
          message: error.message,
          name: error.name,
          stack: error.stack,
          url: error.url,
          responseStatus: error.responseStatus,
          rawData: error.rawData
        }
      };
      
      console.error(`Error fetching products (attempt ${attempt + 1}/${retries + 1}):`, errorInfo);
      
      // If this is the last attempt, re-throw the error
      if (attempt === retries) {
        // Provide a more user-friendly error message
        if (error.category === 'network' || error.status === 0) {
          throw new Error('Unable to connect to the server. Please make sure the backend server is running on port 5002.');
        }
        throw error;
      }
      
      // Calculate delay based on error category
      let delay: number;
      if (error instanceof ApiError && error.category === ErrorCategory.SERVER) {
        delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s, etc.
      } else if (error instanceof ApiError && error.category === ErrorCategory.NETWORK) {
        delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, etc.
      } else if (error instanceof ApiError && error.category === ErrorCategory.TIMEOUT) {
        delay = Math.pow(2, attempt) * 3000; // 3s, 6s, 12s, etc.
      } else {
        delay = Math.pow(2, attempt) * 500; // 0.5s, 1s, 2s, etc.
      }
      
      // Add some randomization to prevent thundering herd
      const randomizedDelay = delay * (0.8 + Math.random() * 0.4);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, randomizedDelay));
    }
  }
  
  // This should never be reached, but just in case
  throw lastError;
}

export default function OptimizedProductsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [useStaticData, setUseStaticData] = useState(true); // Default to static data for better performance
  
  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'createdAt_desc';
  const showAll = searchParams.get('showAll') === 'true';
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  // Helper functions to safely access pagination properties
  const getPaginationTotal = (pagination: PaginationType | undefined) => {
    return pagination && 'total' in pagination ? pagination.total : undefined;
  };

  const getPaginationPages = (pagination: PaginationType | undefined) => {
    return pagination && 'pages' in pagination ? pagination.pages : undefined;
  };

  const getPaginationPage = (pagination: PaginationType | undefined) => {
    return pagination && 'currentPage' in pagination ? pagination.currentPage : undefined;
  };

  // Fetch products when search params change
  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      if (!isMounted) return;
      
      if (isMounted) {
        setLoading(true);
        setError(null);
      }
      
      try {
        const resolvedSearchParams = Object.fromEntries(searchParams.entries());
        const result = await getProducts(resolvedSearchParams, useStaticData);
        if (isMounted) {
          setData(result);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err);
          // Log error to analytics service with better serialization
          const errorInfo = {
            message: err.message || 'Unknown error',
            name: err.name,
            stack: err.stack,
            timestamp: new Date().toISOString(),
            status: err.status,
            url: err.url,
            category: err.category
          };
          console.error('Failed to fetch products after all retries:', errorInfo);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    fetchData();
    
    return () => {
      isMounted = false;
    };
  }, [searchParams, useStaticData]);

  // Handle sort change
  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortValue = e.target.value;
    const currentParams = new URLSearchParams(searchParams.toString());
    
    // Remove existing sort parameter
    currentParams.delete('sort');
    
    // Add new sort parameter if it's not the default
    if (sortValue !== 'createdAt_desc') {
      currentParams.set('sort', sortValue);
    }
    
    // Reset to first page when sorting (unless showing all)
    if (!showAll) {
      currentParams.delete('page');
    }
    
    // Update URL which will trigger useEffect
    router.push(`/products?${currentParams.toString()}`);
  };

  // Handle show all toggle
  const handleShowAllToggle = () => {
    const currentParams = new URLSearchParams(searchParams.toString());
    
    if (showAll) {
      currentParams.delete('showAll');
      currentParams.delete('limit');
      // Reset to first page when switching back to paginated view
      currentParams.delete('page');
    } else {
      currentParams.set('showAll', 'true');
    }
    
    // Update URL which will trigger useEffect
    router.push(`/products?${currentParams.toString()}`);
  };

  // Handle retry
  const handleRetry = () => {
    // Force a refetch by updating the search params (which triggers the useEffect)
    router.refresh();
  };

  // Toggle between static data and API
  const toggleDataSource = () => {
    setUseStaticData(!useStaticData);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold mb-2">Our Products</h1>
          <p className="text-blue-100">
            Explore our premium collection of automotive accessories and performance parts
          </p>
        </div>
      </div>

      {/* Data Source Toggle */}
      <div className="bg-indigo-50 border-b border-indigo-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-indigo-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <p className="text-indigo-800 text-sm">
                <span className="font-medium">Performance Mode:</span> Using {useStaticData ? 'static data (faster)' : 'API data (real-time)'}
              </p>
            </div>
            <button 
              onClick={toggleDataSource}
              className="text-sm bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 transition-colors"
            >
              Switch to {useStaticData ? 'API' : 'Static'} Data
            </button>
          </div>
        </div>
      </div>

      {/* Info Banner for Sample Data */}
      <div className="bg-yellow-50 border-b border-yellow-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-yellow-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="text-yellow-800 text-sm">
              <span className="font-medium">Note:</span> Currently displaying sample products with placeholder images. 
              Real product data will be imported from WordPress.
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Filters Sidebar */}
          <aside className="hidden lg:block space-y-6">
            <ProductFilters />
          </aside>

          {/* Products Grid */}
          <div className="lg:col-span-3">
            {/* Results Header */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-gray-600">
                {loading ? (
                  'Loading products...'
                ) : data.products.length > 0 ? (
                  <>
                    {showAll ? (
                      `Showing all ${data.products.length} product${data.products.length !== 1 ? 's' : ''}`
                    ) : (
                      <>
                        Showing {data.products.length} product{data.products.length !== 1 ? 's' : ''}
                        {getPaginationTotal(data.pagination) && ` of ${getPaginationTotal(data.pagination)}`}
                      </>
                    )}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              {/* Controls */}
              <div className="flex items-center gap-4">
                {/* Show All Toggle */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="showAll"
                    checked={showAll}
                    onChange={handleShowAllToggle}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="showAll" className="ml-2 block text-sm text-gray-700">
                    Show All
                  </label>
                </div>

                {/* Sort Dropdown */}
                <div>
                  <label htmlFor="sort" className="sr-only">Sort</label>
                  <select
                    id="sort"
                    value={currentSort}
                    onChange={handleSortChange}
                    className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                  >
                    <option value="createdAt_desc">Newest First</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A to Z</option>
                    <option value="rating_desc">Top Rated</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Error State */}
            {error && (
              <ProductFetchError 
                error={error} 
                onRetry={handleRetry} 
              />
            )}

            {/* Loading State */}
            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {[...Array(8)].map((_, index) => (
                  <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
                    <div className="aspect-square bg-gray-200"></div>
                    <div className="p-4">
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded mb-4"></div>
                      <div className="h-6 bg-gray-200 rounded mb-3"></div>
                      <div className="h-10 bg-gray-200 rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Products Grid */}
            {!loading && !error && (
              <>
                <ProductGrid products={data.products} />
                
                {/* Pagination */}
                {!showAll && data.pagination && (
                  <div className="mt-8">
                    <Pagination 
                      pagination={data.pagination}
                      currentPage={getPaginationPage(data.pagination) || 1}
                      basePath="/products"
                      searchParams={new URLSearchParams(searchParams.toString())}
                    />
                  </div>
                )}
              </>
            )}

            {/* Empty State */}
            {!loading && !error && data.products.length === 0 && (
              <div className="text-center py-12">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No products found</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Try adjusting your search or filter to find what you're looking for.
                </p>
                <div className="mt-6">
                  <button
                    onClick={() => router.push('/products')}
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    View All Products
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}