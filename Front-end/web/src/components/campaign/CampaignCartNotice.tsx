'use client';

import Link from 'next/link';
import { Gift, CheckCircle2 } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { useCampaign } from '@/hooks/queries/useCampaign';

/**
 * Whether the festive offer is on this bag — said out loud, in the summary.
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
}: {
  /** True only when the server's quote actually priced this campaign onto the bag. */
  applied: boolean;
  /** Rupees the campaign took off, from that same quote. */
  discount: number;
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
          <span className="font-semibold text-emerald-400">Festive offer applied</span> — you
          are saving <span className="font-semibold">{formatPrice(discount)}</span> on this bag.
        </p>
      </div>
    );
  }

  /*
    Not applied. Which of these it is decides what we ask them to do — and two of them
    are dead ends where any prompt would be a lie, so those stay silent.
  */
  const ladder = campaign.productLadder;
  const headline = ladder ? `up to ${ladder.maxPercent}% off` : 'a festive discount';

  if (campaign.reasonCode === 'already_used' || campaign.reasonCode === 'exhausted') return null;

  if (campaign.reasonCode === 'login') {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-gold/30 bg-gold/10 px-3 py-2.5">
        <Gift size={15} className="shrink-0 text-gold" />
        <p className="text-[13px] text-ink">
          <span className="font-semibold text-gold">Festive offer — {headline}</span> on this bag.
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
          <span className="font-semibold text-amber-300">Festive offer — {headline}</span> is
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
          <span className="font-semibold text-gold">Your festive offer is active</span> — {headline}.
          If it has not applied below, enter{' '}
          <span className="font-semibold">{campaign.couponCode}</span> in the promo box.
        </p>
      </div>
    );
  }

  return null;
}
