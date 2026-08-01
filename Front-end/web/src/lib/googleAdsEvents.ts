/**
 * Google Ads funnel events (gtag.js) — the mid-funnel signal that makes dynamic
 * remarketing and Smart Bidding work.
 *
 * The base tag in app/layout.tsx only fires `config` (a page view), and
 * order/[orderId]/success fires `purchase`. Between those two, Google saw
 * nothing: it could not know WHICH product a visitor looked at, so it could not
 * show them that product again, and bidding had only sparse purchase events to
 * learn from. These helpers close that gap — the Google mirror of lib/metaPixel.ts.
 *
 * ── The id contract (why this works at all) ──────────────────────────────────
 * `id` MUST be the Merchant Center offer id, i.e. the same catalogue id the
 * product feed emits (Back-end/server/utils/googleCatalogId.js). Google matches
 * remarketing events to feed offers by that id and by nothing else; an internal
 * Mongo _id would silently produce zero matches. The backend hands the frontend
 * a ready-made `metaContentId` per product/variant — one catalogue id shared by
 * Meta and Google — so callers pass that through and never re-derive it.
 *
 * ── Two Google-specific requirements ─────────────────────────────────────────
 * 1. `google_business_vertical: 'retail'` is REQUIRED on every item for Google
 *    Ads dynamic remarketing. Without it the event is accepted and then ignored
 *    for audience building — a silent failure with no console warning.
 * 2. Items carry BOTH `id` (the Ads remarketing spelling) and `item_id` (the
 *    GA4 spelling). gtag maps between them, but which one a given destination
 *    reads has changed across versions; sending both costs nothing and removes
 *    a class of silent mismatch.
 *
 * Every helper is a no-op when the tag is absent (id unset in preview/local, or
 * an ad blocker), exactly like trackMeta().
 */

import { GOOGLE_ADS_ID, conversionSendTo, isGoogleAdsEnabled } from './googleAds';
import type { GoogleAdsConversionEvent } from './googleAds';

/** All money is RUPEES (Order/Product store rupees) — never divide by 100. */
const CURRENCY = 'INR';

/** Item shape Google Ads expects for retail remarketing events. */
export interface GoogleAdsItem {
  /** Merchant Center offer id — Ads spelling. */
  id: string;
  /** Same value, GA4 spelling. See note 2 above. */
  item_id: string;
  google_business_vertical: 'retail';
  price?: number;
  quantity?: number;
}

/**
 * Safe wrapper — no-op when Google Ads isn't configured or gtag hasn't loaded.
 *
 * Sends the event TWICE when the event also exists as a Google Ads conversion
 * action, because the two destinations need different `send_to` values and one
 * call cannot serve both:
 *
 *   1. `send_to: "AW-123"` (always) — the account-level remarketing signal that
 *      builds audiences and feeds dynamic ads.
 *   2. `send_to: "AW-123/LABEL"` (only when that label is configured) — the
 *      conversion action, which is the ONLY form Google Ads counts in the
 *      Conversions column and its goal groups.
 *
 * Without (2) the event still fires and still shows in the dataLayer while the
 * conversion action reports "no entries yet" forever. Without (1) remarketing
 * gets nothing. Labels are optional per event, so an event with no conversion
 * action configured simply stays remarketing-only.
 *
 * gtag itself is available from the beforeInteractive stub in app/layout.tsx, so
 * callers may fire during hydration; commands queue in window.dataLayer until
 * gtag.js lands. The typeof guard remains for ad blockers and unset builds.
 */
function sendGoogleAdsEvent(
  name: GoogleAdsConversionEvent,
  params: Record<string, unknown>
): void {
  if (!isGoogleAdsEnabled) return;
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;

  window.gtag('event', name, { send_to: GOOGLE_ADS_ID, ...params });

  const conversionTarget = conversionSendTo(name);
  if (conversionTarget) {
    window.gtag('event', name, { send_to: conversionTarget, ...params });
  }
}

/** Build the retail item payload from a catalogue id. */
function retailItem(contentId: string, price?: number, quantity?: number): GoogleAdsItem {
  return {
    id: contentId,
    item_id: contentId,
    google_business_vertical: 'retail',
    ...(price != null ? { price } : {}),
    ...(quantity != null ? { quantity } : {}),
  };
}

/** Product detail page view — the event dynamic remarketing is built on. */
export function trackGoogleViewItem(contentId: string, value?: number): void {
  if (!contentId) return;
  sendGoogleAdsEvent('view_item', {
    currency: CURRENCY,
    ...(value != null ? { value } : {}),
    items: [retailItem(contentId, value)],
  });
}

/** Add to cart. `value` is the TOTAL added (unit price × quantity). */
export function trackGoogleAddToCart(contentId: string, value?: number, quantity = 1): void {
  if (!contentId) return;
  sendGoogleAdsEvent('add_to_cart', {
    currency: CURRENCY,
    ...(value != null ? { value } : {}),
    items: [retailItem(contentId, value != null ? value / quantity : undefined, quantity)],
  });
}

/** One checkout line as the cart API returns it. */
export interface CheckoutLine {
  /** Catalogue id from the cart API (`metaContentId`); null for a stale line. */
  contentId?: string | null;
  /** Unit price in rupees. */
  price?: number;
  quantity?: number;
}

/**
 * Checkout started.
 *
 * Lines without a catalogue id are dropped rather than sent with an internal
 * product id: an id that matches no Merchant Center offer is worse than no id,
 * because it looks correct in the payload while contributing nothing. The event
 * still reports value + currency, which is what Smart Bidding needs even when
 * every line is unidentified.
 */
export function trackGoogleBeginCheckout(value: number, lines?: CheckoutLine[]): void {
  const items = (lines ?? [])
    .filter((line) => !!line.contentId)
    .map((line) => retailItem(String(line.contentId), line.price, line.quantity ?? 1));

  sendGoogleAdsEvent('begin_checkout', {
    currency: CURRENCY,
    value,
    ...(items.length ? { items } : {}),
  });
}

export default { trackGoogleViewItem, trackGoogleAddToCart, trackGoogleBeginCheckout };
