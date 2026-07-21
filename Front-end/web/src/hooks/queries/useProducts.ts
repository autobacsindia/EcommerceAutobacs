'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import apiClient, { ApiError, ErrorCategory } from '@/lib/api';
import type { Product } from '@/lib/types';
import { productKeys } from './keys';
import {
  buildProductsQuery,
  normalizeProductsResponse,
  type ProductsData,
} from '@/lib/productQuery';

export type { ProductsData };

async function fetchProducts(params: Record<string, string>): Promise<ProductsData> {
  try {
    const data = await apiClient.get<Record<string, unknown> & { products?: Product[] }>(
      `/products?${buildProductsQuery(params)}`
    );
    return normalizeProductsResponse(data);
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
 *
 * `initialData` seeds the query from a server-rendered first page so the first
 * paint shows products with no client fetch/spinner. The caller must only pass
 * it when the CURRENT params match the params the server fetched (otherwise it
 * would seed a different key with the wrong page). `initialDataUpdatedAt` is
 * backdated ~30s so the seeded data is treated as slightly aged — a background
 * refresh happens once it crosses staleTime, but the paint is instant.
 */
export function useProducts(
  params: Record<string, string>,
  options?: { initialData?: ProductsData },
) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => fetchProducts(params),
    placeholderData: keepPreviousData,
    initialData: options?.initialData,
    initialDataUpdatedAt: options?.initialData ? Date.now() - 30_000 : undefined,
  });
}
