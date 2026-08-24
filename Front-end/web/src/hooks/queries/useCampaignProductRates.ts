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
