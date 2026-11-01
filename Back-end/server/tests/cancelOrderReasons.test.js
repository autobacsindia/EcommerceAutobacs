/**
 * Cancellation reasons: what the cancel screens offer must be what the server accepts.
 *
 * Regression: the customer "Cancel Order" pop-up offered "Payment issues", sent as
 * `payment_failed`, and the admin bulk bar offered "Payment Issue" / "Quality Issue" /
 * "Other" — none of which were on orderStatusService's allowed list, so every one of
 * those cancels was refused with a developer message ("Invalid reason 'payment_failed'
 * for status 'cancelled'…"). On an order that already had per-line cancellations the
 * lines DID cancel and then the roll-up to `cancelled` failed, leaving a stale status.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: cancellationService } = await import('../services/cancellationService.js');
const {
  CUSTOMER_CANCELLATION_REASONS,
  ADMIN_CANCELLATION_REASONS,
} = await import('../config/cancellationReasons.js');

const BASE = '/api/v1';

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role = 'customer') {
  n += 1;
  const email = `${role}${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: role, email, phone: `90000000${String(n).padStart(2, '0')}`,
    passwordHash: await bcrypt.hash(password, 10), role,
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, user };
}

function makeOrder(userId, overrides = {}) {
  return Order.create({
    user: userId,
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'A', price: 500, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'B', price: 300, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 800, totalAmount: 800, status: 'awaiting_payment',
    ...overrides,
  });
}

const cancelAs = (token, orderId, body) => request(app)
  .put(`${BASE}/orders/${orderId}/cancel`)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

describe('PUT /orders/:id/cancel — customer reasons', () => {
  it.each(CUSTOMER_CANCELLATION_REASONS.map((r) => r.value))(
    'accepts the customer reason %s and stores it on the order',
    async (reason) => {
      const { token, user } = await login();
      const order = await makeOrder(user._id);

      const res = await cancelAs(token, order._id, { reason });
      expect(res.status).toBe(200);

      const fresh = await Order.findById(order._id).lean();
      expect(fresh.status).toBe('cancelled');
      expect(fresh.cancellationReason).toBe(reason);
    },
  );

  it('every customer reason has its own code (one radio = one reason)', () => {
    const values = CUSTOMER_CANCELLATION_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  // A browser still running the previous bundle sends the old codes for a while.
  it.each(['customer_request', 'duplicate_order', 'payment_failed'])(
    'still accepts the legacy code %s from an old cached page',
    async (reason) => {
      const { token, user } = await login();
      const order = await makeOrder(user._id);
      await cancelAs(token, order._id, { reason }).expect(200);
    },
  );

  it('rejects an unknown reason with a 400 and leaves the order alone', async () => {
    const { token, user } = await login();
    const order = await makeOrder(user._id);

    const res = await cancelAs(token, order._id, { reason: 'because<script>' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/choose one of the listed cancellation reasons/i);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.status).toBe('awaiting_payment');
  });

  it('rejects notes over 500 characters (the pop-up limit) with a 400', async () => {
    const { token, user } = await login();
    const order = await makeOrder(user._id);

    const res = await cancelAs(token, order._id, { reason: 'other', notes: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/cannot exceed 500/i);
    expect((await Order.findById(order._id).lean()).status).toBe('awaiting_payment');
  });

  it('a second cancel (double click) changes nothing', async () => {
    const { token, user } = await login();
    const order = await makeOrder(user._id);

    await cancelAs(token, order._id, { reason: 'changed_mind' }).expect(200);
    const again = await cancelAs(token, order._id, { reason: 'other' });
    expect(again.status).toBe(400);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.cancellationReason).toBe('changed_mind');
    expect(fresh.statusHistory.filter((h) => h.status === 'cancelled')).toHaveLength(1);
  });

  it('two cancel clicks at the same instant still record one cancellation', async () => {
    const { token, user } = await login();
    const order = await makeOrder(user._id);

    const results = await Promise.all([
      cancelAs(token, order._id, { reason: 'changed_mind' }),
      cancelAs(token, order._id, { reason: 'changed_mind' }),
    ]);
    expect(results.some((r) => r.status === 200)).toBe(true);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.status).toBe('cancelled');
    expect(fresh.statusHistory.filter((h) => h.status === 'cancelled')).toHaveLength(1);
  });

  it('rolls a partly cancelled order up to cancelled with a customer reason', async () => {
    const { token, user } = await login();
    const order = await makeOrder(user._id, { status: 'processing', paymentStatus: 'paid' });
    const first = await cancellationService.cancelLines(
      String(order._id), { lines: [{ itemId: String(order.items[0]._id), quantity: 1 }] }, {});
    expect(first.success).toBe(true);

    await cancelAs(token, order._id, { reason: 'payment_issue' }).expect(200);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.status).toBe('cancelled');
    expect(fresh.cancellations).toHaveLength(2);
  });
});

describe('POST /orders/bulk/status — admin cancel reasons', () => {
  it.each(ADMIN_CANCELLATION_REASONS.map((r) => r.value))(
    'bulk-cancels with the admin reason %s',
    async (reason) => {
      const { token } = await login('admin');
      const order = await makeOrder(new mongoose.Types.ObjectId());

      const res = await request(app).post(`${BASE}/orders/bulk/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ orderIds: [String(order._id)], status: 'cancelled', reason });

      expect(res.status).toBe(200);
      expect(res.body.results.failed).toEqual([]);
      expect((await Order.findById(order._id).lean()).cancellationReason).toBe(reason);
    },
  );

  it('bulk-cancels when no reason is picked', async () => {
    const { token } = await login('admin');
    const order = await makeOrder(new mongoose.Types.ObjectId());

    const res = await request(app).post(`${BASE}/orders/bulk/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderIds: [String(order._id)], status: 'cancelled' });

    expect(res.body.results.failed).toEqual([]);
    expect((await Order.findById(order._id).lean()).status).toBe('cancelled');
  });
});

describe('POST /orders/:id/cancellations — admin per-line reasons', () => {
  it('refuses an unknown reason before cancelling any line', async () => {
    const { token } = await login('admin');
    const order = await makeOrder(new mongoose.Types.ObjectId(), { status: 'processing', paymentStatus: 'paid' });

    const res = await request(app).post(`${BASE}/orders/${order._id}/cancellations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: String(order.items[0]._id), quantity: 1 }], reason: 'whatever' });

    expect(res.status).toBe(400);
    expect((await Order.findById(order._id).lean()).cancellations || []).toHaveLength(0);
  });

  it('cancelling the last lines with an admin reason rolls the order up', async () => {
    const { token } = await login('admin');
    const order = await makeOrder(new mongoose.Types.ObjectId(), { status: 'processing', paymentStatus: 'paid' });

    await request(app).post(`${BASE}/orders/${order._id}/cancellations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: order.items.map((it) => ({ itemId: String(it._id), quantity: 1 })), reason: 'quality_issue' })
      .expect(201);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.status).toBe('cancelled');
    expect(fresh.cancellationReason).toBe('quality_issue');
  });
});

/*
  Owner decision 2026-11-01: a customer may cancel a PAID order until it ships. It used
  to be admin-only in orderStatusService while the order page offered the button, so the
  customer chose a reason, confirmed, and got "Admin permission required".
*/
describe('PUT /orders/:id/cancel — paid order, not yet shipped', () => {
  it('cancels it and only RECORDS the refund as pending for an admin to send', async () => {
    const { token, user } = await login();
    const order = await makeOrder(user._id, { status: 'processing', paymentStatus: 'paid' });

    const res = await cancelAs(token, order._id, { reason: 'changed_mind' });
    expect(res.status).toBe(200);
    expect(res.body.refundInitiated).toBe(true);
    expect(res.body.refundAmount).toBe(800);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.status).toBe('cancelled');
    expect(fresh.cancelledBy).toBe('customer');
    expect(fresh.cancellationReason).toBe('changed_mind');
    // Nothing paid out: the payment axis is untouched and the refund waits for an admin.
    expect(fresh.paymentStatus).toBe('paid');
    expect(fresh.refundDetails).toMatchObject({ status: 'pending', amount: 800, refundType: 'full' });
  });

  it('a double click flags ONE refund', async () => {
    const { token, user } = await login();
    const order = await makeOrder(user._id, { status: 'processing', paymentStatus: 'paid' });

    const results = await Promise.all([
      cancelAs(token, order._id, { reason: 'changed_mind' }),
      cancelAs(token, order._id, { reason: 'changed_mind' }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.statusHistory.filter((h) => h.status === 'cancelled')).toHaveLength(1);
    expect(fresh.refundDetails.amount).toBe(800);
  });

  it('still refuses a paid order holding a custom / made-to-order item', async () => {
    const { token, user } = await login();
    const custom = await Product.create({
      name: 'Custom Seat Covers', description: 'Made to order', price: 500, stock: 'in',
      images: [{ url: 'http://example.com/i.jpg', alt: 'i' }], brand: 'B', category: 'C',
      isActive: true, returnPolicy: { cancellable: false },
    });
    const order = await makeOrder(user._id, {
      status: 'processing', paymentStatus: 'paid',
      items: [{ product: custom._id, name: 'Custom Seat Covers', price: 800, quantity: 1 }],
    });

    const res = await cancelAs(token, order._id, { reason: 'changed_mind' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot be cancelled once confirmed/);
    expect((await Order.findById(order._id).lean()).status).toBe('processing');
  });

  it('still refuses a customer cancelling someone else\'s paid order', async () => {
    const { token } = await login();
    const order = await makeOrder(new mongoose.Types.ObjectId(), { status: 'processing', paymentStatus: 'paid' });

    expect((await cancelAs(token, order._id, { reason: 'other' })).status).toBe(403);
    expect((await Order.findById(order._id).lean()).status).toBe('processing');
  });
});
