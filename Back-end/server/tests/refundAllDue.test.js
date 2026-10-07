/**
 * The order page's single "Refund" button — cancellationService.refundAllDue.
 *
 * It only orchestrates the per-line refund path, so what must be proved is that the
 * orchestration never pays twice, never pays more than was captured, survives a partial
 * gateway failure, and repairs orders the old whole-order cancel left without records.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import cancellationService, { needsRefundRepair } from '../services/cancellationService.js';
import razorpayService from '../services/razorpayService.js';
import orderStatusService from '../services/orderStatusService.js';

/** Paid order: A ₹500, B ₹300, C ₹200 — total ₹1000, no discount. */
const seedPaidOrder = async (over = {}) => {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'A', price: 500, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'B', price: 300, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'C', price: 200, quantity: 1 },
    ],
    shippingAddress: {
      fullName: 'Asha K', phone: '9999999999', addressLine1: '1 Road',
      city: 'Kochi', state: 'Kerala', postalCode: '682001',
    },
    subtotal: 1000, totalAmount: 1000, status: 'processing', paymentStatus: 'paid',
    ...over,
  });
  const payment = await Payment.create({
    order: order._id, user: order.user, amount: 1000, gatewayPaymentId: 'pay_ALL1',
    paymentGateway: 'razorpay', paymentMethod: 'credit_card', status: 'completed',
  });
  await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
  return order;
};

const cancel = (order, index) => cancellationService.cancelLines(
  String(order._id), { lines: [{ itemId: String(order.items[index]._id), quantity: 1 }] }, {});

const reload = (order) => Order.findById(order._id).lean();
let seq = 0;
const gatewayOk = () => jest.spyOn(razorpayService, 'refundPayment')
  .mockImplementation(async () => ({ refundId: `rfnd_${++seq}`, status: 'processed' }));
const sentPaise = (spy) => spy.mock.calls.reduce((s, c) => s + c[1], 0);

afterEach(async () => {
  await Order.deleteMany({});
  await Payment.deleteMany({});
  jest.restoreAllMocks();
});

it('refunds every due cancellation on the order, each once', async () => {
  const order = await seedPaidOrder();
  await cancel(order, 0);
  await cancel(order, 1);
  const spy = gatewayOk();

  const res = await cancellationService.refundAllDue(String(order._id));

  expect(res.success).toBe(true);
  expect(res.refundedRupees).toBe(800);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(sentPaise(spy)).toBe(80000);
  const fresh = await reload(order);
  expect(fresh.cancellations.map((c) => c.refund.status)).toEqual(['completed', 'completed']);
});

it('pressed again: sends nothing more', async () => {
  const order = await seedPaidOrder();
  await cancel(order, 0);
  const spy = gatewayOk();

  await cancellationService.refundAllDue(String(order._id));
  const again = await cancellationService.refundAllDue(String(order._id));

  expect(again.success).toBe(true);
  expect(again.message).toMatch(/nothing left to refund/i);
  expect(spy).toHaveBeenCalledTimes(1);
});

it('double-click (two at once): every line is paid exactly once', async () => {
  const order = await seedPaidOrder();
  await cancel(order, 0);
  await cancel(order, 1);
  const spy = jest.spyOn(razorpayService, 'refundPayment').mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 30)); // hold the claim while the other runs
    return { refundId: `rfnd_${++seq}`, status: 'processed' };
  });

  const [a, b] = await Promise.all([
    cancellationService.refundAllDue(String(order._id)),
    cancellationService.refundAllDue(String(order._id)),
  ]);

  expect(spy).toHaveBeenCalledTimes(2);
  expect(sentPaise(spy)).toBe(80000);
  // Neither call reports a failure: losing a claim is "in progress", not an error.
  expect(a.success && b.success).toBe(true);
  const fresh = await reload(order);
  expect(fresh.cancellations.every((c) => c.refund.status === 'completed')).toBe(true);
});

