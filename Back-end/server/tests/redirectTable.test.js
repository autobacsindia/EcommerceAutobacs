/**
 * Redirect table: where a removed product's old URL (and, later, the reviewed
 * WordPress /model/<tag> map) sends people. Search Console, Nov 2026: deleted
 * products 404'd, and /product/<slug> 301'd blindly into those 404s.
 *
 * Served to the edge by GET /redirects/slugs as `paths` (+ `live` category and
 * brand slugs for the /collections and /product-brand fallbacks).
 */
import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import Vehicle from '../models/Vehicle.js';
import Redirect from '../models/Redirect.js';
import { normalizePath, normalizeTarget, finalizePathMap } from '../utils/redirectPaths.js';
import { buildPathMap } from '../services/slugRedirectService.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

const product = (overrides = {}) =>
  Product.create({ name: `P ${Math.random()}`, price: 1000, description: 'x'.repeat(20), isActive: true, ...overrides });
const category = (slug, overrides = {}) => Category.create({ name: slug, slug, isActive: true, ...overrides });

describe('redirect table', () => {
  let agent;
  let csrfToken;
  const admin = { name: 'Redirect Admin', email: 'redirect-admin@example.com', password: 'SecurePass123!', role: 'admin' };

  beforeAll(async () => { await dbHandler.connect(); });

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash(admin.password, await bcrypt.genSalt(10));
    await User.create({ name: admin.name, email: admin.email, passwordHash, role: admin.role });
    agent = request.agent(app);
    const login = await agent.post(`${BASE}/auth/login`).send({ email: admin.email, password: admin.password });
    csrfToken = extractCsrfFromSetCookie(login.headers['set-cookie']);
  });

  afterEach(async () => {
    await dbHandler.clearDatabase();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  const map = async () => (await request(app).get(`${BASE}/redirects/slugs`)).body;
  const putRedirect = (id, redirectTo) =>
    agent.put(`${BASE}/products/${id}/redirect`).set('X-XSRF-TOKEN', csrfToken).send({ redirectTo });
  const del = (id, body) => agent.delete(`${BASE}/products/${id}`).set('X-XSRF-TOKEN', csrfToken).send(body);

  describe('GET /redirects/slugs paths', () => {
    it('a deleted product goes to its first ACTIVE category by default', async () => {
      const off = await category('old-cams', { isActive: false });
      const cams = await category('dash-cams');
      await product({ slug: '70mai-a400-dash-cam', categories: [off._id, cams._id], isActive: false, deletedAt: new Date() });

      const body = await map();
      expect(body.paths).toEqual({ '/products/70mai-a400-dash-cam': '/categories/dash-cams' });
      expect(body.live.categories).toEqual(['dash-cams']);
    });

    it("a deleted product's OLD slugs go to its category too, in one hop", async () => {
      const cams = await category('dash-cams');
      const p = await product({ slug: 'a400', categories: [cams._id] });
      await Product.findByIdAndUpdate(p._id, { slug: '70mai-a400' });
      await Product.findByIdAndUpdate(p._id, { isActive: false, deletedAt: new Date() });
      expect((await map()).paths).toEqual({
        '/products/70mai-a400': '/categories/dash-cams',
        '/products/a400': '/categories/dash-cams',
      });
    });

    it('a switched-off (not deleted) product gets no redirect unless one was chosen', async () => {
      const cams = await category('dash-cams');
      await product({ slug: 'paused', categories: [cams._id], isActive: false });
      expect((await map()).paths).toEqual({});
    });

    it('a table row overrides the category default, and a 410 row is served as null', async () => {
      const cams = await category('dash-cams');
      await product({ slug: 'old-cam', categories: [cams._id], deletedAt: new Date(), isActive: false });
      await product({ slug: 'new-cam' });
      await Redirect.create({ fromPath: '/products/old-cam', toPath: '/products/new-cam', source: 'product' });
      await Redirect.create({ fromPath: '/model/old-junk-tag', toPath: null, source: 'legacy' });

      expect((await map()).paths).toEqual({
        '/products/old-cam': '/products/new-cam',
        '/model/old-junk-tag': null,
      });
    });

    it('never redirects a live page (product, category, brand, vehicle)', async () => {
      await product({ slug: 'live-one' });
      await category('floor-mats');
      await Brand.create({ name: '70mai', slug: '70mai', isActive: true });
      await Vehicle.create({ make: 'Toyota', model: 'Hilux', slug: 'toyota-hilux', isActive: true });
      await Redirect.insertMany([
        { fromPath: '/products/live-one', toPath: '/categories/floor-mats' },
        { fromPath: '/categories/floor-mats', toPath: '/categories' },
        { fromPath: '/brands/70mai', toPath: '/brands' },
        { fromPath: '/model/toyota-hilux', toPath: null },
      ]);
      expect((await map()).paths).toEqual({});
    });

    it('collapses chains to one hop, following renames', async () => {
      const p = await product({ slug: 'thor-3' });
      await Product.findByIdAndUpdate(p._id, { slug: 'thor-3-speakers' }); // thor-3 → thor-3-speakers
      await Redirect.insertMany([
        { fromPath: '/model/speaker', toPath: '/products/thor-2' },
        { fromPath: '/products/thor-2', toPath: '/products/thor-3' },
      ]);
      expect((await map()).paths).toEqual({
        '/model/speaker': '/products/thor-3-speakers',
        '/products/thor-2': '/products/thor-3-speakers',
      });
    });
  });

  describe('admin: where a removed product goes', () => {
    it('DELETE with redirectTo stores it for every URL the product had (one hop each)', async () => {
      const target = await product({ slug: 'thor-3-speakers' });
      const p = await product({ slug: 'thor-2' });
      await Product.findByIdAndUpdate(p._id, { slug: 'thor-2-speakers' }); // has history

      const res = await del(p._id, { redirectTo: '/products/thor-3-speakers' });
      expect(res.status).toBe(200);
      expect((await map()).paths).toEqual({
        '/products/thor-2': '/products/thor-3-speakers',
        '/products/thor-2-speakers': '/products/thor-3-speakers',
      });
      expect(target).toBeTruthy();
    });

    it('DELETE with a bad target is rejected BEFORE anything is deleted', async () => {
      const p = await product({ slug: 'keep-me' });
      for (const bad of ['https://evil.example/x', '/products/does-not-exist', '/products/keep-me', '/blog/x']) {
        const res = await del(p._id, { redirectTo: bad });
        expect(res.status).toBe(400);
      }
      const still = await Product.findById(p._id).lean();
      expect(still.deletedAt).toBeNull();
      expect(await Redirect.countDocuments()).toBe(0);
    });

    it('PUT /products/:id/redirect sets, is idempotent, reads back, and clears', async () => {
      await category('dash-cams');
      const p = await product({ slug: 'paused-cam', isActive: false });

      expect((await putRedirect(p._id, '/categories/dash-cams')).status).toBe(200);
      expect((await putRedirect(p._id, '/categories/dash-cams')).status).toBe(200);
      expect(await Redirect.countDocuments()).toBe(1);
      const read = await agent.get(`${BASE}/products/${p._id}/redirect`);
      expect(read.body.redirectTo).toBe('/categories/dash-cams');
      expect((await map()).paths).toEqual({ '/products/paused-cam': '/categories/dash-cams' });

      expect((await putRedirect(p._id, null)).status).toBe(200);
      expect(await Redirect.countDocuments()).toBe(0);
    });

    it('a product switched back on is never redirected, even with a stale row', async () => {
      await category('dash-cams');
      const p = await product({ slug: 'back-again', isActive: false });
      await putRedirect(p._id, '/categories/dash-cams');
      await Product.findByIdAndUpdate(p._id, { isActive: true });
      expect((await map()).paths).toEqual({});
    });

    it('needs an admin/marketing login', async () => {
      const p = await product({ slug: 'x1' });
      const res = await request(app).put(`${BASE}/products/${p._id}/redirect`).send({ redirectTo: null });
      expect([401, 403]).toContain(res.status);
    });
  });
});

