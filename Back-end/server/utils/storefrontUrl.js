/**
 * Customer-facing storefront links for emails.
 *
 * Built ONLY from FRONTEND_URL — never a hardcoded host — so the cutover from
 * *.railway.app to autobacsindia.com is an env change, not a code change. When
 * FRONTEND_URL is unset the helpers return null and templates leave the link out:
 * a missing button is better than one pointing at the wrong site.
 */

/** Storefront origin without a trailing slash, or null when not configured. */
export const storefrontOrigin = () => {
  // FRONTEND_URL is a single origin; tolerate a comma list and take the first.
  const raw = String(process.env.FRONTEND_URL || '').split(',')[0].trim();
  return raw ? raw.replace(/\/+$/, '') : null;
};

/**
 * The public Track Order page, optionally pre-filled with a courier tracking number.
 *
 * Safe to put in an email: /track only shows the parcel's status and destination
 * city/state/PIN — no name, street address, phone or order contents.
 *
 * @param {string} [trackingNumber]
 * @returns {string|null}
 */
export const trackOrderUrl = (trackingNumber) => {
  const origin = storefrontOrigin();
  if (!origin) return null;
  const number = String(trackingNumber ?? '').trim();
  return number ? `${origin}/track?number=${encodeURIComponent(number)}` : `${origin}/track`;
};
