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

import { GOOGLE_ADS_ID, isGoogleAdsEnabled } from './googleAds';

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
 * Events are addressed to the Ads account itself (`send_to: AW-…`, no
 * conversion label): these are remarketing/behaviour signals, not conversions.
 * Only the purchase event routes to a labelled conversion action.
 */
function sendGoogleAdsEvent(name: string, params: Record<string, unknown>): void {
  if (!isGoogleAdsEnabled) return;
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, { send_to: GOOGLE_ADS_ID, ...params });
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

/**
 * Checkout started.
 *
 * `items` is optional and currently omitted by the checkout page: the cart API
 * does not expose catalogue ids per line (unlike the order API, which attaches
 * `metaContentId`), and an internal product id here would be worse than no id —
 * it would match no offer while looking like it should. The event still carries
 * value + currency, which is what Smart Bidding needs from this step. Attaching
 * ids is a follow-up that requires a shared cart serializer on the backend.
 */
export function trackGoogleBeginCheckout(value: number, items?: GoogleAdsItem[]): void {
  sendGoogleAdsEvent('begin_checkout', {
    currency: CURRENCY,
    value,
    ...(items && items.length ? { items } : {}),
  });
}

export default { trackGoogleViewItem, trackGoogleAddToCart, trackGoogleBeginCheckout };
