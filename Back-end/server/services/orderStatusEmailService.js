/**
 * Order status-change email service.
 *
 * Sends the customer a notification when their order reaches a fulfillment
 * milestone (shipped / delivered / cancelled / refunded). Enqueued from
 * orderStatusService._enqueueStatusNotification and processed by the
 * notification worker (send-order-status-email job).
 *
 * Mirrors invoiceService.emailOrderInvoice: DB access + idempotency live here,
 * the actual send is provider-only in emailHandler.sendOrderStatusUpdate.
 */

import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';

/**
 * Send the status-update email for an order, once per status.
 * Idempotent via Order.notifiedStatuses so BullMQ retries never double-send.
 * @param {string} orderId
 * @param {string} status - New status (shipped|delivered|cancelled|refunded)
 * @returns {Promise<{status: 'sent'|'skipped'|'no-recipient'|'not-found'}>}
 */
export const emailOrderStatusUpdate = async (orderId, status) => {
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  // Idempotency: skip if we've already notified the customer for this status.
  if (order.notifiedStatuses?.includes(status)) return { status: 'skipped' };

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const to = user?.email || order.guestEmail;
  if (!to) {
    console.warn(`[StatusEmail] No recipient email for order ${orderId} — skipping ${status} email`);
    return { status: 'no-recipient' };
  }

  const result = await emailHandler.sendOrderStatusUpdate({ to, order, status, user });

  // Only mark as notified when the provider actually accepted it, so a transient
  // failure lets BullMQ retry rather than silently dropping the notification.
  if (result?.success) {
    order.notifiedStatuses = [...(order.notifiedStatuses || []), status];
    await orderRepository.save(order);
    return { status: 'sent' };
  }

  throw new Error(
    `Status email failed for order ${orderId} (${status}): ${result?.error || 'unknown error'}`
  );
};

export default { emailOrderStatusUpdate };
