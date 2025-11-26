'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilters from '@/components/products/ProductFilters';
import Pagination from '@/components/layout/Pagination';

// Function to fetch products with proper sorting parameters
async function getProducts(searchParams: any) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  
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
    const url = `${API_URL}/products${queryString ? `?${queryString}` : ''}`;
    
    const response = await fetch(url, {
      cache: 'no-store', // Always fetch fresh data
    });

    if (!response.ok) {
      throw new Error('Failed to fetch products');
    }

    const data = await response.json();
    return data; // Return the entire response object
  } catch (error) {
    console.error('Error fetching products:', error);
    return { products: [], pagination: {} };
  }
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  
  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'relevance';

  // Fetch products when search params change
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const resolvedSearchParams = Object.fromEntries(searchParams.entries());
      const result = await getProducts(resolvedSearchParams);
      setData(result);
      setLoading(false);
    };
    
    fetchData();
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

  // Get search term from URL
  const searchTerm = searchParams.get('search') || '';
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-12">
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