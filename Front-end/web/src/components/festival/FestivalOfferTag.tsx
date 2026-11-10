import { totalSavingFromMrp, type FestivalOfferResult } from '@/lib/festival/festivalOffer';

/**
 * "🪔 Diwali offer −3% · Before Diwali ₹1,12,500 · You save ₹3,375" — the line every
 * price surface shows beside the Diwali price. The Diwali price itself (the big number)
 * and the M.R.P. strike-through stay with the caller, exactly as before the offer.
 *
 * Purely presentational and hook-free: the caller passes the offer it already resolved
 * (useFestivalOfferPrice on cards/PDP, the server quote's festivalOfferLines in cart and
 * checkout) and ITS OWN money formatter — the storefront's currency-aware formatPrice,
 * or checkout's INR-only formatRupees. Renders nothing when there is no offer.
 */
export default function FestivalOfferTag({
  offer,
  formatMoney,
  className = '',
  compact = false,
  mrp = null,
}: {
  offer: Pick<FestivalOfferResult, 'percent' | 'discount' | 'basePrice'> | null | undefined;
  /** Must keep paise (exact) — a rounded-up saving is a promise the cart then breaks. */
  formatMoney: (rupees: number) => string;
  className?: string;
  /** Badge only — for tight tiles. */
  compact?: boolean;
  /**
   * The M.R.P. shown struck through beside the price, when there is one. "You save" is
   * then the whole saving against it (sale + Diwali), not just the Diwali part.
   */
  mrp?: number | null;
}) {
  if (!offer) return null;
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold ${className}`}
      data-testid="festival-offer-tag"
    >
      <span className="rounded bg-[#b4231a] px-1.5 py-0.5 text-[#fff]">
        <span aria-hidden="true">🪔 </span>Diwali offer −{offer.percent}%
      </span>
      {!compact && (
        <span className="font-normal text-ink-muted">
          Before Diwali <s>{formatMoney(offer.basePrice)}</s>
          {' · '}
          <span className="font-semibold text-emerald-600">You save {formatMoney(totalSavingFromMrp(offer, mrp))}</span>
        </span>
      )}
    </span>
  );
}
