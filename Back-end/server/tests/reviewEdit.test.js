/**
 * A customer editing their own product review (profile "My reviews").
 *
 *   • own review only (403 otherwise, 403 for imported reviews with no owner);
 *   • the edit goes back for approval (drops off the product page until checked);
 *   • photos are kept when the edit does not send them (regression: they were wiped);
 *   • GET /reviews/user is bounded, whitelists the sort, and carries the product slug.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Product } = await import('../models/Product.js');
const { default: Review } = await import('../models/Review.js');

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
  const email = `r${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: `User ${n}`, email, phone: `90000001${String(n).padStart(2, '0')}`,
    passwordHash: await bcrypt.hash(password, 10), role,
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, user };
}

let p = 0;
const makeProduct = () => {
  p += 1;
  return Product.create({ name: `Lamp ${p}`, description: 'A lamp', price: 999, stock: 'in', slug: `lamp-${p}`, isActive: true });
};

const PHOTOS = [{ url: 'https://res.cloudinary.com/demo/image/upload/r1.jpg' }];
const makeReview = (userId, productId, over = {}) => Review.create({
  user: userId, product: productId, rating: 4, title: 'Good', comment: 'Bright and easy to fit.',
  images: PHOTOS, isApproved: true, ...over,
});

const edit = (token, id, body) => request(app).put(`${BASE}/reviews/${id}`).set('Authorization', `Bearer ${token}`).send(body);
const body = { rating: 2, title: 'Changed my mind', comment: 'Stopped working after a month.' };

describe('PUT /reviews/:id — customer edits own review', () => {
  it('saves, sends it back for approval, and keeps the photos when none are sent', async () => {
    const me = await login();
    const product = await makeProduct();
    const review = await makeReview(me.user._id, product._id);

    const res = await edit(me.token, review._id, body);
    expect(res.status).toBe(200);
    expect(res.body.review).toMatchObject({ rating: 2, title: 'Changed my mind', isApproved: false });

    const fresh = await Review.findById(review._id).lean();
    expect(fresh.comment).toBe('Stopped working after a month.');
    expect(fresh.isApproved).toBe(false);
    expect(fresh.images.map((i) => i.url)).toEqual(PHOTOS.map((i) => i.url));
  });

  it("refuses another customer's review and an imported one with no owner (403)", async () => {
    const owner = await login();
    const other = await login();
    const product = await makeProduct();
    const review = await makeReview(owner.user._id, product._id);
    const imported = await Review.create({ product: product._id, guestName: 'Old site', rating: 5, comment: 'Imported long ago.', isApproved: true });

    expect((await edit(other.token, review._id, body)).status).toBe(403);
    expect((await edit(other.token, imported._id, body)).status).toBe(403);
    const fresh = await Review.findById(review._id).lean();
    expect(fresh).toMatchObject({ rating: 4, isApproved: true });
  });

  it('validates the edit (400) and 404s an unknown review', async () => {
    const me = await login();
    const product = await makeProduct();
    const review = await makeReview(me.user._id, product._id);
    expect((await edit(me.token, review._id, { ...body, comment: 'short' })).status).toBe(400);
    expect((await edit(me.token, review._id, { ...body, rating: 9 })).status).toBe(400);
    expect((await edit(me.token, new mongoose.Types.ObjectId(), body)).status).toBe(404);
    expect((await Review.findById(review._id).lean()).isApproved).toBe(true);
  });

  it('401 without a login', async () => {
    const me = await login();
    const product = await makeProduct();
    const review = await makeReview(me.user._id, product._id);
    const res = await request(app).put(`${BASE}/reviews/${review._id}`).send(body);
    expect([401, 403]).toContain(res.status);
  });
});

describe('GET /reviews/user', () => {
  it('lists only my reviews with the product slug, bounded at 50, ignoring unknown sort fields', async () => {
    const me = await login();
    const other = await login();
    const products = await Promise.all(Array.from({ length: 3 }, makeProduct));
    await Promise.all(products.map((pr) => makeReview(me.user._id, pr._id)));
    await makeReview(other.user._id, products[0]._id);

    const res = await request(app).get(`${BASE}/reviews/user?limit=100000&sortBy=passwordHash`).set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(3);
    expect(res.body.reviews[0].product.slug).toMatch(/^lamp-/);
    expect(res.body.pagination.totalPages).toBe(1);
  });
});
