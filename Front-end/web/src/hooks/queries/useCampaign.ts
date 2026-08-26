'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  /**
   * Stable machine key for the same refusal ('unverified', 'exhausted', 'already_used',
   * 'not_activated', …). Branch on this, never on `reason` — that one is finished prose
   * meant to be displayed, and matching against it breaks the moment the wording is
   * improved.
   *
   * 'not_activated' means the offer is running and this customer could have it, but they
   * never opened its landing page. It is the ONLY refusal the landing page itself can
   * fix, which is why that page treats it as a prompt to act rather than as bad news.
   */
  reasonCode: string | null;
  /**
   * This campaign only reaches customers who activated it from its landing page.
   *
   * When false — an ordinary public sale — nothing should ever POST an activation, or
   * every shopper who loads the landing page ends up on a roster the campaign never
   * reads.
   */
  requiresActivation: boolean;
  /**
   * Whether THIS customer has activated it. Read together with `requiresActivation` to
   * decide whether to activate, and never inferred from `reasonCode`: an unverified
   * customer is refused for their email long before activation is considered, so the
   * refusal code cannot tell you whether they have been to the landing page.
   *
   * ⚠ Only DETERMINED while the campaign is live and the visitor is signed in. The
   * server refuses an off/unopened/ended/exhausted campaign — and an anonymous visitor —
   * before it reads the activation record, and reports false on those paths without
   * having looked. So never latch UI on `activated === false` alone; pair it with the
   * outcome of the activation call, or a tab left open past the campaign's end will wait
   * for ever on a state the server can no longer report.
   */
  activated: boolean;
  tier: { tierId: string; label: string | null; percent: number; discountPaise: number } | null;
  tiers: CampaignTier[];
  maxDiscountPerOrder: number | null;
  /**
   * Present only on campaigns priced by the PER-PRODUCT ladder, where `tiers` above is
   * empty. A summary, not the ladder: the internal tier codes group the catalogue for
   * operators and mean nothing to a shopper, so only the rates a buyer will actually be
   * charged are published.
   */
  productLadder: {
    /** The best rate any product earns. */
    maxPercent: number;
    /** What everything outside a named tier earns. */
    defaultPercent: number;
    /** The reduced rate on goods already discounted — never the sale AND the full rate. */
    onSaleMaxPercent: number;
  } | null;
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
 * Whether a campaign badge (product card, PDP) should render at all, for THIS user.
 *
 * Requires actual eligibility, not merely the absence of a terminal refusal.
 *
 * It used to be the looser test — show the rate to anyone except those who had already
 * redeemed or arrived after the cap ran out — on the reasoning that a visible discount
 * is what makes signing in worth doing. That reasoning holds for a campaign the whole
 * site is meant to see. It is exactly wrong for one gated on activation: a shopper who
 * signed up through the ordinary registration form would be shown "+8% festive" on every
 * card and then charged full price, which is a bait-and-switch we would have built on
 * purpose.
 *
 * So the rule is now the honest one — advertise the offer only where it will actually be
 * honoured. A campaign with no activation gate is unaffected in practice, because every
 * signed-in verified customer is eligible for it anyway; what changes is that signed-OUT
 * visitors no longer see the rate. For a gated campaign that is the entire point, and the
 * landing page remains free to advertise the ladder to anyone, because that page is
 * reached from the card.
 *
 * Reuses the SAME query as the site-wide `CampaignBanner` (`useCampaign(0)`), so calling
 * this from a product grid costs nothing extra — react-query serves it from cache.
 */
export function useCampaignBadgeVisible(slug: string = ACTIVE_CAMPAIGN_SLUG) {
  const { data: campaign } = useCampaign(0, slug);
  return campaign?.eligible === true;
}

/**
 * Activate the offer on the signed-in customer's account — the landing page's one write.
 *
 * Only ever called from the campaign's landing page, and that is the whole mechanism: the
 * route carries no inbound link, is `noindex`, and is absent from the sitemap, so reaching
 * it means the customer came through the printed card. Everyone who signed up through the
 * ordinary registration form never calls this and never gets the offer.
 *
 * The response is the full eligibility payload, so it is written straight into the shared
 * `me` cache rather than triggering a refetch: the ribbon, the badges and the cart meter
 * all read that one entry and flip to "active" together, off a single round trip.
 *
 * Idempotent server-side, which is what lets the landing page fire it on every visit
 * without tracking whether it has already run.
 */
export function useActivateCampaign(slug: string = ACTIVE_CAMPAIGN_SLUG) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; campaign: CampaignStatus }>(
        API_ENDPOINTS.CAMPAIGN_ACTIVATE(slug),
        {},
      );
      return res.campaign;
    },
    onSuccess: (campaign) => {
      // Seed the zero-cart entry every display surface reads — the ribbon, the badges
      // and the landing page all share it, so they flip to "active" together off this
      // one response.
      queryClient.setQueryData(campaignKeys.me(slug, 0), campaign);

      /*
        Drop the cart-value-keyed entries, whose `tier` was computed while this customer
        was still ineligible — a stale "no discount" meter on a cart that now earns one.

        Explicitly NOT the entry seeded above, which a prefix invalidation would sweep up
        with the rest: it is the one query actually mounted on this page, so invalidating
        it triggers an immediate refetch of the value we were just handed, and the single
        round trip becomes two.
      */
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return key[0] === campaignKeys.all[0]
            && key[1] === 'me'
            && key[2] === slug
            && key[3] !== 0;
        },
      });
    },
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
