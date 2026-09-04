import { MetadataRoute } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getServerApiBase } from '@/lib/server-api';
import { SITE_URL as BASE_URL } from '@/lib/siteUrl';

/**
 * The site's single sitemap, served at /sitemap.xml — the exact path robots.ts
 * advertises.
 *
 * ⚠️ Do NOT reintroduce `generateSitemaps()` here without also shipping a
 * `<sitemapindex>` route. Exporting it moves the output to /sitemap/0.xml,
 * /sitemap/1.xml, … and Next does NOT write an index at /sitemap.xml, so the
 * one URL robots.txt points at 404s and nothing reaches Google. That shipped:
 * every shard was well-formed and completely unreachable. The shard dispatch
 * also compared `id === 1` while Next passes `id` as a STRING, so the article
 * shard silently re-served the static shard and all 63 blog posts went missing
 * — `id >= 2` kept working because `>=` coerces, which is why products looked
 * fine and hid it.
 *
 * One file is correct at this size by a wide margin: Google's limit is 50,000
 * URLs / 50MB and the catalogue produces ~1,300. Revisit sharding above ~10k
 * URLs, and ship the index route in the same change.
 */

// Regenerate hourly. Each upstream fetch is separately revalidated too, so a
// slow source can't pin a stale sitemap for longer than this.
export const revalidate = 3600;

const PRODUCT_PAGE_SIZE = 250;
const MAX_PRODUCTS      = 20000; // hard cap — a runaway catalogue can't hang the build
const MAX_ARTICLES      = 2000;

type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
type Entries    = MetadataRoute.Sitemap;

/**
 * Stale-while-revalidate, per source rather than per shard.
 *
 * A sitemap that suddenly drops a section reads to Google as "these pages are
 * gone", so a failing upstream must serve its last good answer rather than an
 * empty list. Sources are isolated from each other for the same reason: a dead
 * blog API must not take the 933 product URLs down with it.
 */
type Source = 'products' | 'categories' | 'articles' | 'brands' | 'vehicles';
const cache = new Map<Source, { data: Entries; at: number }>();
const CACHE_TTL = 86400000; // 24h

function readCache(source: Source): Entries | null {
  const hit = cache.get(source);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(source);
    return null;
  }
  return hit.data;
}

/** Normalise any date-like value to a valid Date, falling back to now. */
function safeDate(value: unknown): Date {
  if (!value) return new Date();
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Deduplicate entries by URL — last writer wins. */
function dedup(entries: Entries): Entries {
  const map = new Map<string, Entries[number]>();
  for (const entry of entries) map.set(entry.url, entry);
  return Array.from(map.values());
}

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${getServerApiBase()}${path}`, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (err) {
    console.warn('[SITEMAP_FETCH_FAILED]', path, (err as Error).message);
    return fallback;
  }
}

/**
 * Run one source, and never let it throw into the caller. On failure fall back
 * to the last good result for that source; only an empty section is worse than
 * a stale one.
 */
async function collect(source: Source, load: () => Promise<Entries>): Promise<Entries> {
  const startedAt = Date.now();
  try {
    const entries = await load();
    if (entries.length > 0) cache.set(source, { data: entries, at: Date.now() });
    console.info('[SITEMAP_SOURCE]', { source, count: entries.length, durationMs: Date.now() - startedAt });
    return entries;
  } catch (err) {
    console.error('[SITEMAP_SOURCE_FAILED]', {
      source,
      durationMs: Date.now() - startedAt,
      error: (err as Error).message,
    });
    Sentry.captureException(err, { extra: { context: 'sitemap', source } });

    const stale = readCache(source);
    if (stale) {
      console.warn('[SITEMAP_SOURCE_STALE]', { source, count: stale.length });
      return stale;
    }
    return [];
  }
}

// ── sources ───────────────────────────────────────────────────────────────────

/**
 * Listing roots and the admin-managed static pages.
 *
 * MANAGED_PAGES must stay in step with Back-end/server/config/staticPages.js —
 * that file is the source of truth for which entity-less pages exist, and
 * sitemapStaticPages.test.ts fails if the two drift. `/shop` and `/about` are
 * deliberately absent: both are redirects, and submitting a redirect competes
 * with its own destination.
 */
const LISTING_ROOTS: Array<[string, ChangeFreq, number]> = [
  ['/products',   'daily',  0.8],
  ['/categories', 'weekly', 0.6],
  ['/brands',     'weekly', 0.6],
  ['/blog',       'daily',  0.8],
];

const MANAGED_PAGES: Array<[string, ChangeFreq, number]> = [
  ['/',          'daily',   1.0],
  ['/about-us',  'monthly', 0.5],
  ['/careers',   'monthly', 0.4],
  ['/contact',   'monthly', 0.5],
  ['/faq',       'monthly', 0.4],
  ['/help',      'monthly', 0.4],
  ['/track',     'monthly', 0.4],
  ['/shipping',  'yearly',  0.3],
  ['/returns',   'yearly',  0.3],
  ['/warranty',  'yearly',  0.3],
  ['/privacy',   'yearly',  0.3],
  ['/terms',     'yearly',  0.3],
  ['/offers',       'daily',   0.6],
  ['/super-cars',   'monthly', 0.5],
  ['/consultation', 'monthly', 0.5],
  ['/media',        'monthly', 0.4],
  ['/blog/gallery', 'weekly',  0.4],
  ['/blog/videos',  'weekly',  0.4],
];

export const STATIC_ROUTES: Array<[string, ChangeFreq, number]> = [
  ...MANAGED_PAGES,
  ...LISTING_ROOTS,
];

function staticEntries(): Entries {
  const now = new Date();
  return STATIC_ROUTES.map(([path, changeFrequency, priority]) => ({
    url: path === '/' ? BASE_URL : `${BASE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}

async function productEntries(): Promise<Entries> {
  const count = await getJson<{ total?: number; pagination?: { total?: number } }>(
    '/products/count',
    {},
  );
  const total = Math.min(count.pagination?.total ?? count.total ?? 0, MAX_PRODUCTS);
  if (total === 0) throw new Error('product count returned 0');

  const pages = Math.ceil(total / PRODUCT_PAGE_SIZE);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      getJson<{ products?: Array<{ slug: string; updatedAt: string }> }>(
        `/products/sitemap?limit=${PRODUCT_PAGE_SIZE}&page=${i + 1}`,
        {},
      ),
    ),
  );

  return results.flatMap((page) =>
    (page.products ?? [])
      .filter((p) => p.slug)
      .map((p) => ({
        url: `${BASE_URL}/products/${p.slug}`,
        lastModified: safeDate(p.updatedAt),
        changeFrequency: 'daily' as ChangeFreq,
        priority: 0.6,
      })),
  );
}

