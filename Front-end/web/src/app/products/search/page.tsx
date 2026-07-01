'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilters from '@/components/products/ProductFilters';
import apiClient from '@/lib/api';
import { trackViewItemList } from '@/lib/analytics';

const PAGE_SIZE = 12;

async function getProducts(searchParams: any) {
  const queryParams = new URLSearchParams();

  if (searchParams.category) queryParams.append('category', searchParams.category);
  if (searchParams.search)   queryParams.append('search', searchParams.search);
  if (searchParams.page)     queryParams.append('page', searchParams.page);
  if (searchParams.minPrice) queryParams.append('minPrice', searchParams.minPrice);
  if (searchParams.maxPrice) queryParams.append('maxPrice', searchParams.maxPrice);
  if (searchParams.inStock)  queryParams.append('inStock', searchParams.inStock);
  if (searchParams.rating)   queryParams.append('rating', searchParams.rating);
  if (searchParams.brand)    queryParams.append('brand', searchParams.brand);

  if (searchParams.sort) {
    switch (searchParams.sort) {
      case 'price_asc':   queryParams.append('sortBy', 'price');         queryParams.append('order', 'asc');  break;
      case 'price_desc':  queryParams.append('sortBy', 'price');         queryParams.append('order', 'desc'); break;
      case 'name_asc':    queryParams.append('sortBy', 'name');          queryParams.append('order', 'asc');  break;
      case 'rating_desc': queryParams.append('sortBy', 'averageRating'); queryParams.append('order', 'desc'); break;
      default: break;
    }
  }

  const qs = queryParams.toString();
  const endpoint = `/products${qs ? `?${qs}` : ''}`;

  try {
    const data: any = await apiClient.get(endpoint);
    return data;
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      console.error('Error fetching products:', {
        error: error.message || error.toString(),
        name: error.name,
        endpoint,
        timestamp: new Date().toISOString()
      });
    }
    throw error;
  }
}

async function getSearchCorrections(searchTerm: string) {
  try {
    const data: any = await apiClient.get(
      `/products/suggestions?q=${encodeURIComponent(searchTerm)}&limit=3`
    );
    if (data.success && data.corrections?.length > 0) return data.corrections;
    return [];
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      console.error('Error fetching search corrections:', {
        error: error.message || error.toString(),
        timestamp: new Date().toISOString()
      });
    }
    return [];
  }
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pagination data lives at the top level of the API response (not nested under "pagination")
  const [products, setProducts]     = useState<any[]>([]);
  const [total, setTotal]           = useState(0);
  const [hasNext, setHasNext]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [corrections, setCorrections] = useState<any[]>([]);
  const pageRef = useRef(1);

  const currentSort = searchParams.get('sort') || 'relevance';
  const searchTerm  = searchParams.get('search') || '';

  // Reset and fetch page 1 whenever the query/filters/sort changes
  useEffect(() => {
    let isMounted = true;
    pageRef.current = 1;

    const fetchData = async () => {
      if (!isMounted) return;
      setLoading(true);
      setProducts([]);

      const resolved = Object.fromEntries(searchParams.entries());
      resolved.page = '1';

      try {
        const result = await getProducts(resolved);
        if (!isMounted) return;

        const fetched: any[] = result.products || [];
        setProducts(fetched);
        setTotal(result.total || 0);
        setHasNext(result.hasNext || false);

        trackViewItemList({
          listType: 'search',
          listName: resolved.search || resolved.brand || resolved.category,
          itemCount: fetched.length,
        });

        if (searchTerm && fetched.length === 0) {
          const correctionResults = await getSearchCorrections(searchTerm);
          if (isMounted) setCorrections(correctionResults);
        } else {
          if (isMounted) setCorrections([]);
        }
      } catch (error: any) {
        if (error.name !== 'AbortError' && isMounted) {
          console.error('Error in search page:', {
            message: error.message || 'Unknown error',
            name: error.name,
            timestamp: new Date().toISOString()
          });
          setProducts([]);
          setTotal(0);
          setHasNext(false);
          setCorrections([]);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => { isMounted = false; };
  }, [searchParams]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasNext) return;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    const resolved = Object.fromEntries(searchParams.entries());
    resolved.page = String(nextPage);

    try {
      const result = await getProducts(resolved);
      setProducts(prev => [...prev, ...(result.products || [])]);
      setTotal(result.total || 0);
      setHasNext(result.hasNext || false);
      pageRef.current = nextPage;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error loading more products:', {
          message: error.message || 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortValue = e.target.value;
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.delete('sort');
    if (sortValue !== 'relevance') currentParams.set('sort', sortValue);
    currentParams.delete('page');
    router.push(`/products/search?${currentParams.toString()}`);
  };

  const handleCorrectionClick = (correctedTerm: string) => {
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.set('search', correctedTerm);
    router.push(`/products/search?${currentParams.toString()}`);
  };

  const remaining = Math.max(0, total - products.length);

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero Section */}
      <div className="bg-linear-to-r from-gold to-blue-800 text-ink py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold mb-2">Search Results</h1>
          <p className="text-blue-100">
            {loading
              ? searchTerm ? `Searching for "${searchTerm}"…` : 'Search our product catalog'
              : searchTerm
                ? `Found ${total} result${total !== 1 ? 's' : ''} for "${searchTerm}"`
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
                        className="underline text-gold hover:text-blue-800 ml-1"
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
              <p className="text-ink-muted">
                {loading ? (
                  'Loading products...'
                ) : products.length > 0 ? (
                  <>
                    Showing {products.length}
                    {total > products.length ? ` of ${total}` : ''}
                    {' '}result{products.length !== 1 ? 's' : ''}
                    {searchTerm && ` for "${searchTerm}"`}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-2">
                <label htmlFor="sort" className="text-sm text-ink-muted">Sort by:</label>
                <select
                  id="sort"
                  className="border border-hairline rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
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

            {/* Loading skeleton */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, index) => (
                  <div key={index} className="bg-obsidian rounded-lg shadow-md overflow-hidden animate-pulse">
                    <div className="h-48 bg-obsidian-raised"></div>
                    <div className="p-4">
                      <div className="h-4 bg-obsidian-raised rounded mb-2"></div>
                      <div className="h-4 bg-obsidian-raised rounded w-2/3 mb-4"></div>
                      <div className="h-6 bg-obsidian-raised rounded w-1/3 mb-4"></div>
                      <div className="flex justify-between">
                        <div className="h-10 bg-obsidian-raised rounded w-24"></div>
                        <div className="h-10 bg-obsidian-raised rounded w-24"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : products.length > 0 ? (
              <>
                <ProductGrid products={products} />

                {/* Load More */}
                {hasNext && (
                  <div className="mt-8 flex justify-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="flex items-center gap-2 px-6 py-3 bg-gold text-obsidian rounded-md hover:bg-gold disabled:opacity-70 disabled:cursor-not-allowed transition-colors font-medium"
                    >
                      {loadingMore ? (
                        <>
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Loading…
                        </>
                      ) : (
                        `Load More (${remaining} more product${remaining !== 1 ? 's' : ''})`
                      )}
                    </button>
                  </div>
                )}

                {!hasNext && total > PAGE_SIZE && (
                  <p className="mt-8 text-center text-ink-muted text-sm">
                    All {total} products loaded
                  </p>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <p className="text-ink-muted text-lg mb-4">No products found matching your criteria</p>
                <Link href="/products" className="text-gold hover:text-gold font-medium">
                  Browse all products
                </Link>
              </div>
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
