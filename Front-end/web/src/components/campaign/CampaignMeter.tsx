'use client';

import { Gift, TrendingUp } from 'lucide-react';
import { useCampaign, nextTier, campaignCeilingLabel } from '@/hooks/queries/useCampaign';
import { formatSavingInr } from '@/hooks/queries/useCampaignProductRates';

/**
 * Cart savings meter — the emotional engine of the campaign.
 *
 * Shows what the customer is saving right now and what one more step would add. This is
 * only honest because the tier ladder is resolved best-for-customer: the saving can never
 * fall as the cart grows, so "add ₹X more to save ₹Y more" is always a real promise and
 * the bar only ever moves right.
 *
 * Display only. `pricingService` recomputes the discount server-side at checkout, so the
 * figure here can never affect what is charged — it mirrors the quote the cart already
 * holds rather than doing its own money maths.
 *
 * Renders nothing when there is no campaign, the visitor is not eligible, or the cart is
 * empty, so it costs nothing for the rest of the year.
 */
export default function CampaignMeter({
  cartValue,
  appliedDiscount,
}: {
  /** Cart subtotal in rupees. */
  cartValue: number;
  /**
   * The discount the server's quote granted **for this campaign**, in rupees.
   * Callers must pass this ONLY when the quote's applied coupon is the campaign's own
   * (see the cart page) — otherwise an unrelated coupon's discount would be displayed
   * under the campaign's label.
   */
  appliedDiscount?: number | null;
}) {
  const { data: campaign } = useCampaign(Math.round(cartValue));

  if (!campaign?.eligible || cartValue <= 0) return null;

  // Prefer the server's figure, but only when it is a real number the server actually
  // returned for this campaign. `?? ` alone treated a genuine 0 as authoritative and
  // rendered "Festive 20 — You save ₹0" while the tier said otherwise.
  const tierSaving = campaign.tier ? campaign.tier.discountPaise / 100 : 0;
  const saving = typeof appliedDiscount === 'number' && appliedDiscount > 0
    ? appliedDiscount
    : tierSaving;

  // Nothing to celebrate yet — the cart has not reached any tier.
  if (saving <= 0) return null;
  /*
    Keeps the paise where a saving has them. The bag below itemises the same money per
    line, so a summary that rounded while the lines did not would not add up under a
    shopper checking it — the one arithmetic they are most likely to do.
  */
  const inr = (n: number) => formatSavingInr(n);
  // The enforced ceiling, as money. Formatted with this component's own `inr` so the
  // sentence below is written the same way as the figure above it.
  const ceiling = campaignCeilingLabel(campaign, inr);

  /*
    A PER-PRODUCT campaign has no ladder to climb: the rate follows the product, so
    there is no "add ₹X more" and no rung to be at the top of. Everything below that
    describes progress is therefore suppressed for it — `nextTier` reads `tiers`, which
    is empty under this shape, and the cart-ladder branch would otherwise congratulate
    the shopper on having "unlocked the best tier available" when no tier exists and
    nothing they add could change their rate.

    What IS worth saying is how the rate was decided, so a smaller-than-expected saving
    reads as the published rule rather than as a short-change.
  */
  const ladder = campaign.productLadder;
  const next = ladder ? null : nextTier(campaign, cartValue);

  // Progress toward the next rung. With no next rung the customer is already at the
  // top of the ladder, so the bar reads full rather than stalling at some arbitrary point.
  const progress = next
    ? Math.min(100, Math.max(4, (cartValue / (cartValue + next.addRupees)) * 100))
    : 100;

  return (
    <div className="rounded-lg border border-gold/30 bg-gradient-to-br from-gold/10 to-transparent p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift size={16} className="text-gold" />
          <span className="text-sm font-semibold text-gold">
            {/*
                Fixed copy, not `campaign.name`.

                `name` is admin free-text and reads as an operator label — the live one is
                "Festive 2026 — Thank You Reward", which is a title, not something that
                belongs mid-sentence in a cart summary. A cart-value campaign still shows
                its TIER label here, because that one is written to be read by the buyer.
             */}
            {campaign.tier?.label ?? 'Your reward'}
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-zinc-500">You save</p>
          <p className="font-display text-xl font-bold text-emerald-400">{inr(saving)}</p>
        </div>
      </div>

      {/* A bar implies a journey with a far end. There isn't one under a per-product
          ladder, so it would be decoration pretending to be information. */}
      {!ladder && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold/60 to-gold transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {ladder ? (
        /*
          The rate ladder used to be spelled out here — 8% / 4% / 2%. It is the rule, not
          the outcome, and the outcome is already sitting directly above in rupees, per
          line in the bag below, and on every card that got the shopper here. Quoting
          three percentages beside a rupee figure only invites the shopper to check our
          arithmetic; the ceiling, where one is configured, is the one extra fact worth
          adding because it bounds what the number above can ever become.
        */
        <p className="mt-2.5 text-xs text-zinc-400">
          {ceiling && (
            <>
              <span className="font-semibold text-white">
                {ceiling.charAt(0).toUpperCase() + ceiling.slice(1)}
              </span>
              {' — '}
            </>
          )}
          Applied for you, no code to enter. Each item&apos;s share is shown beside it in
          your bag.
        </p>
      ) : next ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-zinc-400">
          <TrendingUp size={12} className="text-gold" />
          Add <span className="font-semibold text-white">{inr(next.addRupees)}</span> more to save
          <span className="font-semibold text-emerald-400"> {inr(next.extraRupees)}</span> extra
        </p>
      ) : (
        <p className="mt-2.5 text-xs text-zinc-400">
          You&apos;ve unlocked the best tier available. Applied automatically at checkout.
        </p>
      )}
    </div>
  );
}
