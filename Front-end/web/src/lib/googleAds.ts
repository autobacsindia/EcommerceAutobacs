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
 *   NEXT_PUBLIC_GOOGLE_ADS_ID             e.g. "AW-11434499615"
 *   NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL e.g. "cC2kCO7WhNccEJ-8sswq"
 *
 * NEXT_PUBLIC_* vars are baked at BUILD time — set them before the build and
 * redeploy after any change.
 */

/** Google Ads Conversion ID, e.g. "AW-11434499615". Empty when unset. */
export const GOOGLE_ADS_ID = (process.env.NEXT_PUBLIC_GOOGLE_ADS_ID || '').trim();

/** Conversion label for the "Purchase" action (the part after "/" in send_to). */
const PURCHASE_LABEL = (process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL || '').trim();

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
