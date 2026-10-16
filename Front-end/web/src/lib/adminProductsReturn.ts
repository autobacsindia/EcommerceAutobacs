/**
 * Where the product editor goes back to after a save: the exact product-list
 * view the admin came from (page, search, filters), carried in `?returnTo=`.
 *
 * Only the product list itself is accepted. `returnTo` arrives in a URL anyone
 * can craft, so anything else — another path, another origin, a
 * `//evil.example` protocol-relative trick — falls back to the plain list
 * rather than becoming an open redirect.
 */
export const PRODUCTS_LIST_PATH = '/admin/products';

/**
 * The product list for a panel: '/admin' → /admin/products, the marketing panel
 * ('/team/marketing') → /team/marketing/products. See lib/usePanel.
 */
export const productsListPath = (base = '/admin') => `${base}/products`;

export function safeProductsReturn(raw: string | null | undefined, base = '/admin'): string {
  const list = productsListPath(base);
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return list;
  try {
    const url = new URL(raw, 'http://local.invalid');
    // Only THIS panel's product list — never another path, panel or origin.
    if (url.origin !== 'http://local.invalid' || url.pathname !== list) return list;
    return `${url.pathname}${url.search}`;
  } catch {
    return list;
  }
}

/** The editor link for a product, remembering the list view it was opened from. */
export function productEditHref(productId: string, listUrl: string, base = '/admin'): string {
  return `${base}/products/edit/${productId}?returnTo=${encodeURIComponent(listUrl)}`;
}
