'use client';

import { Gift } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { useCampaign } from '@/hooks/queries/useCampaign';
import { useCampaignProductRates, lineSavings } from '@/hooks/queries/useCampaignProductRates';

/**
 * "Save 8% on this with the festive offer" — the campaign, on the product page.
 *
 * The reason this exists: the whole scheme used to be invisible until a coupon
 * auto-applied on /cart. A shopper browsing a Thanos product saw nothing anywhere, and a
 * single silent failure in that auto-apply was indistinguishable from a campaign that
 * had been switched off. A discount nobody can see does not sell anything.
 *
 * ── Two questions, kept apart on purpose ───────────────────────────────────────
 *
 * WHAT rate this product earns is a property of the catalogue and the ladder, identical
 * for everyone, and comes from the shared/cacheable product-rates endpoint. WHETHER to
 * show it is per-user, and comes from the private eligibility call the page already
 * makes. Keeping them separate is what lets the expensive-to-cache half stay small.
 *
 * Shown to signed-OUT visitors deliberately: the offer is public, the card is printed,
 * and a rate on the page is the thing that makes signing in worth doing. What it must
 * never do is promise a rate to someone who cannot have it — a shopper who has already
 * redeemed, or an offer fully claimed, sees nothing rather than a tease.
 */
export default function CampaignRateBadge({
  productId,
  price,
  originalPrice,
  className = '',
}: {
  productId: string;
  /** The price actually charged for the selected unit — the variant's, where one is picked. */
  price: number;
  originalPrice?: number | null;
  className?: string;
}) {
  const { formatPrice } = useCurrency();
  const { data: campaign } = useCampaign(0);
  const { data: rates } = useCampaignProductRates([productId]);

  const rate = rates?.rates?.[productId];
  if (!rate || rate.percent <= 0) return null;

  /*
    Refusals that mean "this person will never get it", as opposed to "not yet".
    'login' and 'unverified' are both fixable in a minute, so those shoppers still see
    the rate — it is the reason to bother. 'already_used' and 'exhausted' are terminal,
    and advertising a discount to someone the checkout will refuse is a broken promise
    dressed as marketing.
  */
  const terminal = campaign?.reasonCode === 'already_used' || campaign?.reasonCode === 'exhausted';
  if (terminal) return null;

  const { campaign: saving } = lineSavings({ price, originalPrice, quantity: 1, percent: rate.percent });
  if (saving <= 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-gold/30 bg-gold/10 px-3 py-2 text-[13px] ${className}`}
    >
      <Gift size={14} className="shrink-0 text-gold" />
      <span className="text-ink">
        <span className="font-semibold text-gold">Save {rate.percent}% more</span> with the
        festive offer — <span className="font-semibold">{formatPrice(saving)}</span> off this item
      </span>
      {rate.onSaleCapped && (
        /* Said here rather than discovered at the cart. This item is already discounted,
           so the offer adds a reduced rate on top; a shopper who expects the headline
           rate and is charged less reads the gap as being short-changed. */
        <span className="text-[11px] text-ink-muted">already on offer, so this is the added rate</span>
      )}
      {!campaign?.eligible && (
        <span className="text-[11px] text-ink-muted">
          {campaign?.reasonCode === 'unverified' ? 'confirm your email to claim it' : 'sign in to claim it'}
        </span>
      )}
    </div>
  );
}
