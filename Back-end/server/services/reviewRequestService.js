/**
 * Post-delivery review-request email service.
 *
 * A day after an order is delivered, ask the customer to review the products they
 * bought. Enqueued (with a delay) from orderStatusService._enqueueStatusNotification
 * and processed by the notification worker (send-review-request job).
 *
 * Mirrors orderStatusEmailService: DB access + idempotency live here, the actual
 * send is provider-only in emailHandler.sendReviewRequest.
 */

import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';

/**
 * Send the review-request email for a delivered order, once per order.
 * Idempotent via Order.reviewRequestedAt so BullMQ retries never double-send.
 *
 * Skips (without error) when the order is no longer delivered (e.g. refunded within
 * the delay window), has no registered user (legacy/guest orders can't post reviews),
 * or has no reviewable products (all line items reference deleted/slug-less products).
 *
 * @param {string} orderId
 * @returns {Promise<{status: 'sent'|'skipped'|'not-found'|'not-delivered'|'no-user'}>}
 */
export const emailReviewRequest = async (orderId) => {
  const order = await orderRepository.findById(orderId, [
    { path: 'user', select: 'name email' },
    { path: 'items.product', select: 'name slug images' },
  ]);
  if (!order) return { status: 'not-found' };

  // Idempotency: only ever request a review once per order.
  if (order.reviewRequestedAt) return { status: 'skipped' };

  // The customer may have refunded/returned within the delay window — don't beg for
  // a review on an order that's no longer in good standing.
  if (order.status !== 'delivered') return { status: 'not-delivered' };

  // Reviews require a logged-in account (POST /reviews/products/:id is auth-only),
  // so a user-less legacy/imported order has no actionable CTA — skip it.
  const user = order.user && typeof order.user === 'object' ? order.user : null;
  if (!user?.email) return { status: 'no-user' };

  // Build the reviewable-product list from the populated line items: dedup by product
  // id, and drop items whose product was deleted or has no slug (no review page to link).
  const seen = new Set();
  const products = [];
  for (const item of order.items || []) {
    const product = item.product && typeof item.product === 'object' ? item.product : null;
    if (!product?.slug) continue;
    const id = product._id.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    products.push({
      name: product.name || item.name || 'your purchase',
      slug: product.slug,
      image: product.images?.[0]?.url || product.images?.[0] || item.image || '',
    });
  }

  // Nothing reviewable — mark done so we don't keep retrying this order forever.
  if (products.length === 0) {
    order.reviewRequestedAt = new Date();
    await orderRepository.save(order);
    return { status: 'skipped' };
  }

  const result = await emailHandler.sendReviewRequest({ to: user.email, order, user, products });

  // Only mark as requested when the provider actually accepted it, so a transient
  // failure lets BullMQ retry rather than silently dropping the notification.
  if (result?.success) {
    order.reviewRequestedAt = new Date();
    await orderRepository.save(order);
    return { status: 'sent' };
  }

  throw new Error(
    `Review-request email failed for order ${orderId}: ${result?.error || 'unknown error'}`
  );
};

export default { emailReviewRequest };
