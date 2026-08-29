/**
 * Partial cancellation — the service, against a real database.
 *
 * The pure maths lives in tests/unit/utils/orderCancellation.test.js. What can only be
 * proved here is what depends on real concurrent writes, real persistence and real
 * money: that two admins cancelling at once cannot over-cancel, that a refund cannot be
 * sent twice for the same lines, that cancelled units are physically pulled out of an
 * unshipped parcel in the same write, and that the order only rolls up to `cancelled`
 * when the LAST live line dies.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import cancellationService from '../services/cancellationService.js';
import razorpayService from '../services/razorpayService.js';
import orderStatusService from '../services/orderStatusService.js';
import { remainingToShip, isFullyDelivered } from '../utils/orderFulfilment.js';
import { remainingCancellable } from '../utils/orderCancellation.js';

const ADMIN = new mongoose.Types.ObjectId();

/** A paid order: Wax ₹500 ×2, Polish ₹250 ×1 — subtotal & total ₹1250, no discount. */
const seedOrder = async (over = {}) => Order.create({
  user: new mongoose.Types.ObjectId(),
  items: [
    { product: new mongoose.Types.ObjectId(), name: 'Wax', price: 500, quantity: 2 },
    { product: new mongoose.Types.ObjectId(), name: 'Polish', price: 250, quantity: 1 },
  ],
  shippingAddress: {
    fullName: 'Asha K', phone: '9999999999', addressLine1: '1 Road',
    city: 'Kochi', state: 'Kerala', postalCode: '682001',
  },
  subtotal: 1250, totalAmount: 1250,
  status: 'processing', paymentStatus: 'paid',
  ...over,
});

const seedPayment = async (order, methodDetails = undefined) => {
  const payment = await Payment.create({
    order: order._id,
    user: order.user,
    amount: order.totalAmount,
    gatewayPaymentId: 'pay_TEST123',
    paymentGateway: 'razorpay',
    paymentMethod: 'credit_card',
    status: 'completed',
    ...(methodDetails ? { methodDetails } : {}),
  });
  await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
  return payment;
};

const itemIds = (order) => order.items.map((i) => String(i._id));
const reload = (order) => Order.findById(order._id);

afterEach(async () => {
  await Order.deleteMany({});
  await Payment.deleteMany({});
  await User.deleteMany({});
  jest.restoreAllMocks();
});

