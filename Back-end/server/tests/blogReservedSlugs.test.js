/**
 * Blog posts live at /blog/<slug> (moved from the site root in 2026-11), where
 * /blog/gallery and /blog/videos are real pages that win over the post route.
 * A post must therefore never be given one of those slugs — on create (derived
 * from the title) or on an explicit URL change in admin: "-2" is appended.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Article from '../models/Article.js';
import cacheService from '../services/cacheService.js';
import { isReservedBlogSlug, unreservedBlogSlug, RESERVED_BLOG_SLUGS } from '../utils/blogSlug.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

describe('utils/blogSlug', () => {
  it('reserves exactly the real /blog pages', () => {
    expect([...RESERVED_BLOG_SLUGS].sort()).toEqual(['gallery', 'videos']);
  });

  it.each([
    ['gallery', 'gallery-2'],
    ['videos', 'videos-2'],
    ['gallery-tips', 'gallery-tips'],
    ['my-gallery', 'my-gallery'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(unreservedBlogSlug(input)).toBe(expected);
  });

  it('is case-insensitive and tolerates nullish input', () => {
    expect(isReservedBlogSlug('GALLERY')).toBe(true);
    expect(isReservedBlogSlug(undefined)).toBe(false);
  });
});

describe('admin article routes never produce a reserved slug', () => {
  let agent;
  let csrfToken;
  const admin = { name: 'Blog Admin', email: 'blog-reserved-admin@example.com', password: 'SecurePass123!', role: 'admin' };

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
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  const post = (url, body) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const put = (url, body) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);

  it.each([['Gallery', 'gallery-2'], ['Videos', 'videos-2']])(
    'a post titled "%s" is created as %s',
    async (title, expected) => {
      const res = await post('/media/admin/articles', { title, content: '<p>x</p>', type: 'blog' });
      expect(res.status).toBe(201);
      expect(res.body.data.slug).toBe(expected);
    },
  );

  it('still de-duplicates after the reserved bump', async () => {
    await Article.create({ title: 'x', slug: 'gallery-2', type: 'blog', content: '<p>x</p>' });
    const res = await post('/media/admin/articles', { title: 'Gallery', content: '<p>x</p>', type: 'blog' });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('gallery-2-1');
  });

  it('an ordinary title is untouched', async () => {
    const res = await post('/media/admin/articles', { title: 'Gallery Tips', content: '<p>x</p>', type: 'blog' });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('gallery-tips');
  });

  it('an explicit URL change to "videos" saves as videos-2', async () => {
    const a = await Article.create({ title: 'x', slug: 'brake-pads', type: 'blog', content: '<p>x</p>' });
    const res = await put(`/media/admin/articles/${a._id}`, { slug: 'Videos' });
    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe('videos-2');
    expect((await Article.findById(a._id).lean()).slug).toBe('videos-2');
  });
});
