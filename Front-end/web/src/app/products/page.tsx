'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, type ReadonlyURLSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { SlidersHorizontal, X } from 'lucide-react';
import ProductFetchError from '@/components/products/ProductFetchError';
import Pagination from '@/components/layout/Pagination';
import apiClient, { ApiError, ErrorCategory } from '@/lib/api';
import { ProductGridSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import SidebarSkeleton from '@/components/skeletons/SidebarSkeleton';

const ProductGrid = dynamic(() => import('@/components/products/ProductGrid'), {
  loading: () => <ProductGridSkeleton count={8} />
});

const ProductFilters = dynamic(() => import('@/components/products/ProductFilters'), {
  loading: () => <SidebarSkeleton />,
  ssr: false
});

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
  // searchParams is already a plain object (caller converts URLSearchParams before passing in)
  const searchParamsObj = searchParams;
  const cacheKey = `products_${JSON.stringify(searchParamsObj)}`;
  
  // Try to get from localStorage first (with 2-minute expiry to prevent stale slugs)
  const cachedData = localStorage.getItem(cacheKey);
  const cacheTimestamp = localStorage.getItem(`${cacheKey}_timestamp`);
  
  if (cachedData && cacheTimestamp) {
    try {
      const parsedData = JSON.parse(cachedData);
      const age = Date.now() - parseInt(cacheTimestamp);
      const maxAge = 2 * 60 * 1000; // 2 minutes
      
      if (age < maxAge) {
        // Validate all slugs in cached data
        const hasInvalidSlugs = parsedData.products?.some((p: any) => 
          p.slug && (p.slug.startsWith('-') || p.slug.includes('%20'))
        );
        
        if (!hasInvalidSlugs) {
          return parsedData;
        }
        console.log('Cache has invalid slugs, refreshing...');
      } else {
        console.log('Cache expired, refreshing...');
      }
    } catch (e) {
      console.warn('Failed to parse cached products data:', e);
    }
  }
  
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
      if (searchParams.isFeatured) queryParams.append('isFeatured', searchParams.isFeatured);
      if (searchParams.isFastMoving) queryParams.append('isFastMoving', searchParams.isFastMoving);
      
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
        const result = {
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
        
        // Cache in localStorage with timestamp (2-minute expiry)
        try {
          localStorage.setItem(cacheKey, JSON.stringify(result));
          localStorage.setItem(`${cacheKey}_timestamp`, Date.now().toString());
        } catch (e) {
          console.warn('Failed to cache products in localStorage:', e);
        }
        
        return result;
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
      
      if (process.env.NODE_ENV !== 'test') {
        console.error(`Error fetching products (attempt ${attempt + 1}/${retries + 1}):`, errorInfo);
      }
      
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

function ProductsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  
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
      <div className="bg-linear-to-r from-blue-600 to-blue-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold mb-2">
            {searchParams.get('isFeatured') === 'true' 
              ? 'Featured Products' 
              : searchParams.get('isFastMoving') === 'true'
                ? 'Fast-Moving Products'
                : 'Our Products'}
          </h1>
          <p className="text-blue-100">
            {searchParams.get('isFeatured') === 'true' 
              ? 'Explore our fast-moving and most popular automotive accessories'
              : 'Explore our premium collection of automotive accessories and performance parts'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ── Mobile filter drawer backdrop ── */}
        {mobileFiltersOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Mobile filter drawer ── */}
        <div
          className={`fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] bg-white shadow-xl transform transition-transform duration-300 ease-in-out lg:hidden overflow-y-auto ${
            mobileFiltersOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Filters</h2>
            <button
              onClick={() => setMobileFiltersOpen(false)}
              className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              aria-label="Close filters"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-4">
            <ProductFilters />
          </div>
        </div>

        {/* ── Toolbar: mobile filter toggle + sort ── */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/* Left: result count */}
          <p className="text-sm text-gray-600">
            {loading ? 'Loading…' : data.products.length > 0 ? (
              showAll
                ? `Showing all ${data.products.length} product${data.products.length !== 1 ? 's' : ''}`
                : `Showing ${data.products.length}${getPaginationTotal(data.pagination) ? ` of ${getPaginationTotal(data.pagination)}` : ''} product${data.products.length !== 1 ? 's' : ''}`
            ) : 'No products found'}
          </p>

          {/* Right: controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mobile “Filters” button — only visible below lg */}
            <button
              onClick={() => setMobileFiltersOpen(true)}
              className="lg:hidden inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </button>

            {/* Show All toggle */}
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAll}
                onChange={handleShowAllToggle}
                className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className={showAll ? 'text-blue-600 font-medium' : ''}>
                Show all{showAll ? ' (on)' : ''}
              </span>
            </label>

            {/* Sort */}
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={currentSort}
              onChange={handleSortChange}
              disabled={loading}
            >
              <option value="createdAt_desc">Newest First</option>
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
              <option value="name_asc">Name: A – Z</option>
              <option value="rating_desc">Highest Rated</option>
            </select>
          </div>
        </div>

        {/* ── Sidebar + grid ── */}
        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-24">
              <ProductFilters />
            </div>
          </aside>

          {/* Products area */}
          <div className="flex-1 min-w-0">
            {/* Error */}
            {error && !loading && (
              <ProductFetchError onRetry={handleRetry} error={error} />
            )}

            {/* Loading skeleton */}
            {loading && (
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden animate-pulse">
                    <div className="aspect-square bg-gray-200" />
                    <div className="p-3">
                      <div className="h-4 bg-gray-200 rounded mb-2" />
                      <div className="h-4 bg-gray-200 rounded w-2/3 mb-3" />
                      <div className="h-8 bg-gray-200 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Products grid */}
            {!loading && !error && data.products.length > 0 && (
              <>
                <ProductGrid products={data.products} />
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

            {/* Empty state */}
            {!loading && !error && data.products.length === 0 && (
              <div className="text-center py-16">
                <p className="text-gray-500 text-lg mb-4">No products found</p>
                <Link href="/products" className="text-blue-600 hover:text-blue-700 font-medium">
                  Clear filters
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ProductsPageInner />
    </Suspense>
  );
}