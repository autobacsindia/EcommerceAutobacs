/**
 * Google Ads conversion tracking config.
 *
 * These IDs are PUBLIC (they appear in the rendered page source of every site
 * that runs the tag) — not secrets. They are still env-driven, NOT hardcoded, so
 * that non-production deployments (Vercel Preview / local) can leave them unset
 * and therefore NOT fire real conversions. Firing test-card purchases into the
 * live conversion action would pollute Google Ads conversion data and Smart
 * Bidding signals.
 *
 * Set per environment:
 *   NEXT_PUBLIC_GOOGLE_ADS_ID                    e.g. "AW-11434499615"
 *   NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL        e.g. "cC2kCO7WhNccEJ-8sswq"
 *   NEXT_PUBLIC_GOOGLE_ADS_VIEW_ITEM_LABEL       (optional)
 *   NEXT_PUBLIC_GOOGLE_ADS_ADD_TO_CART_LABEL     (optional)
 *   NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_LABEL  (optional)
 *
 * ── Why the labels matter ────────────────────────────────────────────────────
 * `send_to: "AW-123"` addresses the ACCOUNT. That is right for remarketing and
 * audience building, but Google Ads only counts an event against a conversion
 * action when send_to carries that action's label ("AW-123/AbCdEf"). An event
 * sent to the bare account id fires, appears in the dataLayer, and is still
 * reported as "no entries yet" on the conversion action — a failure with no
 * error anywhere. So each funnel event that ALSO exists as a conversion action
 * in Google Ads gets its label here; unlabelled events stay remarketing-only.
 * Copy each label from Google Ads → Goals → Conversions → the action → "Tag
 * setup / Use Google tag" (the part after the "/" in its send_to).
 *
 * NEXT_PUBLIC_* vars are baked at BUILD time — set them before the build and
 * redeploy after any change. They must also be read as literal
 * `process.env.NEXT_PUBLIC_X` expressions (never computed keys) or Next cannot
 * inline them into the client bundle.
 */

/** Google Ads Conversion ID, e.g. "AW-11434499615". Empty when unset. */
export const GOOGLE_ADS_ID = (process.env.NEXT_PUBLIC_GOOGLE_ADS_ID || '').trim();

/** Funnel events that can be routed to a labelled Ads conversion action. */
export type GoogleAdsConversionEvent = 'view_item' | 'add_to_cart' | 'begin_checkout';

/** Conversion label for the "Purchase" action (the part after "/" in send_to). */
const PURCHASE_LABEL = (process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL || '').trim();

const FUNNEL_LABELS: Record<GoogleAdsConversionEvent, string> = {
  view_item: (process.env.NEXT_PUBLIC_GOOGLE_ADS_VIEW_ITEM_LABEL || '').trim(),
  add_to_cart: (process.env.NEXT_PUBLIC_GOOGLE_ADS_ADD_TO_CART_LABEL || '').trim(),
  begin_checkout: (process.env.NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_LABEL || '').trim(),
};

/**
 * True only when a real Google Ads ID is configured — used to gate loading the
 * gtag.js script so we never inject a broken tag (e.g. the placeholder id).
 */
export const isGoogleAdsEnabled = /^AW-\d+$/.test(GOOGLE_ADS_ID);

/**
 * Full `send_to` target for the purchase conversion ("AW-XXXX/LABEL"), or '' when
 * not fully configured. When empty, the purchase event still fires as a generic
 * GA4-style event but is not routed to a specific Ads conversion action.
 */
export const GOOGLE_ADS_PURCHASE_SEND_TO =
  isGoogleAdsEnabled && PURCHASE_LABEL ? `${GOOGLE_ADS_ID}/${PURCHASE_LABEL}` : '';

/**
 * Labelled conversion target for a mid-funnel event ("AW-XXXX/LABEL"), or ''
 * when that event has no conversion action configured — in which case it is
 * sent to the account only, as a remarketing signal.
 */
export function conversionSendTo(event: GoogleAdsConversionEvent): string {
  const label = FUNNEL_LABELS[event];
  return isGoogleAdsEnabled && label ? `${GOOGLE_ADS_ID}/${label}` : '';
}
