/**
 * Query-string rules for crawler traffic, consumed by `middleware.ts`.
 *
 * 1. LEGACY WOOCOMMERCE PARAMETERS → 301 to the same URL without them.
 *
 *    Google still holds hundreds of WooCommerce-era URLs such as
 *    `/model/toyota-hilux/page/9/?per_page=12&add-to-cart=11519` (Search Console,
 *    Oct 2026). This site never emits these parameters and no page reads them, so
 *    each variant is a byte-identical duplicate of the clean URL. A permanent
 *    redirect folds every variant into the clean page in one hop.
 *
 *    They used to be Disallowed in robots.txt instead. That kept them in Google's
 *    index for good: a crawler that may not fetch a URL can never see its redirect.
 *
 * 2. INTERNAL SEARCH RESULTS → `X-Robots-Tag: noindex, follow`.
 *
 *    Every typed term is a new, thin URL. Google may crawl them (it has to, to read
 *    the noindex) but must not index them; `follow` keeps the products they link to
 *    discoverable. A response header rather than per-page metadata because the same
 *    `?search=` rides on /blog, the listing and WordPress's `/?s=`, and reading
 *    searchParams in generateMetadata would make those static pages render per
 *    request. Google treats the header exactly like the meta tag.
 *
 * Pure, so the rules are unit-tested without loading the middleware.
 */

/**
 * WooCommerce/WordPress parameters that carry no meaning on this site. Verified
 * unread by any page (grep before adding one: a parameter the site DOES read —
 * `sort`, `category`, `page`, `q`, `quantity` — must never be listed here, or the
 * redirect silently throws the shopper's choice away).
 */
export const LEGACY_PARAMS: readonly string[] = [
  'add-to-cart',
  'added-to-cart',
  'remove_item',
  'undo_item',
  '_wpnonce',
  'per_page',
  'layout',
  'shop_view',
  'product_view',
  'orderby',
];

/**
 * The URL with every legacy parameter removed, or null when it carries none.
 * Every other parameter (including `ref`, so an affiliate link still credits the
 * affiliate on the next hop) is kept in its original order. WordPress's trailing
 * slash goes too (`/page/9/` → `/page/9`), saving Next's own slash redirect a hop.
 */
export function stripLegacyParams(url: URL): URL | null {
  const keys = Array.from(url.searchParams.keys());
  if (!keys.some((k) => LEGACY_PARAMS.includes(k))) return null;
  const clean = new URL(url.toString());
  for (const k of LEGACY_PARAMS) clean.searchParams.delete(k);
  if (clean.pathname.length > 1) clean.pathname = clean.pathname.replace(/\/+$/, '');
  return clean;
}

/** Query parameters that turn a page into a site-search result. `s` is WordPress's. */
export const SEARCH_PARAMS: readonly string[] = ['search', 's'];

/** True for an internal search-results URL, which must be served noindex. */
export function isInternalSearch(pathname: string, searchParams: URLSearchParams): boolean {
  if (pathname === '/products/search' || pathname.startsWith('/products/search/')) return true;
  return SEARCH_PARAMS.some((p) => searchParams.has(p));
}

export const SEARCH_ROBOTS_HEADER = 'noindex, follow';
