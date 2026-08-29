/**
 * Partial cancellation — killing individual order lines before they are delivered, and
 * paying that money back.
 *
 * The pre-delivery twin of a return. Nothing physically moves, so the whole job is:
 * record which units died, stop them counting anywhere, and refund exactly what those
 * units were worth. This service owns the writes to `Order.cancellations[]`; it does
 * NOT own the money maths (services/refundMathService.js) or what a whole-order status
 * change means (services/orderStatusService.js), so there stays exactly one place that
 * decides each of those.
 *
 * ── THE ORDER IS NEVER REWRITTEN ──────────────────────────────────────────────────
 * `totalAmount`, `subtotal` and `discount` are untouched. An order is an immutable
 * record of what was charged; the refund is the adjustment, and the pair is the truth.
 * Rewriting the totals would leave the order disagreeing with the invoice AND with what
 * Razorpay captured, and would silently rewrite historical revenue.
 *
 * ── ROLL-UP, ONCE ─────────────────────────────────────────────────────────────────
 * `Order.status` stays where it is while ANY line is still live. Only when the last one
 * dies does the order become `cancelled`, through orderStatusService, so the whole-order
 * side effects — coupon release, karma clawback, spin-prize clawback, CRM detach,
 * customer email — fire exactly once. Firing them per line would release the coupon
 * four times and email the customer four times for one decision.
 *
 * ── MONEY ─────────────────────────────────────────────────────────────────────────
 * Every amount comes from refundMathService. Σ(price × qty) is the LIST value before
 * coupon and karma; refunding it over-refunds every discounted order — a live bug in
 * this repo until 2026-08-03. The headroom cap additionally stops a cancellation
 * drawing money a return has already taken.
 */

import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import { applyCancellationRefundSideEffectsOnce } from './cancellationRefundSideEffects.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import orderStatusService from './orderStatusService.js';
import razorpayService from './razorpayService.js';
import { refundableForLines, remainingRefundable } from './refundMathService.js';
import {
  remainingCancellable,
  validateProposedCancellation,
  isFullyCancelled,
  cancellationSummary,
} from '../utils/orderCancellation.js';
import { SHIPMENT_STATUS } from '../utils/orderFulfilment.js';
import { supportsPartialRefund } from '../utils/paymentMethodDetails.js';
import { toPaise, fromPaise } from '../utils/money.js';
import * as Sentry from '@sentry/node';

// Bounded retries for the compare-and-set. A conflict means another admin cancelled
// something while we validated; re-reading resolves it. More than a couple of rounds
// means sustained contention on one order, which is not a real workflow.
const MAX_PUSH_ATTEMPTS = 4;

/**
 * Order states in which lines may be cancelled.
 *
 * `shipped` is included on purpose: a split order sits at `shipped` as soon as ONE
 * parcel goes, while other lines may not be in a box at all — and those are exactly the
 * ones an admin needs to cancel when stock never arrives. Per-line eligibility is
 * decided by utils/orderCancellation.js, which refuses anything already gone; this set
 * only rules out orders where cancellation makes no sense at all.
 */
const CANCELLABLE_ORDER_STATUSES = new Set(['awaiting_payment', 'processing', 'shipped']);

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

