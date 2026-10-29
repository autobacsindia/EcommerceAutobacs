import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import ClientPage from './ClientPage';
import { getServerApiBase, fetchEntityOrNull, internalApiHeaders } from '@/lib/server-api';
import { resolveSeo } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';

import { categorySlugsForPrerender } from '@/lib/staticParams';
import { buildCategoryProductsQuery, normalizeProductsResponse, toCardProduct } from '@/lib/categoryProducts';

/**
 * Makes this route statically generatable, which is the point: a static route
 * is one <Link> can PREFETCH in full, so hovering a category card preloads the
 * whole page and the click is instant. A dynamic route can only prefetch up to
 * the nearest loading boundary, which is why this felt slow before.
 *
 * `dynamicParams` stays at its default (true): a slug absent from this list is
 * rendered on first request and then cached like a prerendered one, so the
 * entire categories catalogue is ISR-backed — the list only decides what is warm
 * immediately after a deploy. See lib/staticParams.ts.
 *
 * notFound() still works: an unknown slug renders on demand, the fetch misses,
 * and the page throws — producing a real 404, which soft404.test.ts guards.
 */
export async function generateStaticParams() {
  return (await categorySlugsForPrerender()).map((slug) => ({ slug }));
}

// cache()d so generateMetadata and the page share one fetch; the result is also
// handed to ClientPage as initialCategory to drop its redundant client refetch.
const getCategoryForMetadata = cache(async (slug: string) => {
  try {
    return await fetchEntityOrNull<any>(
      `${getServerApiBase()}/categories/slug/${slug}`,
      (body: any) => (body?.success && body.category ? body.category : null),
      // See products/[slug]: without the internal key, SSR/prerender shares the
      // public per-IP rate-limit bucket.
      { headers: internalApiHeaders(), next: { revalidate: 300, tags: [`category:${slug}`] } },
    );
  } catch (error) {
    // Rethrown on purpose. See products/[slug]: swallowing this into `null`
    // makes a transient 429/5xx look like "category deleted", and under ISR
    // that 404 is CACHED and outlives the blip.
    console.error('[categories/[slug]] entity fetch failed:', error);
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryForMetadata(slug);

  // notFound() rather than a "Category Not Found" TITLE — returning a title
  // rendered a soft 404 (HTTP 200), so every retired or mistyped category URL
  // stayed indexable. Only works while no Suspense boundary sits above this
  // segment: a `loading.tsx` here, at `/categories`, or at the app root makes
  // Next commit 200 before this throws. See src/app/soft404.test.ts.
  if (!category) notFound();

  const computedDescription = category.description
    ? category.description.substring(0, 160).replace(/\n/g, ' ')
    : `Shop ${category.name} at Autobacs India - Premium automotive accessories, body kits, and performance parts for Indian vehicles. Free shipping across India.`;

  const defaultImage = category.image
    ? (typeof category.image === 'string' ? category.image : category.image.url)
    : undefined;

  // Layer admin SEO overrides over computed defaults. Plain-string default title
  // lets the root layout template append " | Autobacs India" exactly once.
  const seo = resolveSeo(category.seo, {
    title: category.name,
    description: computedDescription,
    url: `${SITE_URL}/categories/${slug}`,
    image: defaultImage,
  });

  const ogTitle = typeof seo.title === 'string' ? seo.title : seo.title.absolute;
  const images = seo.ogImage ? [seo.ogImage] : [];

  return {
    title: seo.title,
    description: seo.description,
    ...(seo.robots && { robots: seo.robots }),
    alternates: { canonical: seo.canonical },
    openGraph: {
       title: ogTitle,
       description: seo.description,
       url: seo.canonical,
       images,
       type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: ogTitle,
        description: seo.description,
        images,
    }
  }
}

/**
 * How long the pre-render waits for the product list before giving up. A slow API
 * must not hold the whole page hostage: without this the render waits as long as
 * the backend does, and a page that is still being generated has nothing to show.
 */
const FIRST_PAGE_TIMEOUT_MS = 4000;

/**
 * The default first page of products, trimmed to card fields, for the server HTML.
 * See lib/categoryProducts.ts for why the category page needs this.
 *
 * Cached like the category itself, and tagged so it never outlives a write:
 * `product:list` is purged by EVERY product write (backend utils/nextTags.js) and
 * `category:<slug>` by a write to this category — so a price edit reaches this HTML
 * within seconds, and the 5-minute window only bounds what a write can't signal
 * (e.g. a sale ending on its own). The client refetches on mount regardless.
 *
 * Never throws. Unlike the category lookup above, a failure here is not "this page
 * does not exist" — returning null just leaves the client to load the grid itself,
 * which is exactly how the page worked before.
 */
async function getFirstPageProducts(slug: string, categoryId: string) {
  try {
    const res = await fetch(
      `${getServerApiBase()}/products?${buildCategoryProductsQuery({}, categoryId)}`,
      {
        headers: internalApiHeaders(),
        next: { revalidate: 300, tags: ['product:list', `category:${slug}`] },
        signal: AbortSignal.timeout(FIRST_PAGE_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const { products, pagination } = normalizeProductsResponse<Record<string, unknown>>(await res.json());
    return { products: products.map(toCardProduct), pagination };
  } catch (error) {
    console.error('[categories/[slug]] first-page products fetch failed:', error);
    return null;
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryForMetadata(slug);
  if (!category) notFound();
  const initialProducts = await getFirstPageProducts(slug, String(category._id));
  return (
    <ClientPage
      slug={slug}
      initialCategory={category}
      // Card-field subset of the same documents; the client refetch fills the rest.
      initialProducts={initialProducts as Parameters<typeof ClientPage>[0]['initialProducts']}
    />
  );
}
