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
import { applyFestivalOffer } from './festivalOffer.js';

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
export function priceFields(source, festivalOffer = null) {
  const eff = roundRupees(effectivePrice(source));
  const orig = typeof source.originalPrice === 'number' ? roundRupees(source.originalPrice) : null;

  /*
    Festival (Diwali) price offer, when live — stacked on the selling price by the same
    pure function the checkout charges with (utils/festivalOffer.js), so the advertised
    price IS the charged price (Merchant Center disapproves a mismatch). `price` stays the
    M.R.P. (or the selling price when there is no higher M.R.P.); `sale_price` is the
    Diwali price; `sale_price_effective_date` bounds it to the offer window so Google/Meta
    fall back at the end date even if they do not re-fetch the feed in time.
  */
  const offer = festivalOffer ? applyFestivalOffer({ unitPrice: eff }) : null;
  if (offer) {
    return {
      price: money(orig != null && orig > eff ? orig : eff),
      salePrice: money(offer.finalPrice),
      salePriceEffectiveDate: effectiveDateRange(festivalOffer),
      effectiveRupees: offer.finalPrice,
    };
  }

  const onSale = orig != null && orig > eff;
  return {
    price: money(onSale ? orig : eff),
    salePrice: onSale ? money(eff) : null,
    salePriceEffectiveDate: null,
    effectiveRupees: eff,
  };
}

/** ISO 8601 interval "start/end" for g:sale_price_effective_date, or null if open-ended. */
export function effectiveDateRange(window) {
  if (!window?.startsAt || !window?.endsAt) return null;
  return `${new Date(window.startsAt).toISOString()}/${new Date(window.endsAt).toISOString()}`;
}

export default { escapeXml, stripHtml, money, priceFields, effectiveDateRange };
