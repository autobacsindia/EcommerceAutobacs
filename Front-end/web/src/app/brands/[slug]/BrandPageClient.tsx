'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import ProductGrid from '@/components/products/ProductGrid';
import StorePageHeader from '@/components/store/StorePageHeader';
import Pagination from '@/components/layout/Pagination';
import apiClient from '@/lib/api';
import { brandProductsPath } from '@/lib/brandProducts';
import { normalizeProductsResponse } from '@/lib/categoryProducts';

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
  category: { _id: string; name: string; slug: string; } | string;
  brand?: string;
  images: ProductImage[] | string;
  stock: StockStatus;
  sku?: string;
  specifications?: Array<{ key: string; value: string; _id?: string; }> | string;
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

async function getBrandProducts(brandName: string, page: number = 1): Promise<ProductsData> {
  // Same request page.tsx pre-renders — see lib/brandProducts.ts.
  const data: unknown = await apiClient.get(brandProductsPath(brandName, page));
  return normalizeProductsResponse<Product>(data);
}

type ReadonlyParams = Pick<URLSearchParams, 'get' | 'toString'>;

interface BrandViewProps {
  slug: string;
  initialBrand: any;
  /** Page 1, fetched by page.tsx and trimmed to card fields. Seeds the grid on page 1. */
  initialProducts?: ProductsData | null;
  searchParams: ReadonlyParams;
}

/**
 * The page with the URL passed IN, so the same tree renders as the server-side
 * Suspense fallback (no params → page 1, with products) and for real on the
 * client. See app/categories/[slug]/ClientPage.tsx — the same fix.
 */
function BrandView({ slug, initialBrand, initialProducts, searchParams }: BrandViewProps) {
  const router = useRouter();
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;
  // Seed only what the server rendered: page 1 of this brand.
  const seeded = !!initialProducts && currentPage === 1;
  // The mount refetch still runs (live prices win) but without a skeleton flash.
  const silentFirstLoad = useRef(seeded);
  const [data, setData] = useState<ProductsData>(seeded ? initialProducts! : { products: [], pagination: {} });
  const [logoFailed, setLogoFailed] = useState(false);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the server fetch — see page.tsx. The brand is guaranteed to exist
  // by the time this renders, so there is no brand-loading or brand-missing state
  // left to model on the client.
  const brand = initialBrand;

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        if (silentFirstLoad.current) {
          silentFirstLoad.current = false;
        } else {
          setLoading(true);
        }
        setError(null);
        const result = await getBrandProducts(initialBrand?.slug || slug, currentPage);
        setData(result);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch products');
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [slug, initialBrand?.slug, currentPage]);

  const handlePageChange = (newPage: number) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('page', newPage.toString());
    router.push(`/brands/${slug}?${p.toString()}`);
  };

  const total = data.pagination?.total || 0;

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: 'Brands', href: '/brands' }, { label: brand.name }]}
        title={
          <span className="flex items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-hairline bg-white p-2">
              {brand.logo && !logoFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt="" className="max-h-full max-w-full object-contain" onError={() => setLogoFailed(true)} />
              ) : (
                <span className="font-display text-2xl font-bold text-gold">{brand.name?.charAt(0)}</span>
              )}
            </span>
            {brand.name}
          </span>
        }
        subtitle={brand.description || `Genuine ${brand.name} parts and accessories.`}
        aside={loading ? 'Loading…' : `${total.toLocaleString('en-IN')} ${total === 1 ? 'product' : 'products'}`}
      />

      <div className="sp-wrap pt-6">
        {/* Error */}
        {error && !loading && (
          <div className="sp-card sp-empty mb-6" role="alert">
            <p className="sp-empty-title">We couldn&apos;t load the products</p>
            <p>{error}</p>
            <button onClick={() => window.location.reload()} className="sh-btn sh-btn-primary">
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        )}

        {/* Loading skeletons */}
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
        ) : !error && data.products.length > 0 ? (
          <>
            <ProductGrid products={data.products} />
            <div className="mt-10">
              <Pagination
                pagination={data.pagination}
                currentPage={currentPage}
                basePath={`/brands/${slug}`}
                searchParams={new URLSearchParams(searchParams.toString())}
              />
            </div>
          </>
        ) : !error ? (
          <div className="sp-card sp-empty">
            <p className="sp-empty-title">No {brand.name} products right now</p>
            <p>Ask us — we can often source {brand.name} parts on request.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/products" className="sh-btn sh-btn-outline">Browse all products</Link>
              <Link href="/consultation" className="sh-btn sh-btn-primary">Ask a specialist</Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary. It sits INSIDE the client
// component on purpose: by the time this renders the server has already awaited
// the brand lookup, so a missing brand has thrown notFound() and committed a 404
// before anything streams. A `loading.tsx` in this segment (or any ancestor)
// would move the boundary above that await and put the soft 404 straight back.
type BrandPageClientProps = Omit<BrandViewProps, 'searchParams'>;

const NO_PARAMS: ReadonlyParams = new URLSearchParams();

function BrandPageInner(props: BrandPageClientProps) {
  return <BrandView {...props} searchParams={useSearchParams()} />;
}

export default function BrandPageClient({ slug, initialBrand, initialProducts }: BrandPageClientProps) {
  return (
    // The fallback is page 1 itself — what the static HTML contains, products and
    // all — not an empty div. See app/categories/[slug]/ClientPage.tsx.
    <Suspense
      fallback={<BrandView slug={slug} initialBrand={initialBrand} initialProducts={initialProducts} searchParams={NO_PARAMS} />}
    >
      <BrandPageInner slug={slug} initialBrand={initialBrand} initialProducts={initialProducts} />
    </Suspense>
  );
}
