/**
 * SEO team's work status (PATCH /products/:id/seo-review).
 *
 *   - admins only; only the three statuses
 *   - marking a product does NOT bump its updatedAt (not a content change)
 *   - a normal product save can neither overwrite nor forge it
 *   - the admin list returns it, so the "SEO work" column can show it
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function tokenFor(role) {
  n += 1;
  const email = `${role}${n}@example.com`;
  const password = 'SecurePass123!';
  await User.create({ name: role, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken=')).split(';')[0].slice('accessToken='.length);
}

const seed = () => Product.create({
  name: 'Bushranger MKII Winch', slug: 'bushranger-mkii-winch', sku: 'BR-1',
  description: 'x'.repeat(30), price: 150000, stock: 'in', isActive: true,
});

const patch = (id, token, body) => request(app).patch(`${BASE}/products/${id}/seo-review`).set('Authorization', `Bearer ${token}`).send(body);

it('lets an admin move a product through Needs check → Working → Completed', async () => {
  const p = await seed();
  const admin = await tokenFor('admin');

  for (const status of ['in_progress', 'done', 'todo', 'done']) {
    const res = await patch(p._id, admin, { status }).expect(200);
    expect(res.body.seoReview.status).toBe(status);
    expect(res.body.seoReview.updatedAt).toBeTruthy();
  }
  const fresh = await Product.findById(p._id).lean();
  expect(fresh.seoReview.status).toBe('done');
  expect(fresh.seoReview.updatedBy).toBeTruthy();
});

it('does not change the product\'s updatedAt (a review is not a content change)', async () => {
  const p = await seed();
  const before = (await Product.findById(p._id).lean()).updatedAt;
  await new Promise((r) => setTimeout(r, 20));
  await patch(p._id, await tokenFor('admin'), { status: 'done' }).expect(200);
  const after = await Product.findById(p._id).lean();
  expect(after.updatedAt.getTime()).toBe(before.getTime());
});

it('refuses customers, anonymous callers, unknown statuses and missing products', async () => {
  const p = await seed();
  const customer = await tokenFor('customer');
  const admin = await tokenFor('admin');

  expect((await patch(p._id, customer, { status: 'done' })).status).toBe(403);
  const anon = await request(app).patch(`${BASE}/products/${p._id}/seo-review`).send({ status: 'done' });
  expect([401, 403]).toContain(anon.status);
  expect((await patch(p._id, admin, { status: 'finished' })).status).toBe(400);
  expect((await patch('64b000000000000000000000', admin, { status: 'done' })).status).toBe(404);
  expect((await Product.findById(p._id).lean()).seoReview?.status).toBeUndefined();
});

it('cannot be overwritten or forged by a normal product save', async () => {
  const p = await seed();
  const admin = await tokenFor('admin');
  await patch(p._id, admin, { status: 'done' }).expect(200);

  await request(app)
    .put(`${BASE}/products/${p._id}`)
    .set('Authorization', `Bearer ${admin}`)
    .field('name', 'Bushranger MKII Winch 12000LB')
    .field('seoReview', JSON.stringify({ status: 'todo' }))
    .expect(200);

  const fresh = await Product.findById(p._id).lean();
  expect(fresh.name).toBe('Bushranger MKII Winch 12000LB');
  expect(fresh.seoReview.status).toBe('done');
});

it('is returned by the admin product list', async () => {
  const p = await seed();
  const admin = await tokenFor('admin');
  await patch(p._id, admin, { status: 'in_progress' }).expect(200);
  const res = await request(app).get(`${BASE}/products/admin/list`).set('Authorization', `Bearer ${admin}`).expect(200);
  expect(res.body.products[0].seoReview.status).toBe('in_progress');
});