describe('redirect path rules (pure)', () => {
  it.each([
    ['/Model/Floor-Mat/', '/model/floor-mat'],
    ['https://www.autobacsindia.com/products/x?y=1#z', '/products/x'],
    ['/products//x', '/products/x'],
    ['/%E0%A4%95', '/क'],
    ['products/x', null],
    ['//evil.example', null],
    ['/a b', null],
    ['', null],
  ])('normalizePath(%s) → %s', (input, expected) => expect(normalizePath(input)).toBe(expected));

  it('normalizeTarget: null is "gone", "/" and junk are rejected', () => {
    expect(normalizeTarget(null)).toBeNull();
    expect(normalizeTarget('/')).toBeUndefined();
    expect(normalizeTarget('javascript:alert(1)')).toBeUndefined();
  });

  it('finalizePathMap drops loops and over-long chains', () => {
    const loop = new Map([['/a', '/b'], ['/b', '/a']]);
    expect(finalizePathMap(loop)).toEqual({});
    const long = new Map(Array.from({ length: 15 }, (_, i) => [`/p${i}`, `/p${i + 1}`]));
    const out = finalizePathMap(long);
    expect(out['/p14']).toBe('/p15'); // short tail is fine
    expect(out['/p0']).toBeUndefined(); // 15 hops: not trusted
  });

  it('buildPathMap skips a deleted product with no active category', () => {
    const out = buildPathMap({
      deletedProducts: [{ slug: 'orphan', categories: ['c1'] }],
      categoryById: new Map(),
      live: new Set(),
      renames: { products: {}, categories: {}, brands: {}, articles: {} },
    });
    expect(out).toEqual({});
  });
});
