/**
 * POST /orders/:id/refund-all — the order page's single Refund button, over HTTP.
 *
 * The route only picks a path: a plain cancelled order goes to the existing whole-order
 * refund unchanged; an order cancelled line by line (the ₹10 test order's shape — the
 * one the old button refused with a 409) goes to the per-line refunds.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: cancellationService } = await import('../services/cancellationService.js');
const { default: razorpayService } = await import('../services/razorpayService.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');

const BASE = '/api/v1';

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); jest.restoreAllMocks(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function tokenFor(role) {
  n += 1;
  const email = `${role}${n}@autobacs.test`;
  const password = 'SecurePass123!';
  await User.create({ name: role, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
}

/** A paid ₹10 order with one line, plus its Payment row. */
async function paidOrder() {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Test item', price: 10, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 10, totalAmount: 10, status: 'processing', paymentStatus: 'paid',
  });
  const payment = await Payment.create({
    order: order._id, user: order.user, amount: 10, gatewayPaymentId: 'pay_TEN',
    paymentGateway: 'razorpay', paymentMethod: 'upi', status: 'completed',
  });
  await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
  return order;
}

const gateway = () => jest.spyOn(razorpayService, 'refundPayment')
  .mockResolvedValue({ refundId: 'rfnd_X', status: 'processed' });

it('is admin-only', async () => {
  const order = await paidOrder();
  const spy = gateway();
  const anon = await request(app).post(`${BASE}/orders/${order._id}/refund-all`);
  expect([401, 403]).toContain(anon.status);
  const customer = await tokenFor('customer');
  const res = await request(app).post(`${BASE}/orders/${order._id}/refund-all`)
    .set('Authorization', `Bearer ${customer}`);
  expect(res.status).toBe(403);
  expect(spy).not.toHaveBeenCalled();
});

it('refunds an order cancelled line by line — the case the old button refused', async () => {
  const order = await paidOrder();
  await cancellationService.cancelLines(
    String(order._id), { lines: [{ itemId: String(order.items[0]._id), quantity: 1 }] }, {});
  expect((await Order.findById(order._id)).status).toBe('cancelled');
  const admin = await tokenFor('admin');
  const spy = gateway();

  // The old button's endpoint still refuses this shape…
  const old = await request(app).post(`${BASE}/orders/${order._id}/refund`).set('Authorization', `Bearer ${admin}`);
  expect(old.status).toBe(409);

  // …the new one refunds it, once.
  const res = await request(app).post(`${BASE}/orders/${order._id}/refund-all`)
    .set('Authorization', `Bearer ${admin}`).expect(200);
  expect(res.body.refundedRupees).toBe(10);
  expect(spy).toHaveBeenCalledWith('pay_TEN', 1000, expect.anything());

  await request(app).post(`${BASE}/orders/${order._id}/refund-all`)
    .set('Authorization', `Bearer ${admin}`).expect(200);
  expect(spy).toHaveBeenCalledTimes(1);
});

it('sends a plain cancelled order through the existing whole-order refund', async () => {
  const order = await paidOrder();
  await orderStatusService.updateOrderStatus(String(order._id), 'cancelled', { isAdmin: true, cancelledBy: 'admin' });
  const admin = await tokenFor('admin');
  const spy = gateway();

  const res = await request(app).post(`${BASE}/orders/${order._id}/refund-all`)
    .set('Authorization', `Bearer ${admin}`);
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][0]).toBe('pay_TEN');
  expect(spy.mock.calls[0][1]).toBe(1000);
  const fresh = await Order.findById(order._id).lean();
  expect(['processing', 'completed']).toContain(fresh.refundDetails.status);

  // Pressed again: the whole-order path refuses a second send.
  const again = await request(app).post(`${BASE}/orders/${order._id}/refund-all`)
    .set('Authorization', `Bearer ${admin}`);
  expect(again.status).toBeGreaterThanOrEqual(400);
  expect(spy).toHaveBeenCalledTimes(1);
});

it('404s for an unknown order and 400s for a malformed id', async () => {
  const admin = await tokenFor('admin');
  await request(app).post(`${BASE}/orders/${new mongoose.Types.ObjectId()}/refund-all`)
    .set('Authorization', `Bearer ${admin}`).expect(404);
  const bad = await request(app).post(`${BASE}/orders/not-an-id/refund-all`)
    .set('Authorization', `Bearer ${admin}`);
  expect(bad.status).toBe(400);
});

