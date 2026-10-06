/**
 * Typo guard for the offer price.
 *
 * The server already refuses anything outside ₹1…catalogue price, so this is not
 * a security boundary — a sales member is allowed to give any discount the call
 * agreed. What it catches is the dropped zero: ₹10 typed for a ₹10,000 part,
 * which creates a real, payable order for a fraction of the price.
 *
 * Half the catalogue price is the threshold because genuine phone offers sit
 * well above it; below that it is far more often a slip than a deal.
 */

export const DEEP_DISCOUNT_RATIO = 0.5;

export type OfferLine = { name: string; listPrice: number; offer: number; quantity: number };

/** Is this line priced below half its catalogue price? */
export const isDeepDiscount = (listPrice: number, offer: number): boolean =>
  Number.isFinite(offer) && Number.isFinite(listPrice) && listPrice > 0 && offer < listPrice * DEEP_DISCOUNT_RATIO;

/** The lines that need a second look, in the order they were added. */
export const deepDiscountLines = <T extends { listPrice: number; offer: number }>(lines: T[]): T[] =>
  lines.filter((l) => isDeepDiscount(l.listPrice, l.offer));

/**
 * The confirmation text. Spells out each suspicious line — product, catalogue
 * price, typed price — so the person reads the numbers rather than clicking
 * through a generic "are you sure?".
 */
export function deepDiscountWarning(lines: OfferLine[], format: (n: number) => string): string {
  const rows = lines.map((l) => `• ${l.name}\n    normal ${format(l.listPrice)} → you typed ${format(l.offer)}`);
  const plural = lines.length === 1 ? 'this price is' : 'these prices are';
  return [
    `Please check — ${plural} less than half the normal price:`,
    '',
    ...rows,
    '',
    'If you missed a zero, press Cancel and correct it.',
    'If the discount is correct, press OK to create the order.',
  ].join('\n');
}
