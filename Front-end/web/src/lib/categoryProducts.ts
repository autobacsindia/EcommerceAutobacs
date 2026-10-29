/**
 * The product-list query a category page issues — shared by the server component
 * (which pre-renders the default first page) and the client page (which refetches
 * it and handles every filtered view).
 *
 * No 'use client' on purpose: page.tsx must be able to CALL these. A function
 * exported from a client module is only a reference on the server.
 *
 * Why the server pre-renders at all: the category page reads `useSearchParams()`,
 * so a statically generated route bails out to client rendering — the HTML arrived
 * with no heading and no products, and the first photo (the page's Largest
 * Contentful Paint) could not even be requested until the JS bundle had loaded,
 * hydrated and made its own API call. Lighthouse measured that at ~8 s on a
 * simulated phone and ~21 s with real throttling. Rendering the default view from
 * the server lets the browser start that image with the HTML.
 *
 * Server and client MUST build the same query for the default view; otherwise the
 * client's refetch would replace the server's grid with a different one. Both go
 * through `buildCategoryProductsQuery` for that reason.
 */

/** The URL params that change what the category's product query returns. */
export const CATEGORY_LISTING_PARAMS = [
  'search',
  'page',
  'minPrice',
  'maxPrice',
  'inStock',
  'rating',
  'vehicleMake',
  'vehicleModel',
  'brand',
  'showAll',
  'sort',
  // The sidebar's sub-category refinement (see lib/categoryScope.ts).
  'category',
] as const;

interface ParamReader {
  get(name: string): string | null;
}

/**
 * True when the URL asks for the plain first page — what the server pre-rendered.
 * Anything else (utm_*, gclid, fbclid …) does not change the products, so an ad
 * click still lands on the pre-rendered grid.
 */
export function isDefaultListingView(params: ParamReader): boolean {
  return CATEGORY_LISTING_PARAMS.every((key) => !params.get(key));
}

/** Query string for `/products` — `categoryId` is the resolved scope (hub id or child ids). */
export function buildCategoryProductsQuery(
  searchParams: Record<string, string | undefined>,
  categoryId: string,
): string {
  const queryParams = new URLSearchParams();

  // Category scope first: the hub itself, or the sidebar's refinement inside it.
  queryParams.append('category', categoryId);

  if (searchParams.search) queryParams.append('search', searchParams.search);
  if (searchParams.page) queryParams.append('page', searchParams.page);
  if (searchParams.minPrice) queryParams.append('minPrice', searchParams.minPrice);
  if (searchParams.maxPrice) queryParams.append('maxPrice', searchParams.maxPrice);
  if (searchParams.inStock) queryParams.append('inStock', searchParams.inStock);
  if (searchParams.rating) queryParams.append('rating', searchParams.rating);
  if (searchParams.vehicleMake) queryParams.append('vehicleMake', searchParams.vehicleMake);
  if (searchParams.vehicleModel) queryParams.append('vehicleModel', searchParams.vehicleModel);
  if (searchParams.brand) queryParams.append('brand', searchParams.brand);
  if (searchParams.showAll === 'true') queryParams.append('limit', '500');

  // Map frontend sort values to backend parameters. No `sort` → no sortBy, so the
  // backend's own default order applies (and the server pre-render matches it).
  switch (searchParams.sort) {
    case undefined:
    case '':
      break;
    case 'price_asc':
      queryParams.append('sortBy', 'price');
      queryParams.append('order', 'asc');
      break;
    case 'price_desc':
      queryParams.append('sortBy', 'price');
      queryParams.append('order', 'desc');
      break;
    case 'name_asc':
      queryParams.append('sortBy', 'name');
      queryParams.append('order', 'asc');
      break;
    case 'rating_desc':
      queryParams.append('sortBy', 'averageRating');
      queryParams.append('order', 'desc');
      break;
    case 'createdAt_desc':
    default:
      queryParams.append('sortBy', 'createdAt');
      queryParams.append('order', 'desc');
      break;
  }

  return queryParams.toString();
}

export interface CategoryPagination {
  total?: number;
  pages?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  count?: number;
}

export interface CategoryProductsResult<P> {
  products: P[];
  pagination: CategoryPagination;
}

/** The `/products` response, reshaped — the backend returns pagination at the top level. */
export function normalizeProductsResponse<P>(data: unknown): CategoryProductsResult<P> {
  const body = data as { products?: P[] } & CategoryPagination | null | undefined;
  if (body && Array.isArray(body.products)) {
    const { total, pages, currentPage, hasNext, hasPrev, count } = body;
    return { products: body.products, pagination: { total, pages, currentPage, hasNext, hasPrev, count } };
  }
  return { products: [], pagination: {} };
}

/**
 * The fields a product CARD renders (StoreProductCard + ProductGrid). The list API
 * returns whole documents — descriptions, specifications, SEO, feature copy —
 * roughly 93 KB for 20 products, none of which a card shows. Everything a server
 * pre-render passes to the client is inlined into the HTML, so it is trimmed to
 * this list. The client's refetch then replaces it with the full response.
 */
const CARD_FIELDS = [
  '_id',
  'name',
  'slug',
  'price',
  'originalPrice',
  'priceMin',
  'priceMax',
  'productType',
  'images',
  'stock',
  'averageRating',
  'totalReviews',
  'isFeatured',
  'category',
  'categories',
  'brand',
  'brandSlug',
] as const;

export function toCardProduct<P extends Record<string, unknown>>(product: P): Partial<P> {
  const card: Partial<P> = {};
  for (const key of CARD_FIELDS) {
    if (key in product) (card as Record<string, unknown>)[key] = product[key];
  }
  return card;
}
