'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Filter, X } from 'lucide-react';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import apiClient from '@/lib/api';
import { vehicleService, VEHICLE_IMAGE_MAP, CROSS_RELATED_SLUG_MAP, getVehicleImageUrl } from '@/services/vehicleService';
import type { Product } from '@/lib/types';
import StoreProductCard from '@/components/products/redesign/StoreProductCard';
import StorePageHeader from '@/components/store/StorePageHeader';
import VehicleImage from '@/components/vehicles/VehicleImage';
import { useCampaignProductRates } from '@/hooks/queries/useCampaignProductRates';
import { useCampaignBadgeVisible } from '@/hooks/queries/useCampaign';

/**
 * Single source of truth for the `/model/[slug]` vehicle listing — rendered by
 * both the page-1 route (`/model/[slug]`) and the paginated route
 * (`/model/[slug]/page/[page]`), which pass only a different `pageNumber`.
 *
 * Sort and category live in the URL (`?sort=`, `?category=`) so they survive
 * pagination and are shareable; pagination is route-based to preserve the
 * existing indexed URL structure.
 */

interface Category {
  _id?: string;
  id?: string | number;
  name: string;
  slug: string;
}

interface RelatedVehicle {
  _id: string;
  slug: string;
  make?: string;
  model?: string;
  name?: string;
  image?: { url?: string };
}

const ITEMS_PER_PAGE = 12;
const RELATED_LIMIT = 5;

/** Sort dropdown value → backend `sortBy`/`order`. */
const SORT_MAP: Record<string, { sortBy: string; order: 'asc' | 'desc' }> = {
  date: { sortBy: 'createdAt', order: 'desc' },
  price_asc: { sortBy: 'price', order: 'asc' },
  price_desc: { sortBy: 'price', order: 'desc' },
  name_asc: { sortBy: 'name', order: 'asc' },
  rating: { sortBy: 'averageRating', order: 'desc' },
};

/** Keyword → VEHICLE_IMAGE_MAP key for the related-vehicle thumbnails. */
const RELATED_IMAGE_KEYWORDS: Array<[keyword: string, mapKey: string]> = [
  ['fortuner', 'fortuner'],
  ['hilux', 'hilux'],
  ['thar', 'thar'],
  ['jimny', 'jimny'],
  ['wrangler', 'wrangler'],
  ['endeavour', 'endeavour'],
  ['ranger', 'ranger'],
  ['defender', 'defender'],
  ['isuzu', 'isuzu-dmax'],
  ['dmax', 'isuzu-dmax'],
];

