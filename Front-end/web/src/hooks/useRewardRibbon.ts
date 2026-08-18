'use client';

import { usePathname } from 'next/navigation';
import { useCampaign } from '@/hooks/queries/useCampaign';

/**
 * Does the campaign reward ribbon own the slot under the nav right now?
 *
 * Two different bars want that space — the reward ribbon (CampaignBanner) and the
 * promo image strip (PromoBanner) — and stacking both pushes the page down while
 * splitting attention across two competing offers. The reward ribbon wins,
 * because it is load-bearing rather than decorative: most invited customers land
 * on a claim page from an email, and the ribbon is the only thing on screen
 * telling them the discount is active. The image strip is marketing that can wait
 * for the next page view.
 *
 * The rule lives here, in one place, so the two components cannot drift into
 * disagreeing about who is showing (which would mean either two bars or none).
 *
 * NOTE: dismissal is deliberately NOT part of this. The ribbon keeps the slot
 * even after a shopper closes it — otherwise dismissing one bar would pop a
 * different one into the space it just vacated, which reads as a bug.
 *
 * Costs nothing extra: `useCampaign` is a TanStack Query hook, so both callers
 * share one cache entry and one request.
 */
export function useRewardRibbonClaimsSlot(): boolean {
  const pathname = usePathname();
  const { data: campaign } = useCampaign(0);

  // Trailing slash normalised — next.config.ts sets `skipTrailingSlashRedirect`,
  // so '/cart/' is served verbatim and an exact match would miss it.
  const path = pathname?.replace(/\/+$/, '') || '/';

  const suppressed =
    path.startsWith('/admin') || path === '/cart' || path === '/festive';

  return !suppressed && !!campaign?.eligible;
}
