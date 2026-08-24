'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import type { Product } from '@/lib/types';
import { productKeys } from './keys';
import { normalizeProductsResponse, type ProductsData } from '@/lib/productQuery';

const PAGE_SIZE = 24;

/**
 * `/offers` — products currently discounted or admin-flagged `isOfferFeatured`.
 *
 * A separate endpoint from the main catalogue (`useProducts`), not a filter on it —
 * "on offer" is Mongo-only eligibility (discount math + an offer window), not an
 * Elasticsearch-backed search facet. Response shape is deliberately the SAME
 * `{total, pages, currentPage, hasNext, hasPrev}` the main listing returns, so this
 * reuses `normalizeProductsResponse` and the site's one `Pagination` component
 * instead of growing a second, bespoke pagination UI just for this page.
 */
export function useOfferProducts(page: number) {
  return useQuery<ProductsData>({
    queryKey: productKeys.offersPage(page),
    queryFn: async () => {
      const data = await apiClient.get<Record<string, unknown> & { products?: Product[] }>(
        `/products/offers?page=${page}&limit=${PAGE_SIZE}`,
      );
      return normalizeProductsResponse(data);
    },
    placeholderData: keepPreviousData,
  });
}