async function categoryEntries(): Promise<Entries> {
  const data = await getJson<{ categories?: Array<{ slug?: string; _id?: string; updatedAt?: string }> }>(
    '/categories/sitemap',
    {},
  );
  return (data.categories ?? [])
    .filter((c) => c.slug || c._id)
    .map((c) => ({
      url: `${BASE_URL}/categories/${c.slug || c._id}`,
      lastModified: safeDate(c.updatedAt),
      changeFrequency: 'weekly' as ChangeFreq,
      priority: 0.7,
    }));
}

async function brandEntries(): Promise<Entries> {
  const data = await getJson<{ brands?: Array<{ slug: string; updatedAt?: string }> }>(
    '/brands/sitemap',
    {},
  );
  return (data.brands ?? [])
    .filter((b) => b.slug)
    .map((b) => ({
      url: `${BASE_URL}/brands/${b.slug}`,
      lastModified: safeDate(b.updatedAt),
      changeFrequency: 'weekly' as ChangeFreq,
      priority: 0.6,
    }));
}

/**
 * Vehicle fitment pages — the long-tail catalogue surface ("Thar Roxx
 * accessories"). Only /model/[slug] is submitted, deliberately:
 *
 *  - /vehicles/** is browse UI serving the same intent, so submitting both puts
 *    two of our own URLs in front of one query. /model/[slug] is the one with
 *    per-page metadata, a description and a self-canonical.
 *  - /model/[slug]/page/N self-canonicalises and stays indexable, but deep
 *    pages are for crawlers to follow, not for us to enumerate.
 */
async function vehicleEntries(): Promise<Entries> {
  const data = await getJson<{ vehicles?: Array<{ slug: string; updatedAt?: string }> }>(
    '/vehicles/sitemap',
    {},
  );
  return (data.vehicles ?? [])
    .filter((v) => v.slug)
    .map((v) => ({
      url: `${BASE_URL}/model/${v.slug}`,
      lastModified: safeDate(v.updatedAt),
      changeFrequency: 'weekly' as ChangeFreq,
      priority: 0.7,
    }));
}

async function articleEntries(): Promise<Entries> {
  const data = await getJson<{
    data?: Array<{ slug: string; updatedAt?: string; publishedAt?: string }>;
  }>(`/media/articles/sitemap?limit=${MAX_ARTICLES}`, {});

  // Blog posts are served at the site root (/<slug>) for WordPress permalink
  // parity (ADR-005) — NOT under /media/<type>/.
  return (data.data ?? [])
    .filter((a) => a.slug)
    .map((a) => ({
      url: `${BASE_URL}/${a.slug}`,
      lastModified: safeDate(a.updatedAt ?? a.publishedAt),
      changeFrequency: 'weekly' as ChangeFreq,
      priority: 0.7,
    }));
}

// ── sitemap ───────────────────────────────────────────────────────────────────

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const startedAt = Date.now();

  const [products, categories, brands, vehicles, articles] = await Promise.all([
    collect('products', productEntries),
    collect('categories', categoryEntries),
    collect('brands', brandEntries),
    collect('vehicles', vehicleEntries),
    collect('articles', articleEntries),
  ]);

  // Static first so dedup() can never let a fetched entry silently override a
  // curated priority — the listing roots also appear as no other source's URL.
  const entries = dedup([
    ...staticEntries(),
    ...products,
    ...categories,
    ...brands,
    ...vehicles,
    ...articles,
  ]);

  console.info('[SITEMAP_BUILT]', {
    total: entries.length,
    products: products.length,
    categories: categories.length,
    brands: brands.length,
    vehicles: vehicles.length,
    articles: articles.length,
    durationMs: Date.now() - startedAt,
  });

  return entries;
}
