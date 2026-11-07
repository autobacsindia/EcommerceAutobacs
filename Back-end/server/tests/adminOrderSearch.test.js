/**
 * The Orders Management search box (GET /orders/admin/all?search=…), as staff use
 * it: by order number (the #xxxxxxxx shown, any case, or the full id), customer
 * name / phone / email (on the order, or on the customer's account), and product
 * name. What is typed is literal text, paging keeps honouring it, and the list
 * stays shut to anyone who is not signed in or not allowed.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import Order from '../models/Order.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function signIn(role, staff) {
  n += 1;
  const email = `search${n}@autobacs.test`;
  await User.create({
    name: `Person ${n}`, email, role, phone: '9000000000', passwordHash: await bcrypt.hash(PASSWORD, 4),
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  return cookie.split(';')[0].slice('accessToken='.length);
}

const buyer = new mongoose.Types.ObjectId();
const seed = (o = {}) => Order.create({
  user: o.user || buyer,
  items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 500, name: o.item || 'Seat cover' }],
  shippingAddress: {
    fullName: o.name || 'Test Buyer', phone: o.phone || '9876500000', addressLine1: '1 Road',
    city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
  },
  subtotal: o.total || 500, totalAmount: o.total || 500, status: 'processing', paymentStatus: 'paid',
});

const search = (token, q, extra = '') => request(app)
  .get(`${BASE}/orders/admin/all?search=${encodeURIComponent(q)}${extra}`)
  .set('Authorization', `Bearer ${token}`);
const totals = (res) => res.body.orders.map((o) => o.totalAmount).sort((a, b) => a - b);

describe('Orders Management search', () => {
  let admin;
  beforeEach(async () => { admin = await signIn('admin'); });

  it('finds an order by product name, any case, part of a word', async () => {
    await seed({ item: 'Pioneer DMH-Z6350BT stereo', total: 24990 });
    await seed({ item: '3D floor mats', total: 4500 });
    const res = await search(admin, 'pioneer dmh').expect(200);
    expect(totals(res)).toEqual([24990]);
    expect(totals(await search(admin, 'FLOOR MAT').expect(200))).toEqual([4500]);
  });

  it('finds an order by the number shown (#xxxxxxxx, any case) and by the full id', async () => {
    await seed({ total: 100 });
    const target = await seed({ total: 321 });
    const shown = String(target._id).slice(-8);
    expect(totals(await search(admin, `#${shown.toUpperCase()}`).expect(200))).toEqual([321]);
    expect(totals(await search(admin, String(target._id)).expect(200))).toEqual([321]);
  });

  it('finds an order by the customer on the order (name, phone) and on their account (email)', async () => {
    const account = await User.create({ name: 'Leela Das', email: 'leela.das@example.test', phone: '9811111111', passwordHash: 'x', role: 'customer' });
    await seed({ user: account._id, total: 700 });
    await seed({ name: 'Rajesh Kumar', phone: '9555000111', total: 800 });
    await seed({ total: 900 });
    expect(totals(await search(admin, 'leela.das@example').expect(200))).toEqual([700]);
    expect(totals(await search(admin, 'rajesh').expect(200))).toEqual([800]);
    expect(totals(await search(admin, '9555000111').expect(200))).toEqual([800]);
  });

  it('special characters are plain text: they match literally and never fail the request', async () => {
    await seed({ item: 'Philips H4 (C++ edition)', total: 1850 });
    await seed({ item: 'Philips H4X standard', total: 1700 });
    expect(totals(await search(admin, '(C++').expect(200))).toEqual([1850]);
    expect(totals(await search(admin, 'H4 (').expect(200))).toEqual([1850]);
    for (const q of ['.*', '[', '\\', '$where', '{"$gt":""}', '^.*$', '?', '#']) {
      const res = await search(admin, q).expect(200);
      expect(res.body.orders).toEqual([]);
    }
  });

  it('pages through every match exactly once, with the count of matches only', async () => {
    for (let i = 0; i < 12; i += 1) await seed({ item: `Roof rack ${i}`, total: 1000 + i });
    for (let i = 0; i < 4; i += 1) await seed({ item: 'Seat cover', total: 50 + i });
    const p1 = await search(admin, 'roof rack', '&page=1&limit=5').expect(200);
    expect(p1.body.pagination).toMatchObject({ total: 12, pages: 3, hasNext: true, hasPrev: false });
    const p2 = await search(admin, 'roof rack', '&page=2&limit=5').expect(200);
    const p3 = await search(admin, 'roof rack', '&page=3&limit=5').expect(200);
    expect(p3.body.pagination.hasNext).toBe(false);
    const all = [...p1.body.orders, ...p2.body.orders, ...p3.body.orders].map((o) => o._id);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
  });

  it('a search combines with the other filters (both must hold)', async () => {
    await seed({ item: 'Roof rack', total: 15000 });
    await seed({ item: 'Roof rack', total: 2000 });
    const res = await search(admin, 'roof', '&minAmount=10000').expect(200);
    expect(totals(res)).toEqual([15000]);
  });

  it('finds an order by its invoice number, plain or as printed (INV-000059), and by the AB- reference', async () => {
    const target = await seed({ total: 777 });
    await Order.collection.updateOne({ _id: target._id }, { $set: { invoiceNo: 59 } });
    const other = await seed({ total: 888 });
    await Order.collection.updateOne({ _id: other._id }, { $set: { invoiceNo: 590 } });
    expect(totals(await search(admin, '59').expect(200))).toEqual([777]);
    expect(totals(await search(admin, 'INV-000059').expect(200))).toEqual([777]);
    expect(totals(await search(admin, 'invoice 59').expect(200))).toEqual([777]);
    expect(totals(await search(admin, `AB-${String(other._id).slice(-8).toUpperCase()}`).expect(200))).toEqual([888]);
  });

  it('combines with the quick filters: paid-only and "Sold by: website"', async () => {
    await seed({ item: 'Roof rack', total: 15000 });
    const unpaid = await seed({ item: 'Roof box', total: 9000 });
    await Order.collection.updateOne({ _id: unpaid._id }, { $set: { paymentStatus: 'pending', status: 'awaiting_payment' } });
    const sold = await seed({ item: 'Roof light', total: 4000 });
    await Order.collection.updateOne({ _id: sold._id }, { $set: { salesUser: new mongoose.Types.ObjectId() } });
    expect(totals(await search(admin, 'roof').expect(200))).toEqual([4000, 9000, 15000]);
    expect(totals(await search(admin, 'roof', '&paymentStatus=paid').expect(200))).toEqual([4000, 15000]);
    expect(totals(await search(admin, 'roof', '&paymentStatus=paid&seller=website').expect(200))).toEqual([15000]);
  });

  it('a very long paste is cut down rather than run as a huge pattern', async () => {
    await seed({ item: 'Roof rack', total: 15000 });
    const res = await search(admin, `roof${'x'.repeat(5000)}`).expect(200);
    expect(res.body.orders).toEqual([]);
  });
});

describe('Orders Management search: who may use it', () => {
  it('signed out → 401', async () => {
    await request(app).get(`${BASE}/orders/admin/all?search=roof`).expect(401);
  });

  it('a customer, or a team that is not marketing → 403', async () => {
    const customer = await signIn('customer');
    await search(customer, 'roof').expect(403);
    const procurement = await signIn('staff', { team: 'procurement' });
    await search(procurement, 'roof').expect(403);
  });

  it('marketing may search (Marketing → Orders is the same screen)', async () => {
    await seed({ item: 'Roof rack', total: 15000 });
    const marketing = await signIn('staff', { team: 'marketing' });
    expect(totals(await search(marketing, 'roof').expect(200))).toEqual([15000]);
  });
});
