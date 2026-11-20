'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { deliveryFeeKeys } from './keys';
import { useDeliveryFeesPublic } from './useDeliveryFeesPublic';

/**
 * What the Black Friday offer waives on each product, for the cards' "Save ₹X+" badge
 * and ₹0 delivery receipt (owner, 2026-11-20).
 *
 * Every figure is the SERVER's (`deliveryFeeService.cardFeeWaivers`), computed with the
 * same fee maths as checkout for the cheapest PIN — so it is a floor every shopper gets,
 * hence the "+". The browser never adds fees up; it renders `save` and the lines as given.
 *
 * One request per grid (not per card). Returns null when the offer is off, so callers
 * render the plain card without branching on an error.
 */
export interface CardFeeWaiver {
  /** M.R.P. − selling price (₹), the card's existing red saving. */
  discount: number;
  /** discount + total: the badge figure. */
  save: number;
  shipping: number;
  packing: number;
  handling: number;
  /** Docket, fuel, payment fee, GST on fees … everything not named above. */
  other: number;
  /** All delivery fees waived. */
  total: number;
}

export interface CardFeeWaivers {
  live: boolean;
  products: Record<string, CardFeeWaiver>;
}

/** Mirrors MAX_CARD_FEE_IDS in Back-end/server/services/deliveryFeeService.js. */
export const MAX_CARD_FEE_IDS = 60;

export function useCardFeeWaivers(productIds: string[]) {
  // Shares the cached /delivery-fees/public answer: outside Black Friday, no request at all.
  const { offerLive } = useDeliveryFeesPublic();
  const ids = [...new Set(productIds.filter(Boolean))].slice(0, MAX_CARD_FEE_IDS);
  const q = useQuery({
    queryKey: deliveryFeeKeys.cardWaivers(ids),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; waivers: CardFeeWaivers }>(
        `${API_ENDPOINTS.DELIVERY_FEES_CARD_WAIVERS}?ids=${encodeURIComponent(ids.join(','))}`,
      );
      return res.waivers?.live ? res.waivers : null;
    },
    enabled: offerLive && ids.length > 0,
    // Decorative: a failure shows the plain card, never an error or a retry storm.
    retry: false,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
  /** Offer live but figures not back yet: the hero cards reserve their checklist's space (no CLS). */
  const pending = offerLive && ids.length > 0 && q.isLoading;
  return { waivers: q.data ?? null, pending };
}
