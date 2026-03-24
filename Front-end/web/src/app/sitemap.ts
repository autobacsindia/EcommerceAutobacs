import { MetadataRoute } from 'next';
import { getServerApiBase } from '@/lib/server-api';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// ── Shard layout ───────────────────────────────────────────────────────────────
// id = 0          → static routes + categories  (bounded: categories rarely exceed a few hundred)
// id = 1          → articles                    (isolated so a slow CMS doesn't block categories)
// id ≥ 2          → products, 250/page          (page = id - 1)
//
// Splitting articles into their own shard prevents shard 0 from becoming a
// bottleneck if the blog/news section grows significantly.
const PRODUCTS_PER_SITEMAP = 250;
const MAX_PRODUCTS          = 5000;  // hard cap — prevents runaway builds
const MAX_ARTICLES          = 2000;  // reasonable upper bound for a single shard
const PRODUCT_SHARD_OFFSET  = 2;     // shards 0 and 1 are reserved for non-products

type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

// ── helpers ────────────────────────────────────────────────────────────────────

async function safeFetch<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (err) {
    // Tag clearly so it's easy to grep in Railway / Vercel log drains
    console.warn('[SITEMAP_FETCH_FAILED]', url, (err as Error).message);
    return fallback;
  }
}

/** Normalise any date-like value to a valid Date, falling back to now. */
function safeDate(value: unknown): Date {
  if (!value) return new Date();
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Deduplicate sitemap entries by URL — last writer wins. */
function dedup(entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  const map = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of entries) map.set(entry.url, entry);
  return Array.from(map.values());
}

async function fetchProductPage(page: number): Promise<MetadataRoute.Sitemap> {
  const data = await safeFetch<{ products?: any[] }>(
    `${getServerApiBase()}/products?limit=${PRODUCTS_PER_SITEMAP}&page=${page}`,
    {}
  );
  return dedup(
    (data.products ?? []).map((p: any) => ({
      url: `${BASE_URL}/products/${p._id}`,
      lastModified: safeDate(p.updatedAt),
      changeFrequency: 'daily' as ChangeFreq,
      priority: 0.6,
    }))
  );
}

// ── generateSitemaps — tells Next.js how many sitemap shards to create ─────────

export async function generateSitemaps(): Promise<{ id: number }[]> {
  const data = await safeFetch<{ total?: number; pagination?: { total?: number } }>(
    `${getServerApiBase()}/products?limit=1&page=1`,
    {}
  );

  const total        = data.pagination?.total ?? (data as any).total ?? 0;
  const safeCapped   = Math.min(total, MAX_PRODUCTS);
  const productShards = Math.ceil(safeCapped / PRODUCTS_PER_SITEMAP);

  // ids 0 and 1 are reserved; product shards start at PRODUCT_SHARD_OFFSET
  return Array.from({ length: productShards + PRODUCT_SHARD_OFFSET }, (_, i) => ({ id: i }));
}

// ── sitemap — called once per shard id ────────────────────────────────────────

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {

  // ── Product shards (id ≥ 2) ─────────────────────────────────────────────────
  if (id >= PRODUCT_SHARD_OFFSET) {
    return fetchProductPage(id - PRODUCT_SHARD_OFFSET + 1); // → page 1, 2, 3…
  }

  // ── Shard 1: articles ────────────────────────────────────────────────────────
  if (id === 1) {
    const articlesData = await safeFetch<{ data?: any[] }>(
      `${getServerApiBase()}/media/articles?limit=${MAX_ARTICLES}&page=1`,
      {}
    );
    return dedup(
      (articlesData.data ?? []).map((article: any) => ({
        url: `${BASE_URL}/media/${article.type}/${article.slug}`,
        lastModified: safeDate(article.updatedAt ?? article.publishedAt),
        changeFrequency: 'weekly' as ChangeFreq,
        priority: 0.7,
      }))
    );
  }

  // ── Shard 0: static routes + categories ─────────────────────────────────────
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL,                    lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 1.0 },
    { url: `${BASE_URL}/shop`,          lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 0.8 },
    { url: `${BASE_URL}/media`,         lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 0.8 },
    { url: `${BASE_URL}/media/news`,    lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 0.8 },
    { url: `${BASE_URL}/media/blogs`,   lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 0.8 },
    { url: `${BASE_URL}/media/gallery`, lastModified: new Date(), changeFrequency: 'weekly'  as ChangeFreq, priority: 0.6 },
    { url: `${BASE_URL}/media/videos`,  lastModified: new Date(), changeFrequency: 'weekly'  as ChangeFreq, priority: 0.6 },
    { url: `${BASE_URL}/about`,         lastModified: new Date(), changeFrequency: 'monthly' as ChangeFreq, priority: 0.5 },
    { url: `${BASE_URL}/contact`,       lastModified: new Date(), changeFrequency: 'monthly' as ChangeFreq, priority: 0.5 },
  ];

  const categoriesData = await safeFetch<{ categories?: any[] }>(
    `${getServerApiBase()}/categories`,
    {}
  );

  const categoryRoutes: MetadataRoute.Sitemap = (categoriesData.categories ?? []).map((cat: any) => ({
    url: `${BASE_URL}/categories/${cat.slug || cat._id}`,
    lastModified: safeDate(cat.updatedAt),
    changeFrequency: 'weekly' as ChangeFreq,
    priority: 0.7,
  }));

  return dedup([...staticRoutes, ...categoryRoutes]);
}

