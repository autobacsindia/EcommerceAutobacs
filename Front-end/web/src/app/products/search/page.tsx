'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilters from '@/components/products/ProductFilters';
import Pagination from '@/components/layout/Pagination';
import apiClient from '@/lib/api';
import { trackViewItemList } from '@/lib/analytics';

// Function to fetch products with proper sorting parameters
async function getProducts(searchParams: any) {
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
  
  // Handle multiple brands
  if (searchParams.brand) {
    queryParams.append('brand', searchParams.brand);
  }
  
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
      case 'relevance':
      default:
        // Default sorting by relevance for search
        break;
    }
  }
  
  const queryString = queryParams.toString();
  const endpoint = `/products${queryString ? `?${queryString}` : ''}`;
  
  try {
    const data: any = await apiClient.get(endpoint);
    return data; // Return the entire response object
  } catch (error: any) {
    // Don't log abort errors as they're expected during cleanup
    if (error.name !== 'AbortError') {
      console.error('Error fetching products:', {
        error: error.message || error.toString(),
        name: error.name,
        stack: error.stack,
        endpoint: endpoint,
        timestamp: new Date().toISOString()
      });
    }
    
    // Re-throw the error to be handled by the calling function
    throw error;
  }
}

// Function to fetch search suggestions including corrections
async function getSearchCorrections(searchTerm: string) {
  try {
    const data: any = await apiClient.get(`/products/suggestions?q=${encodeURIComponent(searchTerm)}&limit=3`);
    
    if (data.success && data.corrections && data.corrections.length > 0) {
      return data.corrections;
    }
    
    return [];
  } catch (error: any) {
    // Don't log abort errors as they're expected during cleanup
    if (error.name !== 'AbortError') {
      console.error('Error fetching search corrections:', {
        error: error.message || error.toString(),
        name: error.name,
        stack: error.stack,
        endpoint: `/products/suggestions?q=${encodeURIComponent(searchTerm)}&limit=3`,
        timestamp: new Date().toISOString()
      });
    }
    return [];
  }
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<any>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [corrections, setCorrections] = useState<any[]>([]);
  
  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'relevance';

  // Fetch products when search params change
  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      if (!isMounted) return;
      
      setLoading(true);
      const resolvedSearchParams = Object.fromEntries(searchParams.entries());
      
      try {
        const result = await getProducts(resolvedSearchParams);
        if (isMounted) {
          setData(result);

          // Analytics: view_item_list (ADR-005)
          trackViewItemList({
            listType: 'search',
            listName: resolvedSearchParams.search || resolvedSearchParams.brand || resolvedSearchParams.category,
            itemCount: result.products?.length ?? 0,
          });

          // Fetch corrections if there's a search term and no results
          const searchTerm = searchParams.get('search') || '';
          if (searchTerm && result.products && result.products.length === 0) {
            const correctionResults = await getSearchCorrections(searchTerm);
            if (isMounted) {
              setCorrections(correctionResults);
            }
          } else {
            if (isMounted) {
              setCorrections([]);
            }
          }
        }
      } catch (error: any) {
        // Don't log abort errors as they're expected during cleanup
        if (error.name !== 'AbortError') {
          if (isMounted) {
            // Better error serialization to avoid empty {}
            const errorInfo = {
              message: error.message || 'Unknown error',
              name: error.name,
              stack: error.stack,
              timestamp: new Date().toISOString()
            };
            console.error('Error in search page:', errorInfo);
            setData({ products: [], pagination: {} });
            setCorrections([]);
          }
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

  const { products = [], pagination = {} } = data;

  // Handle sort change
  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortValue = e.target.value;
    const currentParams = new URLSearchParams(searchParams.toString());
    
    // Remove existing sort parameter
    currentParams.delete('sort');
    
    // Add new sort parameter if it's not the default
    if (sortValue !== 'relevance') {
      currentParams.set('sort', sortValue);
    }
    
    // Reset to first page when sorting
    currentParams.delete('page');
    
    // Update URL which will trigger useEffect
    router.push(`/search?${currentParams.toString()}`);
  };

  // Handle correction click
  const handleCorrectionClick = (correctedTerm: string) => {
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.set('search', correctedTerm);
    router.push(`/search?${currentParams.toString()}`);
  };

  // Get search term from URL
  const searchTerm = searchParams.get('search') || '';
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-linear-to-r from-blue-600 to-blue-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold mb-2">Search Results</h1>
          <p className="text-blue-100">
            {searchTerm 
              ? `Found ${pagination.total || 0} results for "${searchTerm}"` 
              : 'Search our product catalog'}
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
            {/* "Did you mean?" suggestions */}
            {corrections.length > 0 && (
              <div className="mb-6 p-4 bg-blue-50 rounded-md">
                <p className="text-blue-800 font-medium">
                  Did you mean: 
                  {corrections.map((correction, index) => (
                    <span key={index}>
                      {index > 0 && ', '}
                      <button
                        onClick={() => handleCorrectionClick(correction.suggested)}
                        className="underline text-blue-600 hover:text-blue-800 ml-1"
                      >
                        {correction.suggested}
                      </button>
                    </span>
                  ))}?
                </p>
              </div>
            )}

            {/* Results Header */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-gray-600">
                {loading ? (
                  'Loading products...'
                ) : products.length > 0 ? (
                  <>
                    Showing {products.length} product{products.length !== 1 ? 's' : ''}
                    {pagination.total && ` of ${pagination.total}`}
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
                  <option value="relevance">Relevance</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="name_asc">Name: A to Z</option>
                  <option value="rating_desc">Highest Rated</option>
                </select>
              </div>
            </div>

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
            ) : products.length > 0 ? (
              <ProductGrid products={products} />
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg mb-4">No products found matching your criteria</p>
                <Link
                  href="/products"
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Browse all products
                </Link>
              </div>
            )}

            {/* Pagination */}
            {!loading && pagination.pages > 1 && (
              <Pagination
                pagination={pagination}
                currentPage={currentPage}
                basePath="/search"
                searchParams={searchParams}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SearchPageInner />
    </Suspense>
  );
}