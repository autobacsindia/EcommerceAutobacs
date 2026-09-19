import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import BrandPageClient from './BrandPageClient';
import { getServerApiBase, internalApiHeaders, fetchEntityOrNull } from '@/lib/server-api';
import { resolveSeo } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';

import { brandSlugsForPrerender } from '@/lib/staticParams';

/**
 * Makes this route statically generatable, which is the point: a static route
 * is one <Link> can PREFETCH in full, so hovering a brand card preloads the
 * whole page and the click is instant. A dynamic route can only prefetch up to
 * the nearest loading boundary, which is why this felt slow before.
 *
 * `dynamicParams` stays at its default (true): a slug absent from this list is
 * rendered on first request and then cached like a prerendered one, so the
 * entire brands catalogue is ISR-backed — the list only decides what is warm
 * immediately after a deploy. See lib/staticParams.ts.
 *
 * notFound() still works: an unknown slug renders on demand, the fetch misses,
 * and the page throws — producing a real 404, which soft404.test.ts guards.
 */
export async function generateStaticParams() {
  return (await brandSlugsForPrerender()).map((slug) => ({ slug }));
}

/**
 * Server shell for /brands/[slug].
 *
 * This route used to be a pure client component: it fetched the brand in a
 * useEffect and, when the backend answered 404, rendered its own "Brand Not
 * Found" panel — under HTTP 200. A soft 404: every retired or mistyped brand URL
 * stayed indexable, and no 404 ever reached Observability.
 *
 * Because a client page cannot export generateMetadata, SEO lived in a sibling
 * `layout.tsx` that fetched the same brand a second time. Resolving the brand
 * here instead collapses those two fetches into one cache()d call and lets the
 * page 404 for real; that layout is gone. The interactive product grid stays a
 * client component and receives the brand it no longer has to fetch.
 *
 * ⚠️ Do NOT add a loading.tsx to this segment (or any ancestor). A Suspense
 * boundary above this await makes Next flush the shell — and commit HTTP 200 —
 * before notFound() can throw, which is exactly the bug this removes.
 */

// cache()d so generateMetadata and the page body share ONE upstream call.
const getBrand = cache(async (slug: string) => {
  try {
    return await fetchEntityOrNull<any>(
      `${getServerApiBase()}/products/brands/${encodeURIComponent(decodeURIComponent(slug))}/details`,
      // The backend answers 404 for a brand with no Brand document AND no
      // active products, which is precisely the "does not exist" signal.
      // fetchEntityOrNull retries transients and throws on anything that is not
      // a 404, so a blip can never be cached as a 404 by ISR.
      (body: any) => (body?.success && body.brand?.name ? body.brand : null),
      {
        headers: internalApiHeaders(),
        // Time-based only, deliberately UNTAGGED. `brand:` is not in the
        // revalidator's prefix allowlist (src/lib/revalidateTags.ts), and both
        // ends drop unknown tags silently — a `brand:<slug>` tag here would look
        // wired while never being purgeable. 300s matches what the layout this
        // replaced already used. Adding a real tag means adding the prefix on
        // BOTH sides plus a producer in Back-end/server/utils/nextTags.js.
        next: { revalidate: 300 },
      },
    );
  } catch (error) {
    console.error('[brands/[slug]] entity fetch failed:', error);
    throw error;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) notFound();

  const computedDescription = brand.description
    ? String(brand.description).substring(0, 160).replace(/\n/g, ' ')
    : `Shop genuine ${brand.name} automotive accessories, body kits and performance parts at Autobacs India.`;

  // Admin override → computed default → site default, via the shared resolver.
  // The backend already returns brandDoc.seo on this endpoint.
  const seo = resolveSeo(brand.seo, {
    title: brand.name,
    description: computedDescription,
    url: `${SITE_URL}/brands/${brand.slug || slug}`,
    // The controller substitutes a via.placeholder.com URL when a brand has no
    // logo; that is not an OG image, so let the site default win instead.
    image:
      brand.logo && !String(brand.logo).includes('via.placeholder.com')
        ? brand.logo
        : undefined,
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
      siteName: 'Autobacs India',
      images,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: seo.description,
      images,
    },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) notFound();

  return <BrandPageClient slug={slug} initialBrand={brand} />;
}
