'use client';

import Link from 'next/link';
import { Gift, CheckCircle2 } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { useCampaign, campaignCeilingLabel } from '@/hooks/queries/useCampaign';

/**
 * Whether the offer is on this bag — said out loud, in the summary.
 *
 * The gap this closes: a shopper cannot tell a working offer from a broken one by
 * looking at a total. A signed-out visitor saw no discount line and no explanation, and
 * had no way to know that signing in was worth ₹10,000. Someone signed in saw a discount
 * appear with nothing naming it. Both read as "did that apply?".
 *
 * So this states the answer in every case, and — where the answer is "not yet" — states
 * the one action that changes it. It reports the SERVER's outcome (`applied` comes from
 * the quote's appliedCampaign) rather than re-deriving eligibility, so it can never claim
 * a discount the pricing engine did not grant.
 */
export default function CampaignCartNotice({
  applied,
  discount,
  cartValue,
}: {
  /** True only when the server's quote actually priced this campaign onto the bag. */
  applied: boolean;
  /** Rupees the campaign took off, from that same quote. */
  discount: number;
  /** Subtotal of this bag, in rupees — used only to refuse an absurd headline. */
  cartValue: number;
}) {
  const { formatPrice } = useCurrency();
  const { data: campaign } = useCampaign(0);

  // No campaign configured, or it is off/over — say nothing at all.
  if (!campaign) return null;

  if (applied && discount > 0) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
        <p className="text-[13px] text-ink">
          <span className="font-semibold text-emerald-400">Offer applied</span> — you
          are saving <span className="font-semibold">{formatPrice(discount, { exact: true })}</span> on this bag.
        </p>
      </div>
    );
  }

  /*
    An offer this customer was never given — say nothing at all.

    Checked before the per-reason branches below because two of them would otherwise
    make a promise we cannot keep. A signed-out visitor gets 'login' and would be told
    "sign in to apply it"; an unverified one gets 'unverified' and would be told to
    confirm their email. Both are true instructions for an open campaign and both are
    lies for a gated one — doing either lands them back on this cart with no discount
    and no explanation, which is worse than never having mentioned it.

    Kept BELOW the applied branch on purpose: `applied` comes from the server's own
    quote, so if the campaign really did price this bag, confirming it always wins over
    any reasoning we do here.
  */
  if (campaign.requiresActivation && !campaign.activated) return null;

  /*
    Not applied. Which of these it is decides what we ask them to do — and two of them
    are dead ends where any prompt would be a lie, so those stay silent.
  */
  /*
    The offer as MONEY, never as a rate. `campaignCeilingLabel` reads the ceiling
    pricingService actually enforces, so "up to ₹1,87,000 off" is true by construction.
    When no ceiling is configured it returns null and the sentence simply names the offer
    — a campaign with no cap has no honest rupee maximum, and falling back to "up to 8%
    off" would put the shopper straight back to doing the arithmetic themselves.
  */
  /*
    The ceiling is an ORDER-WIDE cap, and this is the one surface that knows how big the
    order actually is. "Up to ₹50,000 off" beside a ₹2,000 bag is not merely optimistic —
    the shopper can see it is impossible, and a number they can disprove at a glance
    discredits the offer rather than selling it. So the figure is withheld once it
    exceeds what the bag could possibly earn, and the sentence names the offer instead.

    A comparison of two server-published numbers, not a derivation: nothing here works
    out what the discount would be.
  */
  const rawCeiling = campaignCeilingLabel(campaign, (v) => formatPrice(v, { exact: true }));
  const reachable =
    typeof campaign.maxDiscountPerOrder === 'number' && campaign.maxDiscountPerOrder <= cartValue;
  const ceiling = reachable ? rawCeiling : null;
  const headline = ceiling ?? 'a discount';

  if (campaign.reasonCode === 'already_used' || campaign.reasonCode === 'exhausted') return null;

  if (campaign.reasonCode === 'login') {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-gold/30 bg-gold/10 px-3 py-2.5">
        <Gift size={15} className="shrink-0 text-gold" />
        <p className="text-[13px] text-ink">
          <span className="font-semibold text-gold">Offer — {headline}</span> on this bag.
        </p>
        <Link
          href={`/login?redirect=${encodeURIComponent('/cart')}`}
          className="text-[13px] font-semibold text-gold underline underline-offset-2"
        >
          Sign in to apply it
        </Link>
      </div>
    );
  }

  if (campaign.reasonCode === 'unverified') {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
        <Gift size={15} className="shrink-0 text-amber-400" />
        <p className="text-[13px] text-ink">
          <span className="font-semibold text-amber-300">Offer — {headline}</span> is
          waiting on your account.
        </p>
        <Link href="/verify-email" className="text-[13px] font-semibold text-amber-300 underline underline-offset-2">
          Confirm your email to apply it
        </Link>
      </div>
    );
  }

  /*
    Eligible, but the server did not price it onto this bag — the auto-apply has not
    landed, or failed. Previously this was completely silent, which is precisely how a
    correctly configured live campaign came to look broken. Saying the offer exists is
    honest whatever the cause, and the code is printed on the card as a fallback.
  */
  if (campaign.eligible) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded border border-gold/30 bg-gold/10 px-3 py-2.5">
        <Gift size={15} className="mt-0.5 shrink-0 text-gold" />
        <p className="text-[13px] text-ink">
          <span className="font-semibold text-gold">Your offer is active</span>
          {ceiling ? ` — ${ceiling}.` : '.'}{' '}
          If it has not applied below, enter{' '}
          <span className="font-semibold">{campaign.couponCode}</span> in the promo box.
        </p>
      </div>
    );
  }

  return null;
}
