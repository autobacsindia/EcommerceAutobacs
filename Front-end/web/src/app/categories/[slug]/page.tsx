import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import ClientPage from './ClientPage';
import { getServerApiBase, fetchEntityOrNull, internalApiHeaders } from '@/lib/server-api';
import { resolveSeo } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';

import { categorySlugsForPrerender } from '@/lib/staticParams';

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

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryForMetadata(slug);
  if (!category) notFound();
  return <ClientPage slug={slug} initialCategory={category} />;
}