describe('GET /orders/refunds — one row per cancelled item group', () => {
  const list = async (admin, status = 'all') =>
    (await request(app).get(`${BASE}/orders/refunds?status=${status}`)
      .set('Authorization', `Bearer ${admin}`).expect(200)).body.refunds;

  const forOrder = (rows, order) => rows.filter((r) => String(r.order._id) === String(order._id));

  it('lists a line-cancelled order as its cancellation — not as a "full refund" the server refuses', async () => {
    const order = await paidOrder();
    await cancellationService.cancelLines(
      String(order._id), { lines: [{ itemId: String(order.items[0]._id), quantity: 1 }] }, {});
    const admin = await tokenFor('admin');

    const rows = forOrder(await list(admin), order);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'cancellation', amount: 10, status: 'pending', items: ['Test item × 1'] });

    // Process it the way the row's button does; it moves from pending to completed.
    gateway();
    await request(app).post(`${BASE}/orders/${order._id}/cancellations/${rows[0].cancellationId}/refund`)
      .set('Authorization', `Bearer ${admin}`).send({}).expect(200);
    expect(forOrder(await list(admin, 'pending'), order)).toHaveLength(0);
    expect(forOrder(await list(admin, 'completed'), order)[0]).toMatchObject({ kind: 'cancellation', status: 'completed' });
  });

  it('gives each cancellation its own row on a partly cancelled, still-live order', async () => {
    const order = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [
        { product: new mongoose.Types.ObjectId(), name: 'A', price: 500, quantity: 1 },
        { product: new mongoose.Types.ObjectId(), name: 'B', price: 300, quantity: 1 },
        { product: new mongoose.Types.ObjectId(), name: 'C', price: 200, quantity: 1 },
      ],
      shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 1000, totalAmount: 1000, status: 'processing', paymentStatus: 'paid',
    });
    for (const i of [0, 1]) {
      await cancellationService.cancelLines(
        String(order._id), { lines: [{ itemId: String(order.items[i]._id), quantity: 1 }] }, {});
    }
    const admin = await tokenFor('admin');
    const rows = forOrder(await list(admin, 'pending'), order);
    expect(rows.map((r) => [r.kind, r.amount, r.items[0]])).toEqual(
      expect.arrayContaining([['cancellation', 500, 'A × 1'], ['cancellation', 300, 'B × 1']]));
    expect(rows).toHaveLength(2);
  });

  it('shows a repair row for an order the old admin cancel left unrecorded, until it is refunded', async () => {
    const order = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [
        { product: new mongoose.Types.ObjectId(), name: 'A', price: 6, quantity: 1 },
        { product: new mongoose.Types.ObjectId(), name: 'B', price: 4, quantity: 1 },
      ],
      shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 10, totalAmount: 10, status: 'processing', paymentStatus: 'paid',
    });
    const payment = await Payment.create({
      order: order._id, user: order.user, amount: 10, gatewayPaymentId: 'pay_REP',
      paymentGateway: 'razorpay', paymentMethod: 'upi', status: 'completed',
    });
    await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
    await cancellationService.cancelLines(
      String(order._id), { lines: [{ itemId: String(order.items[0]._id), quantity: 1 }] }, {});
    // The old bug: whole-order cancel straight through the status service.
    await orderStatusService.updateOrderStatus(String(order._id), 'cancelled', { isAdmin: true, cancelledBy: 'admin' });
    const admin = await tokenFor('admin');

    const before = forOrder(await list(admin, 'pending'), order);
    expect(before.map((r) => r.kind).sort()).toEqual(['cancellation', 'repair']);
    expect(before.find((r) => r.kind === 'repair').items).toEqual(['B × 1']);

    const spy = gateway();
    await request(app).post(`${BASE}/orders/${order._id}/refund-all`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(spy.mock.calls.reduce((s, c) => s + c[1], 0)).toBe(1000); // ₹10, exactly the capture

    expect(forOrder(await list(admin, 'pending'), order)).toHaveLength(0);
    const after = forOrder(await list(admin, 'completed'), order);
    expect(after.map((r) => r.kind)).toEqual(['cancellation', 'cancellation']);
  });

  it('keeps a plain cancelled order as one whole-order row, as before', async () => {
    const order = await paidOrder();
    await orderStatusService.updateOrderStatus(String(order._id), 'cancelled', { isAdmin: true, cancelledBy: 'admin' });
    const admin = await tokenFor('admin');
    const rows = forOrder(await list(admin), order);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'order', amount: 10, status: 'pending' });
    expect(String(rows[0]._id)).toBe(String(order._id));
  });

  it('lists nothing for an unpaid order cancelled line by line — nothing is owed', async () => {
    const order = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ product: new mongoose.Types.ObjectId(), name: 'A', price: 10, quantity: 1 }],
      shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 10, totalAmount: 10, status: 'awaiting_payment', paymentStatus: 'pending',
    });
    await cancellationService.cancelLines(
      String(order._id), { lines: [{ itemId: String(order.items[0]._id), quantity: 1 }] }, {});
    const admin = await tokenFor('admin');
    expect(forOrder(await list(admin), order)).toHaveLength(0);
  });
});
