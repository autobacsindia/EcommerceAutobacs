/**
 * When a sales-panel order is paid, Accounts / Procurement / the seller are alerted
 * ONCE — through the real capture path (real transactions), however many times
 * Razorpay delivers the event. A website order never triggers this alert.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';

const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

delete process.env.REDIS_URL; // no real Redis client at import time
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: razorpayService } = await import('../services/razorpayService.js');

// Enqueue is read at call time — turn it on only now (see crmOfflineJourney.test.js).
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

jest.setTimeout(30000);

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  await Payment.syncIndexes();
});

beforeEach(() => { enqueued.length = 0; });

afterEach(async () => {
  for (const key in mongoose.connection.collections) {
    await mongoose.connection.collections[key].deleteMany();
  }
});

async function seedOrder({ salesUser = null } = {}) {
  const user = await User.create({ name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x' });
  return Order.create({
    user: user._id,
    source: salesUser ? 'offline' : 'web',
    ...(salesUser && { salesUser }),
    orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'P', quantity: 1, price: 1000 }],
    subtotal: 1000,
    totalAmount: 1000,
    shippingAddress: { fullName: 'B', phone: '9999999999', addressLine1: '1 St', city: 'Pune', state: 'MH', postalCode: '411001', country: 'India' },
    paymentMethod: 'razorpay',
    status: 'awaiting_payment',
    paymentStatus: 'pending',
  });
}

const captured = (order, id) => ({
  payment: { entity: {
    id, order_id: `order_${order._id}`, amount: order.totalAmount * 100, currency: 'INR',
    method: 'upi', notes: { orderId: order._id.toString() },
  } },
});

const alerts = () => enqueued.filter((j) => j.name === 'send-staff-sales-paid-alert');

describe('sales order paid alert', () => {
  it('is enqueued exactly once for a sales order, even if Razorpay retries', async () => {
    const order = await seedOrder({ salesUser: new mongoose.Types.ObjectId() });
    const payload = captured(order, `pay_${Date.now()}_s`);

    await razorpayService.handlePaymentCaptured(payload);
    await razorpayService.handlePaymentCaptured(payload);

    expect(alerts()).toEqual([{ name: 'send-staff-sales-paid-alert', data: { orderId: String(order._id) } }]);
    expect((await Order.findById(order._id).lean()).paymentStatus).toBe('paid');
  });

  it('is not sent for a website order', async () => {
    const order = await seedOrder();
    await razorpayService.handlePaymentCaptured(captured(order, `pay_${Date.now()}_w`));
    expect(alerts()).toHaveLength(0);
    // The ordinary website notifications still go out.
    expect(enqueued.some((j) => j.name === 'send-order-invoice')).toBe(true);
  });
});
