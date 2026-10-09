'use client';

import type { StockStatus } from '@/lib/stock';
import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SlidersHorizontal, X } from 'lucide-react';
import apiClient from '@/lib/api';
import ProductGrid from '@/components/products/ProductGrid';
import Filters from '@/components/products/redesign/Filters';
import CategoryChips from '@/components/products/redesign/CategoryChips';
import ShopContactHero from '@/components/products/ShopContactHero';
import Pagination from '@/components/layout/Pagination';
import StorePageHeader from '@/components/store/StorePageHeader';
import { trackViewItemList } from '@/lib/analytics';
import { getMainCategory } from '@/lib/categoryMapping';
import { resolveCategoryScope } from '@/lib/categoryScope';
import { useCategoriesFetcher } from '@/hooks/queries/useCategories';

// Define types for our data
interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category: { 
    _id: string;
    name: string;
    slug: string;
  } | string;
  brand?: string;
  images: ProductImage[] | string;
  stock: StockStatus;
  sku?: string;
  specifications?: Array<{
    key: string;
    value: string;
    _id?: string;
  }> | string;
  features?: string[] | string;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[] | string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

interface Pagination {
  total?: number;
  pages?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  count?: number;
}

interface ProductsData {
  products: Product[];
  pagination: Pagination;
}

interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: any;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

// Function to fetch products with proper sorting parameters
async function getProducts(searchParams: any, categoryId: string): Promise<ProductsData> {
  try {
    // Build query string from search params
    const queryParams = new URLSearchParams();
    
    // Add category filter. `categoryId` is the resolved SCOPE: the hub itself,
    // or — when the sidebar has drilled into this hub's children — those
    // children. It was previously always the hub, so any category the sidebar
    // wrote to the URL changed the checkbox and nothing else.
    queryParams.append('category', categoryId);

    if (searchParams.search) queryParams.append('search', searchParams.search);
    if (searchParams.page) queryParams.append('page', searchParams.page);
    if (searchParams.minPrice) queryParams.append('minPrice', searchParams.minPrice);
    if (searchParams.maxPrice) queryParams.append('maxPrice', searchParams.maxPrice);
    if (searchParams.inStock) queryParams.append('inStock', searchParams.inStock);
    if (searchParams.rating) queryParams.append('rating', searchParams.rating);
    if (searchParams.vehicleMake) queryParams.append('vehicleMake', searchParams.vehicleMake);
    if (searchParams.vehicleModel) queryParams.append('vehicleModel', searchParams.vehicleModel);
    if (searchParams.brand) queryParams.append('brand', searchParams.brand);
    if (searchParams.showAll === 'true') queryParams.append('limit', '500');
    
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
    
    // Fix: Backend returns pagination properties directly in response object
    if (data && data.products) {
      // Extract pagination properties from the response
      const { total, pages, currentPage, hasNext, hasPrev, count } = data;
      return {
        products: data.products,
        pagination: {
          total,
          pages,
          currentPage,
          hasNext,
          hasPrev,
          count
        }
      };
    }
    return { products: [], pagination: {} };
  } catch (error: any) {
    // 404 means "nothing matches" — a genuinely empty result.
    if (error.status === 404 || error.responseStatus === 404) return { products: [], pagination: {} };
    // Anything else (dropped connection, server hiccup) is NOT an empty category:
    // throw so the page offers a retry instead of claiming there are no products.
    console.error('Error fetching products:', error);
    throw new Error(LOAD_FAILED);
  }
}

/** A load that failed for a reason other than "not found" — shown with a retry. */
const LOAD_FAILED = 'We couldn\'t load products right now. Please check your connection and try again.';

// Function to fetch category by slug
async function getCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const response: any = await apiClient.get(`/categories/slug/${slug}`);
    // The API returns { success: true, category: {...} } for successful requests
    // Or { success: false, message: '...' } for errors
    if (response.success && response.category) {
      return response.category;
    }
    
    // If we get here, the category wasn't found
    return null;
  } catch (error: any) {
    // Handle 404 errors silently as they're expected for invalid slugs
    if (error.status === 404 || error.responseStatus === 404) {
      return null;
    }
    
    // Anything else is a failed load, not a missing category — see getProducts.
    console.error('Unexpected error fetching category:', error);
    throw new Error(LOAD_FAILED);
  }
}

