/**
 * Spin-to-Win over REAL HTTP — the exact request the order-success page makes.
 *
 * Written after the wheel failed to appear on the preview tier with no error anywhere:
 * SpinSection renders nothing on ANY non-eligible answer, so "no campaign", "not paid",
 * "not your order" and "the route 404s" are indistinguishable in a browser. Every unit
 * test we had called the service directly, so none of them would have caught a route
 * that was not mounted, an auth middleware that rejected, or a response shape the client
 * could not read.
 *
 * These go through the router, the auth middleware and the JSON contract.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import SpinCampaign from '../models/SpinCampaign.js';
import SpinPrize from '../models/SpinPrize.js';
import SpinResult from '../models/SpinResult.js';
import * as dbHandler from './db-handler.js';
import cacheService from '../services/cacheService.js';
import { SPIN_STATUS } from '../config/spin.js';

jest.setTimeout(120000);

const buyer = { name: 'Spin Buyer', email: 'spinbuyer@example.com', password: 'SecurePass123!' };

const ADDRESS = {
  fullName: 'Spin Buyer', phone: '9999999999', addressLine1: '1 Test Road',
  city: 'Mumbai', state: 'Maharashtra', postalCode: '400001',
};

async function login(email, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  return cookie ? cookie.split(';')[0] : null;
}

/**
 * The double-submit CSRF pair. The browser's apiClient mints this automatically before
 * any non-GET; supertest does not, so a POST without it is a 403 that means nothing
 * about the spin route.
 */
async function csrfPair() {
  const res = await request(app).get('/api/v1/csrf-token');
  const c = (res.headers['set-cookie'] || []).find((x) => x.startsWith('XSRF-TOKEN='));
  const token = c ? c.split(';')[0].split('=')[1] : '';
  return { cookie: c ? c.split(';')[0] : '', token };
}

async function seedLiveCampaign(overrides = {}) {
  const campaign = await SpinCampaign.create({
    slug: `http-${new mongoose.Types.ObjectId()}`,
    name: 'HTTP Campaign',
    status: SPIN_STATUS.LIVE,
    startsAt: new Date(Date.now() - 86400000),
    endsAt: new Date(Date.now() + 86400000),
    goodieWinRatePercent: 50,
    ...overrides,
  });
  await SpinPrize.create({
    campaign: campaign._id, name: '₹200 off', kind: 'coupon', couponType: 'fixed',
    couponValue: 200, isFloorPrize: true, stockTotal: null, stockRemaining: null,
  });
  await SpinPrize.create({
    campaign: campaign._id, name: 'Microfibre Cloth', sku: 'GOODIE-MF', kind: 'goodie',
    stockTotal: 10, stockRemaining: 10,
  });
  return campaign;
}

