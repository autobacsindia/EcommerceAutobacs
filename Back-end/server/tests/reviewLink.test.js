/**
 * Signed review links — a buyer reviews without an account.
 *
 * WHAT THIS GUARDS
 * ----------------
 * The token is the ONLY thing standing between a public endpoint and a
 * "verified purchase" badge on any product in the catalogue. So the tests that
 * matter are not the happy path:
 *
 *   - a forged or edited token must be refused (and the signature compared in
 *     constant time, so the comparison itself leaks nothing);
 *   - a token must not be re-pointable at a different product by editing the
 *     payload — that would let one real order mint a review for anything;
 *   - a link must work ONCE, including when the same WhatsApp message is
 *     tapped twice at the same moment, which a read-then-write cannot do;
 *   - an expired link must stop working.
 *
 * The badge is the whole point of the feature: it is what makes these reviews
 * worth more than invented ones, and it is only honest if the token is sound.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Review from '../models/Review.js';
import * as dbHandler from './db-handler.js';
import { mintReviewToken, readReviewToken } from '../services/reviewLinkService.js';

const BASE = '/api/v1';
const adminUser = { name: 'Review Admin', email: 'reviewadmin@example.com', password: 'SecurePass123!' };

let adminToken;
let product;
let order;

/*
  The public submit is an unauthenticated POST, so it is fully CSRF-protected —
  and deliberately NOT exempted. These tests do what the browser does: seed a
  token from /csrf-token and send it as both cookie and header, which keeps the
  endpoint's CSRF protection genuinely under test rather than bypassed.
*/
let csrfPair, csrfToken;
const csrfPost = (url, body) =>
  request(app).post(url).set('Cookie', csrfPair).set('x-xsrf-token', csrfToken).send(body);

/*
  A real customer order. `user` is required on every live order (only imported
  WooCommerce ones are user-less), so the buyer here has an account — they
  simply never sign in to leave a review, which is the case this feature
  serves: the sale happened on WhatsApp and the link goes back the same way.
*/
const seedOrder = async (status = 'delivered') =>
  Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: product._id, name: product.name, quantity: 1, price: 1000 }],
    status,
    shippingAddress: {
      fullName: 'Ramesh Kumar', phone: '9999999999', addressLine1: '1 Road',
      city: 'Kochi', state: 'Kerala', postalCode: '682001',
    },
    subtotal: 1000, totalAmount: 1000, paymentStatus: 'paid',
  });

