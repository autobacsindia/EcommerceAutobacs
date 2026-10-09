'use client';

import type { StockStatus } from '@/lib/stock';
import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Reviews } from '@/components/reviews';
import apiClient from '@/lib/api';
import { productKeys } from '@/hooks/queries/keys';
import { trackProductView } from '@/lib/analytics';
import { trackViewContent } from '@/lib/metaPixel';
import { trackGoogleViewItem } from '@/lib/googleAdsEvents';
import SimilarProductsSection from '@/components/products/SimilarProductsSection';
import ComplementaryProductsSection from '@/components/products/ComplementaryProductsSection';
import StickyCartBar from '@/components/products/StickyCartBar';
import VehicleCards from '@/components/products/VehicleCards';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import Gallery from '@/components/products/redesign/Gallery';
import { variantImageIndex } from '@/lib/variantImage';
import BuyBox, { type ProductVariant } from '@/components/products/redesign/BuyBox';
import ConsultSpecialistBanner from '@/components/products/ConsultSpecialistBanner';

/**
 * `null` means the product genuinely does not exist (the API said 404). Any other
 * failure — a dropped mobile connection, a server hiccup, a rate limit — is THROWN,
 * so TanStack Query keeps the product already on screen and retries, instead of
 * caching "missing" and replacing a page the customer is reading with
 * "Product not found". That swap was observed on the live site during a 2-second
 * network drop.
 */
async function getProduct(slugOrId: string): Promise<Product | null> {
  try {
    const response = await apiClient.get<{ product?: Product }>(`/products/slug/${encodeURIComponent(slugOrId)}`);
    return response?.product ?? null;
  } catch (slugError: unknown) {
    if ((slugError as { status?: number })?.status === 404) return null;
    throw slugError;
  }
}

interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  saleEndsAt?: string | null;
  /** Meta catalogue content_id (backend-computed, matches the feed). */
  metaContentId?: string;
  category?: { _id: string; name: string; slug: string } | string;
  brand?: string;
  images?: Array<{ url: string; alt?: string; _id?: string; public_id?: string; isPrimary?: boolean }>;
  stock: StockStatus;
  sku?: string;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  whyChoose?: string[];
  packageContents?: string[];
  compatibleVehicles?: Array<{ make: string; model: string; slug?: string; image?: { url?: string; alt?: string } }>;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[];
  slug?: string;
  // Variable-product fields (simple products omit these).
  productType?: 'simple' | 'variable' | 'grouped';
  variants?: ProductVariant[];
  priceMin?: number;
  priceMax?: number;
}

// Each section is a white card on the grey canvas, like the home page.
const sectionCls = 'mt-6 rounded-xl bg-white p-5 shadow-sm sm:p-8';
const headingCls = 'font-display text-[22px] font-bold leading-tight text-ink sm:text-[24px]';