class CancellationService {
  /**
   * Cancel some units, and refund them.
   *
   * @param {string} orderId
   * @param {object} payload
   * @param {Array<{itemId: string, quantity: number}>} payload.lines
   * @param {string} [payload.reason]
   * @param {string} [payload.notes]
   * @param {object} [opts]
   * @param {string} [opts.userId] - the admin doing it
   * @returns {Promise<{success: boolean, message: string, order?, cancellation?, refund?}>}
   */
  async cancelLines(orderId, payload = {}, opts = {}) {
    const { userId } = opts;

    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt += 1) {
      const order = await orderRepository.findById(orderId);
      if (!order) return { success: false, message: 'Order not found' };

      if (!CANCELLABLE_ORDER_STATUSES.has(order.status)) {
        return {
          success: false,
          message: `Cannot cancel lines on an order in '${order.status}'.`,
        };
      }

      const lines = (payload.lines || []).map((l) => ({
        itemId: String(l.itemId),
        quantity: Number(l.quantity),
      }));

      const check = validateProposedCancellation(order, { lines });
      if (!check.valid) return { success: false, message: check.message };

      const willBeFull = this._isFullAfter(order, lines);
      const planned = this._plannedRefund(order, lines);

      /*
        Debit-card EMI cannot be partially refunded — the issuer will only unwind the
        whole plan. Refusing here, rather than letting Razorpay reject it later with an
        opaque error, means the admin is told the actual remedy.

        ⚠️ The test is MONEY, not line coverage. "Every line cancelled" is not the same
        as "the whole capture goes back": shipping is never refunded, so cancelling all
        the goods on an order with a delivery charge still sends a PARTIAL refund, which
        the issuer rejects. Comparing the refund against what was captured is the only
        honest test — the same one partialRefundBlockReason applies on the return path.
      */
      if (order.paymentStatus === 'paid') {
        const payment = order.payment ? await paymentRepository.findById(order.payment) : null;
        if (payment && !supportsPartialRefund(payment)
            && planned.productValuePaise < toPaise(order.totalAmount || 0)) {
          const shortfall = fromPaise(toPaise(order.totalAmount || 0) - planned.productValuePaise);
          return {
            success: false,
            message: 'This order was paid by debit-card EMI, which the bank can only refund in full. '
              + `Cancelling these lines refunds ₹${fromPaise(planned.productValuePaise)} of the `
              + `₹${order.totalAmount} captured (₹${shortfall} short — shipping is never refunded), `
              + 'and the bank will reject that. Refund the full amount manually in the Razorpay dashboard.',
          };
        }
      }

      const parcelEdits = this._parcelEditsFor(order, lines);

      const cancellation = {
        _id: new mongoose.Types.ObjectId(),
        sequence: (order.cancellations?.length || 0) + 1,
        lines,
        reason: payload.reason || 'admin_cancellation',
        notes: payload.notes,
        cancelledAt: new Date(),
        cancelledBy: userId,
        refund: planned,
      };

      const updated = await orderRepository.pushCancellationIfUnchanged(
        orderId,
        order.cancellations?.length || 0,
        cancellation,
        parcelEdits,
        // Pin the parcels too: a concurrent createShipment could otherwise commit the
        // very units this call just validated as free, shipping and refunding them both.
        order.shipments?.length || 0,
      );
      if (!updated) continue; // lost the race — re-read and re-validate

      const created = updated.cancellations[updated.cancellations.length - 1];

      // Roll the ORDER up only when nothing is left alive. Attribution belongs to this
      // call, so the userId is passed through — unlike the shipment roll-up, whose
      // caller records the action itself.
      await this._syncOrderStatus(updated, userId, payload.reason, payload.notes);

      return {
        success: true,
        message: willBeFull
          ? 'Every remaining line cancelled — the order is now cancelled.'
          : `Cancelled ${lines.reduce((n, l) => n + l.quantity, 0)} unit(s).`,
        order: updated,
        cancellation: created,
        refund: {
          status: created.refund.status,
          amountRupees: fromPaise(created.refund.productValuePaise),
        },
      };
    }

