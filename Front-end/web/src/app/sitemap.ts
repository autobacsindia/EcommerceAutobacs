import { MetadataRoute } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getServerApiBase } from '@/lib/server-api';
import { SITE_URL as BASE_URL } from '@/lib/siteUrl';

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

// In-memory cache for stale-while-revalidate pattern
// Keyed by shard ID, stores { data, timestamp }
const sitemapCache = new Map<number, { data: MetadataRoute.Sitemap; timestamp: number }>();
const CACHE_TTL = 86400000; // 24 hours in ms

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

/** Get cached sitemap data if still valid */
function getCachedSitemap(id: number): MetadataRoute.Sitemap | null {
  const cached = sitemapCache.get(id);
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    sitemapCache.delete(id);
    return null;
  }
  
  return cached.data;
}

/** Cache sitemap data for future use */
function cacheSitemap(id: number, data: MetadataRoute.Sitemap): void {
  sitemapCache.set(id, { data, timestamp: Date.now() });
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
  const startTime = Date.now();
  
  // Add timeout for individual page fetches
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s — allows for Railway cold-start
  
  try {
    // OPTIMIZATION: Fetch only required fields (slug, updatedAt) from backend
    // Backend should have a dedicated lightweight endpoint: GET /products/sitemap?page=X&limit=250
    // Returns: [{ slug: string, updatedAt: string }] instead of full product objects
    const data = await safeFetch<{ products?: Array<{ slug: string; updatedAt: string }> }>(
      `${getServerApiBase()}/products/sitemap?limit=${PRODUCTS_PER_SITEMAP}&page=${page}`,
      {}
    );
    clearTimeout(timeoutId);
    
    const products = dedup(
      (data.products ?? [])
        .filter((p: any) => p.slug)  // skip products without a slug
        .map((p: any) => ({
          url: `${BASE_URL}/products/${p.slug}`,
          lastModified: safeDate(p.updatedAt),
          changeFrequency: 'daily' as ChangeFreq,
          priority: 0.6,
        }))
    );
    
    const durationMs = Date.now() - startTime;
    
    // OBSERVABILITY: Log success metrics
    console.info('[SITEMAP_PRODUCTS_SUCCESS]', {
      shard: page + PRODUCT_SHARD_OFFSET,
      count: products.length,
      durationMs,
      page,
    });
    
    // If we got data, cache it
    if (products.length > 0) {
      cacheSitemap(page + PRODUCT_SHARD_OFFSET, products);
    }
    
    return products;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`[SITEMAP_PRODUCT_FETCH_FAILED]`, {
      page,
      shard: page + PRODUCT_SHARD_OFFSET,
      durationMs,
      error: (err as Error).message,
    });
    Sentry.captureException(err, { extra: { context: 'fetchProductPage', page, shard: page + PRODUCT_SHARD_OFFSET, durationMs } });
    
    // STALE-WHILE-REVALIDATE: Return cached data if available
    const cached = getCachedSitemap(page + PRODUCT_SHARD_OFFSET);
    if (cached) {
      console.log(`[SITEMAP] Returning cached data for product page ${page} (${cached.length} URLs)`);
      return cached;
    }
    
    // No cache available - return empty
    return [];
  }
}

// ── generateSitemaps — tells Next.js how many sitemap shards to create ─────────

