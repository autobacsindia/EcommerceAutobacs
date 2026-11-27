'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { clearPendingCoupon, readPendingCoupon } from '@/lib/pendingCoupon';

type CartLike = {
  couponCode?: string | null;
  items?: { product?: { _id?: string } | null; variantId?: string | null; quantity: number }[];
} | null | undefined;

type ApplyCoupon = (code: string) => Promise<{ discountApplied: boolean; message?: string }>;

/**
 * Apply a coupon a landing page handed the shopper (see lib/pendingCoupon), so a
 * cardholder never has to find the coupon box.
 *
 * - Never overwrites a coupon already on the cart — the shopper chose that one.
 * - Signed-in only: the card coupon is once per customer, which the server counts per
 *   account, so a guest attempt is a guaranteed "please log in" refusal.
 * - One attempt per cart contents. A refusal (no Hilux parts yet, under the minimum,
 *   already used) is quiet and the code stays pending; adding a qualifying part changes
 *   the contents and earns one more try. No loop, no error toast for a bonus the
 *   shopper did not ask for here.
 * - Cleared once the server has actually taken money off, or once it sits on the cart.
 *
 * Money is untouched: applyCoupon goes through the normal endpoint and the server
 * re-checks the code at checkout.
 */
export function usePendingCouponAutoApply(
  cart: CartLike,
  isAuthenticated: boolean,
  applyCoupon: ApplyCoupon,
) {
  const triedRef = useRef<string | null>(null);
  const items = cart?.items ?? [];
  const contentsKey = items
    .map((i) => `${i.product?._id ?? ''}:${i.variantId ?? ''}:${i.quantity}`)
    .sort()
    .join('|');
  const cartCoupon = cart?.couponCode ?? null;

  useEffect(() => {
    if (!isAuthenticated || !contentsKey) return;
    const pending = readPendingCoupon();
    if (!pending) return;
    if (cartCoupon) {
      if (cartCoupon.toUpperCase() === pending) clearPendingCoupon();
      return;
    }
    const attempt = `${pending}#${contentsKey}`;
    if (triedRef.current === attempt) return;
    triedRef.current = attempt;

    applyCoupon(pending)
      .then(({ discountApplied }) => {
        if (!discountApplied) return;
        clearPendingCoupon();
        toast.success(`${pending} applied`);
      })
      .catch(() => {
        /* refused for this cart — stays pending for the next change */
      });
  }, [isAuthenticated, contentsKey, cartCoupon, applyCoupon]);
}
