'use client';

import { useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { useCurrency } from '@/context/CurrencyContext';
import { useCampaign } from '@/hooks/queries/useCampaign';
import { lineSavings } from '@/hooks/queries/useCampaignProductRates';

/**
 * The one add-to-cart confirmation toast, for every surface that adds to the cart.
 *
 * Exists because the savings-aware wording ("you saved ₹X") was written once on the PDP
 * buy box and then silently diverged: every card, rail and sticky bar kept its own
 * hand-written `toast.success('Added to cart')`, so the same product added from a
 * listing congratulated the shopper on nothing while the PDP congratulated them
 * properly. Duplicated copy is how that drifted; one hook is how it stops.
 *
 * DISPLAY ONLY. Nothing here decides what anybody is charged — the cart recomputes
 * every total server-side. But a figure shown here that the cart then contradicts is
 * the kind of discrepancy a customer screenshots, so it uses the server's own numbers
 * (catalogue price, published campaign rate) and the server's own arithmetic
 * (`lineSavings`, which floors paise exactly like `lineDiscountPaise` does).
 */

export interface AddedToCartLine {
  /** The price actually being added — the VARIANT's price for a variable product. */
  price: number;
  /** The "was" price, when this line is already discounted in the catalogue. */
  originalPrice?: number | null;
  /** Defaults to 1 — every card-level quick-add. */
  quantity?: number;
  /**
   * This product's rate under the running campaign, as published by
   * `useCampaignProductRates`. Pass it raw: eligibility is applied here, once, so no
   * call site can forget it.
   */
  campaignPercent?: number | null;
}

export function useAddedToCartToast() {
  const { formatPrice } = useCurrency();
  // Same query key as the site-wide banner and every campaign badge
  // (`campaignKeys.me(slug, 0)`), so this is a cache read on every surface that
  // already renders one — including a grid of cards, which share the single entry.
  const { data: campaignStatus } = useCampaign(0);
  const eligible = !!campaignStatus?.eligible;

  return useCallback(
    ({ price, originalPrice, quantity = 1, campaignPercent = 0 }: AddedToCartLine) => {
      const qty = Math.max(1, Math.floor(quantity) || 1);
      /*
        The catalogue half of the saving is true for ANYONE, so it always counts. The
        campaign half counts only when this shopper can actually claim it.

        The gate stays here even though `useCampaignBadgeVisible` now hides the badge
        from everyone ineligible, so callers "should" only ever pass a rate to someone
        who has it. Callers pass the rate RAW by contract — that is the whole point of
        this hook — and several do so without consulting the badge rule at all (the
        wishlist and the sticky bar both read the rates hook directly). One of them
        forgetting is a rupee figure claimed as banked and then contradicted by the
        cart, so eligibility is applied once, here, where no call site can skip it.
      */
      const saved = lineSavings({
        price,
        originalPrice,
        quantity: qty,
        percent: eligible ? campaignPercent : 0,
      });

      toast.success(
        saved.total > 0
          ? `Added to cart — you saved ${formatPrice(saved.total)} 🎉`
          : qty > 1
            ? `Added ${qty} to cart`
            : 'Added to cart',
      );
    },
    [eligible, formatPrice],
  );
}
