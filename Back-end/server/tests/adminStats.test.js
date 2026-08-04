/**
 * Admin header stats (GET /api/v1/admin/stats).
 *
 * Regression cover for the "always 0" bug: the counters matched a non-existent
 * field (`orderStatus`) and legacy enum values, and a no-match Mongo filter
 * returns 0 rather than erroring — so the failure was completely silent. These
 * tests assert the numbers against seeded orders in every status, which is the
 * only thing that would have caught it.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import * as dbHandler from './db-handler.js';
import cacheService from '../services/cacheService.js';
import { SALE_STATUSES, PENDING_FULFILLMENT_STATUSES } from '../utils/orderStatusGroups.js';
import { currentFiscalYear } from '../utils/storeTime.js';

const admin = {
  name: 'Stats Admin',
  email: 'statsadmin@example.com',
  password: 'password123',
};

const shippingAddress = {
  fullName: 'Test Buyer',
  phone: '9999999999',
  addressLine1: '1 Test Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400001',
};

async function seedOrder(user, status, totalAmount, paymentStatus = 'paid', createdAt) {
  const order = await Order.create({
    user,
    items: [{ product: user, quantity: 1, price: totalAmount, name: 'Item' }],
    shippingAddress,
    subtotal: totalAmount,
    totalAmount,
    status,
    paymentStatus,
  });
  // `createdAt` is managed by timestamps, so backdating needs an explicit write.
  if (createdAt) {
    await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt } });
  }
  return order;
}

describe('GET /api/v1/admin/stats', () => {
  let adminToken;
  let adminId;

  beforeAll(async () => {
    await dbHandler.connect();
  });

  afterEach(async () => {
    await dbHandler.clearDatabase();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    // The route caches for 30s; without this the second test in the file would
    // assert against the first test's numbers.
    await cacheService.delete(cacheService.generateKey('admin:stats'));

    const passwordHash = await bcrypt.hash(admin.password, await bcrypt.genSalt(10));
    const user = await User.create({
      name: admin.name,
      email: admin.email,
      passwordHash,
      role: 'admin',
    });
    adminId = user._id;

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });
    const accessCookie = (loginRes.headers['set-cookie'] || []).find((c) =>
      c.startsWith('accessToken=')
    );
    adminToken = accessCookie
      ? accessCookie.split(';')[0].slice('accessToken='.length)
      : loginRes.body.accessToken;
  });

  const getStats = () =>
    request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${adminToken}`);

  it('requires an authenticated admin', async () => {
    await request(app).get('/api/v1/admin/stats').expect(401);
  });

  it('counts orders that are placed but not delivered as pending', async () => {
    await seedOrder(adminId, 'processing', 1000);
    await seedOrder(adminId, 'shipped', 2000);
    await seedOrder(adminId, 'delivered', 3000);

    const res = await getStats().expect(200);

    expect(res.body.stats.pendingOrders).toBe(2);
  });

  it('excludes abandoned, cancelled and returned orders from pending', async () => {
    await seedOrder(adminId, 'processing', 1000);
    await seedOrder(adminId, 'awaiting_payment', 5000, 'pending');
    await seedOrder(adminId, 'cancelled', 6000, 'cancelled');
    await seedOrder(adminId, 'returned', 7000, 'refunded');

    const res = await getStats().expect(200);

    expect(res.body.stats.pendingOrders).toBe(1);
    expect(res.body.stats.totalOrders).toBe(1);
  });

  it('sums realised revenue and ignores non-sale orders', async () => {
    await seedOrder(adminId, 'processing', 1000.5);
    await seedOrder(adminId, 'shipped', 2000);
    await seedOrder(adminId, 'delivered', 3000);
    await seedOrder(adminId, 'cancelled', 999999, 'cancelled');
    await seedOrder(adminId, 'awaiting_payment', 888888, 'pending');

    const res = await getStats().expect(200);

    expect(res.body.stats.totalRevenue).toBe(6000.5);
  });

  it('counts revenue for the current financial year only', async () => {
    const fy = currentFiscalYear();
    await seedOrder(adminId, 'delivered', 5000);
    // One millisecond before the FY opened, and a year earlier — both excluded.
    await seedOrder(adminId, 'delivered', 111111, 'paid', new Date(fy.start.getTime() - 1));
    await seedOrder(adminId, 'delivered', 222222, 'paid', new Date(fy.start.getTime() - 86_400_000 * 200));
    // Exactly on the boundary — included ($gte).
    await seedOrder(adminId, 'delivered', 1000, 'paid', fy.start);

    const res = await getStats().expect(200);

    expect(res.body.stats.totalRevenue).toBe(6000);
    // Pending stays lifetime — an order stuck since last FY still needs chasing.
    expect(res.body.stats.totalOrders).toBe(4);
  });

  it('reports the revenue window so the tile can label and deep-link it', async () => {
    const fy = currentFiscalYear();

    const res = await getStats().expect(200);

    expect(res.body.stats.revenuePeriod).toEqual({ label: fy.label, startDate: fy.startDate });
    expect(res.body.stats.revenuePeriod.label).toMatch(/^FY \d{2}-\d{2}$/);
    expect(res.body.stats.revenuePeriod.startDate).toMatch(/^\d{4}-04-01$/);
  });

  it('keeps pending orders lifetime — an order stuck since last FY still needs chasing', async () => {
    const fy = currentFiscalYear();
    await seedOrder(adminId, 'processing', 1000, 'paid', new Date(fy.start.getTime() - 86_400_000 * 30));

    const res = await getStats().expect(200);

    expect(res.body.stats.pendingOrders).toBe(1);
    expect(res.body.stats.totalRevenue).toBe(0);
  });

  it('returns zeros (not an error) when there are no orders', async () => {
    const res = await getStats().expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.stats.pendingOrders).toBe(0);
    expect(res.body.stats.totalRevenue).toBe(0);
  });

  it('advertises the status groups behind each counter so the UI can deep-link them', async () => {
    const res = await getStats().expect(200);

    expect(res.body.stats.filters.pendingOrders).toEqual([...PENDING_FULFILLMENT_STATUSES]);
    expect(res.body.stats.filters.totalRevenue).toEqual([...SALE_STATUSES]);
    expect(res.body.stats.filters.pendingOrders).not.toContain('delivered');
  });

  it('only groups statuses that exist on the Order model', () => {
    const enumValues = Order.schema.path('status').enumValues;
    // `confirmed` is a deliberate legacy carry-over (see utils/orderStatusGroups.js).
    const current = SALE_STATUSES.filter((s) => s !== 'confirmed');

    expect(current.every((s) => enumValues.includes(s))).toBe(true);
    expect(enumValues).toContain('delivered');
  });
});
