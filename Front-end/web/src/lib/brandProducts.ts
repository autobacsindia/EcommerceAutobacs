/**
 * The product-list request a brand page issues — shared by page.tsx (which
 * pre-renders page 1) and BrandPageClient (which refetches it and pages through
 * the rest). Plain module, no 'use client', so the server can call it.
 *
 * Same reason as lib/categoryProducts.ts: the brand page reads useSearchParams(),
 * so the static route bailed out to client rendering and its HTML held no
 * products. Both sides must request the identical page, or the client's refresh
 * would swap the server's grid for a different one.
 */
export const BRAND_PAGE_SIZE = 12;

/** Path under the API base for one page of a brand's products. */
export function brandProductsPath(brandSlug: string, page = 1): string {
  return `/products/brands/${encodeURIComponent(brandSlug)}?page=${page}&limit=${BRAND_PAGE_SIZE}`;
}
