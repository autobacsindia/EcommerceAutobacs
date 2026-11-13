import { LEGACY_ROOT_BLOG_SLUGS } from '@/lib/legacyBlogSlugs';

/**
 * 301 redirects for renamed slugs — old product/category/brand/blog URLs — and
 * for blog posts' old ROOT URLs (`/<slug>` → `/blog/<slug>`, the 2026-11 move).
 *
 * Renaming a slug in admin used to 404 the old URL, throwing away its Google
 * ranking and every backlink. The backend now keeps each document's old slugs
 * and serves them as one small map (GET /api/v1/redirects/slugs). Middleware
 * holds a copy in memory and answers an old URL with a 301 to the new one,
 * before any page renders — a true HTTP 301, not a meta-refresh.
 *
 * Cost model: the map is tiny (only RENAMED slugs) and is refreshed at most
 * every REFRESH_MS per instance, in the background once warm. A request only
 * ever waits on the network for the very first load in a cold instance, and
 * then for at most FETCH_TIMEOUT_MS. If the backend is down the map stays
 * empty/stale and every request proceeds exactly as before — a failure here
 * can only mean "no redirect", never a broken page.
 */

export type SlugMap = Record<string, string>;
export interface SlugRedirectMap {
  products: SlugMap;
  categories: SlugMap;
  brands: SlugMap;
  articles: SlugMap;
}

const EMPTY: SlugRedirectMap = { products: {}, categories: {}, brands: {}, articles: {} };
export const REFRESH_MS = 5 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 1500;

const SECTIONS: Array<[prefix: string, key: keyof SlugRedirectMap]> = [
  ['/products/', 'products'],
  ['/categories/', 'categories'],
  ['/brands/', 'brands'],
  ['/blog/', 'articles'],
];

/** Both spellings of a path segment: as requested, and percent-decoded. */
function candidates(segment: string): string[] {
  const out = [segment.toLowerCase()];
  try {
    const decoded = decodeURIComponent(segment).toLowerCase();
    if (decoded !== out[0]) out.push(decoded);
  } catch {
    /* malformed escape — the raw form is all we have */
  }
  return out;
}

/** The stored (lowercase) legacy slug this segment spells, or null. */
function legacyBlogSlug(segment: string): string | null {
  for (const key of candidates(segment)) {
    if (LEGACY_ROOT_BLOG_SLUGS.has(key)) return key;
  }
  return null;
}

function lookup(map: SlugMap, segment: string): string | null {
  for (const key of candidates(segment)) {
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  }
  return null;
}

/**
 * The path an old URL should 301 to, or null. Pure.
 *
 * Matches exactly one slug segment — `/products/<slug>`, `/categories/<slug>`,
 * `/brands/<slug>`, `/blog/<slug>` (a renamed post), and the site root `/<slug>`
 * where blog posts lived until 2026-11. Deeper paths (`/model/x/page/2`) never
 * match, and `/blog/gallery` / `/blog/videos` are never in the map.
 *
 * A root URL always lands on `/blog/<current slug>` in ONE hop: the rename map is
 * asked first (so a post renamed after the move skips its old /blog URL), then the
 * fixed list of the 64 posts that were ever at the root.
 */
export function resolveSlugRedirect(pathname: string, map: SlugRedirectMap): string | null {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  for (const [prefix, key] of SECTIONS) {
    if (!path.startsWith(prefix)) continue;
    const segment = path.slice(prefix.length);
    if (!segment || segment.includes('/')) return null;
    const next = lookup(map[key], segment);
    return next ? `${prefix}${next}` : null;
  }

  // Blog posts' old home, the site root /<slug>.
  const segment = path.slice(1);
  if (!segment || segment.includes('/')) return null;
  const renamed = lookup(map.articles, segment);
  if (renamed) return `/blog/${renamed}`;
  const legacy = legacyBlogSlug(segment);
  return legacy ? `/blog/${legacy}` : null;
}

/**
 * Could this path be an old slug URL at all? Checked BEFORE touching the map so
 * `/`, `/_next/...`, `/admin/...` and every deeper path never wait on it.
 */
export function isSlugRedirectCandidate(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (path === '/' || path.includes('.')) return false; // home; files like /robots.txt
  const segments = path.split('/').length - 1;
  if (segments === 1) return true; // /<old-root-blog-slug>
  return segments === 2 && SECTIONS.some(([prefix]) => path.startsWith(prefix));
}

function normalize(body: unknown): SlugRedirectMap {
  const b = (body ?? {}) as Partial<Record<keyof SlugRedirectMap, unknown>>;
  const section = (v: unknown): SlugMap => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: SlugMap = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // Only plain slugs as targets: never a scheme, host or path, so a bad row
      // can't turn this into an open redirect.
      if (typeof val === 'string' && /^[a-z0-9%][a-z0-9%-]*$/i.test(val)) out[k.toLowerCase()] = val;
    }
    return out;
  };
  return {
    products: section(b.products),
    categories: section(b.categories),
    brands: section(b.brands),
    articles: section(b.articles),
  };
}

let current: SlugRedirectMap = EMPTY;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

async function load(fetchImpl: typeof fetch): Promise<void> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return;
  try {
    const res = await fetchImpl(`${apiUrl}/api/v1/redirects/slugs`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`${res.status}`);
    current = normalize(await res.json());
    loadedAt = Date.now();
  } catch (err) {
    // Keep the last good map. Retry no sooner than a minute from now, so a dead
    // backend costs one failed fetch per minute, not one per request.
    loadedAt = Date.now() - REFRESH_MS + 60_000;
    console.warn('[slugRedirects] map refresh failed:', (err as Error).message);
  } finally {
    inflight = null;
  }
}

/**
 * The current map. Waits only for the first load in a cold instance; after
 * that a stale map is returned at once while a refresh runs in the background.
 */
export async function getSlugRedirectMap(fetchImpl: typeof fetch = fetch): Promise<SlugRedirectMap> {
  const stale = Date.now() - loadedAt > REFRESH_MS;
  if (stale && !inflight) inflight = load(fetchImpl);
  if (loadedAt === 0 && inflight) await inflight;
  return current;
}

/** Test hook: forget the cached map. */
export function __resetSlugRedirectsForTest(): void {
  current = EMPTY;
  loadedAt = 0;
  inflight = null;
}
