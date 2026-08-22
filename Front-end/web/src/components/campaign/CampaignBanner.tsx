'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gift, X } from 'lucide-react';
import { useCampaign } from '@/hooks/queries/useCampaign';
import { useRewardRibbonClaimsSlot } from '@/hooks/useRewardRibbon';

/**
 * Site-wide reward ribbon for an eligible campaign customer.
 *
 * Load-bearing for this campaign's flow, not decoration: most invited customers arrive
 * by clicking a set-password link in an email, which lands them on the claim page rather
 * than back on the landing page. Without a persistent reminder they would be signed in
 * and eligible with nothing on screen saying so. The ribbon is what reconnects them to
 * the offer wherever they end up.
 *
 * Hidden on admin screens, on the cart (the savings meter already says it better, and
 * two competing reward callouts is noise), and once dismissed for the session.
 *
 * Where it renders, it also OUTRANKS the promotional image strip (PromoBanner) —
 * that precedence lives in useRewardRibbonClaimsSlot() so both components read one
 * rule rather than each guessing at the other's visibility.
 */
export default function CampaignBanner({
  inHomeSlot = false,
  className = '',
}: {
  /**
   * Rendered by the home page into its own strip slot, rather than by the root layout.
   *
   * The home page's nav is `position: fixed` and its strip is an overlay pinned inside
   * the hero's scroll track, so the layout's copy landed at the top of the document
   * UNDERNEATH that bar — invisible, while its flow height still pushed the page down.
   * Home also mounts PromoBanner itself, bypassing the route gate that makes this
   * ribbon outrank it, so both bars appeared at once. See ConditionalPromoBanner.
   */
  inHomeSlot?: boolean;
  className?: string;
} = {}) {
  const [dismissed, setDismissed] = useState(false);
  const { data: campaign } = useCampaign(0);
  const claimsSlot = useRewardRibbonClaimsSlot();
  const pathname = usePathname();

  // Trailing slash normalised, as everywhere else — next.config.ts sets
  // `skipTrailingSlashRedirect`, so an exact match would miss '/'.
  const path = pathname?.replace(/\/+$/, '') || '/';
  // Exactly one of the two mounts renders on the home page.
  if (path === '/' && !inHomeSlot) return null;

  // `campaign` is redundant with claimsSlot at runtime (it only claims the slot
  // when the campaign is eligible) but keeps the type narrowed for the tier maths.
  if (!claimsSlot || dismissed || !campaign) return null;

  /*
    Two campaign shapes, two honest sentences.

    Under the CART-VALUE ladder a bigger basket really does earn a better rate, so
    "add items and your saving grows" is a true promise. Under the PER-PRODUCT ladder
    it is not — the rate follows the product, and a shopper who adds ₹20,000 of default
    -tier goods expecting the headline rate has been misled by the banner rather than
    by anything the server did. Money copy is held to the same standard as money maths.
  */
  const ladder = campaign.productLadder;
  const topPercent = ladder
    ? ladder.maxPercent
    : campaign.tiers?.length
      ? Math.max(...campaign.tiers.map((t) => t.percent))
      : null;

  const ribbon = (
    <div className="relative bg-gradient-to-r from-gold/20 via-gold/10 to-transparent border-b border-gold/25">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 text-sm">
        <Gift size={15} className="shrink-0 text-gold" />
        <p className="flex-1 text-ink/90">
          <span className="font-semibold text-gold">Your festive reward is active.</span>{' '}
          <span className="hidden sm:inline">
            {topPercent ? `Up to ${topPercent}% off — ` : ''}
            {ladder
              ? 'applied automatically at checkout.'
              : 'add items and your saving grows.'}
          </span>
        </p>
        <Link href="/products" className="shrink-0 font-medium text-gold underline-offset-2 hover:underline">
          Shop now
        </Link>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss reward banner"
          className="shrink-0 rounded p-1 text-ink/40 transition hover:text-ink/80"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );

  /*
    In the home slot the ribbon goes INSIDE a wrapper carrying the slot class, rather
    than wearing that class itself. The slot owns placement — overlay positioning on
    desktop, nav clearance on mobile, an opaque ground — and folding those onto the
    ribbon's own element is what made it render differently there than everywhere else.

    The wrapper lives here rather than in HomeRedesign so that a dismissed or
    ineligible ribbon leaves no empty slot behind: on mobile that div is in flow and
    would show as an unexplained gap under the nav.
  */
  return inHomeSlot ? <div className={className}>{ribbon}</div> : ribbon;
}
