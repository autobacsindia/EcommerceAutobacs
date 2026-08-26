'use client';

import { Gift } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { useCampaignBadgeVisible } from '@/hooks/queries/useCampaign';
import { useCampaignProductRates, lineSavings } from '@/hooks/queries/useCampaignProductRates';

/**
 * "Save ₹1,840 more on this item" — the campaign, on the product page.
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
 * Stated in RUPEES, never as the rate. The rate is the rule; the amount is the answer,
 * and it is the only one of the two a shopper can weigh against the price beside it.
 *
 * ── Only where the discount will actually be honoured ─────────────────────────
 *
 * This used to render for signed-OUT visitors too, on the reasoning that a visible rate
 * is what makes signing in worth doing. That holds for an offer the whole site is meant
 * to have. It is exactly wrong for one gated on activation, where the people who would
 * see the badge and then be charged full price are the majority — anyone who registered
 * through the ordinary form rather than through the printed card.
 *
 * So the badge now follows eligibility, via the same `useCampaignBadgeVisible` rule every
 * listing uses. A promise made on a product page has to survive to the invoice.
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
  const { data: rates } = useCampaignProductRates([productId]);
  const visible = useCampaignBadgeVisible();

  const rate = rates?.rates?.[productId];
  if (!rate || rate.percent <= 0) return null;
  if (!visible) return null;

  const { campaign: saving } = lineSavings({ price, originalPrice, quantity: 1, percent: rate.percent });
  if (saving <= 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-gold/30 bg-gold/10 px-3 py-2 text-[13px] ${className}`}
    >
      <Gift size={14} className="shrink-0 text-gold" />
      <span className="text-ink">
        <span className="font-semibold text-gold">Save {formatPrice(saving, { exact: true })} more</span> on this
        item — applied for you at checkout
      </span>
      {rate.onSaleCapped && (
        /* Said here rather than discovered at the cart. This item is already discounted,
           so the offer adds a reduced rate on top; a shopper who expects the headline
           rate and is charged less reads the gap as being short-changed. */
        <span className="text-[11px] text-ink-muted">already on offer, so this is the added rate</span>
      )}
    </div>
  );
}
