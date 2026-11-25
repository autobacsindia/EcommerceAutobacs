import { asyncHandler } from '../middleware/errorMiddleware.js';
import pricingService, { toPublicQuote } from '../services/pricingService.js';
import { offerChoice } from '../services/deliveryFeeService.js';
import { extractAffiliateRef } from '../utils/affiliateAttribution.js';

// @desc    Live price breakdown for a cart, with optional coupon + karma redemption.
//          Read-only preview; the authoritative recompute happens at order creation.
// @route   POST /checkout/quote
// @access  Public (optionalAuth — coupon/karma personalised when logged in)
export const getCheckoutQuote = asyncHandler(async (req, res) => {
  // `shippingCost` is no longer read from the body: delivery fees are server-computed
  // from the rate card. The client sends only the PIN and whether the customer tapped
  // "Apply Black Friday offer" — both re-checked when the order is created.
  const { items, couponCode, redeemKarmaPoints, deliveryPin, applyDeliveryFeeOffer } = req.body;

  const quote = await pricingService.computeQuote({
    items,
    couponCode,
    redeemKarmaPoints,
    deliveryPin,
    // Absent → a live ₹0-delivery offer applies by itself; false = the customer removed it.
    applyDeliveryFeeOffer: offerChoice(applyDeliveryFeeOffer),
    userId: req.user?.id || req.user?._id?.toString() || null,
    /*
      The `ab_ref` cookie, read server-side. Used ONLY to compute the advisory
      `suggestedCoupon` — it never prices this cart. Without it that field was
      unreachable, so a buyer who arrived on an affiliate's link was never offered
      the discount the affiliate was advertising while the affiliate still earned
      commission on the sale.
    */
    referralCode: extractAffiliateRef(req),
  });

  // orderItems + the raw fee block are internal — not for the client.
  res.json({ success: true, quote: toPublicQuote(quote) });
});
