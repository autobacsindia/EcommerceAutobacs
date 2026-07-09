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
 * Like couponKarboIntegration.test.js this spins up its own single-node replica
 * set because processPaymentSuccess writes inside session.withTransaction and the
 * shared standalone mongod in setup.js cannot run transactions.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// razorpayService's constructor throws without these; set BEFORE it is imported.
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
delete process.env.REDIS_URL; // keep post-commit queue enqueue a no-op

import User from '../models/User.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';

jest.setTimeout(120000);

let replset;
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
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: '7.0.14' },
  });
  await mongoose.connect(replset.getUri(), { serverSelectionTimeoutMS: 30000 });
  // The idempotency guarantee rests on the unique gatewayPaymentId index — build it
  // explicitly so the test doesn't race Mongoose's background autoIndex.
  await Payment.syncIndexes();
  razorpayService = (await import('../services/razorpayService.js')).default;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
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

  it('records an unknown gateway method as "other" instead of throwing (money not stranded)', async () => {
    const { order } = await seedOrder();
    const paymentId = `pay_${Date.now()}_paylater`;
    const payload = capturedPayload(order, paymentId);
    payload.payment.entity.method = 'cardless_emi'; // not in the internal enum

    await expect(razorpayService.handlePaymentCaptured(payload)).resolves.not.toThrow();

    const payment = await Payment.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(payment).toBeTruthy();
    expect(payment.paymentMethod).toBe('other');
    expect(payment.status).toBe('completed');
    // Raw gateway method is preserved for reconciliation.
    expect(payment.paymentDetails.razorpay.method).toBe('cardless_emi');
  });
});