it('one gateway failure leaves the others refunded; retry sends only the failed one', async () => {
  const order = await seedPaidOrder();
  await cancel(order, 0);
  await cancel(order, 1);
  const spy = jest.spyOn(razorpayService, 'refundPayment')
    .mockResolvedValueOnce({ refundId: 'rfnd_ok', status: 'processed' })
    .mockRejectedValueOnce(new Error('gateway timeout'));

  const first = await cancellationService.refundAllDue(String(order._id));
  expect(first.success).toBe(false);
  expect(first.statusCode).toBe(502);
  expect(first.message).toMatch(/₹500 sent.*1 refund\(s\) failed.*gateway timeout/);
  let fresh = await reload(order);
  expect(fresh.cancellations.map((c) => c.refund.status)).toEqual(['completed', 'failed']);

  spy.mockResolvedValueOnce({ refundId: 'rfnd_retry', status: 'processed' });
  const retry = await cancellationService.refundAllDue(String(order._id));
  expect(retry.success).toBe(true);
  expect(retry.refundedRupees).toBe(300);
  expect(spy).toHaveBeenCalledTimes(3);
  expect(spy.mock.calls[2][1]).toBe(30000); // only B, never A again
  fresh = await reload(order);
  expect(fresh.cancellations.every((c) => c.refund.status === 'completed')).toBe(true);
});

it('leaves a refund that is still settling alone', async () => {
  const order = await seedPaidOrder();
  await cancel(order, 0);
  const spy = jest.spyOn(razorpayService, 'refundPayment').mockResolvedValue({ refundId: 'rfnd_slow', status: 'pending' });
  await cancellationService.refundAllDue(String(order._id));
  expect((await reload(order)).cancellations[0].refund.status).toBe('processing');

  const again = await cancellationService.refundAllDue(String(order._id));
  expect(again.message).toMatch(/already on its way/i);
  expect(spy).toHaveBeenCalledTimes(1); // the first send only
});

describe('repairing orders the old whole-order cancel left without records', () => {
  /** Reproduces the old bug: line A cancelled, then the order cancelled the old way. */
  const brokenOrder = async () => {
    const order = await seedPaidOrder();
    await cancel(order, 0);
    await orderStatusService.updateOrderStatus(String(order._id), 'cancelled', { isAdmin: true, cancelledBy: 'admin' });
    const fresh = await reload(order);
    expect(fresh.status).toBe('cancelled');
    expect(needsRefundRepair(fresh)).toBe(true);
    return order;
  };

  it('records the missing lines and refunds the whole goods value — never more', async () => {
    const order = await brokenOrder();
    const spy = gatewayOk();

    const res = await cancellationService.refundAllDue(String(order._id));

    expect(res.success).toBe(true);
    expect(res.repaired).toBe(true);
    expect(sentPaise(spy)).toBe(100000); // A + B + C = the ₹1000 captured, exactly
    const fresh = await reload(order);
    expect(fresh.status).toBe('cancelled');
    expect(fresh.cancellations).toHaveLength(2);
    expect(needsRefundRepair(fresh)).toBe(false);

    // And it is still once-only.
    await cancellationService.refundAllDue(String(order._id));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('never repairs an order whose money is recorded another way', async () => {
    const order = await brokenOrder();
    await Order.updateOne({ _id: order._id }, {
      $set: { refundDetails: { status: 'completed', requestedAt: new Date(), amount: 500 } },
    });
    expect(needsRefundRepair(await reload(order))).toBe(false);
  });

  it('never repairs an order that was not paid', async () => {
    const order = await brokenOrder();
    await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'refunded' } });
    expect(needsRefundRepair(await reload(order))).toBe(false);
  });

  it('cancelLines still refuses a cancelled order without the repair flag', async () => {
    const order = await brokenOrder();
    const res = await cancel(order, 1);
    expect(res.success).toBe(false);
  });
});

it('refuses an unpaid order', async () => {
  const order = await seedPaidOrder({ paymentStatus: 'pending', status: 'awaiting_payment' });
  const res = await cancellationService.refundAllDue(String(order._id));
  expect(res.success).toBe(false);
  expect(res.statusCode).toBe(400);
});