export function ProductDetailPageClient({ product }: { product: Product | null }) {
  const { isAuthenticated, user } = useAuth();

  // Selected variant is lifted here so BuyBox and the mobile StickyCartBar stay in
  // sync (both must add the SAME chosen model). Simple products never set it.
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const searchParams = useSearchParams();

  // Deep-link preselect: the back-in-stock email links to ?variant=<id> so the
  // shopper lands on the exact model that came back. Apply each distinct param
  // value AT MOST ONCE (tracked in a ref) so a later product refetch or the user's
  // own dropdown choice is never clobbered by re-running this effect.
  const appliedVariantParam = useRef<string | null>(null);
  useEffect(() => {
    const v = searchParams.get('variant');
    if (!v || appliedVariantParam.current === v) return;
    if (product?.variants?.some((variant) => variant._id === v)) {
      appliedVariantParam.current = v;
      setSelectedVariantId(v);
    }
  }, [product, searchParams]);

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
          // Variant context so the Recently-Viewed card can show a "From" range
          // and route to the PDP instead of quick-adding.
          productType: product.productType,
          priceMin: product.priceMin,
          priceMax: product.priceMax,
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
      // Meta Pixel ViewContent — content_id matches the catalogue feed so this
      // product page view feeds dynamic retargeting / Advantage+ catalogue ads.
      // The same catalogue id is also the Merchant Center offer id, so one value
      // drives both platforms' remarketing (see lib/googleAdsEvents.ts).
      if (product.metaContentId) {
        trackViewContent(product.metaContentId, product.price);
        trackGoogleViewItem(product.metaContentId, product.price);
      }
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

  const galleryImages = (product.images ?? []).filter((img) => img?.url);
  const displayImages = galleryImages
    .map((img, i) => ({ src: img.url, alt: img.alt || `${product.name} image ${i + 1}` }));

  /*
    Which gallery slide the chosen model corresponds to, or null when it has no
    photo of its own — in which case the gallery deliberately stays where the
    shopper left it rather than snapping back to the hero image.

    Computed from the SAME filtered array the gallery renders, so the index can
    never drift from what is on screen. Mapping over `product.images` directly
    would shift every index by one for any product carrying an image row with no
    url, and point the shopper at the wrong photo.
  */
  const selectedVariant = product.variants?.find((v) => v._id === selectedVariantId) ?? null;
  const variantSlide = variantImageIndex(galleryImages, selectedVariant);

  const onSale = !!product.originalPrice && product.originalPrice > product.price;
  const cleanDescription = stripHtml(product.description);
  const features = product.features ?? [];
  const whyChoose = product.whyChoose ?? [];
  const packageContents = product.packageContents ?? [];
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
    <div className="sp sh-theme">
      <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6">
        {/* Breadcrumb */}
        <nav className="sp-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/products">Products</Link>
          {categoryName && (
            <>
              <ChevronRight className="h-3 w-3" />
              <Link href={categorySlug ? `/categories/${categorySlug}` : '/products'} className="hover:text-gold">
                {categoryName}
              </Link>
            </>
          )}
          <ChevronRight className="h-3 w-3" />
          <span className="line-clamp-1 font-semibold text-ink/80">{product.name}</span>
        </nav>

        {/* Gallery + Buy box */}
        <div className="grid gap-6 rounded-xl bg-white p-4 shadow-sm sm:p-6 lg:grid-cols-2 lg:gap-12 lg:p-8">
          <Reveal y={20}>
            <Gallery images={displayImages} name={product.name} onSale={onSale} jumpTo={variantSlide} />
          </Reveal>
          <Reveal y={20} delay={0.08}>
            <BuyBox
              product={product}
              selectedVariantId={selectedVariantId}
              onSelectVariant={setSelectedVariantId}
            />
          </Reveal>
        </div>

        {/* Similar products first — the shopper is still choosing, so alternatives
            sit right under the buy box, above the specialist prompt. */}
        <SimilarProductsSection productId={product._id} />

        {/* Consult a specialist */}
        <Reveal y={20}>
          <ConsultSpecialistBanner productSlug={product.slug} className="mt-6" />
        </Reveal>

        {/* Vehicle compatibility */}
        {product.compatibleVehicles && product.compatibleVehicles.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-1">Fitment</Eyebrow>
            <h2 className={`${headingCls} mb-8`}>Vehicle Compatibility</h2>
            <VehicleCards vehicles={product.compatibleVehicles} isDark />
          </section>
        )}

        {/* Description */}
        {cleanDescription && (
          <section className={sectionCls}>
            <Eyebrow className="mb-1">Overview</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Product Description</h2>
            <div className="max-w-3xl whitespace-pre-line text-[15px] leading-[1.8] text-ink/85">
              {cleanDescription}
            </div>
          </section>
        )}

        {/* Package contents — bulleted "pointers", not a paragraph */}
        {packageContents.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-1">In the box</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Package Includes</h2>
            <ul className="max-w-3xl list-disc space-y-3 pl-6 text-[15px] leading-relaxed text-ink/85 marker:text-gold">
              {packageContents.map((item, i) => (
                <li key={i} className="pl-1">{item}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Features */}
        {features.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-1">Highlights</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Key Features</h2>
            <ol className="max-w-3xl list-decimal space-y-4 pl-6 text-[15px] text-ink/85 marker:text-gold">
              {features.map(renderTitledItem)}
            </ol>
          </section>
        )}

        {/* Why choose */}
        {whyChoose.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-1">Why Choose</Eyebrow>
            <h2 className={`${headingCls} mb-6`}>Why {product.name}?</h2>
            <ol className="max-w-3xl list-decimal space-y-4 pl-6 text-[15px] text-ink/85 marker:text-gold">
              {whyChoose.map(renderTitledItem)}
            </ol>
          </section>
        )}

        {/* Specifications */}
        {specifications.length > 0 && (
          <section className={sectionCls}>
            <Eyebrow className="mb-1">Details</Eyebrow>
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
          <Eyebrow className="mb-1">Verified buyers</Eyebrow>
          <h2 className={`${headingCls} mb-8`}>Customer Reviews</h2>
          <Reviews productId={product._id} isAuthenticated={isAuthenticated} />
        </section>

        {/* Similar + complementary */}
        <ComplementaryProductsSection productId={product._id} />
      </div>

      <StickyCartBar
        product={product}
        isVariable={product.productType === 'variable' && (product.variants?.length ?? 0) > 0}
        variant={product.variants?.find((v) => v._id === selectedVariantId) ?? null}
        priceMin={product.priceMin ?? product.price}
        priceMax={product.priceMax ?? product.price}
      />
    </div>
  );
}

function ClientPageInner({ slug, initialProduct }: { slug: string; initialProduct?: Product | null }) {
  const router = useRouter();

  // The server component already fetched this product (for metadata + JSON-LD)
  // and hands it down as initialData, so the first paint shows the product with
  // NO spinner and NO duplicate client fetch — the previous version threw the
  // server data away and re-fetched here. TanStack Query still owns it after
  // hydration (staleTime 60s), shared with any other consumer of this key.
  const { data: product = null, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: productKeys.detail(slug),
    queryFn: () => getProduct(slug),
    initialData: initialProduct ?? undefined,
    // Mark server data slightly stale so a background refresh corrects any drift
    // between SSR and interaction, without blocking the first paint.
    initialDataUpdatedAt: initialProduct ? Date.now() - 30_000 : undefined,
    staleTime: 60_000,
  });

  // Canonicalize the URL if the resolved product's slug differs (e.g. an
  // ObjectId or legacy slug was requested).
  useEffect(() => {
    if (product?.slug && product.slug !== slug) {
      router.replace(`/products/${product.slug}`, { scroll: false });
    }
  }, [product, slug, router]);

  // With initialProduct present this is false on first paint; only a cold
  // client-side navigation with no server payload shows the spinner.
  const loading = isLoading && !product;

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

  // Could not load, and nothing to fall back on (a cold client-side navigation):
  // say so and offer a retry — this is NOT the same as the product not existing.
  if (!product && isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-obsidian">
        <div className="max-w-md px-4 text-center">
          <h2 className="mb-3 font-display text-[28px] font-bold text-ink">We couldn&apos;t load this product</h2>
          <p className="mb-8 font-display text-[14px] text-ink-muted">
            Please check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-full bg-gold px-6 py-3 font-display text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isFetching ? 'Trying…' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-obsidian">
        <div className="max-w-md px-4 text-center">
          <h2 className="mb-3 font-display text-[28px] font-bold text-ink">Product not found</h2>
          <p className="mb-8 font-display text-[14px] text-ink-muted">
            The product you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/products" className="bg-gold px-7 py-3.5 font-display text-[15px] font-semibold text-white hover:opacity-90 rounded-full">
              Browse products
            </Link>
            <Link href="/" className="border border-hairline px-7 py-3.5 font-display text-[15px] font-semibold text-ink hover:border-gold hover:text-gold rounded-full">
              Go home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <ProductDetailPageClient product={product} />;
}

// useSearchParams() requires a Suspense boundary once this route is statically
// generated. It sits INSIDE the client component on purpose: by the time this
// renders the server has already awaited the product lookup, so a missing product
// has thrown notFound() and committed a 404 before anything streams. Moving
// this boundary up into page.tsx — or adding a loading.tsx to this segment or
// any ancestor — puts the soft 404 straight back. Same shape as
// app/brands/[slug]/BrandPageClient.tsx.
// Props are DERIVED from the inner component rather than restated. `any` here
// meant a future rename of `initialProduct` would compile clean and silently drop the
// server-seeded data, sending the grid back to a client refetch — the exact
// regression the seed exists to avoid.
type ClientPageProps = Parameters<typeof ClientPageInner>[0];

export default function ClientPage({ slug, initialProduct }: ClientPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian-deep" />}>
      <ClientPageInner slug={slug} initialProduct={initialProduct} />
    </Suspense>
  );
}
