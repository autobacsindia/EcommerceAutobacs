/**
 * Payment safety — REAL database, REAL transactions (same harness as
 * razorpayWebhookRace.test.js).
 *
 *  1. A second, DIFFERENT capture on an already-paid order (two tabs, a stale link):
 *     the first payment stays the order's payment, the extra one is recorded for a
 *     manual refund and accounts is alerted — once, however often it is delivered.
 *  2. payment.failed keeps WHY on the order (paymentAttempts), once per payment id.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
delete process.env.REDIS_URL; // post-commit enqueues are no-ops unless a test opts in

// Record queue jobs instead of talking to Redis. Plain functions: resetMocks wipes jest.fn.
const queued = [];
const fakeQueue = { add: async (name, data, opts) => { queued.push({ name, data, opts }); return { id: opts?.jobId }; } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => fakeQueue,
  getOrderQueue: () => fakeQueue,
  getMediaQueue: () => fakeQueue,
  variantJobId: (key) => String(key),
  enqueueVariantGeneration: async () => null,
  enqueueNotification: async () => null,
  enqueueMetaLeadSheetWrite: async () => null,
  closeQueues: async () => {},
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');

jest.setTimeout(30000);

let razorpayService;
let PAYMENT_ATTEMPTS_CAP;

const ADDRESS = {
  fullName: 'Safety Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

async function seedOrder() {
  const user = await User.create({ name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x' });
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

const captured = (order, id, over = {}) => ({
  payment: {
    entity: {
      id, order_id: `order_${order._id}`, amount: order.totalAmount * 100, currency: 'INR',
      method: 'upi', notes: { orderId: order._id.toString() }, ...over,
    },
  },
});

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  await Payment.syncIndexes();
  const mod = await import('../services/razorpayService.js');
  razorpayService = mod.default;
  PAYMENT_ATTEMPTS_CAP = mod.PAYMENT_ATTEMPTS_CAP;
});

beforeEach(() => { queued.length = 0; });

afterEach(async () => {
  delete process.env.REDIS_URL;
  for (const key in mongoose.connection.collections) {
    await mongoose.connection.collections[key].deleteMany();
  }
});

describe('second capture on an already-paid order', () => {
  it('keeps the first payment, records the extra one, and alerts accounts', async () => {
    const { order } = await seedOrder();
    await razorpayService.handlePaymentCaptured(captured(order, 'pay_first'));
    const paid = await Order.findById(order._id).lean();
    expect(paid.paymentStatus).toBe('paid');

    process.env.REDIS_URL = 'redis://test-only'; // let the alert enqueue (queue is faked)
    const result = await razorpayService.processPaymentSuccess(
      String(order._id), captured(order, 'pay_second').payment.entity, null
    );

    expect(result.duplicateCapture).toBe(true);
    const fresh = await Order.findById(order._id).lean();
    expect(String(fresh.payment)).toBe(String(paid.payment));           // first payment kept
    expect(fresh.paymentVerification.reference).toBe('pay_first');      // verified marker untouched
    expect(fresh.status).toBe('processing');
    expect(fresh.duplicateCaptures).toHaveLength(1);
    expect(fresh.duplicateCaptures[0]).toMatchObject({ gatewayPaymentId: 'pay_second', amount: 1000, method: 'upi' });

    const extra = await Payment.findOne({ gatewayPaymentId: 'pay_second' }).lean();
    expect(extra.status).toBe('completed');                              // real money, recorded
    expect(extra.paymentDetails.duplicateCapture).toBe(true);
    expect(String(fresh.duplicateCaptures[0].payment)).toBe(String(extra._id));

    const alerts = queued.filter((j) => j.name === 'send-admin-duplicate-payment-alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data).toEqual({ orderId: String(order._id), gatewayPaymentId: 'pay_second' });
    expect(alerts[0].opts).toEqual({ jobId: 'duplicate-capture-pay_second' });
    // The paid-order side effects (invoice, "order placed") do NOT fire again.
    expect(queued.some((j) => j.name === 'send-order-invoice')).toBe(false);
  });

  it('the extra capture delivered again (webhook retry / reconciliation) changes nothing and alerts once', async () => {
    const { order } = await seedOrder();
    await razorpayService.handlePaymentCaptured(captured(order, 'pay_first'));
    const firstPayment = (await Order.findById(order._id).lean()).payment;

    process.env.REDIS_URL = 'redis://test-only';
    const entity = captured(order, 'pay_second').payment.entity;
    await razorpayService.processPaymentSuccess(String(order._id), entity, null);
    const again = await razorpayService.processPaymentSuccess(String(order._id), entity, null); // must not self-heal onto it
    await razorpayService.handlePaymentCaptured(captured(order, 'pay_second'));

    expect(again).toMatchObject({ duplicateCapture: true, alreadyProcessed: true });
    const fresh = await Order.findById(order._id).lean();
    expect(String(fresh.payment)).toBe(String(firstPayment));
    expect(fresh.duplicateCaptures).toHaveLength(1);
    expect(await Payment.countDocuments({ order: order._id })).toBe(2);
    expect(queued.filter((j) => j.name === 'send-admin-duplicate-payment-alert')).toHaveLength(1);
  });

  it('two different extra captures delivered at once are both recorded, each once', async () => {
    const { order } = await seedOrder();
    await razorpayService.handlePaymentCaptured(captured(order, 'pay_first'));

    await Promise.allSettled([
      razorpayService.handlePaymentCaptured(captured(order, 'pay_x')),
      razorpayService.handlePaymentCaptured(captured(order, 'pay_x')),
      razorpayService.handlePaymentCaptured(captured(order, 'pay_y')),
    ]);

    const fresh = await Order.findById(order._id).lean();
    const ids = fresh.duplicateCaptures.map((d) => d.gatewayPaymentId).sort();
    expect(ids).toEqual(['pay_x', 'pay_y']);
    expect(await Payment.countDocuments({ order: order._id })).toBe(3);
  });

  it('an extra capture of a different amount is still recorded (not rejected as a mismatch)', async () => {
    const { order } = await seedOrder();
    await razorpayService.handlePaymentCaptured(captured(order, 'pay_first'));

    await razorpayService.handlePaymentCaptured(captured(order, 'pay_odd', { amount: 50000 }));

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.duplicateCaptures).toEqual([
      expect.objectContaining({ gatewayPaymentId: 'pay_odd', amount: 500 }),
    ]);
  });

  it('an order paid by bank transfer that then gets a card capture is flagged too', async () => {
    const { order } = await seedOrder();
    await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'paid', status: 'processing' } });

    await razorpayService.handlePaymentCaptured(captured(order, 'pay_after_transfer'));

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.payment).toBeUndefined();
    expect(fresh.duplicateCaptures).toHaveLength(1);
  });
});

describe('payment.failed keeps the reason on the order', () => {
  const failed = (order, id, over = {}) => ({
    id, method: 'card', amount: 100000, currency: 'INR', notes: { orderId: order._id.toString() },
    error_code: 'BAD_REQUEST_ERROR', error_reason: 'payment_declined', error_source: 'bank',
    error_step: 'payment_authorization', error_description: 'Your payment was declined by the bank.',
    created_at: 1763700000, ...over,
  });

  it('stores one attempt with the gateway reason, even when delivered twice', async () => {
    const { order } = await seedOrder();
    await razorpayService.handlePaymentFailure(failed(order, 'pay_fail_1'));
    await razorpayService.handlePaymentFailure(failed(order, 'pay_fail_1')); // webhook retry

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('failed');
    expect(fresh.paymentAttempts).toHaveLength(1);
    expect(fresh.paymentAttempts[0]).toMatchObject({
      razorpayPaymentId: 'pay_fail_1', method: 'card', amount: 1000,
      errorCode: 'BAD_REQUEST_ERROR', errorReason: 'payment_declined', errorSource: 'bank',
      errorStep: 'payment_authorization', errorDescription: 'Your payment was declined by the bank.',
    });
    expect(fresh.paymentAttempts[0].at).toEqual(new Date(1763700000 * 1000));
  });

  it('concurrent deliveries of the same failure still leave one entry', async () => {
    const { order } = await seedOrder();
    await Promise.all([1, 2, 3].map(() => razorpayService.handlePaymentFailure(failed(order, 'pay_fail_c'))));
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentAttempts).toHaveLength(1);
  });

  it('different attempts each get an entry, newest last, capped', async () => {
    const { order } = await seedOrder();
    const total = PAYMENT_ATTEMPTS_CAP + 3;
    for (let i = 0; i < total; i += 1) {
      await razorpayService.handlePaymentFailure(failed(order, `pay_f_${i}`));
    }
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentAttempts).toHaveLength(PAYMENT_ATTEMPTS_CAP);
    expect(fresh.paymentAttempts[0].razorpayPaymentId).toBe('pay_f_3');
    expect(fresh.paymentAttempts.at(-1).razorpayPaymentId).toBe(`pay_f_${total - 1}`);
  });

  it('a failed attempt on an order that is already paid is recorded but does not unpay it', async () => {
    const { order } = await seedOrder();
    await razorpayService.handlePaymentCaptured(captured(order, 'pay_ok'));
    await razorpayService.handlePaymentFailure(failed(order, 'pay_late_fail'));

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('paid');
    expect(fresh.paymentAttempts.map((a) => a.razorpayPaymentId)).toEqual(['pay_late_fail']);
  });

  it('a failure with no/invalid order id is ignored without throwing', async () => {
    await expect(razorpayService.handlePaymentFailure({ id: 'pay_x', notes: { orderId: 'not-an-id' } })).resolves.toBeUndefined();
  });
});
