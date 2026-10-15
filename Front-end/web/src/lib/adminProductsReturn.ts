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

export function safeProductsReturn(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return PRODUCTS_LIST_PATH;
  try {
    const url = new URL(raw, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid' || url.pathname !== PRODUCTS_LIST_PATH) return PRODUCTS_LIST_PATH;
    return `${url.pathname}${url.search}`;
  } catch {
    return PRODUCTS_LIST_PATH;
  }
}

/** The editor link for a product, remembering the list view it was opened from. */
export function productEditHref(productId: string, listUrl: string): string {
  return `/admin/products/edit/${productId}?returnTo=${encodeURIComponent(listUrl)}`;
}