describe('cancelLines', () => {
  it('records the cancellation and prices it net of nothing on a full-price order', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);

    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN },
    );

    expect(res.success).toBe(true);
    expect(res.refund.amountRupees).toBe(500);
    const fresh = await reload(order);
    expect(fresh.cancellations).toHaveLength(1);
    expect(fresh.cancellations[0].refund.status).toBe('pending');
    // The order itself is untouched: it records what was CHARGED.
    expect(fresh.totalAmount).toBe(1250);
    expect(fresh.status).toBe('processing');
  });

  /*
    THE MONEY RULE. The line's list value is ₹500, but a ₹250 order-level coupon means
    the customer paid ₹1000 for ₹1250 of goods. Refunding the list value hands back
    money that was never taken — the exact over-refund refundMathService exists to stop.
    500 × (1000/1250) = 400.
  */
  it('refunds the DISCOUNTED share of a line, never its list price', async () => {
    const order = await seedOrder({ discount: 250, couponDiscount: 250, totalAmount: 1000 });
    const [wax] = itemIds(order);

    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN },
    );

    expect(res.refund.amountRupees).toBe(400);
  });

  it('refuses to cancel more than the line holds', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);
    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 3 }] }, { userId: ADMIN },
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/only 2 left to cancel/i);
  });

  it('refuses a line that has already shipped, pointing at returns instead', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);
    await Order.updateOne({ _id: order._id }, {
      $push: { shipments: { sequence: 1, status: 'shipped', lines: [{ itemId: wax, quantity: 2 }] } },
      $set: { status: 'shipped' },
    });

    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN },
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/return/i);
  });

  /*
    Debit-card EMI can only be unwound whole. Letting it through would reach Razorpay
    and fail there with an opaque message, after the cancellation was already recorded.
  */
  it('refuses a PARTIAL cancellation paid by debit-card EMI', async () => {
    const order = await seedOrder();
    await seedPayment(order, { emi: { kind: 'debit_card', issuer: 'HDFC', months: 6 } });
    const [wax] = itemIds(order);

    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN },
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/debit-card EMI/i);
    // The message names the shortfall and the remedy, so the admin is not left guessing
    // why Razorpay would have rejected it.
    expect(res.message).toMatch(/₹500 of the ₹1250 captured/);
    expect(res.message).toMatch(/manually in the Razorpay dashboard/i);
  });

  // A FULL cancellation ends as a full refund, which debit EMI does allow.
  it('allows cancelling EVERY line on a debit-card EMI order', async () => {
    const order = await seedOrder();
    await seedPayment(order, { emi: { kind: 'debit_card', issuer: 'HDFC', months: 6 } });
    const [wax, polish] = itemIds(order);

    const res = await cancellationService.cancelLines(
      order._id.toString(),
      { lines: [{ itemId: wax, quantity: 2 }, { itemId: polish, quantity: 1 }] },
      { userId: ADMIN },
    );
    expect(res.success).toBe(true);
  });

  it('marks the refund not_applicable on an unpaid order — nothing was ever taken', async () => {
    const order = await seedOrder({ status: 'awaiting_payment', paymentStatus: 'pending' });
    const [wax] = itemIds(order);

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN },
    );
    const fresh = await reload(order);
    expect(fresh.cancellations[0].refund.status).toBe('not_applicable');
  });
});

describe('cancelLines — interaction with parcels', () => {
  /*
    A packed box has not left, so its units are cancellable. If the parcel were not
    edited in the same write, the same unit would be cancelled-and-refunded while still
    sitting in a box a packer is about to hand to a courier.
  */
  it('pulls cancelled units out of a PACKED parcel in the same write', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);
    await Order.updateOne({ _id: order._id }, {
      $push: { shipments: { sequence: 1, status: 'packed', lines: [{ itemId: wax, quantity: 2 }] } },
    });

    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN },
    );

    expect(res.success).toBe(true);
    const fresh = await reload(order);
    expect(fresh.shipments[0].lines).toHaveLength(1);
    expect(fresh.shipments[0].lines[0].quantity).toBe(1);
  });

  // `quantity` has min:1, so a line emptied to zero must be dropped, not written as 0 —
  // otherwise the next save of this document fails schema validation.
  it('drops a parcel line emptied to zero rather than writing quantity 0', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);
    await Order.updateOne({ _id: order._id }, {
      $push: { shipments: { sequence: 1, status: 'packed', lines: [{ itemId: wax, quantity: 2 }] } },
    });

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }] }, { userId: ADMIN },
    );

    const fresh = await reload(order);
    expect(fresh.shipments[0].lines).toHaveLength(0);
    await expect(fresh.save()).resolves.toBeTruthy();
  });

  /*
    Without this the order could never complete: the cancelled unit would sit in
    remainingToShip forever, so the order could never be fully shipped, never reach
    `delivered`, and never open the return window or award karma.
  */
  it('takes cancelled units out of remainingToShip', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }] }, { userId: ADMIN },
    );

    const fresh = await reload(order);
    expect(remainingToShip(fresh).map((l) => l.itemId)).not.toContain(wax);
  });

  it('lets a partly cancelled order still reach fully-delivered', async () => {
    const order = await seedOrder();
    const [wax, polish] = itemIds(order);

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }] }, { userId: ADMIN },
    );
    await Order.updateOne({ _id: order._id }, {
      $push: {
        shipments: {
          sequence: 1, status: 'delivered', deliveredAt: new Date(),
          lines: [{ itemId: polish, quantity: 1 }],
        },
      },
    });

    expect(isFullyDelivered(await reload(order))).toBe(true);
  });
});

