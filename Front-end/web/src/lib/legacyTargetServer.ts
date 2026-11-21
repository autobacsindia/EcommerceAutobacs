import { cache } from 'react';
import { getServerApiBase, internalApiHeaders } from '@/lib/server-api';
import { slugToSearchWords } from '@/lib/legacySearchRedirect';
import { legacyTarget, type LegacyCategory, type LegacyProduct, type LegacyVehicle } from '@/lib/legacyTarget';

/**
 * Server side of lib/legacyTarget.ts: fetch the vehicles and the products whose
 * names share the dead slug's words, then pick where it goes (null → 404).
 *
 * A failed fetch THROWS (error.tsx, retryable, never cached) — it must not turn
 * into a permanent redirect or a cached 404 for a slug we simply could not check.
 */
async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: internalApiHeaders(), next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`Legacy redirect lookup failed: ${res.status} ${url}`);
  return res.json();
}

const allVehicles = cache(async (): Promise<LegacyVehicle[]> => {
  const body = await getJson(`${getServerApiBase()}/vehicles?limit=500`);
  return Array.isArray(body?.vehicles) ? body.vehicles : [];
});

// Only needed for an old PRODUCT URL that matched nothing better.
const allCategories = cache(async (): Promise<LegacyCategory[]> => {
  const body = await getJson(`${getServerApiBase()}/categories`);
  return Array.isArray(body?.categories) ? body.categories : [];
});

async function productsLike(slug: string): Promise<LegacyProduct[]> {
  const q = slugToSearchWords(slug);
  if (!q) return [];
  const body = await getJson(`${getServerApiBase()}/products?search=${encodeURIComponent(q)}&limit=10`);
  return Array.isArray(body?.products) ? body.products : [];
}

export const resolveLegacyTarget = cache(async (slug: string, kind: 'product' | 'model'): Promise<string | null> => {
  const [vehicles, products, categories] = await Promise.all([
    allVehicles(),
    productsLike(slug),
    kind === 'product' ? allCategories() : Promise.resolve([]),
  ]);
  return legacyTarget(slug, kind, { vehicles, products, categories });
});
