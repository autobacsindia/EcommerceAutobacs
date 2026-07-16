'use client';

import { useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

export interface CheckoutQuote {
  subtotal: number;
  couponDiscount: number;
  freeShippingApplied: boolean;
  karmaDiscount: number;
  discount: number;
  shippingCost: number;
  tax: number;
  totalAmount: number;
  appliedCoupon: { code: string; type: string; value: number } | null;
  couponError: string | null;
  karmaPointsUsed: number;
  karmaPointValue: number;
  maxRedeemablePoints: number;
}

export interface QuoteItem { product: string; quantity: number; variantId?: string | null }

/**
 * Debounced live price breakdown for the checkout (coupon + karma preview).
 * Mirrors the server's authoritative pricing — the order is recomputed server-side
 * at creation, so this drives display only. Stale responses are discarded by sequence.
 */
export function useCheckoutQuote(
  items: QuoteItem[],
  couponCode: string | undefined,
  redeemKarmaPoints: number,
  shippingCost = 0,
) {
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const itemsKey = JSON.stringify(items);

  useEffect(() => {
    if (!items.length) { setQuote(null); return; }
    const seq = ++seqRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.post<{ success: boolean; quote: CheckoutQuote }>(
          API_ENDPOINTS.CHECKOUT_QUOTE,
          { items, couponCode: couponCode || undefined, redeemKarmaPoints, shippingCost },
        );
        if (seq !== seqRef.current) return; // a newer request superseded this one
        setQuote(res.quote);
        setError(null);
      } catch (err: any) {
        if (seq !== seqRef.current) return;
        setError(err?.message || 'Failed to price cart');
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, couponCode, redeemKarmaPoints, shippingCost]);

  return { quote, loading, error };
}