describe('cancelLines — the order-level roll-up', () => {
  it('leaves the order alone while any line is still live', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN },
    );
    expect((await reload(order)).status).toBe('processing');
  });

  it('cancels the ORDER when the last live line goes', async () => {
    const order = await seedOrder();
    const [wax, polish] = itemIds(order);

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }] }, { userId: ADMIN },
    );
    expect((await reload(order)).status).toBe('processing');

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }] }, { userId: ADMIN },
    );

    const fresh = await reload(order);
    expect(fresh.status).toBe('cancelled');
    expect(fresh.cancelledBy).toBe('admin');
  });

  /*
    The side effects of a whole-order cancel — coupon release, karma clawback,
    spin-prize clawback, CRM detach, customer email — all hang off ONE
    updateOrderStatus call. Firing it per line would release the coupon three times and
    email the customer three times for one decision.
  */
  it('runs the whole-order side effects exactly ONCE, on the final line', async () => {
    const order = await seedOrder();
    const [wax, polish] = itemIds(order);
    const spy = jest.spyOn(orderStatusService, 'updateOrderStatus');

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });
    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });
    expect(spy).not.toHaveBeenCalled();

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }] }, { userId: ADMIN });

    const cancelCalls = spy.mock.calls.filter(([, status]) => status === 'cancelled');
    expect(cancelCalls).toHaveLength(1);
  });
});

describe('cancelLines — concurrency', () => {
  /*
    Two admins cancelling the same line at once. Each reads "2 left", each validates
    happily, and without the compare-and-set both push — cancelling and refunding four
    units of a two-unit line.
  */
  it('cannot over-cancel when two admins act at the same time', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);

    const [a, b] = await Promise.all([
      cancellationService.cancelLines(
        order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }] }, { userId: ADMIN }),
      cancellationService.cancelLines(
        order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }] }, { userId: ADMIN }),
    ]);

    expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
    const fresh = await reload(order);
    const cancelledUnits = fresh.cancellations
      .flatMap((c) => c.lines)
      .reduce((n, l) => n + l.quantity, 0);
    expect(cancelledUnits).toBe(2);
  });
});

