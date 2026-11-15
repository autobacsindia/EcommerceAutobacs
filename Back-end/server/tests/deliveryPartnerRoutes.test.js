/**
 * "Delivery partner" in the Procurement panel, over HTTP (validators → service →
 * the stored parcel → the panel's view), against a real in-memory Mongo.
 *
 * What must hold:
 *   - a listed partner is stored by code with ITS name and tracking page (the typed
 *     name is ignored), and the panel gets the link for the link icon
 *   - "Other" needs a name; its page must be http(s) — javascript: etc. are refused
 *     and nothing is shipped
 *   - an unknown partner code is refused
 *   - correcting a parcel to another partner rewrites name, code and link together;
 *     a new tracking number keeps the partner's link
 *   - a parcel recorded before the dropdown (courier typed, no code) still shows,
 *     and gets its partner's link when the typed name matches one
 *   - only procurement may enter or change it
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
const VRL_PAGE = 'https://www.vrlgroup.in/Tracking/TrackShipment';
const DTDC_PAGE = 'https://www.dtdc.com/track-your-shipment/';
const DELHIVERY_PAGE = 'https://www.delhivery.com/tracking';

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
  const email = `dp${n}@autobacs.test`;
  const password = 'SecurePass123!';
  await User.create({ name: `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
}
const as = (token) => ({ Authorization: `Bearer ${token}` });

async function paidOrder() {
  const o = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Snorkel', price: 30000, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 30000, totalAmount: 30000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  await orderStatusService.updateOrderStatus(String(o._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  return Order.findById(o._id).lean();
}

/** A paid order with its one item marked "Our Warehouse", ready to dispatch. */
async function ownStockOrder(procurement) {
  const order = await paidOrder();
  const itemId = String(order.items[0]._id);
  await request(app).post(`${BASE}/staff/work/orders/${order._id}/lines/${itemId}/stock`)
    .set(as(procurement)).send({ stock: 'own_stock' }).expect(200);
  return { order, itemId, path: `${BASE}/staff/work/orders/${order._id}/dispatch-own` };
}

it('lists the partners for the dropdown, Other last', async () => {
  const res = await request(app).get(`${BASE}/orders/tracking/carriers`).expect(200);
  expect(res.body.carriers.filter((c) => c.deliveryPartner).map((c) => c.code))
    .toEqual(['VRL', 'DELHIVERY', 'DTDC', 'TRACKON', 'SHREE_TIRUPATI', 'OTHER']);
});

it('stores a listed partner by code with its own name and tracking page', async () => {
  const procurement = await login('staff', { team: 'procurement' });
  const { order, path } = await ownStockOrder(procurement);

  const res = await request(app).post(path).set(as(procurement))
    // A stale or odd name from the client is ignored for a listed partner.
    .field('courierCode', 'VRL').field('courierName', 'vrl logistics typo').field('trackingNumber', 'VRL123')
    .expect(200);

  expect(res.body.order.parcels[0]).toMatchObject({ courier: 'VRL', courierCode: 'VRL', courierUrl: VRL_PAGE, trackingNumber: 'VRL123' });
  const fresh = await Order.findById(order._id).lean();
  expect(fresh.shipments[0].carrier).toMatchObject({ name: 'VRL', code: 'VRL', trackingUrl: VRL_PAGE });
});

it('supplier dispatch takes a partner too, and still works with none', async () => {
  const procurement = await login('staff', { team: 'procurement' });
  const order = await paidOrder();
  const itemId = String(order.items[0]._id);
  await request(app).post(`${BASE}/staff/work/orders/${order._id}/lines/${itemId}/stock`)
    .set(as(procurement)).send({ stock: 'in_stock' }).expect(200);

  const res = await request(app).post(`${BASE}/staff/work/orders/${order._id}/ship`).set(as(procurement))
    .field('courierCode', 'DTDC').field('trackingNumber', 'D1')
    .attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
    .expect(200);
  expect(res.body.order.parcels[0]).toMatchObject({ courier: 'DTDC', courierCode: 'DTDC', courierUrl: DTDC_PAGE });
});

