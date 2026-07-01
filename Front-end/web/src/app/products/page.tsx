'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { SlidersHorizontal, X } from 'lucide-react';
import ProductFetchError from '@/components/products/ProductFetchError';
import Pagination from '@/components/layout/Pagination';
import apiClient, { ApiError, ErrorCategory } from '@/lib/api';
import { trackViewItemList } from '@/lib/analytics';
import type { Product, Pagination as PaginationType } from '@/lib/types';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import StoreProductCard from '@/components/products/redesign/StoreProductCard';
import CategoryChips from '@/components/products/redesign/CategoryChips';
import ActiveFilters from '@/components/products/redesign/ActiveFilters';

const Filters = dynamic(() => import('@/components/products/redesign/Filters'), { ssr: false });

interface ProductsData {
  products: Product[];
  pagination: PaginationType;
}

const SORTS: Record<string, { sortBy: string; order: string }> = {
  price_asc: { sortBy: 'price', order: 'asc' },
  price_desc: { sortBy: 'price', order: 'desc' },
  name_asc: { sortBy: 'name', order: 'asc' },
  rating_desc: { sortBy: 'averageRating', order: 'desc' },
  createdAt_desc: { sortBy: 'createdAt', order: 'desc' },
};

async function getProducts(searchParams: Record<string, string>, retries = 3): Promise<ProductsData> {
  let lastError: unknown;
  const passthrough = [
    'category', 'search', 'page', 'minPrice', 'maxPrice', 'inStock',
    'isFeatured', 'isFastMoving', 'rating', 'vehicleMake', 'vehicleModel', 'brand',
  ];

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const q = new URLSearchParams();
      passthrough.forEach((k) => { if (searchParams[k]) q.append(k, searchParams[k]); });
      if (searchParams.showAll === 'true') q.append('limit', '500');
      const sort = SORTS[searchParams.sort ?? 'createdAt_desc'] ?? SORTS.createdAt_desc;
      q.append('sortBy', sort.sortBy);
      q.append('order', sort.order);

      const data = await apiClient.get<Record<string, unknown> & { products?: Product[] }>(
        `/products?${q.toString()}`
      );
      if (data && data.products) {
        const { total, pages, currentPage, hasNext, hasPrev, count } = data as Record<string, number | boolean>;
        return {
          products: data.products,
          pagination: { total, pages, currentPage, hasNext, hasPrev, count } as PaginationType,
        };
      }
      return { products: [], pagination: {} };
    } catch (error: unknown) {
      lastError = error;
      if (attempt === retries) {
        if (error instanceof ApiError && (error.category === ErrorCategory.NETWORK || error.status === 0)) {
          throw new Error('Unable to connect to the server. Please try again shortly.');
        }
        throw error;
      }
      const base = error instanceof ApiError && error.category === ErrorCategory.SERVER ? 2000 : 1000;
      const delay = Math.pow(2, attempt) * base * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function ProductsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const currentSort = searchParams.get('sort') || 'createdAt_desc';
  const showAll = searchParams.get('showAll') === 'true';
  const isFeatured = searchParams.get('isFeatured') === 'true';
  const isFastMoving = searchParams.get('isFastMoving') === 'true';

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resolved = Object.fromEntries(searchParams.entries());
        const result = await getProducts(resolved);
        if (!mounted) return;
        setData(result);
        trackViewItemList({
          listType: resolved.search ? 'search' : (resolved.category || resolved.brand) ? 'category' : 'all',
          listName: resolved.search || resolved.category || resolved.brand,
          itemCount: result.products.length,
        });
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [searchParams]);

  const setSort = (value: string) => {
    const p = new URLSearchParams(searchParams.toString());
    value === 'createdAt_desc' ? p.delete('sort') : p.set('sort', value);
    if (!showAll) p.delete('page');
    router.replace(`/products?${p.toString()}`, { scroll: false });
  };

  const eyebrow = isFeatured ? 'Curated Picks' : isFastMoving ? 'Top Sellers' : 'Catalogue';
  const title = isFeatured ? 'Featured' : isFastMoving ? 'Fast Moving' : 'All Products';
  const total = data.pagination?.total;

  return (
    <div className="min-h-screen bg-obsidian font-display text-ink">
      {/* Header */}
      <header className="border-b border-hairline bg-obsidian-deep px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-[1400px]">
          <Reveal>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="mt-4 text-[clamp(38px,6vw,72px)] font-light leading-[0.95] tracking-[-0.01em]">
              {title}
            </h1>
          </Reveal>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        {/* Sticky category chips */}
        <div className="sticky top-16 z-30 -mx-5 border-b border-hairline bg-obsidian/90 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8 md:top-[76px]">
          <CategoryChips />
        </div>

        <div className="flex gap-10 py-8">
          {/* Sidebar */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-[150px]">
              <Filters />
            </div>
          </aside>

          {/* Main */}
          <div className="min-w-0 flex-1">
            {/* Toolbar */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <p className="font-display text-[13px] tracking-[0.04em] text-ink-muted">
                {loading ? 'Loading…' : data.products.length
                  ? <><span className="text-ink">{total ?? data.products.length}</span> {(total ?? data.products.length) === 1 ? 'result' : 'results'}</>
                  : 'No results'}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex items-center gap-2 border border-hairline px-4 py-2.5 font-display text-[11px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:border-gold/50 hover:text-ink lg:hidden"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
                </button>
                <select
                  value={currentSort}
                  onChange={(e) => setSort(e.target.value)}
                  disabled={loading}
                  className="appearance-none border border-hairline bg-obsidian-raised px-4 py-2.5 font-display text-[12px] tracking-[0.04em] text-ink outline-none focus:border-gold/55"
                  aria-label="Sort products"
                >
                  <option value="createdAt_desc">Newest</option>
                  <option value="price_asc">Price · Low to High</option>
                  <option value="price_desc">Price · High to Low</option>
                  <option value="name_asc">Name · A–Z</option>
                  <option value="rating_desc">Top rated</option>
                </select>
              </div>
            </div>

            {/* Active filter chips */}
            <div className="mb-6 empty:hidden">
              <ActiveFilters />
            </div>

            {/* Error */}
            {error && !loading && <ProductFetchError onRetry={() => router.refresh()} error={error} />}

            {/* Loading */}
            {loading && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="border border-hairline bg-obsidian">
                    <div className="aspect-[4/5] animate-pulse bg-obsidian-raised" />
                    <div className="space-y-3 p-5">
                      <div className="h-3 w-1/3 animate-pulse bg-obsidian-raised" />
                      <div className="h-4 w-3/4 animate-pulse bg-obsidian-raised" />
                      <div className="h-5 w-1/2 animate-pulse bg-obsidian-raised" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Grid */}
            {!loading && !error && data.products.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6">
                  {data.products.map((p, i) => (
                    <Reveal key={p._id} delay={Math.min(i, 8) * 0.04}>
                      <StoreProductCard product={p} featured={p.isFeatured} />
                    </Reveal>
                  ))}
                </div>
                {!showAll && data.pagination && (
                  <div className="mt-12">
                    <Pagination
                      pagination={data.pagination}
                      currentPage={data.pagination.currentPage || 1}
                      basePath="/products"
                      searchParams={new URLSearchParams(searchParams.toString())}
                    />
                  </div>
                )}
              </>
            )}

            {/* Empty */}
            {!loading && !error && data.products.length === 0 && (
              <div className="border border-hairline py-20 text-center">
                <p className="mb-4 font-display text-[15px] font-light text-ink-muted">
                  No products match your filters.
                </p>
                <Link
                  href="/products"
                  className="font-display text-[11px] uppercase tracking-[0.2em] text-gold hover:opacity-80"
                >
                  Clear all filters
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-obsidian-deep/70" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[86vw] max-w-sm flex-col bg-obsidian-deep">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <Eyebrow as="span">Filters</Eyebrow>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close filters" className="text-ink-muted hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <Filters onApplied={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian" />}>
      <ProductsPageInner />
    </Suspense>
  );
}
