/**
 * Team-panel returns over HTTP (/api/v1/staff/returns): the gate in front of it (customers
 * and anonymous callers never get in), the validators, the multipart inspection photos
 * and the private file endpoint, and one whole return from raise to refund.
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

const asset = (raw, resourceType) => (raw?.publicId ? { publicId: raw.publicId, resourceType, bytes: 100, provider: 'r2' } : null);
jest.unstable_mockModule('../services/returnEvidence.js', () => {
  const m = {
    verifyVideo: async (raw) => asset(raw, 'video'),
    verifyProof: async (raw) => asset(raw, 'image'),
    verifyPhotos: async (raws) => (raws || []).map((r) => asset(r, 'image')).filter(Boolean),
    uploadTargets: async () => ({ provider: 'r2', folder: 'autobacs/returns/x', uploads: [] }),
    withSignedEvidence: async (rr) => ({ ...rr, video: null, proofOfPurchase: null, images: [] }),
  };
  return { ...m, default: m };
});

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: razorpayService } = await import('../services/razorpayService.js');

const BASE = '/api/v1';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 7)]);
const DAY = 24 * 60 * 60 * 1000;

jest.setTimeout(120000);
beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); stored.clear(); jest.restoreAllMocks(); });
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
const as = (token) => ({ Authorization: `Bearer ${token}` });

async function deliveredOrder() {
  const line = new mongoose.Types.ObjectId();
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ _id: line, product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 5000, shippingCost: 0, totalAmount: 5000, status: 'delivered', paymentStatus: 'paid',
    deliveredAt: new Date(Date.now() - DAY),
  });
  const payment = await Payment.create({
    order: order._id, user: order.user, amount: 5000, gatewayPaymentId: `pay_${order._id}`,
    paymentGateway: 'razorpay', paymentMethod: 'upi', status: 'completed',
  });
  await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
  return { orderId: String(order._id), itemId: String(line) };
}

it('keeps customers and anonymous callers out', async () => {
  const customer = await login('customer');
  const anon = await request(app).get(`${BASE}/staff/returns?queue=review`);
  expect([401, 403]).toContain(anon.status);
  const res = await request(app).get(`${BASE}/staff/returns?queue=review`).set(as(customer));
  expect(res.status).toBe(403);
});

it('validates the shape before anything runs', async () => {
  const ops = await login('staff', { team: 'operations' });
  expect((await request(app).get(`${BASE}/staff/returns?queue=everything`).set(as(ops))).status).toBe(400);
  const bad = await request(app).post(`${BASE}/staff/returns`).set(as(ops)).send({ orderId: 'nope', items: [] });
  expect(bad.status).toBe(400);
  const badReason = await request(app).post(`${BASE}/staff/returns`).set(as(ops))
    .send({ orderId: String(new mongoose.Types.ObjectId()), items: [{ itemId: String(new mongoose.Types.ObjectId()), quantity: 1, reason: 'bored' }], description: 'x' });
  expect(badReason.status).toBe(400);
});

it('runs one return from raise to refund, with the inspection photo uploaded and served privately', async () => {
  jest.spyOn(razorpayService, 'refundPayment').mockResolvedValue({ refundId: 'rfnd_1', status: 'processed', amount: 500000 });
  const { orderId, itemId } = await deliveredOrder();
  const seller = await login('staff', { team: 'sales', isHead: true });
  const ops = await login('staff', { team: 'operations' });
  const accounts = await login('staff', { team: 'accounts' });
  const procurement = await login('staff', { team: 'procurement' });

  const options = await request(app).get(`${BASE}/staff/returns/orders/${orderId}/options`).set(as(seller)).expect(200);
  expect(options.body.options.lines[0]).toMatchObject({ itemId, returnableQuantity: 1 });

  const raised = await request(app).post(`${BASE}/staff/returns`).set(as(seller)).send({
    orderId, description: 'Wrong colour sent', images: [{ publicId: 'autobacs/returns/x/photo-1.jpg' }],
    items: [{ itemId, quantity: 1, reason: 'wrong_item' }],
  }).expect(201);
  const id = raised.body.return.id;

  // Sales can never approve.
  expect((await request(app).post(`${BASE}/staff/returns/${id}/review`).set(as(seller)).send({ decision: 'approve' })).status).toBe(403);
  await request(app).post(`${BASE}/staff/returns/${id}/review`).set(as(ops))
    .send({ decision: 'approve', destination: { kind: 'warehouse' } }).expect(200);
  await request(app).post(`${BASE}/staff/returns/${id}/pickup`).set(as(ops))
    .send({ provider: 'Delhivery', trackingNumber: 'DL77' }).expect(200);
  await request(app).post(`${BASE}/staff/returns/${id}/received`).set(as(ops)).send({}).expect(200);

  const inspected = await request(app).post(`${BASE}/staff/returns/${id}/inspection`).set(as(ops))
    .field('passed', 'true')
    .field('notes', 'Wrong colour, unused')
    .field('disposition', 'resell')
    .attach('photo', JPEG, { filename: 'item.jpg', contentType: 'image/jpeg' })
    .expect(200);
  const file = inspected.body.return.files[0];
  expect(file).toMatchObject({ purpose: 'inspection' });

  const served = await request(app).get(`${BASE}/staff/returns/${id}/files/${file.id}`).set(as(accounts))
    .buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); })
    .expect(200);
  expect(served.headers['cache-control']).toBe('private, no-store');
  expect(Buffer.compare(served.body, JPEG)).toBe(0);

  // Procurement can never send a customer refund.
  expect((await request(app).post(`${BASE}/staff/returns/${id}/refund`).set(as(procurement)).send({})).status).toBe(403);
  const preview = await request(app).get(`${BASE}/staff/returns/${id}/refund-preview`).set(as(accounts)).expect(200);
  expect(preview.body.preview).toMatchObject({ refundNow: 5000, canSend: true });
  // A client "amount" is ignored — the server's figure is what is sent.
  const refunded = await request(app).post(`${BASE}/staff/returns/${id}/refund`).set(as(accounts))
    .send({ finalAmount: 1, amount: 1 }).expect(200);
  expect(refunded.body.refund).toMatchObject({ amount: 5000, status: 'completed' });
  expect(razorpayService.refundPayment).toHaveBeenCalledWith(`pay_${orderId}`, 500000, expect.any(Object));

  const bell = await request(app).get(`${BASE}/notifications/summary`).set(as(accounts)).expect(200);
  expect(bell.body.items.find((i) => i.key === 'returns_refund')).toMatchObject({ count: 0 });
});
