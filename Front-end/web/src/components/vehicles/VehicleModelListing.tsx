'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Filter, X } from 'lucide-react';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import apiClient from '@/lib/api';
import { vehicleService, VEHICLE_IMAGE_MAP, CROSS_RELATED_SLUG_MAP } from '@/services/vehicleService';
import type { Product } from '@/lib/types';
import StoreProductCard from '@/components/products/redesign/StoreProductCard';

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

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    router.push(buildUrl(page));
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
      <p className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-3">Categories</p>
      <ul className="space-y-1">
        <li>
          <button
            onClick={() => handleCategoryChange('')}
            className={`text-left w-full px-3 py-2 rounded-sm text-sm transition-colors ${
              selectedCategory === ''
                ? 'bg-gold/10 text-gold font-display font-bold border border-gold/30'
                : 'text-ink/70 font-display hover:bg-obsidian-raised'
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
                className={`text-left w-full px-3 py-2 rounded-sm text-sm transition-colors ${
                  selectedCategory === category.slug
                    ? 'bg-gold/10 text-gold font-display font-bold border border-gold/30'
                    : 'text-ink/70 font-display hover:bg-obsidian-raised'
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
    'px-4 py-2 rounded-sm border font-display font-bold text-sm uppercase tracking-widest transition-colors';
  const paginationBtnActive = `${paginationBtnBase} bg-gold text-obsidian border-gold`;
  const paginationBtnEnabled = `${paginationBtnBase} bg-obsidian-raised text-ink/70 border-hairline hover:border-gold hover:text-ink`;
  const paginationBtnDisabled = `${paginationBtnBase} bg-obsidian-raised text-ink-muted border-hairline cursor-not-allowed`;

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="bg-obsidian border-b border-hairline py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Vehicles</p>
          <h1 className="text-5xl font-display font-light text-ink tracking-[-0.01em] mb-4">
            {displayName} Parts &amp; Accessories
          </h1>
          <p className="text-ink/70 font-display max-w-3xl mx-auto">
            Find the perfect parts and accessories for your {displayName}
          </p>

          {vehicle && (
            <div className="mt-6 flex flex-wrap justify-center gap-6 text-sm text-ink/70 font-display">
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-ink-muted uppercase tracking-widest">Make</span>
                <span>{vehicle.make}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-ink-muted uppercase tracking-widest">Model</span>
                <span>{vehicle.model}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <nav className="text-sm font-display">
          <Link href="/" className="text-ink-muted hover:text-gold transition-colors">Home</Link>
          <span className="mx-2 text-hairline">/</span>
          <Link href="/vehicles" className="text-ink-muted hover:text-gold transition-colors">Vehicles</Link>
          <span className="mx-2 text-hairline">/</span>
          {currentPage > 1 ? (
            <>
              <Link href={`/model/${slug}`} className="text-ink-muted hover:text-gold transition-colors">{displayName}</Link>
              <span className="mx-2 text-hairline">/</span>
              <span className="text-ink/70">Page {currentPage}</span>
            </>
          ) : (
            <span className="text-ink/70">{displayName}</span>
          )}
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="bg-obsidian border border-hairline rounded-sm p-6 sticky top-24">
              <h2 className="font-display font-light text-ink tracking-[-0.01em] mb-5 flex items-center gap-2">
                <Filter className="h-4 w-4 text-gold shrink-0" />
                Category Filters
              </h2>
              {categoryFilters}
            </div>
          </aside>

          {/* Products */}
          <div className="lg:col-span-3">
            {/* Results Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-ink/70 font-display">
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
                  className="lg:hidden flex items-center gap-2 text-sm font-display font-bold text-ink/70 uppercase tracking-widest bg-obsidian-raised px-4 py-2 rounded-sm border border-hairline hover:border-gold transition-colors"
                >
                  <Filter className="h-4 w-4" />
                  Filters
                </button>

                {/* Sort */}
                <div className="flex items-center gap-2">
                  <label htmlFor="sort" className="text-sm text-ink-muted font-display">Sort:</label>
                  <select
                    id="sort"
                    className="bg-obsidian-raised border border-hairline text-ink/70 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-gold font-display transition-colors"
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
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-obsidian border border-hairline rounded-sm overflow-hidden animate-pulse">
                    <div className="aspect-[4/5] bg-obsidian-raised" />
                    <div className="p-5 space-y-3">
                      <div className="h-4 bg-obsidian-raised rounded-sm" />
                      <div className="h-4 bg-obsidian-raised rounded-sm w-2/3" />
                      <div className="h-5 bg-obsidian-raised rounded-sm w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8 text-center max-w-2xl mx-auto">
                <h3 className="text-lg font-display font-bold text-red-400 uppercase tracking-wide mb-3">Error Loading Products</h3>
                <p className="text-ink/70 font-display mb-5">{error}</p>
                <button
                  onClick={() => router.refresh()}
                  className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : products.length > 0 ? (
              <div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6">
                  {products
                    .filter((p) => p && (p._id || (p as { id?: string }).id))
                    .map((product) => (
                      <StoreProductCard
                        key={product._id || (product as { id?: string }).id}
                        product={product}
                        featured={product.isFeatured || (product as { featured?: boolean }).featured}
                        fitmentBadge={displayName}
                      />
                    ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-12 flex items-center justify-center">
                    <nav className="flex items-center gap-2" aria-label="Pagination">
                      <button
                        onClick={() => goToPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        className={currentPage === 1 ? paginationBtnDisabled : paginationBtnEnabled}
                      >
                        Previous
                      </button>

                      {pageWindow.map((pageNum) => (
                        <button
                          key={pageNum}
                          onClick={() => goToPage(pageNum)}
                          aria-current={currentPage === pageNum ? 'page' : undefined}
                          className={currentPage === pageNum ? paginationBtnActive : paginationBtnEnabled}
                        >
                          {pageNum}
                        </button>
                      ))}

                      <button
                        onClick={() => goToPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className={currentPage === totalPages ? paginationBtnDisabled : paginationBtnEnabled}
                      >
                        Next
                      </button>
                    </nav>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-ink-muted font-display text-lg mb-4">No products found for {displayName}</p>
                <button
                  onClick={() => handleCategoryChange('')}
                  className="text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors"
                >
                  View all products
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Related Vehicles */}
        {relatedVehicles.length > 0 && (
          <section className="mt-16">
            <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em] mb-8">
              Related {vehicle?.make || 'Vehicles'}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {relatedVehicles
                .filter((v) => v && v._id && v.slug)
                .slice(0, RELATED_LIMIT)
                .map((relatedVehicle) => {
                  const imageUrl = resolveRelatedVehicleImage(relatedVehicle);
                  return (
                    <Link
                      key={relatedVehicle._id}
                      href={`/model/${encodeURIComponent(relatedVehicle.slug)}`}
                      className="group block"
                    >
                      <div className="bg-obsidian border border-hairline rounded-sm overflow-hidden hover:border-gold transition-colors">
                        <div className="aspect-square bg-obsidian-raised flex items-center justify-center overflow-hidden">
                          {imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imageUrl}
                              alt={relatedVehicle.name || `${relatedVehicle.make} ${relatedVehicle.model}`}
                              className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/images/fallback-product.png';
                              }}
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-ink-muted font-display text-xs">No image</span>
                            </div>
                          )}
                        </div>
                        <div className="p-3 text-center bg-obsidian-raised border-t border-hairline">
                          <h3 className="text-sm font-display font-bold text-ink/70 group-hover:text-gold uppercase tracking-wide transition-colors">
                            {relatedVehicle.model}
                          </h3>
                        </div>
                      </div>
                    </Link>
                  );
                })}
            </div>
          </section>
        )}
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-obsidian-deep/70" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[86vw] max-w-sm flex-col bg-obsidian-deep">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h2 className="font-display font-light text-ink tracking-[-0.01em] flex items-center gap-2">
                <Filter className="h-4 w-4 text-gold shrink-0" />
                Category Filters
              </h2>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close filters" className="text-ink-muted hover:text-ink">
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
