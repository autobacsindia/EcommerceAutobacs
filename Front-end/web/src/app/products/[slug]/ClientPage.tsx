'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Reviews } from '@/components/reviews';
import apiClient from '@/lib/api';
import { trackProductView } from '@/lib/analytics';
import SimilarProductsSection from '@/components/products/SimilarProductsSection';
import ComplementaryProductsSection from '@/components/products/ComplementaryProductsSection';
import StickyCartBar from '@/components/products/StickyCartBar';
import VehicleCards from '@/components/products/VehicleCards';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import Gallery from '@/components/products/redesign/Gallery';
import BuyBox from '@/components/products/redesign/BuyBox';
import ConsultSpecialistBanner from '@/components/products/ConsultSpecialistBanner';

async function getProduct(slugOrId: string): Promise<Product | null> {
  try {
    const response = await apiClient.get<{ product?: Product }>(`/products/slug/${encodeURIComponent(slugOrId)}`);
    if (response?.product) return response.product;
  } catch (slugError: unknown) {
    if ((slugError as { status?: number })?.status !== 404) {
      console.error('Slug lookup error:', slugError);
    }
  }
  return null;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  saleEndsAt?: string | null;
  category?: { _id: string; name: string; slug: string } | string;
  brand?: string;
  images?: Array<{ url: string; alt?: string; _id?: string }>;
  stock: StockStatus;
  sku?: string;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  whyChoose?: string[];
  compatibleVehicles?: Array<{ make: string; model: string }>;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[];
  slug?: string;
}

const sectionCls = 'border-t border-hairline py-16';
const headingCls = 'text-[clamp(26px,3vw,40px)] font-light leading-tight text-ink';