it('Other: needs a name, keeps an https page, refuses javascript: and ships nothing', async () => {
  const procurement = await login('staff', { team: 'procurement' });
  const { order, path } = await ownStockOrder(procurement);

  const noName = await request(app).post(path).set(as(procurement))
    .field('courierCode', 'OTHER').field('courierName', '').field('trackingNumber', 'X1');
  expect(noName.status).toBe(400);

  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://a.in/x', '//a.in/x']) {
    const res = await request(app).post(path).set(as(procurement))
      .field('courierCode', 'OTHER').field('courierName', 'Ram Transport').field('courierUrl', bad).field('trackingNumber', 'X1');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/http:\/\/ or https:\/\//);
  }
  expect((await Order.findById(order._id).lean()).shipments || []).toHaveLength(0);

  const ok = await request(app).post(path).set(as(procurement))
    .field('courierCode', 'OTHER').field('courierName', 'Ram Transport').field('courierUrl', 'https://ramtransport.in/track')
    .field('trackingNumber', 'RT9')
    .expect(200);
  expect(ok.body.order.parcels[0]).toMatchObject({ courier: 'Ram Transport', courierCode: 'OTHER', courierUrl: 'https://ramtransport.in/track' });
});

it('refuses a partner code that is not on the list', async () => {
  const procurement = await login('staff', { team: 'procurement' });
  const { path } = await ownStockOrder(procurement);
  const res = await request(app).post(path).set(as(procurement))
    .field('courierCode', 'NOT_A_COURIER').field('courierName', 'X').field('trackingNumber', 'X1');
  expect(res.status).toBe(400);
});

it('correcting the partner rewrites name, code and link together; a new number keeps the link', async () => {
  const procurement = await login('staff', { team: 'procurement' });
  const operations = await login('staff', { team: 'operations' });
  const { path, order } = await ownStockOrder(procurement);
  const shipped = await request(app).post(path).set(as(procurement))
    .field('courierCode', 'OTHER').field('courierName', 'Ram Transport').field('courierUrl', 'https://ramtransport.in/t')
    .field('trackingNumber', 'RT1').expect(200);
  const edit = `${BASE}/staff/work/orders/${order._id}/parcels/${shipped.body.order.parcels[0].id}`;

  // Operations can see it, but only procurement can change it.
  expect((await request(app).put(edit).set(as(operations)).field('courierCode', 'VRL')).status).toBe(403);

  let res = await request(app).put(edit).set(as(procurement)).field('courierCode', 'VRL').field('courierName', 'VRL').expect(200);
  expect(res.body.order.parcels[0]).toMatchObject({ courier: 'VRL', courierCode: 'VRL', courierUrl: VRL_PAGE, trackingNumber: 'RT1' });

  res = await request(app).put(edit).set(as(procurement)).field('courierCode', 'VRL').field('trackingNumber', 'VRL22').expect(200);
  expect(res.body.order.parcels[0]).toMatchObject({ courierUrl: VRL_PAGE, trackingNumber: 'VRL22' });

  // A javascript: page on a correction is refused and changes nothing.
  const bad = await request(app).put(edit).set(as(procurement))
    .field('courierCode', 'OTHER').field('courierName', 'Evil').field('courierUrl', 'javascript:alert(1)');
  expect(bad.status).toBe(400);
  const fresh = await Order.findById(order._id).lean();
  expect(fresh.shipments[0].carrier).toMatchObject({ name: 'VRL', code: 'VRL', trackingUrl: VRL_PAGE });
});

it('a parcel typed before the dropdown still shows, and gets its partner link by name', async () => {
  const procurement = await login('staff', { team: 'procurement' });
  const { path, order } = await ownStockOrder(procurement);
  // The old client: free-text courier, no code.
  const res = await request(app).post(path).set(as(procurement))
    .field('courierName', 'Delhivery').field('trackingNumber', 'DL1').expect(200);
  expect(res.body.order.parcels[0]).toMatchObject({ courier: 'Delhivery', courierCode: '', courierUrl: DELHIVERY_PAGE, trackingNumber: 'DL1' });
  expect((await Order.findById(order._id).lean()).shipments[0].carrier).toEqual({ name: 'Delhivery' });

  // An unknown typed courier shows with no link.
  await Order.updateOne({ _id: order._id }, { $set: { 'shipments.0.carrier': { name: 'Ram Transport' } } });
  const view = await request(app).get(`${BASE}/staff/work/orders/${order._id}`).set(as(procurement)).expect(200);
  expect(view.body.order.parcels[0]).toMatchObject({ courier: 'Ram Transport', courierCode: '', courierUrl: null });
});
