'use client';

import { useCurrency } from '@/context/CurrencyContext';
import type { CheckoutQuote } from '@/hooks/useCheckoutQuote';

/**
 * What ONE line in the bag earns from the applied coupon, in rupees.
 *
 * Shown per line because a cart can hold several different rates at once — that is the
 * whole point of the per-product ladder — so a single cart-wide figure would leave the
 * shopper unable to tell which item earned what.
 *
 * ── Why rupees and not the rate ────────────────────────────────────────────────
 *
 * This used to read "3% off with FEST26". A percentage next to a price is a sum the
 * shopper has to do themselves, and the answer they arrive at is the number they will
 * compare against the total. Printing the amount the server already computed removes
 * both the arithmetic and any chance of the two disagreeing.
 *
 * Every figure comes straight off `quote.discountLines`, which pricingService resolved
 * in integer paise. The browser neither derives a rate nor derives an amount.
 */
export default function CartLineDiscount({
  quote,
  productId,
  variantId,
}: {
  quote: CheckoutQuote | null;
  productId: string;
  variantId?: string | null;
}) {
  const { formatPrice } = useCurrency();

  const line = quote?.discountLines?.find(
    (l) => l.product === productId && (l.variantId ?? null) === (variantId ?? null),
  );

  /*
    Gated on `discountPaise`, not on `percent`.

    Once the order-wide ceiling bites, apportionCap can reduce a line to zero while its
    tier rate still reads 8%. The old `percent > 0` test would print a discount beside a
    line that was discounted by nothing — the sort of gap that becomes a support ticket.
  */
  if (!line || line.discountPaise <= 0) return null;

  return (
    <p className="text-[11px] font-display mt-1 text-gold/80">
      {formatPrice(line.discountPaise / 100, { exact: true })} off with {quote?.appliedCoupon?.code}
      {line.onSaleCapped && (
        /* Already discounted, so the coupon adds a reduced rate rather than its full
           one. Said here, next to the item, not only in the popup they may dismiss. */
        <span className="text-amber-500/90">
          {' '}— already on offer, so this is the added rate
        </span>
      )}
    </p>
  );
}
