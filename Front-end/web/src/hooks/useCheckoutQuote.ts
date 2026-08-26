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
  /** Present only when the applied coupon is a campaign's managed coupon. */
  appliedCampaign: {
    id: string; slug: string; name: string;
    /** All three are null under the PER-PRODUCT ladder — there is no single cart-wide
     *  rung there; each line carries its own rate in `discountLines`. */
    tierId: string | null; tierLabel: string | null; percent: number | null;
  } | null;
  /**
   * Per-line discount breakdown — present only when the applied coupon is priced by a
   * campaign's PER-PRODUCT tier ladder, null otherwise. Server-computed: the browser
   * displays these numbers and never derives them, because money is confirmed by the
   * server before the UI commits to it.
   */
  discountLines: {
    product: string;
    variantId: string | null;
    name: string;
    quantity: number;
    linePaise: number;
    tierCode: string | null;
    tierLabel: string | null;
    percent: number;
    /** The product was already sold below its MRP when the cart was priced. */
    alreadyOnSale: boolean;
    /** True only when being on offer actually REDUCED this line's rate. */
    onSaleCapped: boolean;
    discountPaise: number;
  }[] | null;
  /**
   * What to celebrate, resolved server-side. `catalog` is what the buyer already saves
   * against MRP before any code is typed; `coupon` and `karma` are what the code and
   * their points added. The browser renders these; it never adds them up itself.
   */
  savings: { catalog: number; coupon: number; karma: number; total: number };
  couponError: string | null;
  /**
   * Machine key for the CLASS of coupon refusal — 'campaign' when the applied code
   * belongs to a promotional campaign this customer cannot use, null otherwise.
   *
   * Branch on this, never on `couponError`, which is finished prose. It exists so the
   * cart can tell a refusal the customer can act on (below the minimum, cart too small)
   * from one they cannot — an offer that was never theirs — and quietly drop the latter
   * instead of parking a permanent red error under the promo box.
   */
  couponErrorCode: string | null;
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
  /*
    Which coupon code the CURRENT `quote` was actually priced with.

    Needed because `quote` is deliberately retained across a coupon change — it is not
    cleared while the 350 ms debounce and the request that follows it are in flight, so
    the totals on screen do not flicker to nothing on every keystroke. The consequence is
    that for a moment `quote.couponError` / `couponErrorCode` describe the PREVIOUS code,
    and a caller acting on them would act on the wrong coupon. Anything that makes a
    DECISION from the coupon fields must check this first.
  */
  const [quotedCouponCode, setQuotedCouponCode] = useState<string | null>(null);
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
        setQuotedCouponCode(couponCode || null);
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

  return { quote, quotedCouponCode, loading, error };
}
