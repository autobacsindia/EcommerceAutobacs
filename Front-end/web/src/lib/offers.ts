/**
 * Offer campaigns — presentation copy only.
 *
 * This is deliberately NOT the campaign engine (`Campaign` / `CampaignMember` on the
 * backend). That one owns money: it gates an audience and prices a managed coupon, and
 * every rupee it moves flows through the coupon path so Order.discount, the invoice and
 * refundMathService keep reading one set of figures.
 *
 * These offers move no money at all. They exist for a sale that is settled OFF the site
 * — at the counter, on goods that are not in the catalogue — where the only job the
 * website does is get the customer signed in. So there is no discount, no coupon code,
 * no eligibility check and no backend: nothing here can alter a cart total, which is
 * precisely why it can be a static map rather than an admin-managed document.
 *
 * Copy lives in one object so the headline on the landing page and the strip on the
 * sign-in screens can never drift apart, and so changing the wording is a one-line edit
 * rather than a hunt through three components.
 */

export type OfferKey = 'onam';

export type Offer = {
  /** Query-param value and lookup key: `/login?offer=onam`. */
  key: OfferKey;
  /** Small caps line above the title. */
  eyebrow: string;
  /** The headline the customer reads on the landing page. */
  title: string;
  /** One line under the title, before sign-in. */
  tagline: string;
  /** The condensed version, shown on the sign-in and registration screens. */
  stripText: string;
  /** Where the printed QR points. A printed code can never be changed — see below. */
  landingPath: string;
};

export const OFFERS: Readonly<Record<OfferKey, Offer>> = Object.freeze({
  /**
   * Onam 2026, in-store. The QR is printed on the counter card, so `landingPath` is
   * fixed at print time: if this route is ever renamed the printed cards die with it.
   * Rename by adding a redirect, never by editing this string.
   */
  onam: {
    key: 'onam',
    eyebrow: 'Onam Special',
    title: 'Your Onam coupon is waiting',
    tagline: 'Sign in to activate it, and our team will apply it to your purchase.',
    stripText: 'Onam Special — sign in to activate your coupon',
    landingPath: '/onam',
  },
});

/**
 * Resolve an `?offer=` query value to a known offer.
 *
 * Returns null for anything unrecognised rather than throwing or falling back to a
 * default: the parameter arrives from a URL a stranger can type, and an unknown value
 * should leave the sign-in screen exactly as it was, not decorate it with someone
 * else's promotion.
 */
export function getOffer(raw: string | null | undefined): Offer | null {
  if (!raw) return null;
  // hasOwnProperty, not a bare index: `OFFERS['constructor']` reaches Object.prototype
  // and hands back a truthy function, which would sail past a `?? null` check and be
  // rendered as an offer.
  if (!Object.prototype.hasOwnProperty.call(OFFERS, raw)) return null;
  return OFFERS[raw as OfferKey];
}
