/**
 * Back-in-stock notification service (worker side).
 *
 * Two-phase, mirroring how order emails fan out:
 *   1. fanOutRestock(productId, variantId) — enqueued by the ProductSchema restock
 *      hook when an item recovers. Loads every pending request for that exact
 *      target, atomically claims each (pending → notified) so concurrent restock
 *      events and BullMQ retries can't double-send, and enqueues one send job per
 *      claimed request.
 *   2. emailBackInStock(requestId) — provider-only send for a single claimed request.
 *
 * DB access goes through repositories; idempotency lives in the atomic claim; the
 * actual send is provider-only in emailHandler.sendBackInStockEmail.
 */

import productRepository from '../repositories/productRepository.js';
import stockNotificationRequestRepository from '../repositories/stockNotificationRequestRepository.js';
import { isPurchasable } from '../utils/stockStatus.js';
import { getNotificationsQueue } from '../queue/queues.js';
import emailHandler from './emailHandler.js';

/** Current availability of the specific target (variant if given, else parent). */
function currentStockOf(product, variantId) {
  if (!variantId) return product.stock;
  const variant = (product.variants || []).find(v => v._id.toString() === variantId.toString());
  return variant ? variant.stock : undefined;
}

/**
 * Fan out back-in-stock emails for a recovered product/variant. Idempotent and
 * concurrency-safe: each request is claimed with an atomic status transition, so
 * a request enqueued once is never sent twice even if the hook fires repeatedly.
 *
 * Skips silently when the target has gone out of stock again between the hook
 * firing and this job running (a flap) — we only email people about a genuine,
 * still-available restock.
 *
 * @param {string} productId
 * @param {string|null} variantId
 * @returns {Promise<{status: string, claimed?: number}>}
 */
export const fanOutRestock = async (productId, variantId = null) => {
  const product = await productRepository.findStockView(productId);
  if (!product) return { status: 'product-not-found' };

  // Guard against a restock that flipped back to out before this job ran.
  if (!isPurchasable(currentStockOf(product, variantId))) return { status: 'no-longer-available' };

  const pending = await stockNotificationRequestRepository.findPendingIdsForTarget(productId, variantId);

  let claimed = 0;
  const queue = getNotificationsQueue();

  for (const { _id } of pending) {
    // Atomic claim: only one worker can flip pending → notified, so re-fired hooks
    // and overlapping restock events can't produce duplicate sends.
    const req = await stockNotificationRequestRepository.claimPending(_id);
    if (!req) continue; // already claimed by another run
    claimed += 1;

    queue
      .add('send-back-in-stock-email', { requestId: _id.toString() })
      .catch(err => console.error('[Restock] Failed to enqueue send-back-in-stock-email:', err.message));
  }

  return { status: 'ok', claimed };
};

/**
 * Send one back-in-stock email for an already-claimed request. Provider-only; the
 * request was flipped to `notified` at claim time, so this is safe to retry.
 *
 * @param {string} requestId
 * @returns {Promise<{status: string}>}
 */
export const emailBackInStock = async (requestId) => {
  const request = await stockNotificationRequestRepository.findByIdWithRefs(requestId);

  if (!request) return { status: 'not-found' };
  if (request.status === 'cancelled') return { status: 'cancelled' };

  const user = request.user && typeof request.user === 'object' ? request.user : null;
  const to = user?.email || request.email;
  if (!to) return { status: 'no-recipient' };

  const product = request.product && typeof request.product === 'object' ? request.product : null;
  if (!product?.slug) return { status: 'no-product' };

  // Resolve the variant label so a variable-product email names the exact model.
  let variantLabel = null;
  if (request.variantId) {
    const variant = (product.variants || []).find(v => v._id.toString() === request.variantId.toString());
    variantLabel = variant?.label || null;
  }

  const image = product.images?.find(i => i.isPrimary)?.url || product.images?.[0]?.url || '';

  await emailHandler.sendBackInStockEmail({
    to,
    user,
    product: { name: product.name, slug: product.slug, image },
    variantId: request.variantId ? request.variantId.toString() : null,
    variantLabel,
  });

  return { status: 'sent' };
};