describe('GET /api/v1/spin/orders/:orderId — what the success page actually calls', () => {
  let cookie;
  let userId;

  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    await cacheService.invalidatePattern('public:spin:*');
    const passwordHash = await bcrypt.hash(buyer.password, await bcrypt.genSalt(10));
    const u = await User.create({ name: buyer.name, email: buyer.email, passwordHash });
    userId = u._id;
    cookie = await login(buyer.email, buyer.password);
    expect(cookie).toBeTruthy();
  });

  const seedOrder = (over = {}) => Order.create({
    user: userId,
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 1000, name: 'Thing' }],
    shippingAddress: ADDRESS, subtotal: 1000, totalAmount: 1000,
    status: 'processing', paymentStatus: 'paid', ...over,
  });

  it('the route is mounted and answers 200 for the order owner', async () => {
    await seedLiveCampaign();
    const order = await seedOrder();

    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('offers the wheel on a PAID order while a campaign is live', async () => {
    await seedLiveCampaign();
    const order = await seedOrder();

    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', cookie);

    expect(res.body.eligible).toBe(true);
    // The client maps `segments` straight onto the dial — an empty array renders a
    // blank wheel, so the contract is that it is populated.
    expect(Array.isArray(res.body.segments)).toBe(true);
    expect(res.body.segments.length).toBeGreaterThan(0);
    expect(res.body.campaign?.segmentCount).toBeGreaterThan(0);
  });

  it('tells the client to KEEP POLLING while payment is still confirming', async () => {
    await seedLiveCampaign();
    const order = await seedOrder({ paymentStatus: 'pending', status: 'awaiting_payment' });

    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', cookie);

    expect(res.body.eligible).toBe(false);
    // Without this flag the widget gives up instantly and the customer never sees the
    // wheel, because the webhook almost always lands after the redirect.
    expect(res.body.pending).toBe(true);
  });

  it('says a plain no (not pending) when NO campaign is live', async () => {
    const order = await seedOrder();
    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', cookie);

    expect(res.body.eligible).toBe(false);
    expect(res.body.pending).toBeFalsy();
    expect(res.body.reason).toBe('no_campaign');
  });

  it('a DRAFT campaign offers nothing — publishing is what turns the wheel on', async () => {
    await seedLiveCampaign({ status: SPIN_STATUS.DRAFT });
    const order = await seedOrder();
    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', cookie);
    expect(res.body.reason).toBe('no_campaign');
  });

  it('an order placed BEFORE the campaign opened is not eligible', async () => {
    const campaign = await seedLiveCampaign();
    const order = await seedOrder();
    await Order.collection.updateOne(
      { _id: order._id },
      { $set: { createdAt: new Date(new Date(campaign.startsAt).getTime() - 3600000) } },
    );
    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', cookie);
    expect(res.body.reason).toBe('predates_campaign');
  });

  it('rejects an anonymous caller instead of quietly answering 200', async () => {
    await seedLiveCampaign();
    const order = await seedOrder();
    const res = await request(app).get(`/api/v1/spin/orders/${order._id}`);
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it("404s on someone else's order rather than leaking that it exists", async () => {
    await seedLiveCampaign();
    const order = await seedOrder();
    const otherHash = await bcrypt.hash('OtherPass123!', await bcrypt.genSalt(10));
    await User.create({ name: 'Other', email: 'other@example.com', passwordHash: otherHash });
    const otherCookie = await login('other@example.com', 'OtherPass123!');

    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', otherCookie);
    expect(res.status).toBe(404);
  });

  it('POST spins, and a second POST returns the SAME prize over HTTP', async () => {
    await seedLiveCampaign();
    const order = await seedOrder();

    const csrf = await csrfPair();
    const first = await request(app)
      .post(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', [cookie, csrf.cookie])
      .set('X-XSRF-TOKEN', csrf.token)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.result?.prize?.name).toBeTruthy();
    expect(typeof first.body.result.segmentIndex).toBe('number');

    const second = await request(app)
      .post(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', [cookie, csrf.cookie])
      .set('X-XSRF-TOKEN', csrf.token)
      .send({});
    expect(second.body.alreadySpun).toBe(true);
    expect(second.body.result.prize.name).toBe(first.body.result.prize.name);
    expect(await SpinResult.countDocuments({ order: order._id })).toBe(1);
  });

  it('after spinning, GET reports alreadySpun so a refresh shows the prize again', async () => {
    await seedLiveCampaign();
    const order = await seedOrder();
    const csrf = await csrfPair();
    const spun = await request(app)
      .post(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', [cookie, csrf.cookie])
      .set('X-XSRF-TOKEN', csrf.token)
      .send({});
    expect(spun.status).toBe(200);

    const res = await request(app)
      .get(`/api/v1/spin/orders/${order._id}`)
      .set('Cookie', cookie);
    expect(res.body.alreadySpun).toBe(true);
    expect(res.body.result?.prize?.name).toBeTruthy();
    expect(Array.isArray(res.body.result.segmentLabels)).toBe(true);
  });
});
