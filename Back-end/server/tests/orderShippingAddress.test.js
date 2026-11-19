/**
 * PATCH /orders/:id/shipping-address — admin correction of the delivery address.
 *
 * Contract (services/orderAddressService.js):
 *   • admin only; customers and staff are refused;
 *   • only before dispatch — a shipped/cancelled order, or any parcel past `packed`
 *     or with a tracking number, is locked (409);
 *   • PIN code / state / country never change (they set the delivery charge);
 *   • a reason is required, and every change is kept on the order + audit log;
 *   • the customer's own order view never shows the internal change trail.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const svc = await import('../services/orderAddressService.js');

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
    name: `${role} ${n}`, email, phone: `90000000${String(n).padStart(2, '0')}`,
    passwordHash: await bcrypt.hash(password, 10), role,
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, user };
}

const ADDRESS = { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India' };

function makeOrder(userId, overrides = {}) {
  return Order.create({
    user: userId,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'A', price: 500, quantity: 1 }],
    shippingAddress: ADDRESS,
    subtotal: 500, totalAmount: 500, status: 'processing',
    ...overrides,
  });
}

const patchAs = (token, orderId, body) => request(app)
  .patch(`${BASE}/orders/${orderId}/shipping-address`)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

const fix = { address: { addressLine1: '12B Marine Drive', phone: '+91 91234 56789' }, reason: 'Customer called with the right flat number' };

describe('PATCH /orders/:id/shipping-address', () => {
  it('admin corrects street and phone; trail kept on the order and the audit log', async () => {
    const { token } = await login('admin');
    const { user: customer } = await login();
    const order = await makeOrder(customer._id);

    const res = await patchAs(token, order._id, fix);
    expect(res.status).toBe(200);
    expect(res.body.shippingAddress).toMatchObject({ addressLine1: '12B Marine Drive', phone: '9123456789', postalCode: '682001', state: 'Kerala' });
    expect(res.body.addressEditable).toBe(true);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.shippingAddress.addressLine1).toBe('12B Marine Drive');
    expect(fresh.totalAmount).toBe(500);
    expect(fresh.addressChanges).toHaveLength(1);
    expect(fresh.addressChanges[0]).toMatchObject({
      reason: fix.reason,
      before: expect.objectContaining({ addressLine1: '1 Road', phone: '9876543210' }),
      after: expect.objectContaining({ addressLine1: '12B Marine Drive', phone: '9123456789' }),
    });

    // Fire-and-forget audit row: allow it to land.
    await new Promise((r) => setTimeout(r, 50));
    const audit = await AuditLog.findOne({ resource: 'OrderShippingAddress', resourceId: String(order._id) }).lean();
    expect(audit).toBeTruthy();
  });

  it('refuses customers and non-admin staff (403) and leaves the order untouched', async () => {
    const { token: customerToken, user: customer } = await login();
    const { token: staffToken } = await login('staff');
    const order = await makeOrder(customer._id);

    expect((await patchAs(customerToken, order._id, fix)).status).toBe(403);
    expect((await patchAs(staffToken, order._id, fix)).status).toBe(403);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.shippingAddress.addressLine1).toBe('1 Road');
    expect(fresh.addressChanges).toBeUndefined();
  });

  it.each([
    ['a shipped order', { status: 'shipped' }],
    ['a delivered order', { status: 'delivered' }],
    ['a cancelled order', { status: 'cancelled' }],
    ['an order with an order-level tracking number', { trackingNumber: 'AWB123' }],
    ['a parcel already handed to the courier', { shipments: [{ sequence: 1, status: 'shipped', lines: [] }] }],
    ['a packed parcel that already has a tracking number', { shipments: [{ sequence: 1, status: 'packed', trackingNumber: 'AWB9', lines: [] }] }],
  ])('locks %s (409)', async (_label, overrides) => {
    const { token } = await login('admin');
    const { user: customer } = await login();
    const order = await makeOrder(customer._id, overrides);

    const res = await patchAs(token, order._id, fix);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/can no longer be changed/);
    expect((await Order.findById(order._id).lean()).shippingAddress.addressLine1).toBe('1 Road');
  });

  it('still allows the edit while a parcel is only packed with no tracking number', async () => {
    const { token } = await login('admin');
    const { user: customer } = await login();
    const order = await makeOrder(customer._id, { shipments: [{ sequence: 1, status: 'packed', lines: [] }] });
    expect((await patchAs(token, order._id, fix)).status).toBe(200);
  });

  it.each([
    ['PIN code', { postalCode: '110001' }],
    ['state', { state: 'Delhi' }],
    ['country', { country: 'Nepal' }],
  ])('rejects a %s change — it would change the delivery charge', async (label, address) => {
    const { token } = await login('admin');
    const { user: customer } = await login();
    const order = await makeOrder(customer._id);

    const res = await patchAs(token, order._id, { address, reason: 'typo' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/can't be changed on a placed order/);
    expect((await Order.findById(order._id).lean()).shippingAddress).toMatchObject({ postalCode: '682001', state: 'Kerala' });
  });

  it('accepts locked fields when they are sent unchanged (the form sends the whole address)', async () => {
    const { token } = await login('admin');
    const { user: customer } = await login();
    const order = await makeOrder(customer._id);
    const res = await patchAs(token, order._id, { address: { ...ADDRESS, city: 'Ernakulam' }, reason: 'City spelled wrong' });
    expect(res.status).toBe(200);
    expect(res.body.shippingAddress.city).toBe('Ernakulam');
  });

  it.each([
    ['no reason', { address: { city: 'Ernakulam' } }, /why/],
    ['a bad phone', { address: { phone: '12345' }, reason: 'fix' }, /10-digit/],
    ['an emptied required field', { address: { addressLine1: '  ' }, reason: 'fix' }, /required/],
    ['no actual change', { address: { city: 'Kochi' }, reason: 'fix' }, /Nothing changed/],
  ])('rejects %s (400)', async (_label, body, msg) => {
    const { token } = await login('admin');
    const { user: customer } = await login();
    const order = await makeOrder(customer._id);
    const res = await patchAs(token, order._id, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(msg);
  });

  it('404s an unknown order', async () => {
    const { token } = await login('admin');
    expect((await patchAs(token, new mongoose.Types.ObjectId(), fix)).status).toBe(404);
  });

  it('caps the trail at MAX_ADDRESS_CHANGES, keeping the newest', async () => {
    const { token } = await login('admin');
    const { user: customer } = await login();
    const old = Array.from({ length: svc.MAX_ADDRESS_CHANGES }, (_, i) => ({ at: new Date(2026, 0, i + 1), reason: `old ${i}` }));
    const order = await makeOrder(customer._id, { addressChanges: old });
    expect((await patchAs(token, order._id, fix)).status).toBe(200);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.addressChanges).toHaveLength(svc.MAX_ADDRESS_CHANGES);
    expect(fresh.addressChanges.at(-1).reason).toBe(fix.reason);
    expect(fresh.addressChanges[0].reason).toBe('old 1');
  });

  it('GET hides the change trail from the customer and flags editability for admins only', async () => {
    const { token: adminToken } = await login('admin');
    const { token: customerToken, user: customer } = await login();
    const order = await makeOrder(customer._id);
    await patchAs(adminToken, order._id, fix);

    const mine = await request(app).get(`${BASE}/orders/${order._id}`).set('Authorization', `Bearer ${customerToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.order.shippingAddress.addressLine1).toBe('12B Marine Drive');
    expect(mine.body.order.addressChanges).toBeUndefined();
    expect(mine.body.order.addressEditable).toBeUndefined();

    const admin = await request(app).get(`${BASE}/orders/${order._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(admin.body.order.addressEditable).toBe(true);
    expect(admin.body.order.addressChanges).toHaveLength(1);
  });
});

describe('orderAddressService — races', () => {
  it('a dispatch landing between the check and the write locks the edit (409), not overwrites', async () => {
    const { user: customer } = await login();
    const order = await makeOrder(customer._id);
    const req = { user: { _id: customer._id, name: 'Admin' }, headers: {} };

    // Simulate the race: the parcel ships right after the service read the order.
    const realFindOneAndUpdate = Order.findOneAndUpdate.bind(Order);
    const spy = jest.spyOn(Order, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
      await Order.updateOne({ _id: order._id }, { $set: { status: 'shipped' } });
      return realFindOneAndUpdate(...args);
    });
    await expect(svc.updateShippingAddress(req, String(order._id), fix)).rejects.toMatchObject({ statusCode: 409 });
    spy.mockRestore();
    expect((await Order.findById(order._id).lean()).shippingAddress.addressLine1).toBe('1 Road');
  });

  it('a second admin saving the same old address at once gets a 409, not a silent overwrite', async () => {
    const { user: customer } = await login();
    const order = await makeOrder(customer._id);
    const req = { user: { _id: customer._id, name: 'Admin' }, headers: {} };

    const realFindOneAndUpdate = Order.findOneAndUpdate.bind(Order);
    const spy = jest.spyOn(Order, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
      await Order.updateOne({ _id: order._id }, { $set: { 'shippingAddress.addressLine1': 'Other admin' } });
      return realFindOneAndUpdate(...args);
    });
    await expect(svc.updateShippingAddress(req, String(order._id), fix)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Someone else/) });
    spy.mockRestore();
    expect((await Order.findById(order._id).lean()).shippingAddress.addressLine1).toBe('Other admin');
  });
});
