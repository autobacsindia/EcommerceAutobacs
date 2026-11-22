import { notFound, permanentRedirect } from 'next/navigation';
import { fetchEntityOrNull, getServerApiBase, internalApiHeaders } from '@/lib/server-api';
import { resolveLegacyTarget } from '@/lib/legacyTargetServer';

/**
 * WooCommerce's product URL, /product/<slug>. Never renders: it sends the old
 * link to the page it became, in ONE permanent redirect, or 404s.
 *
 * The middleware (lib/legacyRoutes.ts) already answers a renamed slug and a
 * product in the redirect table at the edge. What reaches this page is either a
 * product that still lives under the same slug, or a WordPress-era slug this
 * catalogue never had. So: same slug live → /products/<slug>; otherwise the
 * closest product / vehicle / category by name (lib/legacyTarget.ts); else 404.
 *
 * It replaces a blind next.config swap to /products/<slug>, which 301'd every
 * renamed product into a 404 (Search Console, Nov 2026).
 *
 * A FAILED lookup throws (error.tsx, retryable, never cached) — it must never
 * become a permanent redirect away from a product that exists.
 *
 * ⚠️ No loading.tsx in this segment or above: a Suspense boundary commits HTTP
 * 200 before the redirect / notFound() can throw (see app/soft404.test.ts).
 */
export default async function LegacyProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const product = await fetchEntityOrNull<{ slug?: string }>(
    `${getServerApiBase()}/products/slug/${encodeURIComponent(slug)}`,
    (body: any) => body?.product ?? null,
    { headers: internalApiHeaders(), next: { revalidate: 60, tags: [`product:${slug}`] } },
  );
  if (product?.slug) permanentRedirect(`/products/${product.slug}`);

  const target = await resolveLegacyTarget(slug, 'product');
  if (target) permanentRedirect(target);
  notFound();
}
