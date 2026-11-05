/**
 * "Supplier advance already paid — this order can't be cancelled."
 *
 * Owner decision (2026-11-05): a made-to-order item whose supplier has been
 * approved or paid an advance cannot be cancelled — the supplier is already
 * making it and the money is gone. Staff decline the customer's cancel request
 * instead.
 *
 * One check, used by every road to a cancellation:
 *   - orderStatusService.updateOrderStatus → 'cancelled' (customer cancel, admin
 *     status change, bulk status change)
 *   - cancellationService.cancelLines (admin per-line cancel, the remainder of a
 *     partly cancelled order, accounts approving an out-of-stock refund)
 *
 * Kept free of other services on purpose: both callers sit low in the import graph.
 */
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';

/** Approved (accounts said yes), on hold (approved, parked) or paid: the money is committed. */
export const COMMITTED_STATUSES = Object.freeze(['approved', 'on_hold', 'paid']);
export const ADVANCE_BLOCK_MESSAGE = "Supplier advance already paid — this order can't be cancelled. Decline the customer's cancel request instead.";
// What the customer reads: no internal words (supplier, advance, decline).
export const CUSTOMER_BLOCK_MESSAGE = 'This order is being made specially for you and work has already started, so it can no longer be cancelled online. Please contact us for help.';

/**
 * The committed deal payment that blocks cancelling these items (or any item on
 * the order when `itemIds` is empty), or null.
 */
export async function committedAdvanceFor(orderId, itemIds = []) {
  if (!orderId) return null;
  const ids = (itemIds || []).map(String).filter(Boolean);
  // Served by payment_request_order (order, status).
  return paymentRequestRepository.findCommittedDealPart(orderId, ids, COMMITTED_STATUSES);
}

/**
 * The message to refuse with, or null when the cancellation may go ahead.
 * `{ customer: true }` gives the customer's wording (no payment number).
 */
export async function advanceBlockReason(orderId, itemIds = [], { customer = false } = {}) {
  const hit = await committedAdvanceFor(orderId, itemIds);
  if (!hit) return null;
  return customer ? CUSTOMER_BLOCK_MESSAGE : `${ADVANCE_BLOCK_MESSAGE} (${hit.number})`;
}
