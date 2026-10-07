/**
 * Admin cancel after a per-line cancellation must refund the REST of the order too.
 *
 * Regression: the status dropdown (PUT /:id/status) and bulk status update moved such
 * an order to `cancelled` with no refund recorded for the lines still live — the
 * customer was silently under-refunded.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: cancellationService } = await import('../services/cancellationService.js');

const BASE = '/api/v1';

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function adminToken() {
  n += 1;
  const email = `admin${n}@autobacs.test`;
  const password = 'SecurePass123!';
  await User.create({ name: 'Admin', email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role: 'admin' });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
}

/** Paid order: A ₹500, B ₹300; line A already cancelled per line. */
async function partlyCancelledOrder() {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'A', price: 500, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'B', price: 300, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 800, totalAmount: 800, status: 'processing', paymentStatus: 'paid',
  });
  const res = await cancellationService.cancelLines(
    String(order._id), { lines: [{ itemId: String(order.items[0]._id), quantity: 1 }] }, {});
  expect(res.success).toBe(true);
  return order;
}

const owedPaise = (o) => o.cancellations.reduce((s, c) => s + c.refund.productValuePaise, 0);

it('status dropdown: records a refund for the remaining lines', async () => {
  const order = await partlyCancelledOrder();
  const token = await adminToken();

  await request(app).put(`${BASE}/orders/${order._id}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'cancelled', reason: 'customer_request' })
    .expect(200);

  const fresh = await Order.findById(order._id).lean();
  expect(fresh.status).toBe('cancelled');
  expect(fresh.cancellations).toHaveLength(2);
  expect(owedPaise(fresh)).toBe(80000); // A ₹500 + B ₹300 — nothing stranded
  expect(fresh.cancellations.every((c) => c.refund.status === 'pending')).toBe(true);
  expect(fresh.refundDetails?.requestedAt).toBeUndefined(); // no double order-level claim
});

it('bulk status update: records a refund for the remaining lines', async () => {
  const order = await partlyCancelledOrder();
  const token = await adminToken();

  const res = await request(app).post(`${BASE}/orders/bulk/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ orderIds: [String(order._id)], status: 'cancelled', reason: 'customer_request' });
  expect(res.body.results?.successful).toHaveLength(1);

  const fresh = await Order.findById(order._id).lean();
  expect(fresh.status).toBe('cancelled');
  expect(owedPaise(fresh)).toBe(80000);
});

it('a plain order with no earlier cancellations still uses the whole-order refund', async () => {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'A', price: 500, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 500, totalAmount: 500, status: 'processing', paymentStatus: 'paid',
  });
  const token = await adminToken();
  await request(app).put(`${BASE}/orders/${order._id}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'cancelled', reason: 'customer_request' })
    .expect(200);
  const fresh = await Order.findById(order._id).lean();
  expect(fresh.status).toBe('cancelled');
  expect(fresh.cancellations || []).toHaveLength(0);
  expect(fresh.refundDetails?.status).toBe('pending');
});