function ClientPageInner({ slug, initialCategory }: { slug: string; initialCategory?: Category | null }) {
  const searchParams = useSearchParams();
  // Reads the same cached taxonomy the chip strip above renders from.
  const fetchCategories = useCategoriesFetcher();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  // Seed from the category the server component already fetched for metadata, so
  // the header renders immediately and we skip a redundant category network call.
  const [category, setCategory] = useState<Category | null>(initialCategory ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped by "Try again" to re-run the load effect after a failed fetch.
  const [reloadKey, setReloadKey] = useState(0);

  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'createdAt_desc';
  const showAll = searchParams.get('showAll') === 'true';
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  // Helper functions to safely access pagination properties
  const getPaginationTotal = (pagination: Pagination | undefined) => {
    return pagination && 'total' in pagination ? pagination.total : undefined;
  };

  const getPaginationPages = (pagination: Pagination | undefined) => {
    return pagination && 'pages' in pagination ? pagination.pages : undefined;
  };

  const getPaginationPage = (pagination: Pagination | undefined) => {
    return pagination && 'currentPage' in pagination ? pagination.currentPage : undefined;
  };

  // Fetch category and products when slug or search params change
  useEffect(() => {
    /*
      Guards BOTH unmount and supersession. React runs this effect's cleanup
      before starting the next run, so a superseded run's `isMounted` is already
      false by the time its (slower) response lands — a stale answer arriving
      last cannot paint over a newer one. See ClientPage.race.test.tsx.
    */
    let isMounted = true;
    
    const fetchData = async () => {
      if (!isMounted) return;
      
      try {
        setLoading(true);
        setError(null);
        
        // Validate slug before fetching
        if (!slug) {
          if (isMounted) {
            setError('Invalid category');
            setData({ products: [], pagination: {} });
          }
          return;
        }
        
        // Reuse the server-provided category on the initial slug; only hit the
        // network when navigating client-side to a different category.
        const categoryData = (initialCategory && initialCategory.slug === slug)
          ? initialCategory
          : await getCategoryBySlug(slug);
        if (!categoryData) {
          if (isMounted) {
            setError('Category not found');
            setData({ products: [], pagination: {} });
          }
          return;
        }
        
        if (isMounted) {
          setCategory(categoryData);
        }
        
        // Fetch products for this category
        const resolvedSearchParams = Object.fromEntries(searchParams.entries());
        const scope = await resolveCategoryScope(
          categoryData._id,
          (searchParams.get('category') ?? '').split(',').filter(Boolean),
          fetchCategories
        );
        const result = await getProducts(resolvedSearchParams, scope);
        if (isMounted) {
          setData(result);
          // Analytics: view_item_list (ADR-005)
          trackViewItemList({ listType: 'category', listName: categoryData.slug || slug, itemCount: result.products.length });
        }
      } catch (err: any) {
        if (isMounted) {
          // Only show error message if it's not the expected "Category not found" error
          if (err.message && err.message !== 'Category not found') {
            setError(err.message || 'Failed to load products');
          }
          setData({ products: [], pagination: {} });
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
    // `fetchCategories` is stable (memoised on the query client), so listing it
    // satisfies the lint rule without re-running the effect.
  }, [slug, searchParams, fetchCategories, reloadKey]);

  // Handle sort change
  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortValue = e.target.value;
    const currentParams = new URLSearchParams(window.location.search);
    
    // Remove existing sort parameter
    currentParams.delete('sort');
    
    // Add new sort parameter if it's not the default
    if (sortValue !== 'createdAt_desc') {
      currentParams.set('sort', sortValue);
    }
    
    // Reset to first page when sorting (unless showing all)
    if (!showAll) {
      currentParams.delete('page');
    }
    
    // Update URL which will trigger useEffect
    window.location.search = currentParams.toString();
  };

  // Handle show all toggle
  const handleShowAllToggle = () => {
    const currentParams = new URLSearchParams(window.location.search);
    
    if (showAll) {
      currentParams.delete('showAll');
      currentParams.delete('limit');
      // Reset to first page when switching back to paginated view
      currentParams.delete('page');
    } else {
      currentParams.set('showAll', 'true');
    }
    
    // Update URL which will trigger useEffect
    window.location.search = currentParams.toString();
  };

  if (error && (error === 'Category not found' || error === 'Invalid category')) {
    return (
      <div className="sp sh-theme">
        <div className="sp-wrap">
          <div className="sp-section sp-card sp-empty mx-auto max-w-lg">
            <p className="sp-empty-title">Category not available</p>
            <p>{error === 'Invalid category' ? 'That category link is not valid.' : "This category doesn't exist or has been removed."}</p>
            <Link href="/categories" className="sh-btn sh-btn-primary">Browse all categories</Link>
          </div>
        </div>
      </div>
    );
  }

  const total = getPaginationTotal(data.pagination);
  const countLabel = loading
    ? 'Loading…'
    : data.products.length
      ? `${(total || data.products.length).toLocaleString('en-IN')} ${(total || data.products.length) === 1 ? 'product' : 'products'}`
      : 'No products';

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: 'Categories', href: '/categories' }, { label: category?.name || 'Category' }]}
        title={category?.name || 'Products'}
        subtitle={category?.description || `Shop ${category?.name ? category.name.toLowerCase() : 'parts'} for your car — genuine products with fitment help.`}
        aside={countLabel}
      />

      {/* Category strip — the same control as /products. Without it, arriving here
          from a chip was a one-way door: no way to reach a sibling hub but Back. */}
      <div className="sticky top-[var(--store-header-h)] z-30 border-b border-hairline bg-white/95 backdrop-blur">
        <div className="sp-wrap py-3">
          <CategoryChips />
        </div>
      </div>

      <div className="sp-wrap">
        <div className="flex gap-6 pt-6">
          {/* Filters Sidebar */}
          <aside className="hidden w-64 shrink-0 lg:block">
            {/* Clears the sticky category strip above, same offset /products uses. */}
            <div className="sticky top-[calc(var(--store-header-h)+80px)] max-h-[calc(100vh-var(--store-header-h)-100px)] overflow-y-auto rounded-xl bg-white p-5 shadow-sm">
              <Filters basePath={`/categories/${slug}`} scopeCategoryId={category?._id} />
            </div>
          </aside>

          {/* Products Grid */}
          <div className="min-w-0 flex-1">
            {/* Results Header */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="text-[14px] text-ink-muted">
                {loading ? 'Loading products…' : data.products.length > 0 ? (
                  showAll
                    ? <>Showing all <span className="font-semibold text-ink">{data.products.length}</span> products</>
                    : <>Showing <span className="font-semibold text-ink">{data.products.length}</span>{total ? <> of <span className="font-semibold text-ink">{total}</span></> : null} products</>
                ) : 'No products found'}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-semibold text-ink transition-colors hover:border-gold hover:text-gold lg:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" /> Filters
                </button>
                <label htmlFor="showAll" className="flex cursor-pointer items-center gap-2 text-[14px] text-ink/80">
                  <input
                    type="checkbox"
                    id="showAll"
                    checked={showAll}
                    onChange={handleShowAllToggle}
                    className="h-4 w-4 accent-gold"
                  />
                  Show all
                </label>
                <label htmlFor="sort" className="flex items-center gap-2 text-[14px] text-ink-muted">
                  <span className="hidden sm:inline">Sort by</span>
                  <select
                    id="sort"
                    className="rounded-full border border-hairline bg-white px-4 py-2 text-[14px] font-medium text-ink outline-none focus:border-gold"
                    value={currentSort}
                    onChange={handleSortChange}
                    disabled={loading}
                  >
                    <option value="createdAt_desc">Newest</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A–Z</option>
                    <option value="rating_desc">Top rated</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Loading skeletons */}
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
            ) : error === LOAD_FAILED ? (
              <div className="sp-card sp-empty" role="alert">
                <p className="sp-empty-title">Something went wrong</p>
                <p>{LOAD_FAILED}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="sh-btn sh-btn-primary"
                >
                  Try again
                </button>
              </div>
            ) : data.products.length > 0 ? (
              <ProductGrid products={data.products} />
            ) : (
              <div className="sp-card sp-empty">
                <p className="sp-empty-title">No products in this category yet</p>
                <p>Try another category, or ask us — we can often source the part.</p>
                <Link href="/categories" className="sh-btn sh-btn-primary">Browse other categories</Link>
              </div>
            )}

            {!loading && !showAll && (
              <div className="mt-10">
                <Pagination
                  pagination={data.pagination}
                  currentPage={currentPage}
                  basePath={`/categories/${slug}`}
                  searchParams={searchParams}
                />
              </div>
            )}

            <div className="mt-10">
              <ShopContactHero
                title={`Not sure which ${category?.name ? category.name.toLowerCase() : 'parts'} fit your car?`}
                placement="category_hero"
              />
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
              <Filters basePath={`/categories/${slug}`} scopeCategoryId={category?._id} onApplied={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// useSearchParams() requires a Suspense boundary once this route is statically
// generated. It sits INSIDE the client component on purpose: by the time this
// renders the server has already awaited the category lookup, so a missing category
// has thrown notFound() and committed a 404 before anything streams. Moving
// this boundary up into page.tsx — or adding a loading.tsx to this segment or
// any ancestor — puts the soft 404 straight back. Same shape as
// app/brands/[slug]/BrandPageClient.tsx.
// Props are DERIVED from the inner component rather than restated. `any` here
// meant a future rename of `initialCategory` would compile clean and silently drop the
// server-seeded data, sending the grid back to a client refetch — the exact
// regression the seed exists to avoid.
type ClientPageProps = Parameters<typeof ClientPageInner>[0];

export default function ClientPage({ slug, initialCategory }: ClientPageProps) {
  return (
    <Suspense fallback={<div className="sp sh-theme" />}>
      <ClientPageInner slug={slug} initialCategory={initialCategory} />
    </Suspense>
  );
}
