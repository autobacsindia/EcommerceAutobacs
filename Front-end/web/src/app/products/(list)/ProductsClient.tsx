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
import { useCampaignProductRates } from '@/hooks/queries/useCampaignProductRates';
import { useCampaignBadgeVisible } from '@/hooks/queries/useCampaign';
import { resolveTerm, type ProductsData } from '@/lib/productQuery';
import ShopContactHero from '@/components/products/ShopContactHero';
import StorePageHeader from '@/components/store/StorePageHeader';
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

  // One batched request for the whole visible page rather than one per card.
  const { data: campaignData } = useCampaignProductRates(data.products.map((p) => p._id));
  const campaignBadgeVisible = useCampaignBadgeVisible();

  // Fire the analytics list-view event once per distinct params — but only when
  // the data is FRESH for those params, not the keepPreviousData placeholder
  // from the prior query (otherwise itemCount would be the previous page's).
  const lastTrackedKey = useRef<string>('');
  useEffect(() => {
    if (!isSuccess || isPlaceholderData) return;
    if (lastTrackedKey.current === spString) return;
    lastTrackedKey.current = spString;
    // Read through resolveTerm, the same helper buildProductsQuery filters by.
    // Keyed on `resolved.search` alone, a `?q=` search reported itself as an
    // unfiltered 'all' browse while the grid really was filtered.
    const term = resolveTerm(resolved);
    trackViewItemList({
      listType: term ? 'search' : (resolved.category || resolved.brand) ? 'category' : 'all',
      listName: term || resolved.category || resolved.brand,
      itemCount: data.products.length,
    });
  }, [spString, resolved, data.products.length, isSuccess, isPlaceholderData]);

  const setSort = (value: string) => {
    const p = new URLSearchParams(searchParams.toString());
    value === 'createdAt_desc' ? p.delete('sort') : p.set('sort', value);
    if (!showAll) p.delete('page');
    router.replace(`/products?${p.toString()}`, { scroll: false });
  };

  const title = isFeatured ? 'Featured picks' : isFastMoving ? 'Best sellers' : 'All products';
  const subtitle = isFeatured
    ? 'Hand-picked by our team — popular upgrades our customers love.'
    : isFastMoving
      ? 'What other drivers are buying most right now.'
      : 'Genuine parts and accessories, with fitment help from our specialists.';
  const total = data.pagination?.total;
  const countLabel = loading
    ? 'Loading…'
    : data.products.length
      ? `${(total ?? data.products.length).toLocaleString('en-IN')} ${(total ?? data.products.length) === 1 ? 'result' : 'results'}`
      : 'No results';

  return (
    <div className="sp sh-theme">
      <StorePageHeader crumbs={[{ label: title }]} title={title} subtitle={subtitle} aside={countLabel} />

      {/* Sticky category chips */}
      <div className="sticky top-[var(--store-header-h)] z-30 border-b border-hairline bg-white/95 backdrop-blur">
        <div className="sp-wrap py-3">
          <CategoryChips />
        </div>
      </div>

      <div className="sp-wrap">
        <div className="flex gap-6 pt-6">
          {/* Sidebar */}
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-[calc(var(--store-header-h)+80px)] max-h-[calc(100vh-var(--store-header-h)-100px)] overflow-y-auto rounded-xl bg-white p-5 shadow-sm">
              <Filters />
            </div>
          </aside>

          {/* Main */}
          <div className="min-w-0 flex-1">
            {/* Toolbar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="text-[14px] text-ink-muted">
                {loading ? 'Loading…' : data.products.length
                  ? <><span className="font-semibold text-ink">{(total ?? data.products.length).toLocaleString('en-IN')}</span> {(total ?? data.products.length) === 1 ? 'result' : 'results'}</>
                  : 'No results'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-semibold text-ink transition-colors hover:border-gold hover:text-gold lg:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" /> Filters
                </button>
                <label className="flex items-center gap-2 text-[14px] text-ink-muted">
                  <span className="hidden sm:inline">Sort by</span>
                  <select
                    value={currentSort}
                    onChange={(e) => setSort(e.target.value)}
                    disabled={loading}
                    className="rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-medium text-ink outline-none focus:border-gold"
                    aria-label="Sort products"
                  >
                    <option value="createdAt_desc">Newest</option>
                    {/* Backed by the time-decayed trailing-sales score
                        (services/salesScoreService.js) — the commercial signal that
                        replaced the dead isFastMoving flag. */}
                    <option value="sales_desc">Best Selling</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A–Z</option>
                    <option value="rating_desc">Top rated</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Active filter chips */}
            <div className="mb-4 empty:hidden">
              <ActiveFilters />
            </div>

            {/* Error */}
            {isError && <ProductFetchError onRetry={() => router.refresh()} error={error as Error} />}

            {/* Loading */}
            {loading && (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-hairline bg-white">
                    <div className="aspect-square animate-pulse bg-obsidian-deep" />
                    <div className="space-y-3 p-4">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-obsidian-deep" />
                      <div className="h-5 w-1/2 animate-pulse rounded bg-obsidian-deep" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Grid */}
            {!loading && !isError && data.products.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {data.products.map((p, i) => (
                    <Reveal key={p._id} delay={Math.min(i, 8) * 0.04}>
                      <StoreProductCard
                        product={p}
                        featured={p.isFeatured}
                        campaignRate={campaignBadgeVisible ? campaignData?.rates?.[p._id] : null}
                      />
                    </Reveal>
                  ))}
                </div>
                {!showAll && data.pagination && (
                  <div className="mt-10">
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
              <div className="sp-card sp-empty">
                <p className="sp-empty-title">No products match your filters</p>
                <p>Try removing a filter, or ask us — we can often source the part.</p>
                <Link href="/products" className="sh-btn sh-btn-primary">Clear all filters</Link>
              </div>
            )}

            <div className="mt-10">
              <ShopContactHero />
            </div>
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
              <Filters onApplied={() => setDrawerOpen(false)} />
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

export default function ProductsClient(props: ProductsClientProps) {
  return (
    <Suspense fallback={<div className="sp sh-theme" />}>
      <ProductsPageInner {...props} />
    </Suspense>
  );
}
