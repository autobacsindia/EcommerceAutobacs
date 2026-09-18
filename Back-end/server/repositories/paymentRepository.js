import BaseRepository from './baseRepository.js';
import Payment from '../models/Payment.js';
import { toPaise, fromPaise } from '../utils/money.js';

/**
 * Lookup filter for the MONEY-CRITICAL `gatewayPaymentId_1` index.
 *
 * That index is `unique` + `partialFilterExpression: { gatewayPaymentId: { $type:
 * "string" } }`. The partial filter is load-bearing and must NOT be removed: it
 * keeps legacy/null gatewayPaymentId docs (migrated WooCommerce orders) from
 * colliding on null under the unique constraint, and that uniqueness is the
 * serialization point that makes webhook processing idempotent.
 *
 * But MongoDB's planner will not infer that `{ gatewayPaymentId: "pay_x" }` is
 * inside `{ $type: "string" }`, so the bare form silently COLLSCANs. Restating
 * `$type` makes the predicate a provable subset and brings the index back. Same
 * defect that cost `carts` a 59,638-doc scan per read — see
 * repositories/cartRepository.js and tests/paymentIndexUsage.test.js.
 *
 * Uniqueness was never affected, only lookup cost: this is a performance fix on
 * the webhook path, not a correctness change.
 */
export const gatewayPaymentIdFilter = (gatewayPaymentId) => ({
  gatewayPaymentId: { $eq: gatewayPaymentId, $type: 'string' },
});

class PaymentRepository extends BaseRepository {
  constructor() {
    super(Payment);
  }

  /**
   * Create a payment record, optionally inside a transaction session.
   * Uses create([data], { session }) array form so the session is honoured.
   */
  async createPayment(data, session = null) {
    if (session) {
      const [payment] = await Payment.create([data], { session });
      return payment;
    }
    const payment = new Payment(data);
    return payment.save();
  }

  async findByOrderAndGatewayId(orderId, gatewayPaymentId, session = null) {
    let q = Payment.findOne({ order: orderId, ...gatewayPaymentIdFilter(gatewayPaymentId) });
    if (session) q = q.session(session);
    return q;
  }

  async findByGatewayPaymentId(gatewayPaymentId, session = null) {
    let q = Payment.findOne(gatewayPaymentIdFilter(gatewayPaymentId));
    if (session) q = q.session(session);
    return q;
  }

  async save(payment, session = null) {
    if (session) return payment.save({ session });
    return payment.save();
  }

  /**
   * MONEY-CRITICAL: add a settled refund to a payment row.
   *
   * `refundAmount` is CUMULATIVE — an order can be refunded several times (one per
   * returned line), so this is an atomic `$inc`, never a read-modify-write or an
   * assignment. Both refund webhooks used to assign `refundEntity.amount / 100`,
   * which meant a second partial refund overwrote the first and the row under-reported
   * what had actually been sent back.
   *
   * `status` flips to `refunded` only once the cumulative total covers the capture;
   * a partial refund leaves it `completed` so the order still reads as paid.
   *
   * ROUNDING: `refundAmount` is a rupee FLOAT and `$inc` accumulates binary error, so
   * the "is it fully refunded?" test MUST be done in integer paise. Comparing the
   * rupee floats directly loses roughly one split in nine — e.g.
   * `16000.88 + 12682.50 === 28683.379999999997`, which is `< 28683.38`, so a payment
   * that HAS been refunded in full silently never reaches `refunded`. The flip write
   * also normalises the drift out of the stored value so it cannot compound.
   *
   * NOT idempotent by design — `$inc` applies every call. Callers must gate it behind
   * a once-only claim (orderRepository.claimRefundPaymentRecord /
   * returnRequestRepository.claimRefundPaymentRecord) so a controller racing its own
   * webhook cannot double-count the same refund.
   *
   * @param {string|ObjectId} paymentId
   * @param {number} amountRupees - the amount settled by THIS refund
   * @param {string} reason
   * @returns {Promise<Object|null>} the updated payment
   */
  async recordRefund(paymentId, amountRupees, reason) {
    const amount = fromPaise(toPaise(amountRupees));
    if (amount <= 0) return null;

    const updated = await Payment.findByIdAndUpdate(
      paymentId,
      {
        $inc: { refundAmount: amount },
        $set: { refundReason: reason, refundedAt: new Date() },
      },
      { new: true }
    );
    if (!updated) return null;

    // Second write, deliberately: the terminal status depends on the POST-increment
    // total, which only the atomic $inc above can tell us. Conditional so a racing
    // refund that already flipped it is not undone.
    const refundedPaise = toPaise(updated.refundAmount);
    if (updated.status !== 'refunded' && refundedPaise >= toPaise(updated.amount)) {
      return Payment.findOneAndUpdate(
        { _id: paymentId, status: { $ne: 'refunded' } },
        { $set: { status: 'refunded', refundAmount: fromPaise(refundedPaise) } },
        { new: true }
      );
    }
    return updated;
  }

  /**
   * MONEY-CRITICAL: take a refund back OFF a payment row.
   *
   * The exact inverse of recordRefund, for an admin withdrawing an offline refund
   * record that was a mistake. ONLY ever valid for money that never actually left —
   * a gateway refund is real and its row must stand.
   *
   * ⚠️ `refundAmount` is the FLOOR that refundMathService.remainingRefundable uses
   * (`Math.max(our records, payment.refundAmount)`), so a revert that skips this leaves
   * the headroom permanently consumed and the order unrefundable. That is the SAFE
   * direction to fail in — it blocks a payout rather than allowing a second one — which
   * is why the caller runs this best-effort AFTER the refund record itself is withdrawn,
   * and reports a warning instead of rolling back.
   *
   * Clamped at 0 by an aggregation-pipeline update, in one atomic write, so concurrent
   * reverts can never drive the row negative and start reading as though we owe money.
   *
   * ROUNDING: the comparison that un-flips `status` is done in integer PAISE for the
   * same reason recordRefund's is — `refundAmount` is a rupee float accumulated by
   * `$inc`, and comparing the floats loses roughly one split in nine.
   *
   * @param {string|ObjectId} paymentId
   * @param {number} amountRupees - what THIS reversal takes back off
   * @returns {Promise<Object|null>} the updated payment, or null if nothing to do
   */
  async reverseRefund(paymentId, amountRupees) {
    const amount = fromPaise(toPaise(amountRupees));
    if (amount <= 0) return null;

    const updated = await Payment.findByIdAndUpdate(
      paymentId,
      [
        {
          $set: {
            refundAmount: {
              $max: [0, { $subtract: [{ $ifNull: ['$refundAmount', 0] }, amount] }],
            },
          },
        },
      ],
      { new: true }
    );
    if (!updated) return null;

    /*
      Un-flip the terminal status. recordRefund sets `refunded` once the cumulative
      total covers the capture; with money taken back off, that is no longer true and
      the payment is a completed capture again. Conditional on it still being
      `refunded` so a racing write is not undone.
    */
    const refundedPaise = toPaise(updated.refundAmount);
    if (updated.status === 'refunded' && refundedPaise < toPaise(updated.amount)) {
      return Payment.findOneAndUpdate(
        { _id: paymentId, status: 'refunded' },
        { $set: { status: 'completed' } },
        { new: true }
      );
    }
    return updated;
  }
}

export default new PaymentRepository();
