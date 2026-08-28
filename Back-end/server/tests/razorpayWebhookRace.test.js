/**
 * Razorpay concurrent-webhook race — REAL database, REAL transactions.
 *
 * Validates the highest-risk money path: what happens when Razorpay delivers the
 * SAME payment.captured event more than once, concurrently (its retry policy is
 * "at least once", and the app-level Redis replay guard is non-atomic + skipped
 * entirely when Redis is down). The correct invariant is exactly ONE completed
 * Payment row for a given gateway payment id, no matter how many times the event
 * lands.
 *
 * processPaymentSuccess writes inside session.withTransaction, so this needs a
 * transaction-capable database. It used to build its own single-node replica set
 * because setup.js started a STANDALONE mongod, which cannot run transactions;
 * setup.js now starts a replica set for every suite, so useTransactionalDb() just
 * reuses it (and warms it up).
 *
 * The timeout below is deliberately TIGHT (30s). Every test here settles in well
 * under a second against the in-memory replica set; the failure mode it guards is a
 * session-less write inside the capture transaction, which cannot fail faster than
 * the server's 60s transactionLifetimeLimitSeconds reaper. A generous timeout let
 * that bug hide for months as "these tests are just slow" — the whole suite took
 * 362s and the concurrent case timed out, so the idempotency guarantee this file
 * exists to prove was never actually verified. Do NOT raise it to make a hang pass.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

// razorpayService's constructor throws without these; set BEFORE it is imported.
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
delete process.env.REDIS_URL; // keep post-commit queue enqueue a no-op

import User from '../models/User.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';

jest.setTimeout(30000);

let razorpayService;

const ADDRESS = {
  fullName: 'Race Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

async function seedOrder() {
  const user = await User.create({
    name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x',
  });
  const order = await Order.create({
    user: user._id,
    orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'P', quantity: 1, price: 1000 }],
    subtotal: 1000,
    totalAmount: 1000,
    shippingAddress: ADDRESS,
    paymentMethod: 'razorpay',
    status: 'awaiting_payment',
    paymentStatus: 'pending',
  });
  return { user, order };
}

// A realistic Razorpay payment.captured payload for the seeded order.
function capturedPayload(order, paymentId) {
  return {
    payment: {
      entity: {
        id: paymentId,
        order_id: `order_${order._id}`,
        amount: order.totalAmount * 100, // paise, matches DB → passes amount check
        currency: 'INR',
        method: 'card',
        notes: { orderId: order._id.toString() },
      },
    },
  };
}

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  // The idempotency guarantee rests on the unique gatewayPaymentId index — build it
  // explicitly so the test doesn't race Mongoose's background autoIndex.
  await Payment.syncIndexes();
  razorpayService = (await import('../services/razorpayService.js')).default;
});


afterEach(async () => {
  for (const key in mongoose.connection.collections) {
    await mongoose.connection.collections[key].deleteMany();
  }
});

describe('Razorpay payment.captured — concurrent delivery', () => {
  it('creates exactly ONE completed payment when the same event lands twice at once', async () => {
    const { order } = await seedOrder();
    const paymentId = `pay_${Date.now()}`;
    const payload = capturedPayload(order, paymentId);

    // Three identical webhook deliveries racing (Redis replay guard absent/bypassed).
    const results = await Promise.allSettled([
      razorpayService.handlePaymentCaptured(payload),
      razorpayService.handlePaymentCaptured(payload),
      razorpayService.handlePaymentCaptured(payload),
    ]);

    const completed = await Payment.countDocuments({ gatewayPaymentId: paymentId, status: 'completed' });
    const total = await Payment.countDocuments({ gatewayPaymentId: paymentId });

    // Diagnostics so a failure is self-explanatory.
    // eslint-disable-next-line no-console
    console.log('[RACE] settled:', results.map(r => r.status),
      '| completed payments:', completed, '| total payments:', total);

    const fresh = await Order.findById(order._id).lean();
    expect(total).toBe(1);       // no duplicate Payment rows
    expect(completed).toBe(1);   // exactly one confirmed
    expect(fresh.paymentStatus).toBe('paid');
  });

  it('is idempotent across two SEQUENTIAL deliveries of the same event', async () => {
    const { order } = await seedOrder();
    const paymentId = `pay_${Date.now()}_seq`;
    const payload = capturedPayload(order, paymentId);

    await razorpayService.handlePaymentCaptured(payload);
    await razorpayService.handlePaymentCaptured(payload); // retry

    const total = await Payment.countDocuments({ gatewayPaymentId: paymentId });
    expect(total).toBe(1);
  });

  // Regression: the `awaiting_payment → processing` transition inside the capture
  // transaction fans out to CRM side-effects. Those write THIS order
  // (markPurchaseCountedOnce) and its user (markPurchased). They must join the
  // caller's session — a session-less write against a document the open transaction
  // already modified waits on a lock that transaction holds while that transaction
  // waits on the write, and only the 60s transaction reaper breaks the tie. See
  // orderStatusService._syncCrmOnStatus.
  it('commits the CRM purchase denormalization in the same transaction as the capture', async () => {
    const { user, order } = await seedOrder();
    const paymentId = `pay_${Date.now()}_crm`;

    await razorpayService.handlePaymentCaptured(capturedPayload(order, paymentId));

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('paid');
    expect(fresh.status).toBe('processing');
    // The once-only flag committed WITH the payment, not as orphaned collateral of
    // an aborted-and-retried attempt.
    expect(fresh.purchaseCounted).toBe(true);

    const freshUser = await User.findById(user._id).lean();
    expect(freshUser.hasPurchased).toBe(true);
    expect(freshUser.paidOrderCount).toBe(1);
    expect(freshUser.totalSpentPaise).toBe(order.totalAmount * 100);
  });

  it('counts the purchase exactly once when the same capture is delivered twice', async () => {
    const { user, order } = await seedOrder();
    const payload = capturedPayload(order, `pay_${Date.now()}_crm_dup`);

    await razorpayService.handlePaymentCaptured(payload);
    await razorpayService.handlePaymentCaptured(payload); // Razorpay retry

    const freshUser = await User.findById(user._id).lean();
    expect(freshUser.paidOrderCount).toBe(1);
    expect(freshUser.totalSpentPaise).toBe(order.totalAmount * 100);
  });

  it('records an unknown gateway method as "other" instead of throwing (money not stranded)', async () => {
    const { order } = await seedOrder();
    const paymentId = `pay_${Date.now()}_paylater`;
    const payload = capturedPayload(order, paymentId);
    // `paylater` is a real Razorpay method with no slot in our enum. It is used here
    // in place of the former `cardless_emi` fixture, which now maps to `emi` on
    // purpose (see utils/paymentMethodDetails.js) and so no longer exercises the
    // unknown-method path this test exists to protect.
    payload.payment.entity.method = 'paylater';

    await expect(razorpayService.handlePaymentCaptured(payload)).resolves.not.toThrow();

    const payment = await Payment.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(payment).toBeTruthy();
    expect(payment.paymentMethod).toBe('other');
    expect(payment.status).toBe('completed');
    // Raw gateway method is preserved for reconciliation.
    expect(payment.paymentDetails.razorpay.method).toBe('paylater');
    expect(payment.methodDetails.rawMethod).toBe('paylater');
  });
});
