'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, ACTIVE_CAMPAIGN_SLUG } from '@/lib/constants';
import { campaignKeys } from './keys';

/**
 * What rate each product earns under the running campaign.
 *
 * Exists so a shopper learns the discount on the PRODUCT PAGE. Before it, the campaign
 * was invisible until a coupon auto-applied on the cart — which made a single silent
 * failure there, or simply never opening the cart, indistinguishable from a campaign
 * that was switched off.
 *
 * Identity-free and therefore shared: every shopper gets the same answer for the same
 * product, so this caches broadly. The per-user question — may THIS person still claim
 * it — belongs to `useCampaign`, which stays private and uncached.
 *
 * Returns null when nothing is running, so a caller renders nothing without branching
 * on an error.
 */

export interface ProductRate {
  /** What this product earns, already reduced to the on-sale ceiling where that applies. */
  percent: number;
  /** True only when being on offer actually REDUCED the rate — never for a tier already at or under the ceiling. */
  onSaleCapped: boolean;
}

interface ProductRates {
  slug: string;
  endsAt: string | null;
  rates: Record<string, ProductRate>;
}

/**
 * Mirrors `MAX_RATE_LOOKUP` in `Back-end/server/services/campaignService.js` — the
 * server only ever reads this many ids off the query string. Capping here too matters
 * beyond just avoiding wasted lookups: the route's `ids` validator rejects the whole
 * request past 2000 characters, and a `showAll=true` product grid can hand this hook
 * 500 ids (~12,500 chars uncapped) — that would 400 the request and blank out every
 * badge on the page, not just the ones past the server's cap.
 */
const MAX_RATE_LOOKUP_IDS = 60;

export function useCampaignProductRates(
  productIds: string[],
  slug: string = ACTIVE_CAMPAIGN_SLUG,
) {
  const ids = [...new Set(productIds.filter(Boolean))].slice(0, MAX_RATE_LOOKUP_IDS);

  return useQuery({
    queryKey: campaignKeys.productRates(slug, ids),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; campaign: ProductRates | null }>(
        `${API_ENDPOINTS.CAMPAIGN_PRODUCT_RATES(slug)}?ids=${encodeURIComponent(ids.join(','))}`,
      );
      return res.campaign;
    },
    // Off entirely when there is no campaign configured, or nothing to ask about — the
    // hook mounts on every product page, so it must cost nothing for most of the year.
    enabled: !!slug && ids.length > 0,
    // A campaign that is off, or a slug that does not exist, answers null rather than
    // erroring; a genuine network failure must not retry on a decorative badge.
    retry: false,
    // Longer than `me`: this answer changes only when an admin edits the ladder or moves
    // products between tiers, not as the shopper does anything.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}

/**
 * What a shopper saves on ONE line, split by where the saving comes from.
 *
 * Mirrors the server's arithmetic exactly — integer paise, floored, same as
 * `lineDiscountPaise` — because a browser figure that disagreed with the amount actually
 * charged is the sort of discrepancy a customer screenshots. Both inputs are
 * server-published (the price from the catalogue, the rate from the campaign); nothing
 * here is invented client-side.
 */
export function lineSavings({
  price,
  originalPrice,
  quantity,
  percent,
}: {
  price: number;
  originalPrice?: number | null;
  quantity: number;
  /** Omit or pass 0 when the shopper cannot claim the campaign — an ineligible visitor is promised nothing. */
  percent?: number | null;
}): { catalog: number; campaign: number; total: number } {
  const qty = Math.max(1, Math.floor(quantity) || 1);
  const linePaise = Math.round(price * 100) * qty;

  const catalogPaise =
    typeof originalPrice === 'number' && originalPrice > price
      ? (Math.round(originalPrice * 100) - Math.round(price * 100)) * qty
      : 0;

  const pct = Math.max(0, Number(percent) || 0);
  const campaignPaise = pct > 0 ? Math.min(linePaise, Math.floor((linePaise * pct) / 100)) : 0;

  return {
    catalog: catalogPaise / 100,
    campaign: campaignPaise / 100,
    total: (catalogPaise + campaignPaise) / 100,
  };
}

/**
 * "+₹1,840 off" — one product's campaign saving, written once for every card that shows it.
 *
 * The wording lives here rather than in each card because that is exactly how the
 * add-to-cart toast came to say four different things on four surfaces (see
 * `useAddedToCartToast`). Four grids quoting the same offer in three phrasings is the
 * same defect one step earlier in the funnel.
 *
 * ── Why a card may show money to someone who cannot yet claim it ────────────────
 *
 * This is an ADVERTISED offer, not a banked saving. `useCampaignBadgeVisible` decides who
 * sees it at all; what this must never do is state the figure as already won — which is
 * why the toast keeps its own, stricter eligibility gate and this does not duplicate it.
 *
 * ── The `from` case ────────────────────────────────────────────────────────────
 *
 * A variable product's card prices the CHEAPEST variant ("From ₹23,000"), so its saving is
 * a floor, not a figure: pick a dearer model and the discount is larger. Stating the floor
 * flatly would be quietly wrong on every variant but one, so the label borrows the card's
 * own "from" vocabulary rather than inventing a second way to say the same thing.
 *
 * Returns null below `MIN_ADVERTISED_SAVING`, so a caller renders nothing without branching.
 */

/**
 * The smallest saving worth putting a badge on a card for.
 *
 * A rate applied to a cheap accessory can resolve to 40 paise. Rendered, that was
 * "+₹0 off" — a badge drawing the eye to nothing — and it stays silly at "+₹0.40 off".
 * Below a rupee the offer is not a reason to buy, so the card says nothing rather than
 * spending its most valuable pixels on it.
 *
 * Deliberately an ADVERTISING threshold, not an accounting one: the cart still itemises
 * every paise (see `CartLineDiscount`), because there the figures have to sum.
 */
export const MIN_ADVERTISED_SAVING = 1;

/**
 * Rupee formatter for the two cross-sell rails that predate CurrencyContext and render
 * their own prices inline.
 *
 * Exists so those rails cannot round a saving differently from the cards around them —
 * keeping paise where they exist, exactly like `formatPrice(v, { exact: true })`. Not a
 * rival to CurrencyContext: it is the same rule, written once, for the two call sites
 * that have no provider to ask. Anything with access to `useCurrency` uses that instead.
 */
export function formatSavingInr(value: number): string {
  const hasPaise = Math.round(value * 100) % 100 !== 0;
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  })}`;
}

export function campaignSavingLabel({
  saving,
  formatPrice,
  from = false,
}: {
  /** Rupees, as produced by `lineSavings().campaign`. */
  saving: number;
  /**
   * The page's own formatter, so a saving is written like every other figure on it.
   *
   * Callers MUST pass one that keeps paise (`formatPrice(v, { exact: true })`). The
   * default INR formatting rounds to whole rupees and rounds UP — a line charged ₹29.97
   * off would advertise "₹30 off", and the cart would then contradict the card. The
   * whole point of showing money instead of a rate is that the two agree.
   */
  formatPrice: (value: number) => string;
  /** True when `saving` was computed from a "From" price and is therefore a floor. */
  from?: boolean;
}): string | null {
  if (!(saving >= MIN_ADVERTISED_SAVING)) return null;
  // The leading '+' reads as "on top of what you already see", which is what separates
  // this from the catalogue's own markdown badge sitting directly above it.
  const amount = `+${formatPrice(saving)} off`;
  return from ? `From ${amount}` : amount;
}
