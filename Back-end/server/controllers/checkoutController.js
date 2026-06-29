import { asyncHandler } from '../middleware/errorMiddleware.js';
import pricingService from '../services/pricingService.js';

// @desc    Live price breakdown for a cart, with optional coupon + karma redemption.
//          Read-only preview; the authoritative recompute happens at order creation.
// @route   POST /checkout/quote
// @access  Public (optionalAuth — coupon/karma personalised when logged in)
export const getCheckoutQuote = asyncHandler(async (req, res) => {
  const { items, couponCode, redeemKarmaPoints, shippingCost } = req.body;

  const quote = await pricingService.computeQuote({
    items,
    couponCode,
    redeemKarmaPoints,
    shippingCost,
    userId: req.user?.id || req.user?._id?.toString() || null
  });

  // orderItems carries internal pricing/scoping fields — not for the client.
  const { orderItems: _orderItems, ...publicQuote } = quote;

  res.json({ success: true, quote: publicQuote });
});
