'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import ProductGrid from '@/components/products/ProductGrid';
import StorePageHeader from '@/components/store/StorePageHeader';
import Pagination from '@/components/layout/Pagination';
import apiClient from '@/lib/api';

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

async function getBrandProducts(brandName: string, page: number = 1, limit: number = 12): Promise<ProductsData> {
  const data: any = await apiClient.get(`/products/brands/${encodeURIComponent(brandName)}?page=${page}&limit=${limit}`);
  if (data?.products) {
    const { total, pages, currentPage, hasNext, hasPrev, count } = data;
    return { products: data.products, pagination: { total, pages, currentPage, hasNext, hasPrev, count } };
  }
  return { products: [], pagination: {} };
}

function BrandPageInner({ slug, initialBrand }: { slug: string; initialBrand: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [logoFailed, setLogoFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the server fetch — see page.tsx. The brand is guaranteed to exist
  // by the time this renders, so there is no brand-loading or brand-missing state
  // left to model on the client.
  const brand = initialBrand;

  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
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
                searchParams={searchParams}
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
export default function BrandPageClient({ slug, initialBrand }: { slug: string; initialBrand: any }) {
  return (
    <Suspense fallback={<div className="sp sh-theme" />}>
      <BrandPageInner slug={slug} initialBrand={initialBrand} />
    </Suspense>
  );
}
