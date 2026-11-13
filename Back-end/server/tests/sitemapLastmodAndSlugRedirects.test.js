/**
 * Sitemap <lastmod> honesty + renamed-slug redirects.
 *
 * Measured on the live sitemap (2026-11-13), two writes that are NOT content
 * edits were moving `updatedAt`, which the sitemap publishes as <lastmod>:
 *   - every blog post read ran `article.save()` to bump `views`, so all 84
 *     posts showed a timestamp from the last 24h;
 *   - the nightly sales-score job (tests/unit/services/salesScoreService.test.js).
 * Google ignores lastmod site-wide once it sees it is inaccurate.
 *
 * And renaming a slug in admin made the old URL a 404. Every document now keeps
 * its old slugs (models/plugins/slugHistory.js) and GET /redirects/slugs serves
 * the old→new map the frontend middleware 301s from.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Article from '../models/Article.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import cacheService from '../services/cacheService.js';
import { nextPreviousSlugs, MAX_PREVIOUS_SLUGS } from '../models/plugins/slugHistory.js';
import { buildSlugMap } from '../services/slugRedirectService.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';
const PAST = new Date('2026-01-01T00:00:00.000Z');

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

const publish = (overrides = {}) =>
  Article.create({
    title: 'Brake Pads 101',
    slug: 'brake-pads-101',
    type: 'blog',
    content: '<p>How to choose brake pads.</p>',
    excerpt: 'A guide',
    status: 'published',
    publishedAt: PAST,
    ...overrides,
  });

const product = (overrides = {}) =>
  Product.create({ name: 'Rear Balance Arms', slug: 'product', price: 1000, description: 'x'.repeat(20), isActive: true, ...overrides });

/** Pin updatedAt in the past without going through Mongoose timestamps. */
const backdate = (Model, id) => Model.collection.updateOne({ _id: id }, { $set: { updatedAt: PAST } });

const sitemapArticle = async (slug) => {
  const res = await request(app).get(`${BASE}/media/articles/sitemap`);
  expect(res.status).toBe(200);
  return res.body.data.find((a) => a.slug === slug);
};

