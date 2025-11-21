'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilters from '@/components/products/ProductFilters';
import ProductFetchError from '@/components/products/ProductFetchError';
import apiClient from '@/lib/api';

// Define types for our data
interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  images: string[];
  category: { name: string };
  rating: number;
  stock: number;
}

interface Pagination {
  total?: number;
  pages?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  page?: number;
}

interface ProductsData {
  products: Product[];
  pagination: Pagination;
}

// Function to fetch products with proper sorting parameters and retry logic
async function getProducts(searchParams: any): Promise<ProductsData> {
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
    return data?.data || { products: [], pagination: {} };
  } catch (error: any) {
    // Log error with context
    console.error('Error fetching products:', {
      error: error.message,
      searchParams,
      timestamp: new Date().toISOString()
    });
    
    // Re-throw the error for the component to handle
    throw error;
  }
}

export default function ProductsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'createdAt_desc';

  // Helper functions to safely access pagination properties
  const getPaginationTotal = (pagination: Pagination) => {
    return 'total' in pagination ? pagination.total : undefined;
  };

  const getPaginationPages = (pagination: Pagination) => {
    return 'pages' in pagination ? pagination.pages : undefined;
  };

  const getPaginationPage = (pagination: Pagination) => {
    return 'page' in pagination ? pagination.page : undefined;
  };

  // Fetch products when search params change
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const resolvedSearchParams = Object.fromEntries(searchParams.entries());
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
    
    // Reset to first page when sorting
    currentParams.delete('page');
    
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
          <aside className="hidden lg:block">
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
                    Showing {data.products.length} product{data.products.length !== 1 ? 's' : ''}
                    {getPaginationTotal(data.pagination) && ` of ${getPaginationTotal(data.pagination)}`}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

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
            {!loading && !error && getPaginationPages(data.pagination) && getPaginationPages(data.pagination)! > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                {Array.from({ length: getPaginationPages(data.pagination)! }, (_, i) => i + 1).map((page) => {
                  const currentParams = new URLSearchParams(searchParams.toString());
                  currentParams.set('page', page.toString());
                  const href = `/products?${currentParams.toString()}`;
                  
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