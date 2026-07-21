import type { Metadata } from 'next';
import ProductsClient from './ProductsClient';
import { getServerApiBase } from '@/lib/server-api';
import {
  buildProductsQuery,
  normalizeProductsResponse,
  type ProductsData,
} from '@/lib/productQuery';
import { SITE_URL } from '@/lib/siteUrl';

export const metadata: Metadata = {
  title: 'All Products',
  description:
    'Shop premium automotive accessories, body kits, and performance parts from Autobacs India.',
  alternates: { canonical: `${SITE_URL}/products` },
};

/**
 * Flatten Next's searchParams (values can be string | string[]) to a flat map.
 * For a repeated key we take the LAST value, matching the client, which derives
 * its params via `Object.fromEntries(new URLSearchParams(...))` (last-wins). If
 * the two disagreed, the server-fetched initialData would fail the seed-gate in
 * ProductsClient and be silently discarded — a wasted SSR fetch + a client refetch.
 */
function flattenParams(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? (v[v.length - 1] ?? '') : v;
  }
  return out;
}

// Server-side first-page fetch. `next.revalidate` puts the backend response in
// Next's Data Cache for 300s keyed by URL, so repeated visits to the same
// filter/sort/page combo are served without re-hitting the backend (which
// itself sets `s-maxage=600`). Tagged 'products' so a future revalidateTag on a
// product write can purge it.
//
// Unlike /categories, a fetch failure here is swallowed (returns undefined):
// the route is dynamic (reads searchParams) so nothing gets cached, and the
// client grid falls back to its own fetch + ProductFetchError UI. There is a
// single caller and no generateMetadata sharing this fetch, so no React cache()
// wrapper is needed.
async function getProductsPage(params: Record<string, string>): Promise<ProductsData | undefined> {
  try {
    const res = await fetch(`${getServerApiBase()}/products?${buildProductsQuery(params)}`, {
      next: { revalidate: 300, tags: ['products'] },
    });
    if (!res.ok) return undefined;
    return normalizeProductsResponse(await res.json());
  } catch (error) {
    // Backend hiccup on SSR: fall back to a client fetch (initialData undefined).
    console.error('[products/page] server fetch failed:', error);
    return undefined;
  }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flattenParams(await searchParams);
  const initialData = await getProductsPage(params);

  return <ProductsClient initialData={initialData} initialParams={params} />;
}
