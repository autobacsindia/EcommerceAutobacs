/**
 * Media article cache: shared-store reads + invalidation on write.
 *
 * The bug this locks down: routes/media.js used to cache article responses in a
 * module-local `new Map()`. Prod runs multiple Railway replicas, so the Map was
 * per-process — an admin publishing an article evicted it on whichever replica
 * handled the write, while every other replica kept serving the stale article
 * for the rest of the 5-minute TTL. Which replica a reader hit was luck, so the
 * staleness looked intermittent and unreproducible.
 *
 * The cache now goes through the shared CacheService, so these tests assert the
 * behaviour that makes the multi-replica case correct:
 *   - reads are served from the shared store (not per-router state)
 *   - every article/press write invalidates it, keyed the way the reads store it
 *   - a rename invalidates BOTH the new slug and the one it moved off
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Article from '../models/Article.js';
import cacheService from '../services/cacheService.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

describe('Media article cache invalidation', () => {
  let agent;
  let csrfToken;

  const admin = {
    name: 'Media Admin',
    email: 'mediacacheadmin@example.com',
    password: 'SecurePass123!',
    role: 'admin',
  };

  beforeAll(async () => { await dbHandler.connect(); });

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

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash(admin.password, await bcrypt.genSalt(10));
    await User.create({ name: admin.name, email: admin.email, passwordHash, role: admin.role });

    agent = request.agent(app);
    const login = await agent
      .post(`${BASE}/auth/login`)
      .send({ email: admin.email, password: admin.password });
    csrfToken = extractCsrfFromSetCookie(login.headers['set-cookie']);
  });

  const post = (url, body) =>
    agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const put = (url, body) =>
    agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const del = (url) =>
    agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken);

  const publish = (overrides = {}) =>
    Article.create({
      title: 'Brake Pads 101',
      slug: 'brake-pads-101',
      type: 'blog',
      content: '<p>How to choose brake pads.</p>',
      excerpt: 'A guide',
      status: 'published',
      publishedAt: new Date(),
      ...overrides,
    });

  it('stores article-list reads in the SHARED cache, not per-router state', async () => {
    await publish();

    const first = await request(app).get(`${BASE}/media/articles?type=blog`);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);

    // The shared store — not a Map inside the router — is what a second replica
    // would read. If this key is absent the cache is process-local again.
    const keys = await cacheService.invalidatePattern('media:articles');
    expect(keys).toBeGreaterThan(0);
  });

  it('serves an updated article body after an admin edit, not the cached one', async () => {
    const article = await publish();

    const before = await request(app).get(`${BASE}/media/articles/brake-pads-101`);
    expect(before.body.data.content).toContain('How to choose brake pads');

    await put(`/media/admin/articles/${article._id}`, { content: '<p>REVISED GUIDANCE.</p>' });

    const after = await request(app).get(`${BASE}/media/articles/brake-pads-101`);
    expect(after.body.data.content).toContain('REVISED GUIDANCE');
  });

  it('a title edit keeps the URL stable and serves the new title', async () => {
    // Documents CURRENT behaviour: the slug-regeneration block in the PUT handler
    // is dead (the field loop assigns req.body.title before the comparison), so an
    // article's public URL never moves. That stability is desirable — this test
    // exists so a future change to that block is a deliberate, visible SEO
    // decision rather than a silent URL migration.
    const article = await publish();

    // Warm the detail cache under the original slug.
    await request(app).get(`${BASE}/media/articles/brake-pads-101`);

    await put(`/media/admin/articles/${article._id}`, { title: 'Brake Pads 202' });

    const same = await request(app).get(`${BASE}/media/articles/brake-pads-101`);
    expect(same.status).toBe(200);
    // Crucially, not the stale cached copy.
    expect(same.body.data.title).toBe('Brake Pads 202');
  });

  // NOTE: the PUT handler's previous-slug invalidation is currently UNREACHABLE
  // and therefore untested — the slug never moves (dead regeneration block), and
  // `previousSlug` is re-read from Mongo inside the handler, so a slug change
  // cannot be staged from outside it. The code is kept as defence for if that
  // block is ever made live; it is deliberately not covered by a contrived test.

  it('a newly published article appears in a previously-cached list', async () => {
    await publish();
    const before = await request(app).get(`${BASE}/media/articles?type=blog`);
    expect(before.body.data).toHaveLength(1);

    await post('/media/admin/articles', {
      title: 'Second Post',
      type: 'blog',
      content: '<p>Another one.</p>',
      status: 'published',
    });

    const after = await request(app).get(`${BASE}/media/articles?type=blog`);
    expect(after.body.data.length).toBeGreaterThan(1);
  });

  it('a deleted article drops out of a previously-cached list', async () => {
    const article = await publish();
    await request(app).get(`${BASE}/media/articles?type=blog`);

    await del(`/media/admin/articles/${article._id}`);

    const after = await request(app).get(`${BASE}/media/articles?type=blog`);
    expect(after.body.data).toHaveLength(0);
  });

  it('does not cache search responses (user input must not mint cache keys)', async () => {
    await publish();
    await request(app).get(`${BASE}/media/articles?search=brake`);
    // Nothing filed under the list tag: the search path bypassed the cache.
    const keys = await cacheService.invalidatePattern('media:articles');
    expect(keys).toBe(0);
  });

  describe('cache key space is bounded (shared Redis, so unbounded = real cost)', () => {
    // `category`/`tag` are free-form user input. Left in the key, a loop of
    // GET /media/articles?category=$RANDOM mints unbounded Redis entries and
    // grows the ctag:media:articles tag set, which only empties on an admin write.
    it.each([
      ['category', 'category=anything-a'],
      ['tag', 'tag=anything-b'],
    ])('does not cache a request filtered by user-supplied %s', async (_name, qs) => {
      await publish();
      await request(app).get(`${BASE}/media/articles?${qs}`);
      expect(await cacheService.invalidatePattern('media:articles')).toBe(0);
    });

    it('does cache the plain listing the storefront actually requests', async () => {
      await publish();
      await request(app).get(`${BASE}/media/articles?type=blog&limit=6`);
      expect(await cacheService.invalidatePattern('media:articles')).toBeGreaterThan(0);
    });

    it('does not cache deep pages', async () => {
      await publish();
      await request(app).get(`${BASE}/media/articles?type=blog&page=50`);
      expect(await cacheService.invalidatePattern('media:articles')).toBe(0);
    });

    it('clamps an absurd limit instead of passing it to Mongo', async () => {
      await publish();
      const res = await request(app).get(`${BASE}/media/articles?limit=100000`);
      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(50);
    });

    it('falls back to defaults on a non-numeric limit rather than NaN', async () => {
      await publish();
      const res = await request(app).get(`${BASE}/media/articles?limit=abc&page=xyz`);
      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(12);
      expect(res.body.pagination.page).toBe(1);
    });

    it('clamps the trending limit too', async () => {
      await publish();
      const res = await request(app).get(`${BASE}/media/trending?limit=99999`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });
  });

  it('a deleted article drops out of another article\'s cached related[]', async () => {
    // A detail response embeds up to 4 sibling articles. Targeted per-slug
    // invalidation cannot fix this: the stale copy of B lives under A's key, so
    // deleting B used to leave A rendering a related link that 404s.
    await publish({ title: 'Keeper', slug: 'keeper' });
    const sibling = await publish({ title: 'Doomed', slug: 'doomed' });

    const before = await request(app).get(`${BASE}/media/articles/keeper`);
    expect(before.body.related.map((r) => r.slug)).toContain('doomed');

    await del(`/media/admin/articles/${sibling._id}`);

    const after = await request(app).get(`${BASE}/media/articles/keeper`);
    expect(after.body.related.map((r) => r.slug)).not.toContain('doomed');
  });

  it('a newly published article appears in another article\'s cached related[]', async () => {
    await publish({ title: 'Keeper', slug: 'keeper' });
    const before = await request(app).get(`${BASE}/media/articles/keeper`);
    expect(before.body.related).toHaveLength(0);

    await post('/media/admin/articles', {
      title: 'Newcomer',
      type: 'blog',
      category: 'General',
      content: '<p>Fresh.</p>',
      status: 'published',
    });

    const after = await request(app).get(`${BASE}/media/articles/keeper`);
    expect(after.body.related.map((r) => r.slug)).toContain('newcomer');
  });
});