describe('refundCancellation', () => {
  const mockRefund = (status = 'processed') =>
    jest.spyOn(razorpayService, 'refundPayment').mockResolvedValue({ refundId: 'rfnd_1', status });

  const cancelOne = async (order) => {
    const [wax] = itemIds(order);
    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });
    return res.cancellation._id.toString();
  };

  it('sends the recorded amount to the gateway and completes', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const cid = await cancelOne(order);
    const spy = mockRefund();

    const res = await cancellationService.refundCancellation(order._id.toString(), cid);

    expect(res.success).toBe(true);
    expect(spy).toHaveBeenCalledWith('pay_TEST123', 50000, expect.objectContaining({ reason: 'order_line_cancelled' }));
    const fresh = await reload(order);
    expect(fresh.cancellations[0].refund.status).toBe('completed');
    expect(fresh.cancellations[0].refund.razorpayRefundId).toBe('rfnd_1');
  });

  /*
    THE IDEMPOTENCY CASE. A double-clicked Refund button, or a retried job, must not
    send a second refund for the same lines.
  */
  it('sends ONE refund when called twice for the same cancellation', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const cid = await cancelOne(order);
    const spy = mockRefund();

    await cancellationService.refundCancellation(order._id.toString(), cid);
    const second = await cancellationService.refundCancellation(order._id.toString(), cid);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.alreadyRefunded).toBe(true);
  });

  it('sends ONE refund under two concurrent calls', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const cid = await cancelOne(order);
    const spy = mockRefund();

    await Promise.all([
      cancellationService.refundCancellation(order._id.toString(), cid),
      cancellationService.refundCancellation(order._id.toString(), cid),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  /*
    THE OVER-DRAW GUARD. A prior cancellation refund has already taken ₹1250 of the
    ₹1250 capture. The second must not reach the gateway, which would reject it with an
    opaque "refund amount provided is greater than amount captured".
  */
  it('refuses to draw more than the capture, counting earlier cancellation refunds', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const [wax, polish] = itemIds(order);

    const first = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }] }, { userId: ADMIN });
    const second = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }] }, { userId: ADMIN });

    const spy = mockRefund();
    await cancellationService.refundCancellation(order._id.toString(), first.cancellation._id.toString());

    // Pretend the first refund drew the WHOLE capture (a hand-issued dashboard top-up).
    await Order.updateOne(
      { _id: order._id, 'cancellations._id': first.cancellation._id },
      { $set: { 'cancellations.$.refund.amountPaise': 125000 } },
    );

    spy.mockClear();
    const res = await cancellationService.refundCancellation(
      order._id.toString(), second.cancellation._id.toString());

    expect(spy).not.toHaveBeenCalled();
    expect(res.message).toMatch(/nothing left to refund/i);
    const fresh = await reload(order);
    expect(fresh.cancellations[1].refund.status).toBe('not_applicable');
  });

  it('rolls the claim back to failed when the gateway throws, so it can be retried', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const cid = await cancelOne(order);
    jest.spyOn(razorpayService, 'refundPayment').mockRejectedValue(new Error('gateway down'));

    const res = await cancellationService.refundCancellation(order._id.toString(), cid);

    expect(res.success).toBe(false);
    const fresh = await reload(order);
    expect(fresh.cancellations[0].refund.status).toBe('failed');
    expect(fresh.cancellations[0].refund.failureReason).toMatch(/gateway down/i);
  });

  it('leaves a normal-speed refund in processing, to settle via the webhook', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const cid = await cancelOne(order);
    mockRefund('pending');

    await cancellationService.refundCancellation(order._id.toString(), cid);
    expect((await reload(order)).cancellations[0].refund.status).toBe('processing');
  });

  it('refuses when the order was never paid', async () => {
    const order = await seedOrder({ status: 'awaiting_payment', paymentStatus: 'pending' });
    const cid = await cancelOne(order);
    const res = await cancellationService.refundCancellation(order._id.toString(), cid);
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('404s for a cancellation id that is not on the order', async () => {
    const order = await seedOrder();
    const res = await cancellationService.refundCancellation(
      order._id.toString(), new mongoose.Types.ObjectId().toString());
    expect(res.statusCode).toBe(404);
  });
});

/**
 * The refund webhook.
 *
 * A normal-speed refund leaves the gateway as `pending` and only settles minutes later,
 * via `refund.processed`. Without a branch that routes on `notes.cancellationId`, that
 * webhook falls through to the ORDER-level path, mismatches on
 * `refundDetails.transactionId`, and the cancellation record sits in `processing`
 * for ever — with its Payment.refundAmount increment never running. Silent, and only
 * visible as a finance discrepancy weeks later.
 */
