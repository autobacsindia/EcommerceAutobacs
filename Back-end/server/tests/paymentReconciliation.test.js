/**
 * Payment reconciliation sweep — REAL database, REAL transactions.
 *
 * Guards the safety net for a missed/misconfigured Razorpay webhook: an order can
 * be captured at the gateway while its confirmation webhook never lands, leaving it
 * stranded in `awaiting_payment` (money in, no order). The sweep asks Razorpay
 * whether such orders were in fact paid and drives the genuinely-captured ones
 * through the same idempotent success path the webhook uses.
 *
 * processPaymentSuccess writes inside session.withTransaction, so this needs a
 * transaction-capable database. tests/setup.js provides one (a single-node replica
 * set) for every suite; useTransactionalDb() asserts that and warms it up. This
 * file used to disconnect from it and build a SECOND replica set of its own — a
 * leftover from when setup.js started a standalone.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

// razorpayService's constructor throws without these; set BEFORE it is imported.
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
delete process.env.REDIS_URL; // keep post-commit queue enqueue + liveness check no-ops

import User from '../models/User.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';

jest.setTimeout(180000);

let razorpayService;
let reconcileStuckPayments;

const ADDRESS = {
  fullName: 'Recon Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

// Seed an order stuck in awaiting_payment with a gateway order id, aged so the
// sweep's [10min, 24h] window includes it.
async function seedStuckOrder({ ageMinutes = 20, totalAmount = 1000, razorpayOrderId = `order_${Date.now()}`, paymentStatus = 'pending' } = {}) {
  const user = await User.create({
    name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x',
  });
  const order = await Order.create({
    user: user._id,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'P', quantity: 1, price: totalAmount }],
    subtotal: totalAmount,
    totalAmount,
    shippingAddress: ADDRESS,
    paymentMethod: 'razorpay',
    status: 'awaiting_payment',
    paymentStatus,
    razorpayOrderId,
  });
  // timestamps:true stamps createdAt on insert and marks it IMMUTABLE, so a Mongoose
  // updateOne would silently strip a createdAt change. Back-date via the raw driver
  // to exercise the age-window logic for real.
  const createdAt = new Date(Date.now() - ageMinutes * 60 * 1000);
  await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt } });
  return { user, order, razorpayOrderId };
}

// A captured Razorpay payment entity as returned by orders.fetchPayments.
function capturedPayment(order, { paymentId = `pay_${Date.now()}`, amountPaise, currency = 'INR' } = {}) {
  return {
    id: paymentId,
    order_id: order.razorpayOrderId,
    status: 'captured',
    amount: amountPaise ?? order.totalAmount * 100,
    currency,
    method: 'card',
    notes: { orderId: order._id.toString() },
  };
}

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  await Payment.syncIndexes(); // unique gatewayPaymentId index — idempotency serialization point
  razorpayService = (await import('../services/razorpayService.js')).default;
  reconcileStuckPayments = (await import('../services/paymentReconciliationService.js')).reconcileStuckPayments;
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const key in mongoose.connection.collections) {
    await mongoose.connection.collections[key].deleteMany();
  }
});

describe('reconcileStuckPayments', () => {
  it('recovers a stuck order that was actually captured at the gateway', async () => {
    const { order, razorpayOrderId } = await seedStuckOrder();
    const payment = capturedPayment(order, { paymentId: 'pay_recovered' });

    const spy = jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([payment]);

    const summary = await reconcileStuckPayments();

    expect(spy).toHaveBeenCalledWith(razorpayOrderId);
    expect(summary).toMatchObject({ scanned: 1, recovered: 1, failed: 0 });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('paid');
    expect(fresh.status).toBe('processing'); // fulfillment advanced from awaiting_payment

    const pay = await Payment.findOne({ gatewayPaymentId: 'pay_recovered' }).lean();
    expect(pay).toBeTruthy();
    expect(pay.status).toBe('completed');
  });

  it('is idempotent — a second sweep recovers nothing and leaves one Payment', async () => {
    const { order } = await seedStuckOrder();
    jest.spyOn(razorpayService, 'fetchOrderPayments')
      .mockResolvedValue([capturedPayment(order, { paymentId: 'pay_idem' })]);

    const first = await reconcileStuckPayments();
    expect(first.recovered).toBe(1);

    // Order is now `processing`/`paid`, so it is no longer in the stuck candidate set.
    const second = await reconcileStuckPayments();
    expect(second).toMatchObject({ scanned: 0, recovered: 0 });

    expect(await Payment.countDocuments({ gatewayPaymentId: 'pay_idem' })).toBe(1);
  });

  it('ignores an order with no captured payment (authorized/failed only)', async () => {
    const { order } = await seedStuckOrder();
    jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([
      { id: 'pay_auth', status: 'authorized', amount: order.totalAmount * 100, currency: 'INR', method: 'card' },
      { id: 'pay_fail', status: 'failed', amount: order.totalAmount * 100, currency: 'INR', method: 'card' },
    ]);

    const summary = await reconcileStuckPayments();
    expect(summary).toMatchObject({ scanned: 1, recovered: 0, failed: 0 });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('pending');
    expect(fresh.status).toBe('awaiting_payment');
  });

  it('does not scan an order that is too fresh (webhook may still be in flight)', async () => {
    await seedStuckOrder({ ageMinutes: 1 }); // younger than the 10-min floor
    const spy = jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([]);

    const summary = await reconcileStuckPayments();
    expect(summary).toMatchObject({ scanned: 0, recovered: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('counts an amount-mismatch capture as failed and never marks the order paid', async () => {
    const { order } = await seedStuckOrder({ totalAmount: 1000 });
    // Gateway reports a different amount than our order → security guard must throw.
    jest.spyOn(razorpayService, 'fetchOrderPayments')
      .mockResolvedValue([capturedPayment(order, { paymentId: 'pay_mismatch', amountPaise: 5000 })]);

    const summary = await reconcileStuckPayments();
    expect(summary).toMatchObject({ scanned: 1, recovered: 0, failed: 1 });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('pending');
    expect(await Payment.countDocuments({ gatewayPaymentId: 'pay_mismatch' })).toBe(0);
  });
  // ── Webhook-liveness signal ────────────────────────────────────────────────
  //
  // `unresolved` is the ONLY input to the "webhooks may be DOWN" alert. The sweep
  // deliberately scans failed/cancelled orders (a client-reported failure can sit
  // on top of a real capture), but those must not feed the alert: a terminal
  // paymentStatus means an outcome DID reach us. Conflating the two made the alert
  // fire on ordinary abandoned checkouts — on production, 39 qualifying orders over
  // 30 days with no actual outage.
  describe('webhook-liveness signal', () => {
    it('counts an order still awaiting an outcome as unresolved', async () => {
      await seedStuckOrder({ paymentStatus: 'pending' });
      jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([]);

      expect(await reconcileStuckPayments()).toMatchObject({ scanned: 1, unresolved: 1 });
    });

    it('does NOT count a failed payment as unresolved (we heard the outcome)', async () => {
      await seedStuckOrder({ paymentStatus: 'failed' });
      jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([]);

      // Still scanned — a client-reported failure can hide a real capture.
      expect(await reconcileStuckPayments()).toMatchObject({ scanned: 1, unresolved: 0 });
    });

    it('does NOT count a cancelled payment as unresolved', async () => {
      await seedStuckOrder({ paymentStatus: 'cancelled' });
      jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([]);

      expect(await reconcileStuckPayments()).toMatchObject({ scanned: 1, unresolved: 0 });
    });

    it('counts only the pending ones when both kinds are stuck together', async () => {
      // The exact production shape on 2026-08-22: two terminal orders and nothing
      // genuinely unresolved. The old signal said 2 and paged; the new one says 0.
      await seedStuckOrder({ paymentStatus: 'failed', razorpayOrderId: 'order_f1' });
      await seedStuckOrder({ paymentStatus: 'cancelled', razorpayOrderId: 'order_c1' });
      jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([]);

      expect(await reconcileStuckPayments()).toMatchObject({ scanned: 2, unresolved: 0 });
    });

    it('still flags the dangerous case: a paid-but-unconfirmed order stays unresolved', async () => {
      // Customer paid, callback never landed, webhook never arrived. The sweep
      // recovers it — and it was unresolved going in, which is what makes webhook
      // silence meaningful.
      const { order } = await seedStuckOrder({ paymentStatus: 'pending' });
      jest.spyOn(razorpayService, 'fetchOrderPayments')
        .mockResolvedValue([capturedPayment(order, { paymentId: 'pay_silent' })]);

      expect(await reconcileStuckPayments()).toMatchObject({ scanned: 1, unresolved: 1, recovered: 1 });
    });

    it('reports unresolved: 0 when there is nothing to scan at all', async () => {
      expect(await reconcileStuckPayments()).toMatchObject({ scanned: 0, unresolved: 0 });
    });
  });
});
