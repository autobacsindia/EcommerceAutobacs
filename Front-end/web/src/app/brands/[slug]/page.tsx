'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { use } from 'react';
import ProductGrid from '@/components/products/ProductGrid';
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

async function getBrandDetails(slug: string): Promise<any> {
  const decodedSlug = decodeURIComponent(slug);
  const response: any = await apiClient.get(`/products/brands/${encodeURIComponent(decodedSlug)}/details`);
  if (!response || typeof response !== 'object') throw new Error('Invalid response format');
  if (response.success === false) throw new Error(response.message || 'Failed to fetch brand details');
  if (response.brand?.name && response.brand?.slug) return response.brand;
  throw new Error('Invalid brand data structure');
}

async function getBrandProducts(brandName: string, page: number = 1, limit: number = 12): Promise<ProductsData> {
  const data: any = await apiClient.get(`/products/brands/${encodeURIComponent(brandName)}?page=${page}&limit=${limit}`);
  if (data?.products) {
    const { total, pages, currentPage, hasNext, hasPrev, count } = data;
    return { products: data.products, pagination: { total, pages, currentPage, hasNext, hasPrev, count } };
  }
  return { products: [], pagination: {} };
}

function BrandPageInner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [brandLoading, setBrandLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<any>(null);

  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  useEffect(() => {
    const fetchBrandAndProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        const brandDetails = await getBrandDetails(slug);
        if (!brandDetails) { setError('Brand not found'); setBrandLoading(false); setLoading(false); return; }
        setBrand(brandDetails);
        setBrandLoading(false);
        const result = await getBrandProducts(brandDetails.slug || slug, currentPage);
        setData(result);
      } catch (err: any) {
        const msg = err.message || 'Failed to fetch brand or products';
        setError(err.status === 404 || msg.toLowerCase().includes('not found') ? 'Brand not found' : msg);
        setBrandLoading(false);
      } finally {
        setLoading(false);
      }
    };
    fetchBrandAndProducts();
  }, [slug, currentPage]);

  const handlePageChange = (newPage: number) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('page', newPage.toString());
    router.push(`/brands/${slug}?${p.toString()}`);
  };

  if (brandLoading || !brand) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold mx-auto mb-4" />
          <p className="text-ink/70 font-display">Loading brand...</p>
        </div>
      </div>
    );
  }

  if (!brand && !brandLoading && error) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-display font-bold text-ink uppercase tracking-wide mb-4">
            {error === 'Brand not found' ? 'Brand Not Found' : 'Error Loading Brand'}
          </h1>
          <p className="text-ink/70 font-display mb-6">
            {error === 'Brand not found'
              ? "The brand you're looking for doesn't exist or has been removed."
              : error}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/brands"
              className="inline-flex items-center justify-center px-6 py-3 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Brands
            </Link>
            <Link
              href="/products"
              className="inline-flex items-center justify-center px-6 py-3 bg-obsidian-raised border border-hairline hover:border-gold text-ink/70 hover:text-ink font-display font-bold uppercase tracking-widest rounded-sm transition-all"
            >
              Browse Products
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Brand Header */}
      <div className="bg-obsidian border-b border-hairline py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="bg-obsidian-raised border border-hairline rounded-lg p-4 w-32 h-32 flex items-center justify-center shrink-0">
              {brand.logo ? (
                <img
                  src={brand.logo}
                  alt={brand.name}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <span className="text-3xl font-display font-bold text-gold">{brand.name?.charAt(0)}</span>
              )}
            </div>
            <div className="text-center md:text-left">
              <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-1">Brand</p>
              <h1 className="text-4xl font-display font-bold text-ink uppercase tracking-wide mb-2">{brand.name}</h1>
              {brand.description && (
                <p className="text-ink/70 font-display mb-4 max-w-2xl">{brand.description}</p>
              )}
              <span className="inline-block bg-gold/10 border border-gold/30 text-gold font-display font-bold uppercase tracking-widest px-3 py-1 rounded-sm text-sm">
                {data.pagination?.total || 0} Products
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Results count */}
        <div className="mb-6">
          <p className="text-ink/70 font-display text-sm">
            {loading ? 'Loading products...' : data.products.length > 0
              ? `Showing ${data.products.length} product${data.products.length !== 1 ? 's' : ''}${data.pagination?.total ? ` of ${data.pagination.total}` : ''}`
              : 'No products found'}
          </p>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center mb-6">
            <h3 className="text-lg font-display font-bold text-red-400 uppercase mb-2">Error Loading Products</h3>
            <p className="text-ink/70 font-display mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-4 py-2 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-obsidian border border-hairline rounded-lg overflow-hidden animate-pulse">
                <div className="h-48 bg-obsidian-raised" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-obsidian-raised rounded w-3/4" />
                  <div className="h-4 bg-obsidian-raised rounded w-1/2" />
                  <div className="h-6 bg-obsidian-raised rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !error && data.products.length > 0 ? (
          <>
            <ProductGrid products={data.products} />
            {!loading && !error && (
              <Pagination
                pagination={data.pagination}
                currentPage={currentPage}
                basePath={`/brands/${slug}`}
                searchParams={searchParams}
              />
            )}
          </>
        ) : !error ? (
          <div className="text-center py-12">
            <p className="text-ink-muted font-display text-lg mb-4">No products found for this brand</p>
            <Link href="/products" className="text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors">
              Browse all products
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian-deep" />}>
      <BrandPageInner params={params} />
    </Suspense>
  );
}
