'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { DeliveryWindow } from '@/lib/deliveryWindow';
import { deliveryFeeKeys } from './keys';

/**
 * Delivery window per product ("7–10 days", heavy goods "10–15 days") for the product
 * page and the listing cards. The server decides it from the product's size class
 * (Back-end/server/utils/deliveryWindow.js); the browser only formats it.
 *
 * One request per grid, not per card. A failure renders no estimate (never a guess).
 */
export interface DeliveryEstimates {
  general: { minDays: number; maxDays: number };
  products: Record<string, DeliveryWindow>;
}

/** Mirrors MAX_DELIVERY_ESTIMATE_IDS in Back-end/server/services/deliveryEstimateService.js. */
export const MAX_DELIVERY_ESTIMATE_IDS = 60;

export function useDeliveryEstimates(productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))].slice(0, MAX_DELIVERY_ESTIMATE_IDS);
  const q = useQuery({
    queryKey: deliveryFeeKeys.estimates(ids),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; estimates: DeliveryEstimates }>(
        `${API_ENDPOINTS.DELIVERY_ESTIMATES}?ids=${encodeURIComponent(ids.join(','))}`,
      );
      return res.estimates ?? null;
    },
    enabled: ids.length > 0,
    retry: false,
    // Changes only when a product's size class does; a few minutes is plenty.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return { estimates: q.data?.products ?? null, pending: ids.length > 0 && q.isLoading };
}
