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

// Define types for our data
interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category?: { 
    _id: string;
    name: string;
    slug: string;
  } | string;
  categories?: Array<{ 
    _id: string;
    name: string;
    slug: string;
  }>;
  brand?: string;
  images: ProductImage[] | string;
  stock: number;
  sku?: string;
  specifications?: Array<{
    key: string;
    value: string;
    _id?: string;
  }> | string;
  features?: string[] | string;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[] | string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

interface Pagination {
  total?: number;
  pages?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  count?: number;
}

interface ProductsData {
  products: Product[];
  pagination: Pagination;
}

// Function to fetch products with proper sorting parameters and enhanced retry logic
async function getProducts(searchParams: any, retries = 3): Promise<ProductsData> {
  let lastError: any;
  
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
      // Serialize error object properly to avoid empty {}
      const errorInfo = {
        message: error.message || error.toString(),
        name: error.name,
        status: error.status,
        category: error.category,
        searchParams,
        timestamp: new Date().toISOString(),
        // Properly serialize error object
        errorDetails: {
          message: error.message,
          name: error.name,
          stack: error.stack,
          // For ApiError instances
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
        // Server errors: longer delays
        delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s, etc.
      } else if (error instanceof ApiError && error.category === ErrorCategory.NETWORK) {
        // Network errors: standard exponential backoff
        delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, etc.
      } else if (error instanceof ApiError && error.category === ErrorCategory.TIMEOUT) {
        // Timeout errors: longer delays
        delay = Math.pow(2, attempt) * 3000; // 3s, 6s, 12s, etc.
      } else {
        // Other errors: shorter delays
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

export default function ProductsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'createdAt_desc';
  const showAll = searchParams.get('showAll') === 'true';
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  // Helper functions to safely access pagination properties
  const getPaginationTotal = (pagination: Pagination | undefined) => {
    return pagination && 'total' in pagination ? pagination.total : undefined;
  };

  const getPaginationPages = (pagination: Pagination | undefined) => {
    return pagination && 'pages' in pagination ? pagination.pages : undefined;
  };

  const getPaginationPage = (pagination: Pagination | undefined) => {
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
        const result = await getProducts(resolvedSearchParams);
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
            // For ApiError instances
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
  }, [searchParams]);

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
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <label htmlFor="showAll" className={`ml-2 text-sm ${showAll ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                    Show All {showAll && '(Active)'}
                  </label>
                </div>

                {/* Sort Dropdown */}
                <div className="flex items-center gap-2">
                  <label htmlFor="sort" className="text-sm text-gray-600">
                    Sort by:
                  </label>
                  <select
                    id="sort"
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={currentSort}
                    onChange={handleSortChange}
                    disabled={loading}
                  >
                    <option value="createdAt_desc">Newest First</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A to Z</option>
                    <option value="rating_desc">Highest Rated</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Error State */}
            {error && !loading && (
              <ProductFetchError onRetry={handleRetry} error={error} />
            )}

            {/* Loading state */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, index) => (
                  <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
                    <div className="h-48 bg-gray-200"></div>
                    <div className="p-4">
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                      <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                      <div className="flex justify-between">
                        <div className="h-10 bg-gray-200 rounded w-24"></div>
                        <div className="h-10 bg-gray-200 rounded w-24"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !error && data.products.length > 0 ? (
              <ProductGrid products={data.products} />
            ) : !error ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg mb-4">No products found matching your criteria</p>
                <Link
                  href="/products"
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Clear filters
                </Link>
              </div>
            ) : null}

            {/* Pagination */}
            {!loading && !error && !showAll && (
              <Pagination
                pagination={data.pagination}
                currentPage={currentPage}
                basePath="/products"
                searchParams={searchParams}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}