export function ProductDetailPageClient({ product }: { product: Product | null }) {
  const { isAuthenticated, user } = useAuth();

  const stripHtml = (html: string) => (html ? html.replace(/<[^>]*>/g, '') : '');

  // Recently viewed
  useEffect(() => {
    if (!product) return;
    try {
      const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
      const recent = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const filtered = recent.filter((p: { _id: string }) => p._id !== product._id);
      const newRecent = [
        {
          _id: product._id,
          name: product.name,
          price: product.price,
          originalPrice: product.originalPrice,
          image: product.images?.[0]?.url,
          slug: product.slug || '',
        },
        ...filtered,
      ].slice(0, 10);
      localStorage.setItem(storageKey, JSON.stringify(newRecent));
    } catch (e) {
      console.error('Failed to save recently viewed', e);
    }
  }, [product, user]);

  // Analytics
  useEffect(() => {
    if (product?._id) {
      trackProductView({
        id: product._id,
        name: product.name,
        price: product.price,
        brand: product.brand,
        category: typeof product.category === 'object' ? product.category?.name : product.category,
      });
    }
  }, [product?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!product) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-obsidian">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-gold" />
          <p className="mt-4 font-display text-[13px] tracking-[0.1em] text-ink-muted">Loading product…</p>
        </div>
      </div>
    );
  }

  const displayImages = (product.images ?? [])
    .filter((img) => img?.url)
    .map((img, i) => ({ src: img.url, alt: img.alt || `${product.name} image ${i + 1}` }));

  const onSale = !!product.originalPrice && product.originalPrice > product.price;
  const cleanDescription = stripHtml(product.description);
  const features = product.features ?? [];
  const whyChoose = product.whyChoose ?? [];
  const specifications = product.specifications ?? [];
  const categoryName = typeof product.category === 'object' ? product.category?.name : product.category;
  const categorySlug = typeof product.category === 'object' ? product.category?.slug : undefined;

  const renderTitledItem = (item: string, index: number) => {
    let title: string | null = null;
    let desc = item;
    const dash = item.includes(' – ') ? ' – ' : item.includes(' - ') ? ' - ' : null;
    if (dash) {
      const [t, ...rest] = item.split(dash);
      title = t.trim();
      desc = rest.join(dash).trim();
    } else {
      const colon = item.match(/^([^:]{2,60}):\s+(.+)$/);
      if (colon) { title = colon[1].trim(); desc = colon[2].trim(); }
    }
    return (
      <li key={index} className="pl-1 leading-relaxed">
        {title ? (
          <>
            <span className="block font-medium text-ink">{title}</span>
            <span className="text-ink-muted">{desc}</span>
          </>
        ) : (
          item
        )}
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-obsidian font-display text-ink">
      <div className="mx-auto max-w-[1340px] px-5 py-10 sm:px-8">
        {/* Breadcrumb */}
        <nav className="mb-8 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          <Link href="/products" className="hover:text-gold">Products</Link>
          {categoryName && (
            <>
              <ChevronRight className="h-3 w-3" />
              <Link href={categorySlug ? `/categories/${categorySlug}` : '/products'} className="hover:text-gold">
                {categoryName}
              </Link>
            </>
          )}
          <ChevronRight className="h-3 w-3" />
          <span className="text-ink/70 normal-case tracking-normal">{product.name}</span>
        </nav>

        {/* Gallery + Buy box */}
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal y={20}>
            <Gallery images={displayImages} name={product.name} onSale={onSale} />
          </Reveal>
          <Reveal y={20} delay={0.08}>
            <BuyBox product={product} />
          </Reveal>
        </div>

        {/* Consult a specialist */}
        <Reveal y={20}>
          <ConsultSpecialistBanner productSlug={product.slug} className="mt-12" />
        </Reveal>

        {/* Vehicle compatibility */}
        {product.compatibleVehicles && product.compatibleVehicles.length > 0 && (
          <section className={`${sectionCls} mt-16`}>
            <Eyebrow className="mb-4">Fitment</Eyebrow>
            <h2 className={`${headingCls} mb-8`}>Vehicle Compatibility</h2>
            <VehicleCards vehicles={product.compatibleVehicles} isDark />
          </section>
        )}

        {/* Description */}
        {cleanDescription && (
          <section className={sectionCls}>
            <Eyebrow className="mb-4">Overview</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Product Description</h2>
            <div className="max-w-3xl whitespace-pre-line text-[15px] font-light leading-[1.85] text-ink-muted">
              {cleanDescription}
            </div>
          </section>
        )}

        {/* Features */}
        {features.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-4">Highlights</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Key Features</h2>
            <ol className="max-w-3xl list-decimal space-y-4 pl-6 text-[15px] font-light text-ink-muted marker:text-gold">
              {features.map(renderTitledItem)}
            </ol>
          </section>
        )}

        {/* Why choose */}
        {whyChoose.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-4">Why Choose</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Why {product.name}?</h2>
            <ol className="max-w-3xl list-decimal space-y-4 pl-6 text-[15px] font-light text-ink-muted marker:text-gold">
              {whyChoose.map(renderTitledItem)}
            </ol>
          </section>
        )}

        {/* Specifications */}
        {specifications.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-4">Details</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Technical Specifications</h2>
            <div className="grid max-w-4xl grid-cols-1 gap-x-12 sm:grid-cols-2">
              {specifications.map((spec, i) => (
                <div key={i} className="flex justify-between border-b border-hairline py-3.5 text-[14px]">
                  <span className="text-ink-muted">{spec.key}</span>
                  <span className="font-medium text-ink">{spec.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Reviews */}
        <section id="reviews" className={sectionCls}>
          <Eyebrow className="mb-4">Verified buyers</Eyebrow>
          <h2 className={`${headingCls} mb-8`}>Customer Reviews</h2>
          <Reviews productId={product._id} isAuthenticated={isAuthenticated} />
        </section>

        {/* Similar + complementary */}
        <section className={sectionCls}>
          <SimilarProductsSection productId={product._id} isDark />
        </section>
        <section className="py-16">
          <ComplementaryProductsSection productId={product._id} isDark />
        </section>
      </div>

      <StickyCartBar product={product} isDark />
    </div>
  );
}

export default function ClientPage({ slug }: { slug: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const fetched = await getProduct(slug);
      setProduct(fetched);
      setLoading(false);
      if (fetched?.slug && fetched.slug !== slug) {
        router.replace(`/products/${fetched.slug}`, { scroll: false });
      }
    })();
  }, [slug, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-obsidian">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-gold" />
          <p className="mt-4 font-display text-[13px] tracking-[0.1em] text-ink-muted">Loading product…</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-obsidian">
        <div className="max-w-md px-4 text-center">
          <h2 className="mb-3 font-display text-[28px] font-light text-ink">Product not found</h2>
          <p className="mb-8 font-display text-[14px] font-light text-ink-muted">
            The product you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/products" className="bg-gold px-7 py-3.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-obsidian hover:opacity-90">
              Browse products
            </Link>
            <Link href="/" className="border border-hairline px-7 py-3.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-ink hover:border-gold hover:text-gold">
              Go home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <ProductDetailPageClient product={product} />;
}
