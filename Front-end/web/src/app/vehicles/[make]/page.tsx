'use client';

import { useState, useEffect } from 'react';
import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFetchError from '@/components/products/ProductFetchError';
import apiClient, { ApiError, ErrorCategory } from '@/lib/api';

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
  category: {
    _id: string;
    name: string;
    slug: string;
  } | string;
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
  isNew?: boolean;
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
      if (searchParams.category) queryParams.append('category', searchParams.category);
      if (searchParams.search) queryParams.append('search', searchParams.search);
      if (searchParams.page) queryParams.append('page', searchParams.page);
      if (searchParams.minPrice) queryParams.append('minPrice', searchParams.minPrice);
      if (searchParams.maxPrice) queryParams.append('maxPrice', searchParams.maxPrice);
      if (searchParams.inStock) queryParams.append('inStock', searchParams.inStock);
      if (searchParams.rating) queryParams.append('rating', searchParams.rating);
      if (searchParams.vehicleMake) queryParams.append('vehicleMake', searchParams.vehicleMake);
      if (searchParams.brand) queryParams.append('brand', searchParams.brand);
      
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
      
      // Log error with context
      console.error(`Error fetching products (attempt ${attempt + 1}/${retries + 1}):`, {
        error: error.message,
        status: error.status,
        category: error.category,
        searchParams,
        timestamp: new Date().toISOString()
      });
      
      // If this is the last attempt, re-throw the error
      if (attempt === retries) {
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

export default function VehicleProductsPage({ params }: { params: Promise<{ make: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Unwrap the params Promise using React.use()
  const { make } = React.use(params);

  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'createdAt_desc';

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
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const resolvedSearchParams = Object.fromEntries(searchParams.entries());
        // Add vehicle make to search params
        resolvedSearchParams.vehicleMake = decodeURIComponent(make);
        
        const result = await getProducts(resolvedSearchParams);
        setData(result);
      } catch (err: any) {
        setError(err);
        // Log error to analytics service
        console.error('Failed to fetch products after all retries:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [searchParams, make]);

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
    
    // Reset to first page when sorting
    currentParams.delete('page');
    
    // Update URL which will trigger useEffect
    router.push(`/vehicles/${make}?${currentParams.toString()}`);
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
          <h1 className="text-4xl font-bold mb-2">{decodeURIComponent(make)} Parts & Accessories</h1>
          <p className="text-blue-100">
            Find the perfect parts and accessories for your {decodeURIComponent(make)}
          </p>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <nav className="text-sm text-gray-600">
          <Link href="/" className="hover:text-blue-600">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/vehicles" className="hover:text-blue-600">Vehicles</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900">{decodeURIComponent(make)}</span>
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Filters Sidebar */}
          <aside className="hidden lg:block">
            <div className="bg-white rounded-lg shadow-md p-6 sticky top-20">
              <h2 className="text-lg font-bold mb-4">Filters</h2>
              <p className="text-gray-600 text-sm">
                Vehicle-specific filters coming soon. For now, browse all {decodeURIComponent(make)} parts.
              </p>
            </div>
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
                    Showing {data.products.length} product{data.products.length !== 1 ? 's' : ''}
                    {getPaginationTotal(data.pagination) && ` of ${getPaginationTotal(data.pagination)}`}
                    {' '}for {decodeURIComponent(make)}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              {/* Controls */}
              <div className="flex items-center gap-4">
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
                <p className="text-gray-500 text-lg mb-4">No products found for {decodeURIComponent(make)}</p>
                <Link
                  href="/products"
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Browse all products
                </Link>
              </div>
            ) : null}

            {/* Pagination */}
            {!loading && !error && getPaginationPages(data.pagination) && getPaginationPages(data.pagination)! > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                {Array.from({ length: getPaginationPages(data.pagination)! }, (_, i) => i + 1).map((page) => {
                  const currentParams = new URLSearchParams(searchParams.toString());
                  currentParams.set('page', page.toString());
                  const href = `/vehicles/${make}?${currentParams.toString()}`;

                  return (
                    <Link
                      key={page}
                      href={href}
                      className={`px-4 py-2 rounded-md ${
                        page === (getPaginationPage(data.pagination) || 1)
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}