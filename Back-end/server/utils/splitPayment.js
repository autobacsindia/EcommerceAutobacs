/**
 * Orders paid in several Razorpay payments (quotation-first payment parts).
 *
 * Every automatic refund path refunds ONE payment (order.payment). For an order
 * paid in parts that is the wrong payment for most of the money, so the one-click
 * Razorpay refund is refused there: the admin refunds each payment from the
 * Razorpay dashboard and records it with the existing offline-refund flow.
 * Orders paid in one payment — every other order — are unaffected.
 */
export const isSplitPaid = (order) => (order?.paymentParts || []).filter((p) => p.status === 'paid').length > 1;

export const SPLIT_REFUND_MESSAGE =
  'This order was paid in several Razorpay payments, so it cannot be refunded in one click. '
  + 'Refund each payment from the Razorpay dashboard, then record it here as an offline refund.';
