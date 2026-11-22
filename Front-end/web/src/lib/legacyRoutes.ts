import type { SlugRedirectMap } from '@/lib/slugRedirects';

/**
 * Old WooCommerce / WordPress / Shopify-style URLs Google still crawls, and the
 * ONE page each should land on now (Search Console "Not found", Nov 2026).
 *
 *   /tag/<anything>                    → /blog
 *   /clients                           → /about-us
 *   /lets-keep-in-touch                → /contact
 *   /product/<slug>                    → /products/<current slug>, or the redirect-table
 *                                        target of a removed product; anything else
 *                                        falls through to app/product/[slug] (lookup)
 *   /product-category/<a>/<b>(/page/N) → /categories/<b>, else <a>, else /categories
 *   /collections/<a>/<b>(/page/N)      → same as product-category
 *   /product-brand/<b>(/page/N)        → /brands/<b> (or <b> minus "-brand"), else /brands
 *   any path in the redirect table     → its target, or 410 Gone
 *
 * Every answer is final: the caller redirects ONCE, straight to a page that
 * exists (renamed slugs are followed here, not on a second hop).
 *
 * A fallback that depends on knowing which categories/brands exist is only taken
 * once the map has loaded; before that the URL falls through (a 404 today, the
 * right redirect a moment later) rather than being permanently sent somewhere
 * wrong. Pure, so every rule is unit-tested without the network.
 */

export type LegacyDecision = { kind: 'redirect'; to: string } | { kind: 'gone' } | null;

const STATIC: Array<[RegExp, string]> = [
  [/^\/tag(\/.*)?$/, '/blog'],
  [/^\/clients$/, '/about-us'],
  [/^\/lets-keep-in-touch$/, '/contact'],
];

/** Prefixes whose rules need the redirect map. Cheap gate for the middleware. */
const MAP_PREFIXES = ['/product/', '/product-category/', '/collections/', '/product-brand/'];

/** Lowercase, percent-decoded, no trailing slash. */
export function normalizeLegacyPath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* malformed escape: match on the raw form */
  }
  p = p.toLowerCase().replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** True when `resolveLegacyRoute` may answer this path (cheap gate for the middleware). */
export function needsLegacyMap(pathname: string): boolean {
  const p = normalizeLegacyPath(pathname);
  return MAP_PREFIXES.some((prefix) => p.startsWith(prefix)) || STATIC.some(([re]) => re.test(p));
}

/** Path segments after `prefix`, with a trailing /page/N dropped. */
function segmentsAfter(path: string, prefix: string): string[] {
  return path
    .slice(prefix.length)
    .replace(/(^|\/)page\/\d+$/, '')
    .split('/')
    .filter(Boolean);
}

/** Singular/plural spellings: "floor-mat" ↔ "floor-mats". */
function spellings(slug: string): string[] {
  const out = [slug];
  if (slug.endsWith('s')) out.push(slug.slice(0, -1));
  else out.push(`${slug}s`);
  return out;
}

/** The current slug of a category/brand that `slug` names, or null. */
function currentSlug(slug: string, renames: Record<string, string>, live: Set<string>): string | null {
  for (const s of spellings(slug)) {
    if (live.has(s)) return s;
    if (Object.prototype.hasOwnProperty.call(renames, s)) return renames[s];
  }
  return null;
}

function toCategory(segments: string[], map: SlugRedirectMap): LegacyDecision {
  for (const seg of [...segments].reverse()) {
    const slug = currentSlug(seg, map.categories, map.live.categories);
    if (slug) return { kind: 'redirect', to: `/categories/${slug}` };
  }
  return map.loaded ? { kind: 'redirect', to: '/categories' } : null;
}

function toBrand(segments: string[], map: SlugRedirectMap): LegacyDecision {
  const [seg] = segments;
  if (seg) {
    for (const candidate of [seg, seg.replace(/-brand$/, '')]) {
      const slug = currentSlug(candidate, map.brands, map.live.brands);
      if (slug) return { kind: 'redirect', to: `/brands/${slug}` };
    }
  }
  return map.loaded ? { kind: 'redirect', to: '/brands' } : null;
}

function fromTable(path: string, map: SlugRedirectMap): LegacyDecision {
  if (!Object.prototype.hasOwnProperty.call(map.paths, path)) return null;
  const to = map.paths[path];
  return to === null ? { kind: 'gone' } : { kind: 'redirect', to };
}

export function resolveLegacyRoute(pathname: string, map: SlugRedirectMap): LegacyDecision {
  const path = normalizeLegacyPath(pathname);

  for (const [re, to] of STATIC) if (re.test(path)) return { kind: 'redirect', to };

  const listed = fromTable(path, map);
  if (listed) return listed;

  if (path.startsWith('/product/')) {
    const [slug, ...rest] = segmentsAfter(path, '/product/');
    if (!slug || rest.length) return null;
    const removed = fromTable(`/products/${slug}`, map);
    if (removed) return removed;
    const renamed = map.products[slug];
    // Not renamed and not removed: app/product/[slug] looks it up (one hop).
    return renamed ? { kind: 'redirect', to: `/products/${renamed}` } : null;
  }
  if (path.startsWith('/product-category/')) return toCategory(segmentsAfter(path, '/product-category/'), map);
  if (path.startsWith('/collections/')) return toCategory(segmentsAfter(path, '/collections/'), map);
  if (path.startsWith('/product-brand/')) return toBrand(segmentsAfter(path, '/product-brand/'), map);
  return null;
}
