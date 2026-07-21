'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { SlidersHorizontal, X } from 'lucide-react';
import ProductFetchError from '@/components/products/ProductFetchError';
import Pagination from '@/components/layout/Pagination';
import { trackViewItemList } from '@/lib/analytics';
import { useProducts } from '@/hooks/queries/useProducts';
import { normalizeParams } from '@/hooks/queries/keys';
import type { ProductsData } from '@/lib/productQuery';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import StoreProductCard from '@/components/products/redesign/StoreProductCard';
import CategoryChips from '@/components/products/redesign/CategoryChips';
import ActiveFilters from '@/components/products/redesign/ActiveFilters';

const Filters = dynamic(() => import('@/components/products/redesign/Filters'), { ssr: false });

interface ProductsClientProps {
  /** First-page products fetched server-side (for the params the server saw). */
  initialData?: ProductsData;
  /** The params the server fetched with — used to gate initialData to a matching key. */
  initialParams?: Record<string, string>;
}

function ProductsPageInner({ initialData, initialParams }: ProductsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const currentSort = searchParams.get('sort') || 'createdAt_desc';
  const showAll = searchParams.get('showAll') === 'true';
  const isFeatured = searchParams.get('isFeatured') === 'true';
  const isFastMoving = searchParams.get('isFastMoving') === 'true';

  // Stable per URL so it doesn't churn the query key / effect on every render.
  const spString = searchParams.toString();
  const resolved = useMemo(() => Object.fromEntries(new URLSearchParams(spString)), [spString]);

  // Only seed the query with the server-rendered page when the CURRENT params
  // match the params the server fetched. On a filter/sort/page change the key
  // differs, so we must NOT hand the old server page to the new key.
  const seededData = useMemo(() => {
    if (!initialData || !initialParams) return undefined;
    const same = JSON.stringify(normalizeParams(resolved)) === JSON.stringify(normalizeParams(initialParams));
    return same ? initialData : undefined;
  }, [initialData, initialParams, resolved]);

  const { data = { products: [], pagination: {} }, isPending, isError, isSuccess, isPlaceholderData, error } =
    useProducts(resolved, { initialData: seededData });
  // isPending is true only on the very first load for a given key; with
  // keepPreviousData a filter/sort/page change keeps the old grid up (no
  // skeleton flash) while the next page fetches.
  const loading = isPending;

  // Fire the analytics list-view event once per distinct params — but only when
  // the data is FRESH for those params, not the keepPreviousData placeholder
  // from the prior query (otherwise itemCount would be the previous page's).
  const lastTrackedKey = useRef<string>('');
  useEffect(() => {
    if (!isSuccess || isPlaceholderData) return;
    if (lastTrackedKey.current === spString) return;
    lastTrackedKey.current = spString;
    trackViewItemList({
      listType: resolved.search ? 'search' : (resolved.category || resolved.brand) ? 'category' : 'all',
      listName: resolved.search || resolved.category || resolved.brand,
      itemCount: data.products.length,
    });
  }, [spString, resolved, data.products.length, isSuccess, isPlaceholderData]);

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
            {isError && <ProductFetchError onRetry={() => router.refresh()} error={error as Error} />}

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
            {!loading && !isError && data.products.length > 0 && (
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
            {!loading && !isError && data.products.length === 0 && (
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

export default function ProductsClient(props: ProductsClientProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian" />}>
      <ProductsPageInner {...props} />
    </Suspense>
  );
}