function formatVehicleName(raw: string): string {
  return raw
    .replace(/-/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Resolve a thumbnail for a related vehicle, or null if none is known. */
function resolveRelatedVehicleImage(v: RelatedVehicle): string | null {
  const slugKey = (v.slug || '').toLowerCase();
  const nameKey = `${v.make || ''}-${v.model || ''}`
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const match = RELATED_IMAGE_KEYWORDS.find(
    ([kw]) => slugKey.includes(kw) || nameKey.includes(kw)
  );
  if (match && VEHICLE_IMAGE_MAP[match[1]]) return VEHICLE_IMAGE_MAP[match[1]];

  return v.image?.url || VEHICLE_IMAGE_MAP[slugKey] || VEHICLE_IMAGE_MAP[nameKey] || null;
}

export default function VehicleModelListing({
  slug,
  pageNumber,
}: {
  slug: string;
  pageNumber: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { handleError } = useErrorHandler();

  // URL-driven filter/sort state (survives pagination, shareable).
  const currentSort = searchParams.get('sort') || 'date';
  const selectedCategory = searchParams.get('category') || '';
  const currentPage = Math.max(1, pageNumber || 1);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [vehicle, setVehicle] = useState<{ make?: string; model?: string; slug?: string } | null>(null);
  const [relatedVehicles, setRelatedVehicles] = useState<RelatedVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const vehicleName = slug ? decodeURIComponent(slug) : '';
  const displayName = vehicleName ? formatVehicleName(vehicleName) : 'Vehicle';
  // A photo we really have for this model (local or mapped); otherwise the placeholder.
  const heroImage = getVehicleImageUrl(slug) ?? null;

  // One batched request for the whole visible page rather than one per card.
  const { data: campaignData } = useCampaignProductRates(products.map((p) => p._id || (p as { id?: string }).id).filter((id): id is string => !!id));
  const campaignBadgeVisible = useCampaignBadgeVisible();

  useEffect(() => {
    if (!slug) {
      router.push('/vehicles');
      return;
    }

    let active = true;
    const timeout = 45000;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const sort = SORT_MAP[currentSort] ?? SORT_MAP.date;
        const [categoriesRes, productsRes, vehicleRes] = await Promise.all([
          apiClient
            .get<{ categories?: Category[] }>('/categories', { timeout })
            .catch(() => ({ categories: [] })),
          vehicleService
            .getVehicleProducts(
              slug,
              {
                page: currentPage,
                limit: ITEMS_PER_PAGE,
                ...(selectedCategory && { category: selectedCategory }),
                sortBy: sort.sortBy,
                order: sort.order,
              },
              { timeout }
            )
            .catch((err: unknown) => {
              console.warn('Could not fetch vehicle products:', err);
              return { products: [], total: 0 };
            }),
          apiClient
            .get<{ success?: boolean; vehicle?: Record<string, unknown> }>(`/vehicles/slug/${slug}`, { timeout })
            .catch((err: unknown) => {
              console.warn('Could not fetch vehicle data:', err);
              return { success: false };
            }),
        ]);

        if (!active) return;

        setCategories((categoriesRes as { categories?: Category[] }).categories || []);

        const pr = productsRes as { products?: Product[]; total?: number; pagination?: { total?: number } };
        setProducts(pr.products || []);
        setTotalProducts(pr.pagination?.total ?? pr.total ?? 0);

        const vr = vehicleRes as { success?: boolean; vehicle?: { make?: string; model?: string; slug?: string } };
        if (vr.success && vr.vehicle) {
          setVehicle(vr.vehicle);
          void loadRelatedVehicles(vr.vehicle);
        }
      } catch (err) {
        if (!active) return;
        setError(handleError(err, 'Failed to load products for this vehicle'));
      } finally {
        if (active) setLoading(false);
      }
    };

    // Related vehicles are secondary — fetched after the main payload and never
    // block or fail the page.
    const loadRelatedVehicles = async (current: { make?: string; model?: string; slug?: string }) => {
      if (!current.make || !current.model) return;
      try {
        const modelsRes = await apiClient.get<{ success?: boolean; models?: string[] }>(
          `/vehicles/models/${current.make}`
        );
        if (!modelsRes.success || !modelsRes.models) return;

        const siblings = await Promise.all(
          modelsRes.models
            .filter((m) => m.toLowerCase() !== current.model!.toLowerCase())
            .map((m) =>
              apiClient
                .get<{ success?: boolean; vehicle?: RelatedVehicle }>(`/vehicles/make-model/${current.make}/${m}`)
                .then((res) => (res.success && res.vehicle ? res.vehicle : null))
                .catch(() => null)
            )
        );
        const related = siblings.filter((v): v is RelatedVehicle => v !== null);

        // Optional editorial cross-links (e.g. Thar ↔ Jimny).
        const crossTargets = CROSS_RELATED_SLUG_MAP[(current.slug || '').toLowerCase()] || [];
        if (crossTargets.length > 0) {
          try {
            const all = await vehicleService.getAllVehicles();
            for (const target of crossTargets) {
              if (related.some((v) => (v.slug || '').toLowerCase() === target)) continue;
              const found = all.find((v) => (v.slug || '').toLowerCase() === target);
              if (found) related.unshift(found as unknown as RelatedVehicle);
            }
          } catch (crossErr) {
            console.warn('Could not enrich cross-related vehicles:', crossErr);
          }
        }

        if (active) setRelatedVehicles(related);
      } catch (err) {
        console.warn('Could not fetch related vehicles:', err);
      }
    };

    fetchData();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, currentPage, currentSort, selectedCategory]);

  // ── URL builders: pagination preserves the active sort/category ──
  const buildUrl = (page: number, overrides?: { sort?: string; category?: string }) => {
    const sp = new URLSearchParams();
    const sort = overrides?.sort ?? currentSort;
    const category = overrides?.category ?? selectedCategory;
    if (sort && sort !== 'date') sp.set('sort', sort);
    if (category) sp.set('category', category);
    const base = page <= 1 ? `/model/${slug}` : `/model/${slug}/page/${page}`;
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // Changing sort changes the result order → reset to page 1.
    router.push(buildUrl(1, { sort: e.target.value }));
  };

  const handleCategoryChange = (categorySlug: string) => {
    setDrawerOpen(false);
    router.push(buildUrl(1, { category: categorySlug }));
  };

  // Products arrive already filtered + paginated from the API.
  const safeTotal = totalProducts || 0;
  const totalPages = Math.max(0, Math.ceil(safeTotal / ITEMS_PER_PAGE));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, safeTotal);

  const pageWindow = (() => {
    if (totalPages <= 0) return [];
    const count = Math.min(5, totalPages);
    let start: number;
    if (totalPages <= 5) start = 1;
    else if (currentPage <= 3) start = 1;
    else if (currentPage >= totalPages - 2) start = totalPages - 4;
    else start = currentPage - 2;
    return Array.from({ length: count }, (_, i) => start + i).filter((n) => n >= 1);
  })();

  // Category filter list — shared by the desktop sidebar and the mobile drawer.
  const categoryFilters = (
    <>
      <p className="mb-3 text-[15px] font-bold text-ink">Categories</p>
      <ul className="space-y-1">
        <li>
          <button
            onClick={() => handleCategoryChange('')}
            className={`w-full rounded-lg px-3 py-2 text-left text-[14px] transition-colors ${
              selectedCategory === ''
                ? 'bg-gold font-semibold text-white'
                : 'text-ink/80 hover:bg-gold/10 hover:text-gold'
            }`}
          >
            All Categories
          </button>
        </li>
        {categories.filter((cat) => cat && (cat._id || cat.id)).map((category) => {
          const count = products.filter(
            (p) => Array.isArray(p.categories) && p.categories.some((c) => c && c.slug === category.slug)
          ).length;
          if (count === 0 && selectedCategory !== category.slug) return null;

          return (
            <li key={String(category._id || category.id)}>
              <button
                onClick={() => handleCategoryChange(category.slug)}
                className={`w-full rounded-lg px-3 py-2 text-left text-[14px] transition-colors ${
                  selectedCategory === category.slug
                    ? 'bg-gold font-semibold text-white'
                    : 'text-ink/80 hover:bg-gold/10 hover:text-gold'
                }`}
              >
                {category.name} ({count})
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );

  const paginationBtnBase =
    'inline-flex min-w-[40px] items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-colors';
  const paginationBtnActive = `${paginationBtnBase} bg-gold text-white border-gold`;
  const paginationBtnEnabled = `${paginationBtnBase} bg-white text-ink border-hairline hover:border-gold hover:text-gold`;
  const paginationBtnDisabled = `${paginationBtnBase} bg-white text-ink-muted/50 border-hairline cursor-not-allowed`;

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[
          { label: 'Shop by vehicle', href: '/vehicles' },
          ...(vehicle?.make ? [{ label: vehicle.make, href: `/vehicles/${encodeURIComponent(vehicle.make)}` }] : []),
          currentPage > 1 ? { label: displayName, href: `/model/${slug}` } : { label: displayName },
          ...(currentPage > 1 ? [{ label: `Page ${currentPage}` }] : []),
        ]}
        title={
          <span className="flex items-center gap-4">
            <span className="hidden h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-hairline sm:block">
              <VehicleImage src={heroImage} alt={displayName} make={vehicle?.make} sizes="96px" className="h-full w-full object-cover" />
            </span>
            <span>{displayName} parts &amp; accessories</span>
          </span>
        }
        subtitle={`Every part here is listed as fitting your ${displayName}.`}
        aside={!loading && !error ? `${safeTotal.toLocaleString('en-IN')} product${safeTotal !== 1 ? 's' : ''}` : undefined}
      />

      {/* Main Content */}
      <div className="sp-wrap">
        <div className="flex gap-6 pt-6">
          {/* Sidebar */}
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              {categoryFilters}
            </div>
          </aside>

          {/* Products */}
          <div className="min-w-0 flex-1">
            {/* Results Header */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="text-[14px] text-ink-muted">
                {loading ? (
                  'Loading products...'
                ) : products.length > 0 ? (
                  <>
                    Showing {startIndex + 1}–{Math.min(endIndex, safeTotal)} of {safeTotal} product{safeTotal !== 1 ? 's' : ''}
                    {selectedCategory && ` in ${categories.find((c) => c.slug === selectedCategory)?.name || selectedCategory}`}
                    {' '}for {displayName}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              <div className="flex items-center gap-3">
                {/* Mobile Filter Button */}
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-semibold text-ink transition-colors hover:border-gold hover:text-gold lg:hidden"
                >
                  <Filter className="h-4 w-4" />
                  Filters
                </button>

                {/* Sort */}
                <div className="flex items-center gap-2">
                  <label htmlFor="sort" className="hidden text-[14px] text-ink-muted sm:inline">Sort by</label>
                  <select
                    id="sort"
                    className="rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-medium text-ink outline-none focus:border-gold"
                    value={currentSort}
                    onChange={handleSortChange}
                    disabled={loading}
                  >
                    <option value="date">Newest First</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A to Z</option>
                    <option value="rating">Highest Rated</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Grid / states */}
            {loading ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-hairline bg-white">
                    <div className="aspect-square animate-pulse bg-obsidian-deep" />
                    <div className="space-y-3 p-4">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-obsidian-deep" />
                      <div className="h-5 w-1/2 animate-pulse rounded bg-obsidian-deep" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="sp-card sp-empty" role="alert">
                <p className="sp-empty-title">We couldn&apos;t load the products</p>
                <p>{error}</p>
                <button onClick={() => router.refresh()} className="sh-btn sh-btn-primary">
                  Try again
                </button>
              </div>
            ) : products.length > 0 ? (
              <div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {products
                    .filter((p) => p && (p._id || (p as { id?: string }).id))
                    .map((product) => {
                      const pid = product._id || (product as { id?: string }).id;
                      return (
                        <StoreProductCard
                          key={pid}
                          product={product}
                          featured={product.isFeatured || (product as { featured?: boolean }).featured}
                          fitmentBadge={displayName}
                          campaignRate={campaignBadgeVisible && pid ? campaignData?.rates?.[pid] : null}
                        />
                      );
                    })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-10 flex items-center justify-center">
                    {/* Real <a href> links, NOT router.push buttons. Pagination that
                        exists only as an onClick has no crawl path at all: pages 2..n of
                        every model listing were unreachable to a crawler and are absent
                        from sitemap.xml, which is why Google knew /model/<slug>/page/3
                        only as a legacy WordPress URL. <Link> still navigates
                        client-side, so nothing about the UX changes. The out-of-range
                        ends stay non-links (a disabled <button> had no href either). */}
                    <nav className="flex items-center gap-2" aria-label="Pagination">
                      {currentPage <= 1 ? (
                        <span aria-disabled="true" className={paginationBtnDisabled}>
                          Previous
                        </span>
                      ) : (
                        <Link href={buildUrl(currentPage - 1)} className={paginationBtnEnabled}>
                          Previous
                        </Link>
                      )}

                      {pageWindow.map((pageNum) => (
                        <Link
                          key={pageNum}
                          href={buildUrl(pageNum)}
                          aria-current={currentPage === pageNum ? 'page' : undefined}
                          className={currentPage === pageNum ? paginationBtnActive : paginationBtnEnabled}
                        >
                          {pageNum}
                        </Link>
                      ))}

                      {currentPage >= totalPages ? (
                        <span aria-disabled="true" className={paginationBtnDisabled}>
                          Next
                        </span>
                      ) : (
                        <Link href={buildUrl(currentPage + 1)} className={paginationBtnEnabled}>
                          Next
                        </Link>
                      )}
                    </nav>
                  </div>
                )}
              </div>
            ) : (
              <div className="sp-card sp-empty">
                <p className="sp-empty-title">No products listed for {displayName} yet</p>
                <p>Our specialists can still find parts that fit — or try all categories.</p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button onClick={() => handleCategoryChange('')} className="sh-btn sh-btn-outline">View all categories</button>
                  <Link href="/consultation" className="sh-btn sh-btn-primary">Ask a specialist</Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Related Vehicles */}
        {relatedVehicles.length > 0 && (
          <section className="sp-section" aria-labelledby="related-title">
            <div className="sp-section-head">
              <h2 id="related-title" className="sp-h2">More {vehicle?.make || 'vehicles'}</h2>
              <Link href="/vehicles" className="st-link">All vehicles ›</Link>
            </div>
            <div className="sp-tiles">
              {relatedVehicles
                .filter((v) => v && v._id && v.slug)
                .slice(0, RELATED_LIMIT)
                .map((relatedVehicle) => (
                  <Link key={relatedVehicle._id} href={`/model/${encodeURIComponent(relatedVehicle.slug)}`} className="sp-tile">
                    <div className="sp-tile-media">
                      <VehicleImage
                        src={resolveRelatedVehicleImage(relatedVehicle)}
                        alt={relatedVehicle.name || `${relatedVehicle.make} ${relatedVehicle.model}`}
                        make={relatedVehicle.make}
                      />
                    </div>
                    <div className="sp-tile-body">
                      <div>
                        <p className="sp-tile-name">{relatedVehicle.model}</p>
                        <p className="sp-tile-sub">{relatedVehicle.make}</p>
                      </div>
                      <span className="sp-tile-go" aria-hidden="true">›</span>
                    </div>
                  </Link>
                ))}
            </div>
          </section>
        )}
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[86vw] max-w-sm flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h2 className="flex items-center gap-2 text-[17px] font-bold text-ink">
                <Filter className="h-4 w-4 shrink-0 text-gold" />
                Filters
              </h2>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close filters" className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-obsidian-deep hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{categoryFilters}</div>
          </div>
        </div>
      )}
    </div>
  );
}