describe('applyCancellationRefundWebhook', () => {
  const cancelAndRefund = async (order, { instant = false } = {}) => {
    const [wax] = itemIds(order);
    const created = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });
    jest.spyOn(razorpayService, 'refundPayment')
      .mockResolvedValue({ refundId: 'rfnd_1', status: instant ? 'processed' : 'pending' });
    await cancellationService.refundCancellation(
      order._id.toString(), created.cancellation._id.toString());
    return created.cancellation._id.toString();
  };

  const entity = (cid, orderId, over = {}) => ({
    id: 'rfnd_1',
    amount: 50000,
    notes: { orderId: String(orderId), cancellationId: String(cid) },
    ...over,
  });

  it('settles a normal-speed refund and records the money on the payment', async () => {
    const order = await seedOrder();
    const payment = await seedPayment(order);
    const cid = await cancelAndRefund(order);

    await razorpayService.applyCancellationRefundWebhook(
      'rfnd_1', cid, entity(cid, order._id), 'completed');

    const fresh = await reload(order);
    expect(fresh.cancellations[0].refund.status).toBe('completed');
    expect((await Payment.findById(payment._id)).refundAmount).toBe(500);
  });

  // Razorpay retries webhooks. The second delivery must change nothing.
  it('is a no-op when the same webhook is replayed', async () => {
    const order = await seedOrder();
    const payment = await seedPayment(order);
    const cid = await cancelAndRefund(order);

    await razorpayService.applyCancellationRefundWebhook('rfnd_1', cid, entity(cid, order._id), 'completed');
    await razorpayService.applyCancellationRefundWebhook('rfnd_1', cid, entity(cid, order._id), 'completed');

    expect((await Payment.findById(payment._id)).refundAmount).toBe(500);
  });

  /*
    THE RACE. An instant refund is settled by the controller AND generates a webhook.
    Both paths increment Payment.refundAmount, which is an atomic $inc and therefore not
    idempotent on its own. The once-only claim is what stops the same money counting
    twice.
  */
  it('does not double-count when an instant refund races its own webhook', async () => {
    const order = await seedOrder();
    const payment = await seedPayment(order);
    const cid = await cancelAndRefund(order, { instant: true });

    await razorpayService.applyCancellationRefundWebhook(
      'rfnd_1', cid, entity(cid, order._id), 'completed');

    expect((await Payment.findById(payment._id)).refundAmount).toBe(500);
  });

  it('records a gateway failure with its reason, and takes no money', async () => {
    const order = await seedOrder();
    const payment = await seedPayment(order);
    const cid = await cancelAndRefund(order);

    await razorpayService.applyCancellationRefundWebhook(
      'rfnd_1', cid,
      entity(cid, order._id, { error: { description: 'Bank declined' } }),
      'failed',
    );

    const fresh = await reload(order);
    expect(fresh.cancellations[0].refund.status).toBe('failed');
    expect(fresh.cancellations[0].refund.failureReason).toMatch(/bank declined/i);
    expect((await Payment.findById(payment._id)).refundAmount || 0).toBe(0);
  });

  // A refund id that is not ours must never be applied to our record.
  it('ignores a webhook whose refund id does not match the stored one', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const cid = await cancelAndRefund(order);

    await razorpayService.applyCancellationRefundWebhook(
      'rfnd_SOMEONE_ELSE', cid,
      entity(cid, order._id, { id: 'rfnd_SOMEONE_ELSE' }),
      'completed',
    );

    expect((await reload(order)).cancellations[0].refund.status).toBe('processing');
  });

  it('survives a webhook for a cancellation that is not on the order', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    await cancelAndRefund(order);
    const stranger = new mongoose.Types.ObjectId().toString();

    await expect(razorpayService.applyCancellationRefundWebhook(
      'rfnd_1', stranger, entity(stranger, order._id), 'completed',
    )).resolves.toBeUndefined();
  });
});

/**
 * The double-refund hole.
 *
 * Rolling the order up to `cancelled` runs orderStatusService, which auto-flags a
 * whole-order refund for the FULL totalAmount whenever money was captured. On an order
 * cancelled line by line that is a SECOND claim on the same capture, sitting beside the
 * per-line records — and because a `pending` cancellation refund is not yet counted
 * against the headroom, both would reach the gateway and both would succeed.
 */
