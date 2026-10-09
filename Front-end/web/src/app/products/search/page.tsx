'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import ProductGrid from '@/components/products/ProductGrid';
import Filters from '@/components/products/redesign/Filters';
import StorePageHeader from '@/components/store/StorePageHeader';
import apiClient from '@/lib/api';
import { trackViewItemList } from '@/lib/analytics';

async function getProducts(searchParams: any) {
  const queryParams = new URLSearchParams();

  // Accept the search term under either `q` (RedesignNav / standard, shareable
  // URLs) or `search` (SearchSuggestions, "did you mean", legacy links). The
  // backend expects `search`, so normalize to it here. Without this, a
  // `?q=storm` URL sent no term and the API returned the entire catalog.
  const term = searchParams.q ?? searchParams.search;

  if (searchParams.category) queryParams.append('category', searchParams.category);
  if (term)                  queryParams.append('search', term);
  if (searchParams.page)     queryParams.append('page', searchParams.page);
  if (searchParams.minPrice) queryParams.append('minPrice', searchParams.minPrice);
  if (searchParams.maxPrice) queryParams.append('maxPrice', searchParams.maxPrice);
  if (searchParams.inStock)  queryParams.append('inStock', searchParams.inStock);
  if (searchParams.rating)   queryParams.append('rating', searchParams.rating);
  if (searchParams.brand)    queryParams.append('brand', searchParams.brand);
  if (searchParams.vehicleMake)  queryParams.append('vehicleMake', searchParams.vehicleMake);
  if (searchParams.vehicleModel) queryParams.append('vehicleModel', searchParams.vehicleModel);

  if (searchParams.sort) {
    switch (searchParams.sort) {
      case 'price_asc':   queryParams.append('sortBy', 'price');         queryParams.append('order', 'asc');  break;
      case 'price_desc':  queryParams.append('sortBy', 'price');         queryParams.append('order', 'desc'); break;
      case 'name_asc':    queryParams.append('sortBy', 'name');          queryParams.append('order', 'asc');  break;
      case 'createdAt_desc': queryParams.append('sortBy', 'createdAt');   queryParams.append('order', 'desc'); break;
      case 'rating_desc': queryParams.append('sortBy', 'averageRating'); queryParams.append('order', 'desc'); break;
      case 'sales_desc':  queryParams.append('sortBy', 'salesScore');    queryParams.append('order', 'desc'); break;
      // Relevance is an EXPLICIT sort now. It used to be inferred from
      // "sortBy=createdAt plus query text", which meant there was no way to ask
      // for it and no way back to it once another sort was chosen.
      case 'relevance':   queryParams.append('sortBy', 'relevance');     break;
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


function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pagination data lives at the top level of the API response (not nested under "pagination")
  const [products, setProducts]     = useState<any[]>([]);
  const [total, setTotal]           = useState(0);
  /** Size of page 1, used to tell "there was more than one page" from "there wasn't". */
  const [firstPageSize, setFirstPageSize] = useState(0);
  const [hasNext, setHasNext]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [corrections, setCorrections] = useState<any[]>([]);
  // True when the backend found no exact match and widened recall to return
  // related products. Shown to the shopper — presenting widened results as if
  // they were direct hits is what makes a search feel broken.
  const [relaxed, setRelaxed]       = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pageRef = useRef(1);

  const currentSort = searchParams.get('sort') || 'relevance';
  const searchTerm  = searchParams.get('q') || searchParams.get('search') || '';

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
        // Measured, not assumed. This page never sends `limit`, so the page size is
        // whatever the backend defaults to — and that default differs per engine.
        // A hardcoded constant here was wrong for years (12 against a real 20) and
        // would quietly go wrong again on any engine or default change.
        setFirstPageSize(fetched.length);
        setTotal(result.total || 0);
        setHasNext(result.hasNext || false);
        setRelaxed(Boolean(result.relaxed));

        trackViewItemList({
          listType: 'search',
          listName: resolved.q || resolved.search || resolved.brand || resolved.category,
          itemCount: fetched.length,
        });

        // Corrections now arrive WITH the results rather than from a second
        // request to /products/suggestions. That endpoint fires on every keystroke
        // and had no trustworthy "found nothing" signal to gate a probe on, so the
        // backend computes corrections on the results path instead — one probe per
        // search, on the real hit count. This also drops a round trip from every
        // zero-result search.
        if (isMounted) {
          setCorrections(searchTerm && fetched.length === 0 ? (result.corrections ?? []) : []);
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
      setRelaxed(Boolean(result.relaxed));
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
    // Write the term under the canonical `q` and clear any legacy `search` so the
    // two can't disagree (the page reads `q` first).
    currentParams.set('q', correctedTerm);
    currentParams.delete('search');
    router.push(`/products/search?${currentParams.toString()}`);
  };

  const remaining = Math.max(0, total - products.length);

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: 'Search' }]}
        title={searchTerm ? <>Results for <span className="text-gold">“{searchTerm}”</span></> : 'Search results'}
        aside={
          loading
            ? searchTerm ? 'Searching…' : undefined
            : searchTerm
              ? `${total.toLocaleString('en-IN')} result${total !== 1 ? 's' : ''}`
              : undefined
        }
      />

      <div className="sp-wrap">
        <div className="flex gap-6 pt-6">
          {/* Filters Sidebar */}
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-[calc(var(--store-header-h)+20px)] max-h-[calc(100vh-var(--store-header-h)-40px)] overflow-y-auto rounded-xl bg-white p-5 shadow-sm">
              <Filters basePath="/products/search" />
            </div>
          </aside>

          {/* Products Grid */}
          <div className="min-w-0 flex-1">
            {/* Relaxed-recall notice. Only meaningful when the widened search
                actually returned something — with zero results the empty state
                already says there are none. */}
            {relaxed && !loading && products.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="status">
                <p className="text-[14px] text-amber-900">
                  No exact matches for <strong>“{searchTerm}”</strong> — showing related results.
                </p>
              </div>
            )}

            {/* "Did you mean?" suggestions */}
            {corrections.length > 0 && (
              <div className="mb-4 rounded-xl bg-gold/10 px-4 py-3">
                <p className="text-[15px] text-ink">
                  Did you mean:
                  {corrections.map((correction, index) => (
                    <span key={index}>
                      {index > 0 && ', '}
                      <button
                        onClick={() => handleCorrectionClick(correction.suggested)}
                        className="ml-1 font-semibold text-gold underline hover:text-[#0b6b3c]"
                      >
                        {correction.suggested}
                      </button>
                    </span>
                  ))}?
                </p>
              </div>
            )}

            {/* Results Header */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="text-[14px] text-ink-muted">
                {loading ? (
                  'Loading products…'
                ) : products.length > 0 ? (
                  <>
                    Showing <span className="font-semibold text-ink">{products.length}</span>
                    {total > products.length ? <> of <span className="font-semibold text-ink">{total}</span></> : ''}
                    {' '}result{products.length !== 1 ? 's' : ''}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-semibold text-ink transition-colors hover:border-gold hover:text-gold lg:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" /> Filters
                </button>

                {/* Sort Dropdown */}
                <label htmlFor="sort" className="flex items-center gap-2 text-[14px] text-ink-muted">
                  <span className="hidden sm:inline">Sort by</span>
                  <select
                    id="sort"
                    className="rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-medium text-ink outline-none focus:border-gold"
                    value={currentSort}
                    onChange={handleSortChange}
                    disabled={loading}
                  >
                    <option value="relevance">Relevance</option>
                    <option value="sales_desc">Best Selling</option>
                    <option value="createdAt_desc">Newest</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A–Z</option>
                    <option value="rating_desc">Top rated</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Loading skeleton */}
            {loading ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                {[...Array(8)].map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-xl border border-hairline bg-white">
                    <div className="aspect-square animate-pulse bg-obsidian-deep" />
                    <div className="space-y-3 p-4">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-obsidian-deep" />
                      <div className="h-5 w-1/2 animate-pulse rounded bg-obsidian-deep" />
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
                      className="sh-btn sh-btn-primary sh-btn-lg disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loadingMore ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Loading…
                        </>
                      ) : (
                        `Load more (${remaining} more product${remaining !== 1 ? 's' : ''})`
                      )}
                    </button>
                  </div>
                )}

                {!hasNext && firstPageSize > 0 && total > firstPageSize && (
                  <p className="mt-8 text-center text-sm text-ink-muted">
                    All {total} products loaded
                  </p>
                )}
              </>
            ) : (
              <div className="sp-card sp-empty">
                <p className="sp-empty-title">No products found matching your criteria</p>
                <p>Check the spelling, try a shorter term, or ask us — we can often source the part.</p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Link href="/products" className="sh-btn sh-btn-outline">Browse all products</Link>
                  <Link href="/consultation" className="sh-btn sh-btn-primary">Ask a specialist</Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[86vw] max-w-sm flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <span className="text-[17px] font-bold text-ink">Filters</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close filters" className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-obsidian-deep hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <Filters basePath="/products/search" onApplied={() => setDrawerOpen(false)} />
            </div>
            {/* Result count on the CTA. A bottom-sheet filter panel without one
                forces the shopper to close it just to learn whether the filter
                they picked left anything — the count is what makes the drawer
                usable rather than a guess. */}
            <div className="border-t border-hairline p-4">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-full rounded-full bg-gold px-4 py-3 text-[15px] font-bold text-white"
              >
                {typeof total === 'number' ? `Show ${total} ${total === 1 ? 'result' : 'results'}` : 'Show results'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="sp sh-theme" />}>
      <SearchPageInner />
    </Suspense>
  );
}
