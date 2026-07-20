'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import apiClient, { ApiError, ErrorCategory } from '@/lib/api';
import type { Product, Pagination as PaginationType } from '@/lib/types';
import { productKeys } from './keys';

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
function buildQuery(params: Record<string, string>): string {
  const q = new URLSearchParams();
  PASSTHROUGH.forEach((k) => { if (params[k]) q.append(k, params[k]); });
  if (params.showAll === 'true') q.append('limit', '500');
  const sort = SORTS[params.sort ?? 'createdAt_desc'] ?? SORTS.createdAt_desc;
  q.append('sortBy', sort.sortBy);
  q.append('order', sort.order);
  return q.toString();
}

async function fetchProducts(params: Record<string, string>): Promise<ProductsData> {
  try {
    const data = await apiClient.get<Record<string, unknown> & { products?: Product[] }>(
      `/products?${buildQuery(params)}`
    );
    if (data && data.products) {
      const { total, pages, currentPage, hasNext, hasPrev, count } = data as Record<string, number | boolean>;
      return {
        products: data.products,
        pagination: { total, pages, currentPage, hasNext, hasPrev, count } as PaginationType,
      };
    }
    return { products: [], pagination: {} as PaginationType };
  } catch (error: unknown) {
    if (error instanceof ApiError && (error.category === ErrorCategory.NETWORK || error.status === 0)) {
      throw new Error('Unable to connect to the server. Please try again shortly.');
    }
    throw error;
  }
}

/**
 * Product listing query. `keepPreviousData` keeps the current grid visible while
 * a new filter/sort/page loads (no flash of skeletons), and identical params —
 * including back/forward navigation — are served instantly from cache instead of
 * re-hitting the network. Retries are handled by the shared QueryClient
 * (retry: 1), replacing the old bespoke 3× exponential backoff.
 */
export function useProducts(params: Record<string, string>) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => fetchProducts(params),
    placeholderData: keepPreviousData,
  });
}
