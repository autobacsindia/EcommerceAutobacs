/**
 * The admin Products list computes each row's SEO score in the browser from the
 * product's content fields (Front-end/web/src/lib/seoScore.ts). If this endpoint
 * ever stops returning one of them — a projection trimmed "for speed" — every
 * score silently drops and nothing errors. This pins the contract.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

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

it('returns every field the SEO score reads', async () => {
  const cat = await Category.create({ name: 'Snorkel', slug: 'snorkel' });
  await Product.create({
    name: 'Ironman Snorkel for Toyota Hilux', slug: 'ironman-snorkel-for-toyota-hilux', sku: 'IM-1',
    description: '<h2>Overview</h2><p>Long description text here.</p><ul><li>One</li></ul>',
    shortDescription: 'Heavy-duty snorkel for the Hilux.',
    brand: 'Ironman 4x4', price: 30000, stock: 'in', isActive: true,
    images: [{ url: 'https://example.com/a.jpg', public_id: 'a', alt: 'Front view' }],
    categories: [cat._id],
    tags: ['snorkel', 'hilux'],
    features: ['Rotomoulded'],
    whyChoose: ['Warranty'],
  });

  const password = 'SecurePass123!';
  await User.create({ name: 'Admin', email: 'seo-admin@example.com', passwordHash: await bcrypt.hash(password, 10), role: 'admin' });
  const login = await request(app).post(`${BASE}/auth/login`).send({ email: 'seo-admin@example.com', password });
  const token = (login.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    ?.split(';')[0].slice('accessToken='.length);

  const res = await request(app)
    .get(`${BASE}/products/admin/list`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const [p] = res.body.products;
  expect(p).toMatchObject({
    name: 'Ironman Snorkel for Toyota Hilux',
    slug: 'ironman-snorkel-for-toyota-hilux',
    shortDescription: 'Heavy-duty snorkel for the Hilux.',
    brand: 'Ironman 4x4',
    tags: ['snorkel', 'hilux'],
    features: ['Rotomoulded'],
    whyChoose: ['Warranty'],
  });
  expect(p.description).toContain('<h2>');
  expect(p.images[0]).toMatchObject({ alt: 'Front view' });
  expect(p.categories).toHaveLength(1);
});
