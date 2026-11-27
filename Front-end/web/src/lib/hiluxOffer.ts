/**
 * The Hilux owners' thank-you card offer — display copy only.
 *
 * The rules themselves live on the HILUX5000 Coupon document (created by
 * Back-end/server/scripts/create-hilux-owner-coupon.js) and are enforced by the
 * server's pricing engine. If the coupon is edited in admin, update the wording here.
 */
export const HILUX_OFFER = Object.freeze({
  code: 'HILUX5000',
  /**
   * Where the printed QR lands. The cards already in customers' hands encode `/onam`,
   * which next.config.ts redirects here — so never rename this path without keeping a
   * redirect from the old one.
   */
  landingPath: '/hilux-owners',
  amountOff: 5000,
  minOrder: 25000,
  /** Model pages that list the parts the coupon covers. */
  shopLinks: [
    { label: 'Hilux Travo parts', href: '/model/toyota-hilux-travo' },
    { label: 'Hilux Revo parts', href: '/model/toyota-hilux-revo' },
  ],
});
