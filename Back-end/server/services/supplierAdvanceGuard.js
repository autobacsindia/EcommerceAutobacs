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
import supplierDealRepository from '../repositories/supplierDealRepository.js';
import { cancelledQuantityByItem } from '../utils/orderCancellation.js';
import { toPaise } from '../utils/money.js';

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

// ── Supplier payments on a cancelled order ───────────────────────────────────────

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/**
 * Is every one of these items gone from the order (the order cancelled, or each
 * item cancelled in full)? An item with only some units cancelled is still live:
 * the supplier is still owed for the rest.
 */
export function itemsCancelled(order, itemIds = []) {
  if (!order || order.status === 'cancelled') return true;
  const ids = (itemIds || []).map(idOf).filter(Boolean);
  if (!ids.length) return false;
  const cancelled = cancelledQuantityByItem(order);
  const qty = new Map((order.items || []).map((i) => [idOf(i._id), Number(i.quantity) || 0]));
  return ids.every((id) => !qty.has(id) || (cancelled.get(id) || 0) >= qty.get(id));
}

/** Units of a request in its own currency (rupees, or the foreign bill), as hundredths. */
const unitsPaise = (r) => toPaise(((r.currency && r.currency !== 'INR') ? Number(r.foreignAmount) || 0 : Number(r.amount) || 0) + (Number(r.credit?.amount) || 0));

/**
 * After an order (or some of its items) is cancelled: supplier payments for those
 * items that are still only WAITING for accounts are withdrawn — nobody approved
 * them and no money moved, so there is nothing left to decide. Without this they sat
 * in accounts' "to approve" list for good (approving one is refused on a cancelled
 * order). A deal part gives its share of the agreed total back.
 *
 * Approved / on-hold ones are left for accounts to decline (paying them is refused —
 * paymentRequestService.assertOrderLive); paid ones are untouched.
 *
 * Idempotent: the compare-and-set moves only a request still `submitted`, so a second
 * call (the line cancel, then the order roll-up) finds nothing to do. Never throws:
 * the cancellation itself has already happened.
 */
export async function withdrawWaitingSupplierPayments(order, note = 'Order cancelled') {
  if (!order?._id) return [];
  const withdrawn = [];
  try {
    const open = await paymentRequestRepository.findOpenForOrder(order._id);
    for (const r of open) {
      if (r.status !== 'submitted' || !itemsCancelled(order, r.itemIds)) continue;
      const done = await paymentRequestRepository.transition(r._id, ['submitted'], { status: 'cancelled' },
        { at: new Date(), byName: 'System', role: 'system', action: 'cancelled', note: `Withdrawn automatically — ${note}`.slice(0, 1000) });
      if (!done) continue; // decided a moment ago: theirs to finish
      if (done.deal) await supplierDealRepository.release(done.deal, unitsPaise(done));
      if (done.credit?.amount) {
        // Lazy: supplierLedgerService imports this module.
        const { restoreCredit } = await import('./supplierLedgerService.js');
        await restoreCredit(done, `${done.number} withdrawn — ${note}`);
      }
      withdrawn.push(done.number);
    }
  } catch (err) {
    console.error(`[SupplierPayments] order ${idOf(order._id)}: could not withdraw waiting supplier payments:`, err.message);
  }
  if (withdrawn.length) console.info(`[SupplierPayments] order ${idOf(order._id)} cancelled: withdrew ${withdrawn.join(', ')}`);
  return withdrawn;
}
