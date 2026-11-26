/**
 * The rules both customer channels (email and WhatsApp) share for "which event is this"
 * and "is it still true". Pure functions; the only import is another pure util
 * (utils/customerJourney.js) on purpose: the WhatsApp service is loaded by many
 * modules, and pulling the email service's mail/queue dependencies in with it would
 * couple the two channels at load time.
 *
 * orderStatusEmailService re-exports all three, so existing imports are unchanged.
 */

import { customerJourney, reassuranceStage } from '../utils/customerJourney.js';

/**
 * Progress milestones between "confirmed" and "shipped", plus the "still on it" note
 * (services/orderProgressService.js). Keys:
 *   preparing                    once per order
 *   packed:<shipmentId>          once per parcel (packed, no courier yet)
 *   courier_booked:<shipmentId>  once per parcel (packed, AWB on it, not yet picked up)
 *   still_on_it:<step>           once per order per step (placed | preparing | packed)
 */
export const PROGRESS_EVENTS = Object.freeze(new Set(['preparing', 'packed', 'courier_booked', 'still_on_it']));

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
 *   preparing / packed / courier_booked / still_on_it — see progressStillRelevant.
 * Every other status was true when it was enqueued and stays true.
 * @param {string|number|null} [occurrence] - still_on_it: the step it is about
 * @returns {boolean}
 */
export const stillRelevant = (order, status, shipment, occurrence = null) => {
  if (status === 'payment_failed') {
    return order.status === 'awaiting_payment' && order.paymentStatus !== 'paid';
  }
  if (status === 'out_for_delivery' || status === 'delivery_failed') {
    return shipment?.status === 'shipped';
  }
  if (PROGRESS_EVENTS.has(status)) return progressStillRelevant(order, status, shipment, occurrence);
  return true;
};

/**
 * The progress messages are only ever about what is happening NOW, so each re-checks
 * the order the worker just loaded. A cancelled or returned order, or one that has
 * moved past the step, gets nothing:
 *   preparing       — still processing and nothing in a parcel yet (the packed,
 *                     courier-booked or shipped message already says more).
 *   packed          — this parcel is still packed and has no AWB (an AWB makes it
 *                     "courier booked" instead, never both at once).
 *   courier_booked  — this parcel is still packed (not yet picked up) and has an AWB.
 *   still_on_it     — the order is still on exactly that step, nothing has shipped,
 *                     and no item is out of stock (sales is talking to the customer).
 */
function progressStillRelevant(order, status, shipment, step) {
  if (order?.status !== 'processing') return false;
  const journey = customerJourney(order);
  if (!journey) return false;
  switch (status) {
    case 'preparing':
      return journey.parcels.total === 0 && journey.steps.find((s) => s.key === 'preparing')?.done === true;
    case 'packed':
      return shipment?.status === 'packed' && !String(shipment.trackingNumber || '').trim();
    case 'courier_booked':
      return shipment?.status === 'packed' && !!String(shipment.trackingNumber || '').trim();
    case 'still_on_it':
      return !!step && reassuranceStage(journey) === step;
    default:
      return false;
  }
}

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

