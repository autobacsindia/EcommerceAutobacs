/**
 * Product-listing query helpers — SERVER-SAFE (no 'use client', no browser APIs).
 *
 * Extracted from the client `useProducts` hook so the server component
 * (app/products/page.tsx) and the client hook build the SAME backend query and
 * normalize the response the SAME way. This is what makes the server→client
 * `initialData` handoff sound: the server-fetched page and the first client
 * query key resolve to identical data.
 */

import type { Product, Pagination as PaginationType } from '@/lib/types';

export interface ProductsData {
  products: Product[];
  pagination: PaginationType;
}

const SORTS: Record<string, { sortBy: string; order: string }> = {
  price_asc: { sortBy: 'price', order: 'asc' },
  price_desc: { sortBy: 'price', order: 'desc' },
  name_asc: { sortBy: 'name', order: 'asc' },
  rating_desc: { sortBy: 'averageRating', order: 'desc' },
  createdAt_desc: { sortBy: 'createdAt', order: 'desc' },
};

const PASSTHROUGH = [
  'category', 'search', 'page', 'minPrice', 'maxPrice', 'inStock',
  'isFeatured', 'isFastMoving', 'rating', 'vehicleMake', 'vehicleModel', 'brand',
];

/** Turn the page's raw searchParams into the backend query string. */
export function buildProductsQuery(params: Record<string, string>): string {
  const q = new URLSearchParams();
  PASSTHROUGH.forEach((k) => { if (params[k]) q.append(k, params[k]); });
  if (params.showAll === 'true') q.append('limit', '500');
  const sort = SORTS[params.sort ?? 'createdAt_desc'] ?? SORTS.createdAt_desc;
  q.append('sortBy', sort.sortBy);
  q.append('order', sort.order);
  return q.toString();
}

/** Normalize the backend `/products` response into ProductsData. */
export function normalizeProductsResponse(
  data: (Record<string, unknown> & { products?: Product[] }) | null | undefined,
): ProductsData {
  if (data && data.products) {
    const { total, pages, currentPage, hasNext, hasPrev, count } = data as Record<string, number | boolean>;
    return {
      products: data.products,
      pagination: { total, pages, currentPage, hasNext, hasPrev, count } as PaginationType,
    };
  }
  return { products: [], pagination: {} as PaginationType };
}
