'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { deliveryFeeKeys } from './keys';

export interface PublicDeliveryFees {
  /** Delivery fees are charged online at checkout (else: paid to the courier on delivery). */
  chargeAtCheckout: boolean;
  offer: { code: string; live: boolean; endsAt: string | null };
}

async function fetchPublicDeliveryFees(): Promise<PublicDeliveryFees | null> {
  const res = await apiClient.get<{ deliveryFees?: PublicDeliveryFees }>(API_ENDPOINTS.DELIVERY_FEES_PUBLIC, { retries: 0 });
  return res?.deliveryFees ?? null;
}

/**
 * DISPLAY ONLY: drives product-page wording ("delivery fees shown at checkout" vs
 * "paid on delivery") and the Black Friday hint. What anyone is charged comes from the
 * checkout quote, never from this. `offer.live` also stops at `endsAt` on this clock.
 */
export function useDeliveryFeesPublic() {
  const q = useQuery({
    queryKey: deliveryFeeKeys.public(),
    queryFn: fetchPublicDeliveryFees,
    staleTime: 60 * 1000,
    retry: 1,
  });
  const data = q.data ?? null;
  const offerLive = Boolean(
    data?.chargeAtCheckout && data.offer.live && (!data.offer.endsAt || Date.parse(data.offer.endsAt) > Date.now()),
  );
  return { chargeAtCheckout: Boolean(data?.chargeAtCheckout), offerLive, isLoading: q.isLoading };
}