    return {
      success: false,
      message: 'Another cancellation was recorded on this order at the same time. Please review and try again.',
    };
  }

  /**
   * Send a recorded cancellation's refund to Razorpay.
   *
   * Split from `cancelLines` deliberately. Recording the cancellation is a local,
   * always-correct write; talking to the gateway can fail, time out, or succeed while
   * the response is lost. Keeping them apart means a failed refund leaves the
   * cancellation intact and retryable from the same button, instead of forcing the
   * whole thing to be undone.
   *
   * Idempotent by construction: the claim is matched on `refund.status === 'pending'`,
   * so a double-click or a retried job finds nothing to claim and is told the refund is
   * already running rather than sending a second one.
   *
   * @returns {Promise<{success: boolean, message: string, refund?, statusCode?: number}>}
   */
  async refundCancellation(orderId, cancellationId) {
    const order = await orderRepository.findById(orderId);
    if (!order) return { success: false, message: 'Order not found', statusCode: 404 };

    const record = (order.cancellations || []).find((c) => idOf(c._id) === String(cancellationId));
    if (!record) {
      return { success: false, message: 'Cancellation not found on this order', statusCode: 404 };
    }

    if (record.refund?.status === 'completed') {
      return { success: true, message: 'This cancellation has already been refunded.', alreadyRefunded: true };
    }
    if (record.refund?.status === 'processing') {
      return { success: false, message: 'A refund for this cancellation is already being processed.', statusCode: 409 };
    }

    if (order.paymentStatus !== 'paid') {
      return {
        success: false,
        message: 'No captured payment to refund — the lines are cancelled and nothing is owed.',
        statusCode: 400,
      };
    }

    const payment = order.payment ? await paymentRepository.findById(order.payment) : null;
    if (!payment?.gatewayPaymentId) {
      return {
        success: false,
        message: 'No Razorpay payment id on file for this order — refund manually in the dashboard.',
        statusCode: 422,
      };
    }

    /*
      Recompute from the ORDER rather than trusting the snapshot taken when the lines
      were cancelled. The snapshot is a record of intent; between then and now a return
      may have drawn part of the same capture, and the cap has to be applied against
      what is left TODAY. Same rule the return refund path follows.
    */
    const siblingReturns = await returnRequestRepository.find({ order: order._id }).select('refund').lean();
    const headroom = remainingRefundable(order, siblingReturns, null, payment, record._id);
    const wantedPaise = Math.max(0, Math.floor(Number(record.refund?.productValuePaise) || 0));
    const amountPaise = Math.min(wantedPaise, toPaise(headroom.remainingRupees));

    if (amountPaise <= 0) {
      // Nothing left to send. Recording it as not_applicable (rather than failing) stops
      // the admin retrying a button that can never succeed — e.g. a ₹0 line, or an
      // order whose capture has already been fully refunded by a return.
      await orderRepository.claimCancellationRefund(orderId, record._id, 0);
      await orderRepository.settleCancellationRefund(orderId, record._id, 'not_applicable', {
        failureReason: wantedPaise > 0
          ? `No refundable balance left on this order (₹${headroom.alreadyRefundedRupees} of ₹${headroom.capturedRupees} already refunded).`
          : 'These lines carried no refundable value.',
      });
      return {
        success: true,
        message: wantedPaise > 0
          ? `Nothing left to refund — ₹${headroom.alreadyRefundedRupees} of ₹${headroom.capturedRupees} has already gone back. Check the Razorpay dashboard.`
          : 'These lines carried no refundable value; nothing to refund.',
        refund: { status: 'not_applicable', amountRupees: 0 },
      };
    }

    // Race-safe claim: only the first caller proceeds to the gateway.
    const claimed = await orderRepository.claimCancellationRefund(orderId, record._id, amountPaise);
    if (!claimed) {
      return { success: false, message: 'A refund for this cancellation is already being processed.', statusCode: 409 };
    }

    try {
      const result = await razorpayService.refundPayment(payment.gatewayPaymentId, amountPaise, {
        orderId: order._id.toString(),
        cancellationId: String(record._id),
        reason: 'order_line_cancelled',
      });

      // Instant refunds come back already `processed`; normal ones settle later via the
      // refund.processed webhook.
      const completed = result.status === 'processed';

      await orderRepository.settleCancellationRefund(
        orderId, record._id, completed ? 'completed' : 'processing',
        { razorpayRefundId: result.refundId },
      );

      /*
        Accumulate onto the payment row rather than assigning, so a prior partial refund
        is not erased. Gated on a once-only claim because that write is an atomic $inc:
        an instant refund's webhook can land before this line runs and would otherwise
        count the same money twice. Same guard shape as the return refund path.
      */
      if (completed) await this._recordRefundSideEffects(orderId, record._id, payment, amountPaise);

      return {
        success: true,
        message: completed
          ? 'Refund completed.'
          : 'Refund initiated — funds typically settle in 5-7 business days.',
        refund: {
          id: result.refundId,
          status: completed ? 'completed' : 'processing',
          amountRupees: fromPaise(amountPaise),
        },
      };
    } catch (err) {
      // Roll the claim back so the admin can retry from the same button. Conditional on
      // still-processing, so a webhook that completed it in the meantime is not undone.
      await orderRepository.settleCancellationRefund(orderId, record._id, 'failed', {
        failureReason: err.message,
      });

      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setContext('cancellation_refund', {
            orderId: String(orderId),
            cancellationId: String(record._id),
            paymentId: payment.gatewayPaymentId,
            amountPaise,
          });
          scope.setTag('payment_action', 'cancellation_refund');
          scope.setTag('severity', 'high');
          Sentry.captureException(err);
        });
      }

      return { success: false, message: `Refund failed: ${err.message}`, statusCode: 502 };
    }
  }

  /**
   * Read-only view for the admin/customer screens.
   */
  async getCancellations(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order) return null;
    return {
      cancellations: order.cancellations || [],
      remaining: remainingCancellable(order),
      summary: cancellationSummary(order),
    };
  }

  /**
   * What these lines are worth, priced by refundMathService.
   *
   * `itemId` is passed through so the matcher can resolve the exact order line rather
   * than guessing from product+variant — the same product can legitimately appear as
   * two separate lines.
   * @private
   */
  _plannedRefund(order, lines) {
    const byItem = new Map((order.items || []).map((i) => [idOf(i._id), i]));
    const priced = lines.map((l) => {
      const item = byItem.get(l.itemId);
      return {
        itemId: l.itemId,
        product: item?.product,
        variantId: item?.variantId,
        quantity: l.quantity,
        unitPrice: item?.price,
      };
    });

    const { netRupees } = refundableForLines(order, priced);
    const productValuePaise = toPaise(netRupees);

    return {
      productValuePaise,
      amountPaise: 0,
      // An unpaid order owes nothing back: the lines simply die. Marking it pending
      // would leave a refund button that can never legitimately fire.
      status: order.paymentStatus === 'paid' && productValuePaise > 0 ? 'pending' : 'not_applicable',
      ltvAdjusted: false,
      paymentIncremented: false,
    };
  }

  /**
   * Would this cancellation leave nothing alive?
   * @private
   */
  _isFullAfter(order, lines) {
    const projected = {
      items: order.items,
      cancellations: [...(order.cancellations || []), { lines }],
    };
    return isFullyCancelled(projected);
  }

  /**
   * Pull cancelled units out of any parcel that has not shipped.
   *
   * A `packed` box has not left, so its contents can be edited. Without this the same
   * unit would be cancelled and refunded while still sitting in a box a packer is about
   * to hand over. Parcels that are shipped/delivered are untouched — their units were
   * refused by validation before we got here.
   *
   * @returns {Array<{shipmentId: string, lines: Array}>} replacement `lines` per parcel
   * @private
   */
  _parcelEditsFor(order, lines) {
    const toRemove = new Map();
    for (const l of lines) toRemove.set(l.itemId, (toRemove.get(l.itemId) || 0) + l.quantity);

    const edits = [];
    for (const shipment of order.shipments || []) {
      if (shipment.status !== SHIPMENT_STATUS.PACKED) continue;

      let touched = false;
      const nextLines = [];
      for (const line of shipment.lines || []) {
        const id = idOf(line.itemId);
        const owed = toRemove.get(id) || 0;
        if (owed <= 0) { nextLines.push({ itemId: line.itemId, quantity: line.quantity }); continue; }

        const take = Math.min(owed, line.quantity || 0);
        toRemove.set(id, owed - take);
        touched = true;

        const left = (line.quantity || 0) - take;
        // A line emptied to zero is dropped entirely: `quantity` has `min: 1`, so
        // writing 0 would fail schema validation on the next save of this document.
        if (left > 0) nextLines.push({ itemId: line.itemId, quantity: left });
      }

      /*
        A parcel emptied to zero lines is left in place, not deleted. MongoDB refuses
        $pull and $push on the same array in one update, so removing it would need a
        second write — and a crash between the two would lose the cancellation itself.
        An empty `packed` parcel is inert (it ships nothing and blocks nothing); the
        admin UI hides it. Deleting it is a separate, safe follow-up.
      */
      if (touched) edits.push({ shipmentId: shipment._id, lines: nextLines });
    }

    return edits;
  }

  /**
   * The two non-idempotent side effects of a completed refund, each behind a once-only
   * claim: the cumulative `$inc` on Payment.refundAmount, and the customer's LTV
   * decrement. Both must survive an instant refund whose webhook races this call.
   * @private
   */
  async _recordRefundSideEffects(orderId, cancellationId, payment, amountPaise) {
    await applyCancellationRefundSideEffectsOnce(
      orderId, cancellationId, payment?._id, amountPaise);
  }

  /**
   * Bring `Order.status` in line with its cancellations.
   *
   * Fires ONLY when the last live unit dies. Routed through orderStatusService so a
   * full cancellation keeps every meaning it has always had — status history, the
   * coupon release, the karma and spin-prize clawbacks, the CRM detach, the admin alert
   * and the customer email — and gets them exactly once.
   * @private
   */
  async _syncOrderStatus(order, userId, reason, notes) {
    if (!isFullyCancelled(order)) return;
    if (order.status === 'cancelled') return;

    const attempt = () => orderStatusService.updateOrderStatus(order._id.toString(), 'cancelled', {
      userId,
      isAdmin: true,
      cancelledBy: 'admin',
      reason: reason || 'customer_request',
      notes: notes || 'Every remaining line was cancelled individually',
    });

    /*
      No transaction here, for the same reasons as the shipment roll-up: both writes
      target the SAME document, and this repo has already paid once for wrapping
      orderStatusService in a session — a session-less write to a document an open
      transaction had itself written self-deadlocked until Mongo's 60-second reaper and
      broke every Razorpay capture.

      What makes the gap safe is that the roll-up is DERIVED: the cancellations are the
      source of truth and `Order.status` is a cached conclusion about them, recomputed on
      the next cancellation. So: retry once, then say so loudly enough to be repaired.
    */
    let result = await attempt();
    if (!result?.success) result = await attempt();

    if (!result?.success) {
      const message =
        `[Cancellation] Roll-up to 'cancelled' FAILED for order ${order._id}: `
        + `${result?.message || 'unknown error'}. Every line is cancelled and the refund is `
        + 'recorded, but Order.status is stale — the coupon release, karma/spin clawback and '
        + 'customer email have NOT run. Needs manual repair.';
      console.error(message);
      Sentry.captureMessage(message, 'error');
    }
  }
}

export default new CancellationService();
