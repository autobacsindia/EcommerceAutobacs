/**
 * Customer rating of the sale/service on an order (OrderRating), read by the
 * sales incentive engine. What matters is not the happy path but that the
 * numbers can't be gamed: only the real customer of a DELIVERED order can
 * rate, one record per order (also under two taps at once), edits only within
 * 7 days, staff can neither write nor edit, links can't be forged or re-pointed.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import OrderRating from '../models/OrderRating.js';
import * as dbHandler from './db-handler.js';
import {
  mintRatingToken, readRatingToken, parseRatingInput, istMonthRange, EDIT_WINDOW_DAYS,
} from '../services/orderRatingService.js';
import { mintReviewToken } from '../services/reviewLinkService.js';
import { reviewRequestEmail } from '../utils/emailTemplates.js';
import { buildIndexes } from '../scripts/create-order-rating-indexes.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';
const DAY = 24 * 60 * 60 * 1000;

let csrfPair, csrfToken;
const withCsrf = (r) => r.set('Cookie', csrfPair).set('x-xsrf-token', csrfToken);
const post = (url, body, token) => {
  const r = withCsrf(request(app).post(url));
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};
const get = (url, token) => {
  const r = request(app).get(url);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

let n = 0;
async function makeUser(role, staff) {
  n += 1;
  const email = `rate${n}@autobacs.test`;
  const user = await User.create({
    name: `Person ${n}`, email, role, phone: '9000000000', passwordHash: await bcrypt.hash(PASSWORD, 4),
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  return { user, token: cookie.split(';')[0].slice('accessToken='.length) };
}

const seedOrder = (o = {}) => Order.create({
  user: o.user || new mongoose.Types.ObjectId(),
  source: o.source || 'web',
  salesUser: o.salesUser ?? null,
  items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 500, name: 'Seat cover' }],
  shippingAddress: {
    fullName: 'Test Buyer', phone: '9876500000', addressLine1: '1 Road',
    city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
  },
  subtotal: 500, totalAmount: 500, status: o.status || 'delivered', paymentStatus: 'paid',
});

const linkFor = (order) => `${BASE}/order-ratings/link/${mintRatingToken(String(order._id)).token}`;

beforeAll(async () => {
  await dbHandler.connect();
  await OrderRating.syncIndexes();
  const seed = await request(app).get(`${BASE}/csrf-token`);
  csrfPair = (seed.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN=')).split(';')[0];
  csrfToken = csrfPair.split('=')[1];
});
beforeEach(() => { process.env.REVIEW_LINK_SECRET = 'test-review-link-secret-0123456789'; });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

describe('rating token', () => {
  test('round-trips the order id', () => {
    const id = String(new mongoose.Types.ObjectId());
    expect(readRatingToken(mintRatingToken(id).token)).toEqual({ ok: true, orderId: id, sentBy: null, net: null });
  });

  test('an edited payload (another order) fails the signature', () => {
    const { token } = mintRatingToken(String(new mongoose.Types.ObjectId()));
    const [, mac] = token.split('.');
    const other = Buffer.from(JSON.stringify({ k: 'r', o: String(new mongoose.Types.ObjectId()), e: 9999999999 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(readRatingToken(`${other}.${mac}`)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  test('a product-review token is not a rating token', () => {
    const id = String(new mongoose.Types.ObjectId());
    const { token } = mintReviewToken(id, String(new mongoose.Types.ObjectId()));
    expect(readRatingToken(token).ok).toBe(false);
  });

  test('expired and junk tokens are refused without throwing', () => {
    expect(readRatingToken(mintRatingToken(String(new mongoose.Types.ObjectId()), -1).token))
      .toEqual({ ok: false, reason: 'expired' });
    for (const bad of ['', 'x', 'a.b', 'a.b.c', null, undefined]) expect(readRatingToken(bad).ok).toBe(false);
  });

  test('refuses to mint without a secret', () => {
    const prev = [process.env.REVIEW_LINK_SECRET, process.env.JWT_SECRET];
    delete process.env.REVIEW_LINK_SECRET; delete process.env.JWT_SECRET;
    try {
      expect(() => mintRatingToken('a')).toThrow(/not set/);
    } finally {
      [process.env.REVIEW_LINK_SECRET, process.env.JWT_SECRET] = prev;
    }
  });
});

describe('input', () => {
  test.each([0, 6, 2.5, '3.5', 'five', null, -1])('rejects stars %p', (stars) => {
    expect(() => parseRatingInput({ stars })).toThrow(/1 to 5/);
  });
  test('accepts 1–5 and a trimmed optional comment', () => {
    expect(parseRatingInput({ stars: '4', comment: '  <b>great</b>  ' })).toEqual({ stars: 4, comment: 'bgreat/b' });
    expect(parseRatingInput({ stars: 1 })).toEqual({ stars: 1, comment: '' });
  });
  test('rejects an over-long comment', () => {
    expect(() => parseRatingInput({ stars: 3, comment: 'x'.repeat(501) })).toThrow(/500/);
  });
});

describe('rating by signed link', () => {
  test('creates one rating credited to the order salesperson', async () => {
    const seller = await makeUser('staff', { team: 'sales' });
    const order = await seedOrder({ salesUser: seller.user._id });
    const view = await get(linkFor(order));
    expect(view.status).toBe(200);
    expect(view.body.rating).toBeNull();

    const res = await post(linkFor(order), { stars: 5, comment: 'Very helpful' });
    expect(res.status).toBe(201);
    const saved = await OrderRating.findOne({ order: order._id }).lean();
    expect(saved).toMatchObject({ stars: 5, comment: 'Very helpful', source: 'link' });
    expect(String(saved.salesperson)).toBe(String(seller.user._id));
  });

  test('a re-submit within 7 days updates the same record and keeps the salesperson', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const order = await seedOrder({ salesUser: a });
    await post(linkFor(order), { stars: 2 });
    await Order.updateOne({ _id: order._id }, { $set: { salesUser: b } });
    const res = await post(linkFor(order), { stars: 4, comment: 'Sorted out' });
    expect(res.status).toBe(200);
    const all = await OrderRating.find({ order: order._id }).lean();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ stars: 4, comment: 'Sorted out', editCount: 1 });
    expect(String(all[0].salesperson)).toBe(String(a));
  });

  test('locked after 7 days', async () => {
    const order = await seedOrder();
    await post(linkFor(order), { stars: 3 });
    await OrderRating.collection.updateOne(
      { order: order._id },
      { $set: { createdAt: new Date(Date.now() - (EDIT_WINDOW_DAYS * DAY + 60000)) } }
    );
    const res = await post(linkFor(order), { stars: 5 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('locked');
    expect((await OrderRating.findOne({ order: order._id })).stars).toBe(3);
    expect((await get(linkFor(order))).body.rating.locked).toBe(true);
  });

  test('two simultaneous submits still yield ONE record', async () => {
    const order = await seedOrder();
    const url = linkFor(order);
    const results = await Promise.all([post(url, { stars: 5 }), post(url, { stars: 4 })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await OrderRating.countDocuments({ order: order._id })).toBe(1);
  });

  test.each(['processing', 'shipped', 'cancelled', 'returned', 'awaiting_payment'])('a %s order cannot be rated', async (status) => {
    const order = await seedOrder({ status });
    expect((await get(linkFor(order))).status).toBe(409);
    const res = await post(linkFor(order), { stars: 5 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not-delivered');
    expect(await OrderRating.countDocuments({})).toBe(0);
  });

  test('forged and expired links write nothing', async () => {
    const order = await seedOrder();
    expect((await post(`${BASE}/order-ratings/link/forged.token`, { stars: 5 })).status).toBe(400);
    const expired = mintRatingToken(String(order._id), -1).token;
    expect((await post(`${BASE}/order-ratings/link/${expired}`, { stars: 5 })).status).toBe(410);
    expect(await OrderRating.countDocuments({})).toBe(0);
  });

  test('a signed-in staff member cannot use a customer link', async () => {
    const staff = await makeUser('staff', { team: 'sales' });
    const order = await seedOrder({ salesUser: staff.user._id });
    const res = await post(linkFor(order), { stars: 5 }, staff.token);
    expect(res.status).toBe(403);
    expect(await OrderRating.countDocuments({})).toBe(0);
  });
});

describe('rating from the customer account', () => {
  test('the customer rates their own delivered order', async () => {
    const c = await makeUser('customer');
    const order = await seedOrder({ user: c.user._id });
    const view = await get(`${BASE}/order-ratings/mine/${order._id}`, c.token);
    expect(view.body).toMatchObject({ rateable: true, rating: null });
    const res = await post(`${BASE}/order-ratings/mine/${order._id}`, { stars: 4 }, c.token);
    expect(res.status).toBe(201);
    expect((await OrderRating.findOne({ order: order._id })).source).toBe('account');
  });

  test("another customer's order looks like it does not exist", async () => {
    const c = await makeUser('customer');
    const order = await seedOrder({ status: 'processing' });
    const res = await post(`${BASE}/order-ratings/mine/${order._id}`, { stars: 1 }, c.token);
    expect(res.status).toBe(404);
    expect(await OrderRating.countDocuments({})).toBe(0);
  });

  test('staff and admin accounts cannot rate even an order in their name', async () => {
    for (const [role, staff] of [['staff', { team: 'sales' }], ['admin']]) {
      const s = await makeUser(role, staff);
      const order = await seedOrder({ user: s.user._id });
      const res = await post(`${BASE}/order-ratings/mine/${order._id}`, { stars: 5 }, s.token);
      expect(res.status).toBe(403);
    }
    expect(await OrderRating.countDocuments({})).toBe(0);
  });

  test('requires a login', async () => {
    const order = await seedOrder();
    expect([401, 403]).toContain((await post(`${BASE}/order-ratings/mine/${order._id}`, { stars: 5 })).status);
  });
});

describe('panel (read only)', () => {
  const rate = async (salesUser, stars, createdAt = new Date()) => {
    const order = await seedOrder({ salesUser });
    await OrderRating.collection.insertOne({ order: order._id, salesperson: salesUser, stars, comment: '', source: 'link', createdAt, updatedAt: createdAt, editCount: 0 });
    return order;
  };

  test('admin sees an order rating and a monthly average per salesperson', async () => {
    const admin = await makeUser('admin');
    const s1 = await makeUser('staff', { team: 'sales' });
    const s2 = await makeUser('staff', { team: 'operations' });
    const order = await rate(s1.user._id, 5, new Date('2026-11-03T10:00:00Z'));
    await rate(s1.user._id, 3, new Date('2026-11-20T10:00:00Z'));
    await rate(s2.user._id, 4, new Date('2026-11-05T10:00:00Z'));
    await rate(s1.user._id, 1, new Date('2026-10-31T19:00:00Z')); // 1 Nov 00:30 IST → November
    await rate(s1.user._id, 1, new Date('2026-10-31T18:00:00Z')); // 31 Oct 23:30 IST → October

    const one = await get(`${BASE}/order-ratings/panel/order/${order._id}`, admin.token);
    expect(one.status).toBe(200);
    expect(one.body.rating).toMatchObject({ stars: 5, salesperson: { name: s1.user.name } });

    const month = await get(`${BASE}/order-ratings/panel/monthly?month=2026-11`, admin.token);
    expect(month.status).toBe(200);
    const byName = Object.fromEntries(month.body.rows.map((r) => [r.salesperson.name, r]));
    expect(byName[s1.user.name]).toMatchObject({ count: 3, average: 3, low: 1 });
    expect(byName[s2.user.name]).toMatchObject({ count: 1, average: 4 });
  });

  test('a head sees only their own team; a non-head member sees nothing', async () => {
    const head = await makeUser('staff', { team: 'sales', isHead: true });
    const member = await makeUser('staff', { team: 'sales' });
    const other = await makeUser('staff', { team: 'operations' });
    const mine = await rate(member.user._id, 4, new Date('2026-11-10T10:00:00Z'));
    const theirs = await rate(other.user._id, 2, new Date('2026-11-10T10:00:00Z'));

    const month = await get(`${BASE}/order-ratings/panel/monthly?month=2026-11`, head.token);
    expect(month.body.rows.map((r) => r.salesperson.name)).toEqual([member.user.name]);
    expect((await get(`${BASE}/order-ratings/panel/order/${mine._id}`, head.token)).body.rating.stars).toBe(4);
    expect((await get(`${BASE}/order-ratings/panel/order/${theirs._id}`, head.token)).status).toBe(403);

    expect((await get(`${BASE}/order-ratings/panel/monthly?month=2026-11`, member.token)).status).toBe(403);
    // The member is that order's salesperson: they may open the card, never the rating.
    const own = await get(`${BASE}/order-ratings/panel/order/${mine._id}`, member.token);
    expect(own.status).toBe(200);
    expect(own.body.rating).toBeNull();
  });

  test('customers and anonymous callers cannot read the panel', async () => {
    const c = await makeUser('customer');
    expect((await get(`${BASE}/order-ratings/panel/monthly?month=2026-11`, c.token)).status).toBe(403);
    expect([401, 403]).toContain((await get(`${BASE}/order-ratings/panel/monthly?month=2026-11`)).status);
  });

  test('there is no write route for staff', async () => {
    const admin = await makeUser('admin');
    const order = await rate(new mongoose.Types.ObjectId(), 2);
    for (const method of ['put', 'patch', 'delete']) {
      const res = await withCsrf(request(app)[method](`${BASE}/order-ratings/panel/order/${order._id}`))
        .set('Authorization', `Bearer ${admin.token}`).send({ stars: 5 });
      expect(res.status).toBe(404);
    }
    expect((await OrderRating.findOne({ order: order._id })).stars).toBe(2);
  });

  test('a bad month is a 400', async () => {
    const admin = await makeUser('admin');
    expect((await get(`${BASE}/order-ratings/panel/monthly?month=2026-13`, admin.token)).status).toBe(400);
  });
});

describe('salesperson link (offline orders)', () => {
  const share = (order, token, ip = '203.0.113.7') =>
    withCsrf(request(app).post(`${BASE}/order-ratings/panel/order/${order._id}/share-link`))
      .set('Authorization', `Bearer ${token}`).set('cf-connecting-ip', ip).send({});
  const tokenOf = (url) => url.split('/rate/')[1];

  test('the order salesperson gets a WhatsApp link; the rating is marked as sent by them', async () => {
    const seller = await makeUser('staff', { team: 'sales' });
    const order = await seedOrder({ source: 'offline', salesUser: seller.user._id });

    const view = await get(`${BASE}/order-ratings/panel/order/${order._id}`, seller.token);
    expect(view.body).toMatchObject({ rating: null, canShareLink: true });

    const res = await share(order, seller.token);
    expect(res.status).toBe(200);
    expect(res.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919876500000\?text=/);
    expect(decodeURIComponent(res.body.whatsappUrl)).toContain(res.body.url);

    const sent = await withCsrf(request(app).post(`${BASE}/order-ratings/link/${tokenOf(res.body.url)}`))
      .set('cf-connecting-ip', '198.51.100.20').send({ stars: 5 });
    expect(sent.status).toBe(201);
    const saved = await OrderRating.findOne({ order: order._id }).lean();
    expect(saved).toMatchObject({ source: 'salesperson-link', sameNetworkAsSender: false });
    expect(String(saved.sentBy)).toBe(String(seller.user._id));
    expect(String(saved.salesperson)).toBe(String(seller.user._id));

    // The salesperson never sees the rating itself, and can't make another link.
    const after = await get(`${BASE}/order-ratings/panel/order/${order._id}`, seller.token);
    expect(after.body).toMatchObject({ rating: null, rated: true, canShareLink: false });
    expect((await share(order, seller.token)).body.code).toBe('already-rated');
  });

  test('a rating from the same network the link was made on is flagged (not blocked)', async () => {
    const seller = await makeUser('staff', { team: 'sales' });
    const admin = await makeUser('admin');
    const order = await seedOrder({ source: 'offline', salesUser: seller.user._id });
    const { body } = await share(order, seller.token, '203.0.113.7');
    const sent = await withCsrf(request(app).post(`${BASE}/order-ratings/link/${tokenOf(body.url)}`))
      .set('cf-connecting-ip', '203.0.113.7').send({ stars: 5 });
    expect(sent.status).toBe(201);
    expect((await OrderRating.findOne({ order: order._id })).sameNetworkAsSender).toBe(true);

    const panel = await get(`${BASE}/order-ratings/panel/order/${order._id}`, admin.token);
    expect(panel.body.rating).toMatchObject({ source: 'salesperson-link', sameNetworkAsSender: true, sentBy: { name: seller.user.name } });
    const month = await get(`${BASE}/order-ratings/panel/monthly?month=${new Date().toISOString().slice(0, 7)}`, admin.token);
    expect(month.body.rows[0]).toMatchObject({ flagged: 1 });
  });

  test('the token does not carry the readable IP', async () => {
    const seller = await makeUser('staff', { team: 'sales' });
    const order = await seedOrder({ source: 'offline', salesUser: seller.user._id });
    const { body } = await share(order, seller.token, '203.0.113.7');
    const payload = Buffer.from(tokenOf(body.url).split('.')[0], 'base64').toString();
    expect(payload).not.toContain('203.0.113.7');
  });

  test('website orders, undelivered orders and other salespeople are refused', async () => {
    const seller = await makeUser('staff', { team: 'sales' });
    const other = await makeUser('staff', { team: 'sales' });
    const web = await seedOrder({ salesUser: seller.user._id });
    expect((await share(web, seller.token)).body.code).toBe('not-offline');
    const shipped = await seedOrder({ source: 'offline', salesUser: seller.user._id, status: 'shipped' });
    expect((await share(shipped, seller.token)).body.code).toBe('not-delivered');
    const cancelled = await seedOrder({ source: 'offline', salesUser: seller.user._id, status: 'cancelled' });
    expect((await share(cancelled, seller.token)).status).toBe(409);
    const theirs = await seedOrder({ source: 'offline', salesUser: seller.user._id });
    expect((await share(theirs, other.token)).status).toBe(403);
    expect((await get(`${BASE}/order-ratings/panel/order/${theirs._id}`, other.token)).status).toBe(403);
  });

  test('their head and an admin can also make the link', async () => {
    const seller = await makeUser('staff', { team: 'sales' });
    const head = await makeUser('staff', { team: 'sales', isHead: true });
    const otherHead = await makeUser('staff', { team: 'operations', isHead: true });
    const admin = await makeUser('admin');
    const order = await seedOrder({ source: 'offline', salesUser: seller.user._id });
    expect((await share(order, head.token)).status).toBe(200);
    expect((await share(order, admin.token)).status).toBe(200);
    expect((await share(order, otherHead.token)).status).toBe(403);
  });

  test('customers cannot make links', async () => {
    const c = await makeUser('customer');
    const order = await seedOrder({ source: 'offline', user: c.user._id });
    expect((await share(order, c.token)).status).toBe(403);
  });
});

describe('IST month range', () => {
  test('starts at midnight India time', () => {
    expect(istMonthRange('2026-11')).toEqual({
      from: new Date('2026-10-31T18:30:00.000Z'),
      to: new Date('2026-11-30T18:30:00.000Z'),
    });
    expect(istMonthRange('2026-12').to).toEqual(new Date('2026-12-31T18:30:00.000Z'));
  });
});

describe('review-request email', () => {
  const order = { _id: new mongoose.Types.ObjectId(), shippingAddress: { fullName: 'Asha' } };
  const products = [{ name: 'Seat cover', slug: 'seat-cover', image: '' }];

  test('without a rating link it is unchanged', () => {
    const before = reviewRequestEmail({ order, products, company: {} });
    const withNull = reviewRequestEmail({ order, products, company: {}, ratingUrl: null });
    expect(withNull).toEqual(before);
    expect(before.html).not.toMatch(/experience with our team/);
  });

  test('with a link it adds five star links', () => {
    const { html, text } = reviewRequestEmail({ order, products, company: {}, ratingUrl: 'https://x.test/rate/tok' });
    expect(html).toMatch(/experience with our team/);
    for (const s of [1, 2, 3, 4, 5]) expect(html).toContain(`https://x.test/rate/tok?stars=${s}`);
    expect(text).toContain('https://x.test/rate/tok');
  });
});

describe('index migration script', () => {
  test('dry run plans both indexes, apply builds them, re-run is a no-op', async () => {
    await OrderRating.collection.drop().catch(() => {});
    await OrderRating.createCollection();
    const log = () => {};
    expect((await buildIndexes({ apply: false, log })).map(([, s]) => s)).toEqual(['would build', 'would build']);
    await buildIndexes({ apply: true, log });
    const names = (await OrderRating.collection.indexes()).map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['order_1', 'salesperson_1_createdAt_-1']));
    expect((await OrderRating.collection.indexes()).find((i) => i.name === 'order_1').unique).toBe(true);
    expect((await buildIndexes({ apply: true, log })).map(([, s]) => s)).toEqual(['already there', 'already there']);
  });
});