describe('whole-order refund cannot double up with per-line refunds', () => {
  const cancelEverything = async (order) => {
    const [wax, polish] = itemIds(order);
    await cancellationService.cancelLines(order._id.toString(),
      { lines: [{ itemId: wax, quantity: 2 }, { itemId: polish, quantity: 1 }] }, { userId: ADMIN });
  };

  it('does not flag an order-level refund when the lines carry their own', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    await cancelEverything(order);

    const fresh = await reload(order);
    expect(fresh.status).toBe('cancelled');
    // The per-line record holds the money; there must be no second, full-total claim.
    expect(fresh.cancellations[0].refund.status).toBe('pending');
    expect(fresh.refundDetails?.requestedAt).toBeFalsy();
  });

  // An ordinary whole-order cancel, with no line cancellations, must be untouched.
  it('still flags the order-level refund on a plain whole-order cancel', async () => {
    const order = await seedOrder();
    await seedPayment(order);

    await orderStatusService.updateOrderStatus(order._id.toString(), 'cancelled', {
      userId: ADMIN, isAdmin: true, cancelledBy: 'admin', reason: 'customer_request',
    });

    const fresh = await reload(order);
    expect(fresh.refundDetails?.status).toBe('pending');
    expect(fresh.refundDetails?.amount).toBe(1250);
  });
});

/**
 * Regressions from the code review of 2026-08-29. Every one of these passed a green
 * test suite while being broken in production, so each is pinned by the condition that
 * actually failed rather than by the happy path.
 */