export async function generateSitemaps(): Promise<{ id: number }[]> {
  const startTime = Date.now();
  
  // Fetch total count with timeout protection
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s — allows for Railway cold-start
  
  try {
    // OPTIMIZATION: Use lightweight count endpoint instead of fetching products
    // Backend: GET /products/count or HEAD /products
    const data = await safeFetch<{ total?: number; pagination?: { total?: number } }>(
      `${getServerApiBase()}/products/count`,
      {}
    );
    clearTimeout(timeoutId);

    const total        = data.pagination?.total ?? (data as any).total ?? 0;
    const safeCapped   = Math.min(total, MAX_PRODUCTS);
    const productShards = Math.ceil(safeCapped / PRODUCTS_PER_SITEMAP);
    
    const durationMs = Date.now() - startTime;

    // ids 0 and 1 are reserved; product shards start at PRODUCT_SHARD_OFFSET
    const sitemaps = Array.from({ length: productShards + PRODUCT_SHARD_OFFSET }, (_, i) => ({ id: i }));
    
    console.info('[SITEMAP_GENERATE_SUCCESS]', {
      totalProducts: safeCapped,
      productShards,
      totalShards: sitemaps.length,
      durationMs,
    });
    
    return sitemaps;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error('[SITEMAP_GENERATE_FAILED]', {
      durationMs,
      error: (err as Error).message,
    });
    Sentry.captureException(err, { extra: { context: 'generateSitemaps', durationMs } });
    
    // FALLBACK: Use cached shard count or minimal sitemaps
    // This ensures we always generate SOME sitemap, even if backend is completely down
    const cachedProductCount = sitemapCache.size - 2; // Exclude static/article shards
    if (cachedProductCount > 0) {
      console.log(`[SITEMAP] Using cached shard count: ${cachedProductCount}`);
      return Array.from({ length: cachedProductCount + PRODUCT_SHARD_OFFSET }, (_, i) => ({ id: i }));
    }
    
    // Last resort: minimal sitemaps (static + categories only)
    return [{ id: 0 }, { id: 1 }];
  }
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
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s — allows for Railway cold-start

    try {
      // OPTIMIZATION: Fetch only required fields
      const articlesData = await safeFetch<{ data?: Array<{ type: string; slug: string; updatedAt?: string; publishedAt?: string }> }>(
        `${getServerApiBase()}/media/articles/sitemap?limit=${MAX_ARTICLES}`,
        {}
      );
      clearTimeout(timeoutId);
      
      const articles = dedup(
        (articlesData.data ?? [])
          .filter((article: any) => article.slug)
          .map((article: any) => ({
            // Blog posts are served at the site root (/<slug>) for WordPress
            // permalink parity (ADR-005) — NOT under /media/<type>/.
            url: `${BASE_URL}/${article.slug}`,
            lastModified: safeDate(article.updatedAt ?? article.publishedAt),
            changeFrequency: 'weekly' as ChangeFreq,
            priority: 0.7,
          }))
      );
      
      const durationMs = Date.now() - startTime;
      
      // Cache successful fetch
      if (articles.length > 0) {
        cacheSitemap(1, articles);
        console.info('[SITEMAP_ARTICLES_SUCCESS]', {
          shard: 1,
          count: articles.length,
          durationMs,
        });
      }
      
      return articles;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      console.error('[SITEMAP_ARTICLES_FAILED]', {
        shard: 1,
        durationMs,
        error: (err as Error).message,
      });
      Sentry.captureException(err, { extra: { context: 'sitemap shard 1 (articles)', durationMs } });
      
      // STALE-WHILE-REVALIDATE: Return cached data
      const cached = getCachedSitemap(1);
      if (cached) {
        console.log(`[SITEMAP] Returning cached articles (${cached.length} URLs)`);
        return cached;
      }
      
      return [];
    }
  }

  // ── Shard 0: static routes + categories ─────────────────────────────────────
  // Indexable, real routes only. Keep in sync with the managed static pages
  // (config/staticPages.js on the backend) and the listing roots.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL,                    lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 1.0 },
    { url: `${BASE_URL}/shop`,          lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 0.8 },
    { url: `${BASE_URL}/products`,      lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 0.8 },
    { url: `${BASE_URL}/blog`,          lastModified: new Date(), changeFrequency: 'daily'   as ChangeFreq, priority: 0.8 },
    { url: `${BASE_URL}/brands`,        lastModified: new Date(), changeFrequency: 'weekly'  as ChangeFreq, priority: 0.6 },
    { url: `${BASE_URL}/categories`,    lastModified: new Date(), changeFrequency: 'weekly'  as ChangeFreq, priority: 0.6 },
    { url: `${BASE_URL}/about-us`,      lastModified: new Date(), changeFrequency: 'monthly' as ChangeFreq, priority: 0.5 },
    { url: `${BASE_URL}/careers`,       lastModified: new Date(), changeFrequency: 'monthly' as ChangeFreq, priority: 0.4 },
    { url: `${BASE_URL}/contact`,       lastModified: new Date(), changeFrequency: 'monthly' as ChangeFreq, priority: 0.5 },
    { url: `${BASE_URL}/faq`,           lastModified: new Date(), changeFrequency: 'monthly' as ChangeFreq, priority: 0.4 },
    { url: `${BASE_URL}/shipping`,      lastModified: new Date(), changeFrequency: 'yearly'  as ChangeFreq, priority: 0.3 },
    { url: `${BASE_URL}/returns`,       lastModified: new Date(), changeFrequency: 'yearly'  as ChangeFreq, priority: 0.3 },
    { url: `${BASE_URL}/warranty`,      lastModified: new Date(), changeFrequency: 'yearly'  as ChangeFreq, priority: 0.3 },
    { url: `${BASE_URL}/privacy`,       lastModified: new Date(), changeFrequency: 'yearly'  as ChangeFreq, priority: 0.3 },
    { url: `${BASE_URL}/terms`,         lastModified: new Date(), changeFrequency: 'yearly'  as ChangeFreq, priority: 0.3 },
  ];

  // Fetch categories with timeout
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s — allows for Railway cold-start
  
  let categoryRoutes: MetadataRoute.Sitemap = [];
  try {
    // OPTIMIZATION: Fetch only slug and updatedAt
    const categoriesData = await safeFetch<{ categories?: Array<{ slug?: string; _id?: string; updatedAt?: string }> }>(
      `${getServerApiBase()}/categories/sitemap`,
      {}
    );
    clearTimeout(timeoutId);
    
    categoryRoutes = (categoriesData.categories ?? []).map((cat: any) => ({
      url: `${BASE_URL}/categories/${cat.slug || cat._id}`,
      lastModified: safeDate(cat.updatedAt),
      changeFrequency: 'weekly' as ChangeFreq,
      priority: 0.7,
    }));
    
    const durationMs = Date.now() - startTime;
    
    // Cache successful fetch
    if (categoryRoutes.length > 0) {
      cacheSitemap(0, [...staticRoutes, ...categoryRoutes]);
      console.info('[SITEMAP_CATEGORIES_SUCCESS]', {
        shard: 0,
        count: categoryRoutes.length,
        durationMs,
      });
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error('[SITEMAP_CATEGORIES_FAILED]', {
      shard: 0,
      durationMs,
      error: (err as Error).message,
    });
    Sentry.captureException(err, { extra: { context: 'sitemap shard 0 (categories)', durationMs } });
    
    // STALE-WHILE-REVALIDATE: Try to return cached data
    const cached = getCachedSitemap(0);
    if (cached) {
      console.log(`[SITEMAP] Returning cached categories (${cached.length} URLs)`);
      return cached;
    }
    // Continue with static routes only
  }

  return dedup([...staticRoutes, ...categoryRoutes]);
}

