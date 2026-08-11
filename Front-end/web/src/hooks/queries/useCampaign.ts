'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, ACTIVE_CAMPAIGN_SLUG } from '@/lib/constants';
import { campaignKeys } from './keys';

/**
 * Per-user campaign eligibility — the one read behind the landing page, the site-wide
 * banner, and the cart savings meter.
 *
 * Display only. The discount itself is recomputed server-side at checkout, so a stale
 * or tampered value here can change what the customer is *shown*, never what they are
 * charged. The response is `no-store, private`; never let it reach a shared cache.
 */

export interface CampaignTier {
  id: string;
  label: string | null;
  minCartValue: number;
  percent: number;
  maxDiscount: number | null;
}

export interface CampaignStatus {
  slug: string;
  name: string;
  endsAt: string | null;
  couponCode: string | null;
  eligible: boolean;
  reason: string | null;
  tier: { tierId: string; label: string | null; percent: number; discountPaise: number } | null;
  tiers: CampaignTier[];
  maxDiscountPerOrder: number | null;
}

export function useCampaign(cartValue = 0, slug: string = ACTIVE_CAMPAIGN_SLUG) {
  return useQuery({
    queryKey: campaignKeys.me(slug, cartValue),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; campaign: CampaignStatus }>(
        `${API_ENDPOINTS.CAMPAIGN_ME(slug)}?cartValue=${cartValue}`,
      );
      return res.campaign;
    },
    /**
     * Off entirely when no campaign is configured.
     *
     * The site-wide banner mounts in the root layout, so without this gate every page
     * view all year round fires an uncacheable per-user request that 404s once the
     * festive period is over. Clearing `ACTIVE_CAMPAIGN_SLUG` removes the request
     * completely rather than merely hiding its result.
     */
    enabled: !!slug,
    // A campaign that is off, or a slug that does not exist, 404s. That is the expected
    // steady state for most of the year, so it must not retry or spam the console.
    retry: false,
    // Long enough that navigating the site does not re-ask on every page, short enough
    // that flipping the campaign off in admin reaches shoppers quickly.
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

/**
 * The next rung of the ladder, for the "add ₹X more to save ₹Y more" nudge.
 *
 * Only ever returns a tier that pays MORE than the current one. Under best-for-customer
 * resolution the discount never falls as a cart grows, so this promise is always
 * truthful — under bracket resolution it would not be, which is why the engine defaults
 * to best-for-customer.
 */
export function nextTier(status: CampaignStatus | undefined, cartValue: number): {
  tier: CampaignTier;
  addRupees: number;
  extraRupees: number;
} | null {
  if (!status?.tiers?.length) return null;

  const discountAt = (value: number) => {
    let best = 0;
    for (const t of status.tiers) {
      if (value < t.minCartValue) continue;
      let d = Math.floor((value * t.percent) / 100);
      if (t.maxDiscount) d = Math.min(d, t.maxDiscount);
      best = Math.max(best, d);
    }
    return status.maxDiscountPerOrder ? Math.min(best, status.maxDiscountPerOrder) : best;
  };

  const current = discountAt(cartValue);
  const upcoming = status.tiers
    .filter((t) => t.minCartValue > cartValue)
    .sort((a, b) => a.minCartValue - b.minCartValue);

  for (const t of upcoming) {
    const extra = discountAt(t.minCartValue) - current;
    if (extra > 0) {
      return { tier: t, addRupees: t.minCartValue - cartValue, extraRupees: extra };
    }
  }
  return null;
}