describe('sitemap lastmod + slug redirects', () => {
  let agent;
  let csrfToken;
  const admin = { name: 'SEO Admin', email: 'seo-lastmod-admin@example.com', password: 'SecurePass123!', role: 'admin' };

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
    await cacheService.invalidatePattern('media:');
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  const put = (url, body) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);

  // Views are written fire-and-forget; wait until the counter lands.
  const waitForViews = async (id, n) => {
    for (let i = 0; i < 50; i += 1) {
      const doc = await Article.findById(id).lean();
      if (doc.views >= n) return doc;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`views never reached ${n}`);
  };

  describe('blog view counter', () => {
    it('counts views without moving updatedAt or the sitemap lastmod (cache miss AND hit)', async () => {
      const a = await publish();
      await backdate(Article, a._id);

      const first = await request(app).get(`${BASE}/media/articles/${a.slug}`); // miss
      expect(first.status).toBe(200);
      expect(first.body.data.views).toBe(1);
      await waitForViews(a._id, 1);

      const second = await request(app).get(`${BASE}/media/articles/${a.slug}`); // hit
      expect(second.status).toBe(200);
      const after = await waitForViews(a._id, 2);

      expect(after.updatedAt.toISOString()).toBe(PAST.toISOString());
      expect(new Date((await sitemapArticle(a.slug)).updatedAt).toISOString()).toBe(PAST.toISOString());
    });

    it('a real content edit DOES move the sitemap lastmod', async () => {
      const a = await publish();
      await backdate(Article, a._id);

      const res = await put(`/media/admin/articles/${a._id}`, { content: '<p>Revised.</p>' });
      expect(res.status).toBe(200);

      const lastmod = new Date((await sitemapArticle(a.slug)).updatedAt);
      expect(lastmod.getTime()).toBeGreaterThan(PAST.getTime());
    });
  });

  describe('blog slug rename (admin)', () => {
    it('renames, remembers the old slug, maps it, and keeps it out of the sitemap', async () => {
      const a = await publish({ slug: '14710-2' });

      const res = await put(`/media/admin/articles/${a._id}`, { slug: 'Brake Pads Guide' });
      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe('brake-pads-guide');

      const stored = await Article.findById(a._id).lean();
      expect(stored.previousSlugs).toEqual(['14710-2']);

      const map = await request(app).get(`${BASE}/redirects/slugs`);
      expect(map.status).toBe(200);
      expect(map.body.articles).toEqual({ '14710-2': 'brake-pads-guide' });

      expect(await sitemapArticle('14710-2')).toBeUndefined();
      expect(await sitemapArticle('brake-pads-guide')).toBeDefined();
    });

    it('rejects a slug another post already uses (409) and an empty one (400)', async () => {
      const a = await publish();
      await publish({ title: 'Other', slug: 'taken' });

      expect((await put(`/media/admin/articles/${a._id}`, { slug: 'taken' })).status).toBe(409);
      expect((await put(`/media/admin/articles/${a._id}`, { slug: '!!!' })).status).toBe(400);
      expect((await Article.findById(a._id).lean()).slug).toBe('brake-pads-101');
    });

    it('a title edit still never changes the URL', async () => {
      const a = await publish();
      await put(`/media/admin/articles/${a._id}`, { title: 'Totally New Title' });
      const stored = await Article.findById(a._id).lean();
      expect(stored.slug).toBe('brake-pads-101');
      expect(stored.previousSlugs).toBeUndefined();
    });
  });

  describe('slug history on every write path', () => {
    it('product via findByIdAndUpdate (the admin edit path)', async () => {
      const p = await product();
      await Product.findByIdAndUpdate(p._id, { slug: 'dr-nano-rear-balance-arms' }, { new: true, runValidators: true });
      expect((await Product.findById(p._id).lean()).previousSlugs).toEqual(['product']);
    });

    it('category via findByIdAndUpdate, including an unchanged slug (no-op)', async () => {
      const c = await Category.create({ name: 'Tail Light', slug: 'tail-light', isActive: true });
      await Category.findByIdAndUpdate(c._id, { slug: 'tail-light', name: 'Tail Light' }, { new: true });
      expect((await Category.findById(c._id).lean()).previousSlugs).toBeUndefined();

      await Category.findByIdAndUpdate(c._id, { slug: 'Tail-Lamp' }, { new: true });
      const stored = await Category.findById(c._id).lean();
      expect(stored.slug).toBe('tail-lamp');
      expect(stored.previousSlugs).toEqual(['tail-light']);
    });

    it('brand via save() (brand rename regenerates the slug)', async () => {
      const b = await Brand.create({ name: 'Lightforcew', slug: 'lightforcew', isActive: true });
      const doc = await Brand.findById(b._id);
      doc.slug = 'lightforce';
      await doc.save();
      expect((await Brand.findById(b._id).lean()).previousSlugs).toEqual(['lightforcew']);
    });

    it('a slug change on create records nothing', async () => {
      const p = await product({ slug: 'fresh' });
      expect((await Product.findById(p._id).lean()).previousSlugs).toBeUndefined();
    });

    it('renaming back removes the slug from history (no self-redirect loop)', async () => {
      const p = await product({ slug: 'a' });
      await Product.findByIdAndUpdate(p._id, { slug: 'b' });
      await Product.findByIdAndUpdate(p._id, { slug: 'a' });
      expect((await Product.findById(p._id).lean()).previousSlugs).toEqual(['b']);
    });
  });

  describe('GET /redirects/slugs', () => {
    it('maps every old slug straight to the current one, for public targets only', async () => {
      const live = await product({ slug: 'a' });
      await Product.findByIdAndUpdate(live._id, { slug: 'b' });
      await Product.findByIdAndUpdate(live._id, { slug: 'c' }); // A→B→C: both point at C

      const hidden = await product({ name: 'Draft', slug: 'draft-old', isActive: false });
      await Product.findByIdAndUpdate(hidden._id, { slug: 'draft-new' });

      const res = await request(app).get(`${BASE}/redirects/slugs`);
      expect(res.status).toBe(200);
      expect(res.body.products).toEqual({ a: 'c', b: 'c' });
      expect(res.headers['cache-control']).toMatch(/max-age=120/);
    });

    it('never redirects a slug that another product currently uses', async () => {
      const first = await product({ slug: 'x' });
      await Product.findByIdAndUpdate(first._id, { slug: 'y' });
      await product({ name: 'Another', slug: 'x' }); // x is live again, for someone else

      const res = await request(app).get(`${BASE}/redirects/slugs`);
      expect(res.body.products).toEqual({});
    });

    it('old product slugs never appear in the product sitemap', async () => {
      const p = await product({ slug: 'product' });
      await Product.findByIdAndUpdate(p._id, { slug: 'dr-nano-rear-balance-arms' });
      const res = await request(app).get(`${BASE}/products/sitemap`);
      expect(res.body.products.map((x) => x.slug)).toEqual(['dr-nano-rear-balance-arms']);
    });
  });
});

describe('pure rules', () => {
  it('nextPreviousSlugs: dedupes, drops the new slug, caps the list', () => {
    expect(nextPreviousSlugs(undefined, 'a', 'b')).toEqual(['a']);
    expect(nextPreviousSlugs(['a', 'b'], 'c', 'a')).toEqual(['b', 'c']);
    expect(nextPreviousSlugs(['a'], 'a', 'b')).toEqual(['a']);
    expect(nextPreviousSlugs([], 'a', 'a')).toEqual([]);
    const many = Array.from({ length: MAX_PREVIOUS_SLUGS + 5 }, (_, i) => `s${i}`);
    const out = nextPreviousSlugs(many, 'last', 'now');
    expect(out).toHaveLength(MAX_PREVIOUS_SLUGS);
    expect(out[out.length - 1]).toBe('last');
  });

  it('buildSlugMap: drops an old slug claimed by two documents rather than guessing', () => {
    expect(buildSlugMap([
      { slug: 'one', previousSlugs: ['shared'] },
      { slug: 'two', previousSlugs: ['shared', 'mine'] },
    ])).toEqual({ mine: 'two' });
  });
});
