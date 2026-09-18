/**
 * Recognising the one gateway refund failure that is not really a failure.
 *
 * When an admin refunds a payment by hand in the Razorpay DASHBOARD, nothing is written
 * here: the resulting `refund.processed` webhook carries no order / return /
 * cancellation note, so it resolves to nothing and is dropped. The local refund records
 * and `Payment.refundAmount` therefore still read ₹0 refunded, `remainingRefundable`
 * reports full headroom, and the refund button happily claims the order and calls the
 * gateway — which rejects it, because the payment is already fully refunded.
 *
 * The order then lands in `failed` and the button becomes "Retry Refund" for ever. The
 * headroom guard in processRefund documents this as the case it cannot catch ("a guard,
 * NOT a guarantee").
 *
 * Detecting it does not fix anything by itself — the money really is already back with
 * the customer and there is nothing left to send. What it buys is a truthful message
 * and a route out: the admin is told to RECORD the dashboard refund as an offline
 * settlement, which reconciles the books and closes the order.
 *
 * ⚠️ MATCHED ON TEXT, SO IT MUST ONLY EVER BE ADVISORY. Razorpay's wording is not a
 * contract and can change; a false negative just means the admin sees the raw error
 * (today's behaviour), and a false positive must never do anything more than offer a
 * suggestion. Nothing here may gate a money movement.
 */

const ALREADY_REFUNDED_PATTERNS = [
  /fully refunded/i,
  /already been refunded/i,
  /already refunded/i,
  /refund.*exceeds.*amount captured/i,
  /amount is greater than (the )?(amount )?(available|captured)/i,
];

/**
 * Does this gateway error mean "there is nothing left to refund on this payment"?
 * @param {Error|string} err
 * @returns {boolean}
 */
export const isAlreadyRefundedAtGateway = (err) => {
  const message = typeof err === 'string' ? err : (err?.message || '');
  if (!message) return false;
  return ALREADY_REFUNDED_PATTERNS.some((re) => re.test(message));
};

/**
 * Admin-facing explanation + the action that actually resolves it.
 * @param {string} rawMessage - the gateway's own wording, kept so nothing is hidden
 * @returns {string}
 */
export const alreadyRefundedGuidance = (rawMessage) =>
  `Razorpay reports this payment has already been refunded in full ("${rawMessage}"). `
  + 'That usually means the refund was issued by hand in the Razorpay dashboard, which '
  + 'writes nothing back to this system. Nothing more can be sent to the gateway — '
  + 'record it here as a refund settled offline (using the Razorpay refund id as the '
  + 'reference) to reconcile the order and clear it from the refunds queue.';

export default { isAlreadyRefundedAtGateway, alreadyRefundedGuidance };
