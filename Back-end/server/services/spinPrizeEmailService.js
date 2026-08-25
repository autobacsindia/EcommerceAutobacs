/**
 * Spin-to-Win prize email.
 *
 * Sends the winner what they actually won — critically, the coupon CODE, which otherwise
 * exists only on a page they may have already closed.
 *
 * Mirrors reviewRequestService: idempotency and data access live here, the provider call
 * lives in emailHandler. Enqueued post-commit from spinService so a rolled-back spin can
 * never email a prize that was not awarded.
 */

import spinResultRepository from '../repositories/spinResultRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';

/**
 * Email the prize for one spin, once.
 *
 * Idempotent via SpinResult.prizeEmailedAt, so a BullMQ retry cannot double-send. The
 * flag is set only AFTER the provider accepts the message — setting it first would turn
 * a transient provider outage into a permanently unsent prize.
 *
 * @returns {Promise<{status: 'sent'|'skipped'|'not-found'|'voided'|'no-recipient'}>}
 */
export const emailSpinPrize = async (orderId) => {
  const result = await spinResultRepository.findByOrder(orderId);
  if (!result) return { status: 'not-found' };

  // Already sent — a retry, or a duplicate enqueue.
  if (result.prizeEmailedAt) return { status: 'skipped' };

  // The order was cancelled or refunded between winning and this job running. Emailing a
  // prize that has just been clawed back would be worse than silence.
  if (result.status !== 'granted') return { status: 'voided' };

  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  // Guest orders carry the address on the order itself.
  const email = user?.email || order.guestEmail;
  if (!email) return { status: 'no-recipient' };

  await emailHandler.sendSpinPrizeEmail({
    email,
    name: user?.name || order.shippingAddress?.fullName || 'there',
    orderId: String(order._id),
    prize: result.prizeSnapshot,
  });

  await spinResultRepository.markPrizeEmailed(result._id);
  return { status: 'sent' };
};

export default { emailSpinPrize };