describe('review regressions', () => {
  /*
    THE ONE THAT WOULD HAVE BROKEN EVERY ORDER.

    `{ cancellations: { $size: 0 } }` does not match a document that LACKS the field.
    `cancellations` is new, so no order written before it existed has the key — 1,599 of
    1,599 production orders. The first cancellation on every one of them would have hit
    the compare-and-set, matched nothing, exhausted its retries and returned "another
    cancellation was recorded at the same time".

    Invisible to every other test here because Order.create() materialises
    `cancellations: []` from the schema. This one strips the field, as production has it.
  */
  it('cancels an order written BEFORE the cancellations field existed', async () => {
    const order = await seedOrder();
    await Order.collection.updateOne({ _id: order._id }, { $unset: { cancellations: '' } });
    expect(await Order.collection.findOne({ _id: order._id, cancellations: { $exists: true } })).toBeNull();

    const [wax] = itemIds(order);
    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });

    expect(res.success).toBe(true);
    expect((await reload(order)).cancellations).toHaveLength(1);
  });

  // Same hole on the shipments side of the guard.
  it('cancels an order written before the shipments field existed', async () => {
    const order = await seedOrder();
    await Order.collection.updateOne({ _id: order._id },
      { $unset: { cancellations: '', shipments: '' } });

    const [wax] = itemIds(order);
    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });
    expect(res.success).toBe(true);
  });

  /*
    A gateway failure rolls the record back to `failed` precisely so it can be retried,
    and the admin panel shows a "Retry refund" button for it. Claiming only `pending`
    made that button permanently answer "already being processed".
  */
  it('lets a FAILED refund be retried', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const [wax] = itemIds(order);
    const created = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });
    const cid = created.cancellation._id.toString();

    jest.spyOn(razorpayService, 'refundPayment').mockRejectedValueOnce(new Error('gateway down'));
    await cancellationService.refundCancellation(order._id.toString(), cid);
    expect((await reload(order)).cancellations[0].refund.status).toBe('failed');

    jest.spyOn(razorpayService, 'refundPayment')
      .mockResolvedValue({ refundId: 'rfnd_retry', status: 'processed' });
    const retry = await cancellationService.refundCancellation(order._id.toString(), cid);

    expect(retry.success).toBe(true);
    expect((await reload(order)).cancellations[0].refund.status).toBe('completed');
  });

  /*
    A partly cancelled order is still a purchase, so the order COUNT stays put and only
    the refunded money leaves `totalSpentPaise`. Nothing was decrementing it, while
    `ltvAdjusted` was being set to true — which would also make a future repair job skip
    exactly the rows that needed repairing.
  */
  it('decrements the customer LTV by the refunded amount, once', async () => {
    const user = await User.create({
      name: 'Asha K', email: `ltv-${Date.now()}@example.com`,
      passwordHash: 'x'.repeat(60), totalSpentPaise: 125000,
    });
    const order = await seedOrder({ user: user._id });
    await seedPayment(order);
    const [wax] = itemIds(order);
    const created = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });
    jest.spyOn(razorpayService, 'refundPayment')
      .mockResolvedValue({ refundId: 'rfnd_ltv', status: 'processed' });

    await cancellationService.refundCancellation(
      order._id.toString(), created.cancellation._id.toString());

    expect((await User.findById(user._id)).totalSpentPaise).toBe(125000 - 50000);

    // The webhook for the same refund must not subtract it a second time.
    await razorpayService.applyCancellationRefundWebhook(
      'rfnd_ltv', created.cancellation._id.toString(),
      { id: 'rfnd_ltv', amount: 50000, notes: { orderId: String(order._id) } },
      'completed',
    );
    expect((await User.findById(user._id)).totalSpentPaise).toBe(75000);
  });

  /*
    A whole-order cancel on an order that ALREADY has cancellations used to move it to
    `cancelled` while recording no refund for the lines still live: orderStatusService
    skips its auto-flag once cancellations exist, and processRefund refuses such orders.
    That money silently never went back.
  */
  it('refunds the still-live lines when the whole order is cancelled afterwards', async () => {
    const order = await seedOrder();
    await seedPayment(order);
    const [wax, polish] = itemIds(order);

    await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });

    // What PUT /orders/:id/cancel now delegates to for the remainder.
    const rest = remainingCancellable(await reload(order));
    const res = await cancellationService.cancelLines(
      order._id.toString(),
      { lines: rest.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) },
      { userId: ADMIN },
    );

    expect(res.success).toBe(true);
    const fresh = await reload(order);
    expect(fresh.status).toBe('cancelled');
    // Every unit is now covered by a refund record — nothing stranded.
    const covered = fresh.cancellations
      .flatMap((c) => c.lines).reduce((n, l) => n + l.quantity, 0);
    expect(covered).toBe(3);
    const owed = fresh.cancellations
      .reduce((n, c) => n + c.refund.productValuePaise, 0);
    expect(owed).toBe(125000); // the whole goods value, in paise
    expect(polish).toBeTruthy();
  });

  /*
    "Every line cancelled" is not "the whole capture goes back": shipping is never
    refunded, so an order with a delivery charge still produces a PARTIAL refund, which
    a debit-card EMI issuer rejects. The block has to compare money, not line coverage.
  */
  it('blocks a debit-EMI order whose lines cover everything but shipping does not', async () => {
    const order = await seedOrder({ shippingCost: 100, totalAmount: 1350 });
    await seedPayment(order, { emi: { kind: 'debit_card', issuer: 'HDFC', months: 6 } });
    const [wax, polish] = itemIds(order);

    const res = await cancellationService.cancelLines(
      order._id.toString(),
      { lines: [{ itemId: wax, quantity: 2 }, { itemId: polish, quantity: 1 }] },
      { userId: ADMIN },
    );

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/debit-card EMI/i);
    expect(res.message).toMatch(/shipping is never refunded/i);
  });

  // A parcel dispatched between the read and the write must not have its lines
  // rewritten in transit — units pulled from a box the courier already has.
  it('loses the race rather than editing a parcel that shipped mid-flight', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);
    await Order.updateOne({ _id: order._id }, {
      $push: { shipments: { sequence: 1, status: 'packed', lines: [{ itemId: wax, quantity: 2 }] } },
    });

    const fresh = await reload(order);
    const shipmentId = fresh.shipments[0]._id;
    // The parcel goes out after validation would have read it as `packed`.
    await Order.updateOne(
      { _id: order._id, 'shipments._id': shipmentId },
      { $set: { 'shipments.$.status': 'shipped' } },
    );

    const res = await cancellationService.cancelLines(
      order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }] }, { userId: ADMIN });

    expect(res.success).toBe(false);
    // And the dispatched parcel still holds everything it left with.
    expect((await reload(order)).shipments[0].lines[0].quantity).toBe(2);
  });
});
