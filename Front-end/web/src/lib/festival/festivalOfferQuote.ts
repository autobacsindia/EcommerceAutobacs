import type { CheckoutQuote, FestivalOfferQuoteLine } from '@/hooks/useCheckoutQuote';

/**
 * The SERVER's festival-offer line for a cart line, if the Diwali offer applied to it.
 *
 * Kept out of hooks/useCheckoutQuote.ts on purpose: many page tests replace that module
 * wholesale with a fake hook, and a helper living there would vanish with it.
 */
export function findFestivalOfferLine(
  quote: Pick<CheckoutQuote, 'festivalOfferLines'> | null | undefined,
  productId: string,
  variantId?: string | null,
): FestivalOfferQuoteLine | null {
  return quote?.festivalOfferLines?.find(
    (l) => l.product === productId && (l.variantId ?? null) === (variantId ?? null),
  ) ?? null;
}