beforeAll(async () => {
  await dbHandler.connect();
  const seed = await request(app).get(`${BASE}/csrf-token`);
  csrfPair = (seed.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN=')).split(';')[0];
  csrfToken = csrfPair.split('=')[1];
});

afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

beforeEach(async () => {
  process.env.REVIEW_LINK_SECRET = 'test-review-link-secret-0123456789';

  const passwordHash = await bcrypt.hash(adminUser.password, await bcrypt.genSalt(10));
  await User.create({ name: adminUser.name, email: adminUser.email, passwordHash, role: 'admin' });
  const login = await request(app).post(`${BASE}/auth/login`)
    .send({ email: adminUser.email, password: adminUser.password });
  const cookie = (login.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  adminToken = cookie ? cookie.split(';')[0].slice('accessToken='.length) : login.body.accessToken;

  product = await Product.create({
    name: 'Bushranger Winch', slug: `winch-${Math.random().toString(36).slice(2, 8)}`,
    description: 'x', price: 168550, stock: 'in', isActive: true,
  });
  order = await seedOrder();
});

afterEach(async () => { await dbHandler.clearDatabase(); });

// ── The token itself ────────────────────────────────────────────────────────
describe('the token', () => {
  test('round-trips the order and product it was minted for', () => {
    const { token } = mintReviewToken(String(order._id), String(product._id));
    const read = readReviewToken(token);
    expect(read.ok).toBe(true);
    expect(read.orderId).toBe(String(order._id));
    expect(read.productId).toBe(String(product._id));
  });

  test('a tampered PAYLOAD is refused — a link cannot be aimed at another product', () => {
    const { token } = mintReviewToken(String(order._id), String(product._id));
    const [body, mac] = token.split('.');
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    payload.p = '6a2bfa52ed6f1865a53700c7'; // some other product
    const forgedBody = Buffer.from(JSON.stringify(payload)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    expect(readReviewToken(`${forgedBody}.${mac}`)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  test('a tampered SIGNATURE is refused', () => {
    const { token } = mintReviewToken(String(order._id), String(product._id));
    const [body, mac] = token.split('.');
    const flipped = mac.slice(0, -1) + (mac.at(-1) === 'A' ? 'B' : 'A');
    expect(readReviewToken(`${body}.${flipped}`).ok).toBe(false);
  });

  test('a signature of the wrong LENGTH is refused, not thrown', () => {
    const { token } = mintReviewToken(String(order._id), String(product._id));
    const [body] = token.split('.');
    // timingSafeEqual throws on unequal lengths; the length check must come first.
    expect(() => readReviewToken(`${body}.abc`)).not.toThrow();
    expect(readReviewToken(`${body}.abc`)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  test('a token signed with a DIFFERENT secret is refused', () => {
    const { token } = mintReviewToken(String(order._id), String(product._id));
    process.env.REVIEW_LINK_SECRET = 'a-completely-different-secret';
    expect(readReviewToken(token)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  test('an expired token is refused', () => {
    const { token } = mintReviewToken(String(order._id), String(product._id), -1);
    expect(readReviewToken(token)).toEqual({ ok: false, reason: 'expired' });
  });

  test('garbage is refused rather than throwing', () => {
    for (const bad of ['', 'nonsense', 'a.b.c', '.', 'eyJ9.']) {
      expect(() => readReviewToken(bad)).not.toThrow();
      expect(readReviewToken(bad).ok).toBe(false);
    }
  });

  test('minting without a secret FAILS rather than issuing a forgeable link', () => {
    delete process.env.REVIEW_LINK_SECRET;
    const prevJwt = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => mintReviewToken('a', 'b')).toThrow(/not set/i);
    process.env.JWT_SECRET = prevJwt;
  });
});

// ── Minting (admin) ─────────────────────────────────────────────────────────
describe('POST /reviews/admin/review-link', () => {
  const mint = (body) =>
    request(app).post(`${BASE}/reviews/admin/review-link`)
      .set('Authorization', `Bearer ${adminToken}`).send(body);

  test('issues a link for a delivered order', async () => {
    const res = await mint({ orderId: String(order._id), productId: String(product._id) });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/review/');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('refuses a product that is not on the order', async () => {
    const other = await Product.create({
      name: 'Other', slug: `other-${Math.random().toString(36).slice(2, 8)}`,
      description: 'x', price: 100, stock: 'in', isActive: true,
    });
    const res = await mint({ orderId: String(order._id), productId: String(other._id) });
    expect(res.status).toBe(400);
  });

  test('refuses an order that has not been delivered', async () => {
    const pending = await seedOrder('processing');
    const res = await mint({ orderId: String(pending._id), productId: String(product._id) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/deliver/i);
  });

  test('requires an admin — auth failure never returns 2xx', async () => {
    const res = await request(app).post(`${BASE}/reviews/admin/review-link`)
      .send({ orderId: String(order._id), productId: String(product._id) });
    expect([401, 403]).toContain(res.status);
  });
});

// ── Using the link (public, no account) ─────────────────────────────────────
describe('the public review link', () => {
  const tokenFor = () => mintReviewToken(String(order._id), String(product._id)).token;

  test('GET describes the product and suggests the name on the order', async () => {
    const res = await request(app).get(`${BASE}/reviews/link/${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe('Bushranger Winch');
    expect(res.body.suggestedName).toBe('Ramesh Kumar');
  });

  test('POST publishes a VERIFIED review with no account at all', async () => {
    const res = await csrfPost(`${BASE}/reviews/link/${tokenFor()}`,
      { rating: 5, name: 'Ramesh K', comment: 'Fitted to my Thar, excellent pull.' });
    expect(res.status).toBe(201);

    const saved = await Review.findOne({ product: product._id });
    expect(saved.guestName).toBe('Ramesh K');
    expect(saved.isVerifiedPurchase).toBe(true);
    // Published immediately: the token already proved the purchase.
    expect(saved.isApproved).toBe(true);
    expect(saved.user).toBeFalsy();
    expect(String(saved.order)).toBe(String(order._id));
  });

  test('the customer may change the name they publish under', async () => {
    await csrfPost(`${BASE}/reviews/link/${tokenFor()}`, { rating: 4, name: 'R. Kumar', comment: 'Good.' });
    expect((await Review.findOne({ product: product._id })).guestName).toBe('R. Kumar');
  });

  test('the product rating is recomputed, so the PDP reflects it', async () => {
    await csrfPost(`${BASE}/reviews/link/${tokenFor()}`, { rating: 4, name: 'R', comment: 'Good.' });
    const updated = await Product.findById(product._id);
    expect(updated.averageRating).toBe(4);
    expect(updated.totalReviews).toBe(1);
  });

  test('the link works ONCE', async () => {
    const token = tokenFor();
    const first = await csrfPost(`${BASE}/reviews/link/${token}`, { rating: 5, name: 'A', comment: 'First.' });
    expect(first.status).toBe(201);

    const second = await csrfPost(`${BASE}/reviews/link/${token}`, { rating: 1, name: 'B', comment: 'Second.' });
    expect(second.status).toBe(409);
    expect(await Review.countDocuments({ product: product._id })).toBe(1);
  });

  test('two simultaneous taps on the same link still yield ONE review', async () => {
    const token = tokenFor();
    const results = await Promise.all([
      csrfPost(`${BASE}/reviews/link/${token}`, { rating: 5, name: 'A', comment: 'One.' }),
      csrfPost(`${BASE}/reviews/link/${token}`, { rating: 5, name: 'A', comment: 'One.' }),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Review.countDocuments({ product: product._id })).toBe(1);
  });

  test('a forged token cannot leave a review', async () => {
    const res = await csrfPost(`${BASE}/reviews/link/not-a-real-token`, { rating: 5, name: 'Spam', comment: 'Buy my thing.' });
    expect(res.status).toBe(400);
    expect(await Review.countDocuments({})).toBe(0);
  });

  test('an expired link cannot leave a review', async () => {
    const { token } = mintReviewToken(String(order._id), String(product._id), -1);
    const res = await csrfPost(`${BASE}/reviews/link/${token}`, { rating: 5, name: 'Late', comment: 'Too late.' });
    expect(res.status).toBe(410);
    expect(await Review.countDocuments({})).toBe(0);
  });

  test('rating, name and comment are all required', async () => {
    for (const body of [
      { name: 'A', comment: 'x' },
      { rating: 5, comment: 'x' },
      { rating: 5, name: 'A' },
      { rating: 9, name: 'A', comment: 'x' },
    ]) {
      const res = await csrfPost(`${BASE}/reviews/link/${tokenFor()}`, body);
      expect(res.status).toBe(400);
    }
    expect(await Review.countDocuments({})).toBe(0);
  });

  test('HTML in the comment is sanitised, not stored raw', async () => {
    await csrfPost(`${BASE}/reviews/link/${tokenFor()}`, { rating: 5, name: 'A', comment: 'Great <script>alert(1)</script> winch' });
    expect((await Review.findOne({})).comment).not.toMatch(/<script/i);
  });
});
