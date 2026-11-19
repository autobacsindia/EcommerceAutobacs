/**
 * The rules both customer channels (email and WhatsApp) share for "which event is this"
 * and "is it still true". Pure functions with NO imports on purpose: the WhatsApp
 * service is loaded by many modules, and pulling the email service's mail/queue
 * dependencies in with it would couple the two channels at load time.
 *
 * orderStatusEmailService re-exports all three, so existing imports are unchanged.
 */

/**
 * The idempotency key stored in `Order.notifiedStatuses`.
 *
 * ⚠️ THIS IS THE FIX FOR A REAL SWALLOWED EMAIL. The guard used to be the bare status
 * word, and the send is skipped when the array already contains it — so the moment an
 * order shipped in two parcels, the SECOND "your order has shipped" email was silently
 * dropped and the customer was never told about their other box. Keying on the parcel
 * makes each one notifiable exactly once.
 *
 * Order-level events (cancelled, refunded, and every historical order) keep the bare
 * word, so nothing already sent is ever re-sent after this change ships.
 *
 * `occurrence` is for events that can legitimately happen more than once on the same
 * parcel or order: a courier step (a parcel can be out for delivery, missed, and out
 * for delivery again — keyed on the parcel's step number) or a refund (keyed on the
 * Razorpay refund id). Without it the second "out for delivery" would be swallowed
 * exactly like the second parcel's "shipped" email was.
 *
 * @param {string} status
 * @param {string|null} [shipmentId]
 * @param {string|number|null} [occurrence]
 * @returns {string}
 */
export const notificationKey = (status, shipmentId = null, occurrence = null) =>
  [status, shipmentId, occurrence].filter((part) => part != null && part !== '').join(':');

/**
 * Is this email still true by the time the worker runs it? Each answer is read off the
 * order the worker just loaded, so a delayed or retried job never tells the customer
 * something that has stopped being the case.
 *   payment_failed  — sent after a delay (see razorpayService.handlePaymentFailure);
 *                     a customer who retried and paid in the meantime gets nothing.
 *   out_for_delivery / delivery_failed — only while the parcel is still in transit;
 *                     once it is delivered (or lost) the step is old news.
 * Every other status was true when it was enqueued and stays true.
 * @returns {boolean}
 */
export const stillRelevant = (order, status, shipment) => {
  if (status === 'payment_failed') {
    return order.status === 'awaiting_payment' && order.paymentStatus !== 'paid';
  }
  if (status === 'out_for_delivery' || status === 'delivery_failed') {
    return shipment?.status === 'shipped';
  }
  return true;
};

/**
 * How long after a failed payment we wait before emailing. Most failures are retried
 * in the same Razorpay window within a minute or two (wrong OTP, a declined card then
 * UPI); emailing at once would tell a customer who has just paid that they have not.
 * The worker re-checks the order (stillRelevant) before sending.
 */
export const paymentFailedEmailDelayMs = () => {
  const minutes = Number(process.env.PAYMENT_FAILED_EMAIL_DELAY_MINUTES);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 30) * 60 * 1000;
};

