/**
 * Google Tag Manager container config.
 *
 * The container id is PUBLIC (it appears in the page source of every site that
 * runs GTM) — not a secret — but it stays env-driven, NOT hardcoded, so that
 * Vercel Preview / local builds can leave it unset and therefore never load a
 * container whose tags would fire into live datasets.
 *
 * Set per environment (build-time baked — redeploy after any change):
 *   NEXT_PUBLIC_GTM_ID   e.g. "GTM-PK3BVQR9"
 *
 * ── How GTM relates to the tags this app already loads ───────────────────────
 * The Google Ads tag (lib/googleAds.ts) and the Meta Pixel (lib/metaPixel.ts)
 * are loaded DIRECTLY by app/layout.tsx and fire their conversions from app code
 * (PurchaseTracker, googleAdsEvents.ts, metaPixel.ts). That remains the source of
 * truth for conversion tracking. GTM is a container for ADDITIONAL tools.
 *
 * ⚠ Do NOT build a purchase/conversion tag inside the GTM UI for an id this app
 * already fires directly — GTM and the direct tag would each report the same
 * order and every conversion would be counted twice, which corrupts Smart
 * Bidding with no error anywhere. Same reason the Google Ads "destination"
 * linked to the container should be unlinked: it configures AW-… a second time.
 *
 * NEXT_PUBLIC_* vars must be read as literal `process.env.NEXT_PUBLIC_X`
 * expressions (never computed keys) or Next cannot inline them into the bundle.
 */

/**
 * The dataLayer array GTM reads — deliberately NOT the default `dataLayer`.
 *
 * gtm.js takes ownership of whatever array it is pointed at and REPLAYS the
 * commands already queued there. Sharing the default `dataLayer` with the
 * directly-loaded Google tag (lib/googleAds.ts) therefore made GTM re-execute
 * its `config AW-…`: measured on a production build, gtag/js loaded twice,
 * page_view beacons went 1 → 3 and remarketing 1 → 2 on a single page load.
 * Conversions survived only because Google de-dupes them on `transaction_id`
 * (PurchaseTracker always sends one) — nothing protects the page_view count,
 * which feeds audiences and Smart Bidding.
 *
 * Naming GTM's queue separately makes the two systems structurally independent:
 * gtag owns `window.dataLayer`, GTM owns this one, and neither can replay the
 * other's commands.
 *
 * ⚠ CONSEQUENCE: a copy-pasted `window.dataLayer.push(…)` from a GTM tutorial
 * will NOT be seen by this container — GTM only reads the array below. Push to
 * `window.gtmDataLayer` (or use `pushToGtm`) for anything GTM must react to.
 */
export const GTM_DATA_LAYER = 'gtmDataLayer';

/** GTM container id, e.g. "GTM-PK3BVQR9". Empty when unset. */
export const GTM_ID = (process.env.NEXT_PUBLIC_GTM_ID || '').trim();

/**
 * True only when a real container id is configured — gates the loader so an
 * unset/placeholder value never injects a broken <script> or a 404'ing gtm.js.
 *
 * The id is interpolated into an inline script, so the shape check is also the
 * injection guard: only `GTM-` + uppercase alphanumerics can ever reach the
 * snippet. Anything with a quote, angle bracket or backslash fails the test and
 * the container simply does not load.
 */
export const isGtmEnabled = /^GTM-[A-Z0-9]+$/.test(GTM_ID);

/**
 * Push an event into GTM's queue. Safe before the container loads (the array is
 * a queue GTM drains on arrival) and safe on the server (no-op), so callers do
 * not need to guard. Returns false when GTM is disabled or unavailable.
 */
export function pushToGtm(event: Record<string, unknown>): boolean {
  if (!isGtmEnabled || typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown[]>;
  w[GTM_DATA_LAYER] = w[GTM_DATA_LAYER] || [];
  w[GTM_DATA_LAYER].push(event);
  return true;
}
