/**
 * Formatting primitives shared by every marketing product feed (Meta catalogue,
 * Google Merchant Center).
 *
 * Both platforms consume RSS 2.0 with Google's `g:` namespace, so escaping,
 * plain-texting and money formatting are genuinely identical work. Keeping them
 * here means a fix (e.g. an entity we forgot to strip) lands on every feed at
 * once, and — more importantly — the SALE-EXPIRY guard in priceFields() can
 * never drift between channels, which would otherwise let one platform keep
 * advertising a price we no longer honour.
 *
 * Platform-specific rules (field names, length caps, availability vocabulary,
 * required attributes) deliberately stay in each feed's own service.
 */

import { effectivePrice } from '../services/pricingService.js';
import { roundRupees } from './money.js';

export function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Strip HTML/entities down to plain text for a feed description. */
export function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Format a rupee amount the way both platforms expect: "45000.00 INR". */
export function money(rupees) {
  return `${roundRupees(rupees).toFixed(2)} INR`;
}

/**
 * `price` / `sale_price` from a price source (a product or a variant — both share
 * price/originalPrice/saleEndsAt semantics). Honours the sale-expiry guard via
 * effectivePrice(): if a sale window has passed, the price reverts to
 * originalPrice and no sale_price is emitted, so ads never show a stale discount.
 *
 * Also returns the numeric effective price so callers can apply their own
 * validity floor (Google rejects non-positive prices outright).
 */
export function priceFields(source) {
  const eff = roundRupees(effectivePrice(source));
  const orig = typeof source.originalPrice === 'number' ? roundRupees(source.originalPrice) : null;
  const onSale = orig != null && orig > eff;
  return {
    price: money(onSale ? orig : eff),
    salePrice: onSale ? money(eff) : null,
    effectiveRupees: eff,
  };
}

export default { escapeXml, stripHtml, money, priceFields };
