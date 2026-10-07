/**
 * Team workflow over HTTP: the multipart proof upload, the private photo endpoint,
 * and the gate in front of it all (customers and anonymous callers never get in).
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const stored = new Map();
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async () => true,
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');

const BASE = '/api/v1';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 7)]);

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); stored.clear(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role, staff) {
  n += 1;
  const email = `u${n}@autobacs.test`;
  const password = 'SecurePass123!';
  await User.create({ name: `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
}

async function paidOrder() {
  const o = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Snorkel', price: 30000, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 30000, totalAmount: 30000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  await orderStatusService.updateOrderStatus(String(o._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  return Order.findById(o._id).lean();
}

const as = (token) => ({ Authorization: `Bearer ${token}` });

it('keeps customers and anonymous callers out', async () => {
  const order = await paidOrder();
  const customer = await login('customer');
  const anon = await request(app).get(`${BASE}/staff/work?queue=procurement`);
  expect([401, 403]).toContain(anon.status);
  const res = await request(app).get(`${BASE}/staff/work/orders/${order._id}`).set(as(customer));
  expect(res.status).toBe(403);
});

it('uploads the supplier photo as multipart and serves it back privately', async () => {
  const order = await paidOrder();
  const itemId = String(order.items[0]._id);
  const procurement = await login('staff', { team: 'procurement' });
  const operations = await login('staff', { team: 'operations' });

  await request(app).post(`${BASE}/staff/work/orders/${order._id}/lines/${itemId}/stock`)
    .set(as(procurement)).send({ stock: 'ordered', supplierName: 'Ram Traders' }).expect(200);

  const shipped = await request(app).post(`${BASE}/staff/work/orders/${order._id}/ship`)
    .set(as(procurement))
    .field('courierName', 'Delhivery')
    .field('trackingNumber', 'DL999')
    .field('itemIds', JSON.stringify([itemId]))
    .attach('photo', JPEG, { filename: 'proof.jpg', contentType: 'image/jpeg' })
    .expect(200);

  const parcel = shipped.body.order.parcels[0];
  expect(parcel).toMatchObject({ courier: 'Delhivery', trackingNumber: 'DL999', status: 'shipped' });

  const photo = await request(app).get(parcel.photoUrl.replace('/api/v1', BASE)).set(as(operations))
    .buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); })
    .expect(200);
  expect(photo.headers['content-type']).toMatch(/image\/jpeg/);
  expect(photo.headers['cache-control']).toBe('private, no-store');
  expect(Buffer.compare(photo.body, JPEG)).toBe(0);
});

it('rejects a non-image upload with a clear message', async () => {
  const order = await paidOrder();
  const procurement = await login('staff', { team: 'procurement' });
  await request(app).post(`${BASE}/staff/work/orders/${order._id}/lines/${order.items[0]._id}/stock`)
    .set(as(procurement)).send({ stock: 'in_stock' }).expect(200);

  const res = await request(app).post(`${BASE}/staff/work/orders/${order._id}/ship`)
    .set(as(procurement))
    .attach('photo', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/JPG, PNG or WebP/);
});

it('validates the queue name', async () => {
  const procurement = await login('staff', { team: 'procurement' });
  const res = await request(app).get(`${BASE}/staff/work?queue=everything`).set(as(procurement));
  expect(res.status).toBe(400);
});

it('shows the supplier photo to admins on the admin order page — and never to the customer', async () => {
  // The customer owns the order, so they can open their own order pages.
  n += 1;
  const custEmail = `cust${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const customer = await User.create({ name: 'Ravi', email: custEmail, phone: '9876543210', passwordHash: await bcrypt.hash(password, 10), role: 'customer' });
  const custLogin = await request(app).post(`${BASE}/auth/login`).send({ email: custEmail, password });
  const custToken = (custLogin.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken=')).split(';')[0].slice('accessToken='.length);

  const o = await Order.create({
    user: customer._id,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Snorkel', price: 30000, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 30000, totalAmount: 30000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  await orderStatusService.updateOrderStatus(String(o._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  const itemId = String(o.items[0]._id);
  const procurement = await login('staff', { team: 'procurement' });
  await request(app).post(`${BASE}/staff/work/orders/${o._id}/lines/${itemId}/stock`).set(as(procurement)).send({ stock: 'in_stock' }).expect(200);
  await request(app).post(`${BASE}/staff/work/orders/${o._id}/ship`).set(as(procurement))
    .field('trackingNumber', 'DL1').attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' }).expect(200);

  // Admin: the parcels panel gets a link, and the link serves the photo.
  const admin = await login('admin');
  const adminParcels = await request(app).get(`${BASE}/orders/${o._id}/shipments`).set(as(admin)).expect(200);
  const parcel = adminParcels.body.shipments[0];
  expect(parcel.proofPhoto).toBeUndefined();
  expect(parcel.proofPhotoUrl).toBe(`/api/v1/staff/work/orders/${o._id}/parcels/${parcel._id}/photo`);
  const photo = await request(app).get(parcel.proofPhotoUrl.replace('/api/v1', BASE)).set(as(admin)).expect(200);
  expect(photo.headers['content-type']).toMatch(/image\/jpeg/);
  const adminOrder = await request(app).get(`${BASE}/orders/${o._id}`).set(as(admin)).expect(200);
  expect(adminOrder.body.order?.shipments?.[0]?.proofPhotoUrl || adminOrder.body.shipments?.[0]?.proofPhotoUrl).toBeTruthy();

  // Customer: their own order pages carry no trace of the photo ref.
  const custParcels = await request(app).get(`${BASE}/orders/${o._id}/shipments`).set(as(custToken)).expect(200);
  const custOrder = await request(app).get(`${BASE}/orders/${o._id}`).set(as(custToken)).expect(200);
  const custList = await request(app).get(`${BASE}/orders`).set(as(custToken)).expect(200);
  for (const body of [custParcels.body, custOrder.body, custList.body]) {
    expect(JSON.stringify(body)).not.toMatch(/proofPhoto|shipping-slips\/proof-/);
  }
  // …and cannot fetch the photo through the staff proxy either.
  const blocked = await request(app).get(parcel.proofPhotoUrl.replace('/api/v1', BASE)).set(as(custToken));
  expect(blocked.status).toBe(403);
});
