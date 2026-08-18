/**
 * Promo banner — scheduling resolution, link safety, cache purging, and the
 * Cloudinary cleanup that keeps Mongo and the asset store agreeing.
 *
 * The cases here are the ones a manual click-through would miss: a banner whose
 * window has not opened, two banners live at once, an "off" that only reached
 * Mongo, and an image replaced without deleting the one it orphaned.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import PromoBanner from '../models/PromoBanner.js';
import cacheService from '../services/cacheService.js';
import { PROMO_BANNER_CACHE_TAG } from '../services/promoBannerService.js';
import { isSafePromoLinkPath, normalizePromoLinkPath } from '../utils/promoLinkPath.js';
import { promoBannerTags } from '../utils/nextTags.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1/autobacs/promo-banners';
const IMG = `${CLOUDINARY}/onam.jpg`;

const HOUR = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Pure unit tests — the open-redirect guard. No DB, no HTTP.
// ─────────────────────────────────────────────────────────────────────────────
describe('promo link path safety', () => {
  it.each([
    '/offers',
    '/',
    '/categories/body-kits',
    '/products?sale=1',
    '/offers#festive',
    '/offers/onam-2026',
  ])('accepts the same-site path %s', (path) => {
    expect(isSafePromoLinkPath(path)).toBe(true);
  });

  it.each([
    // Protocol-relative: starts with "/" and is all legal path characters, so a
    // naive "must start with /" check waves it through — and the browser then
    // resolves it to https://evil.com. This is THE open-redirect case.
    ['//evil.com', 'protocol-relative'],
    ['//evil.com/offers', 'protocol-relative with path'],
    // Browsers normalise a backslash to a forward slash, so this is the same
    // attack wearing a different hat.
    ['/\\evil.com', 'backslash-escaped host'],
    ['\\\\evil.com', 'UNC-style'],
    ['https://evil.com', 'absolute URL'],
    ['http://evil.com', 'absolute URL (insecure)'],
    ['javascript:alert(1)', 'script scheme'],
    ['data:text/html,<script>', 'data scheme'],
    ['offers', 'no leading slash'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
  ])('rejects %s (%s)', (path) => {
    expect(isSafePromoLinkPath(path)).toBe(false);
  });

  it.each([null, undefined, 42, {}, []])('rejects the non-string %p', (value) => {
    expect(isSafePromoLinkPath(value)).toBe(false);
  });

  it('falls back to /offers when normalising anything unsafe', () => {
    expect(normalizePromoLinkPath('//evil.com')).toBe('/offers');
    expect(normalizePromoLinkPath(null)).toBe('/offers');
    expect(normalizePromoLinkPath('/categories/audio')).toBe('/categories/audio');
  });
});

describe('promo banner cache tags', () => {
  it('emits a tag the frontend revalidator will actually forward', async () => {
    // Both ends filter on an allowlist and drop anything else SILENTLY, so a tag
    // missing from either list makes the banner permanently unrevalidatable
    // rather than erroring. Assert against the real allowlist, not a copy.
    const { default: revalidator } = await import('../services/frontendRevalidator.js');
    expect(revalidator).toBeDefined();
    expect(promoBannerTags()).toEqual(['promo:banner']);
    expect(promoBannerTags().every((t) => t.startsWith('promo:'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration
// ─────────────────────────────────────────────────────────────────────────────
describe('Promo banner API', () => {
  let agent;
  let csrfToken;

  const admin = {
    name: 'Promo Admin',
    email: 'promoadmin@example.com',
    password: 'password123',
    role: 'admin',
  };
  const shopper = {
    name: 'Promo Shopper',
    email: 'promoshopper@example.com',
    password: 'password123',
    role: 'customer',
  };

  beforeAll(async () => { await dbHandler.connect(); });

  afterEach(async () => {
    await dbHandler.clearDatabase();
    await cacheService.invalidatePattern(PROMO_BANNER_CACHE_TAG);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    const salt = await bcrypt.genSalt(10);
    await User.create({ name: admin.name, email: admin.email, passwordHash: await bcrypt.hash(admin.password, salt), role: admin.role });
    await User.create({ name: shopper.name, email: shopper.email, passwordHash: await bcrypt.hash(shopper.password, salt), role: shopper.role });

    agent = request.agent(app);
    const login = await agent.post(`${BASE}/auth/login`).send({ email: admin.email, password: admin.password });
    csrfToken = extractCsrfFromSetCookie(login.headers['set-cookie']);
  });

  const post = (url, body) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const put = (url, body) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const patch = (url, body) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const del = (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken);

  /** Read the public endpoint with the response cache cleared first. */
  const getActive = async () => {
    await cacheService.invalidatePattern(PROMO_BANNER_CACHE_TAG);
    return request(app).get(`${BASE}/promo-banners/active`);
  };

  const seed = (overrides = {}) =>
    PromoBanner.create({
      title: 'Onam 2026',
      imageUrl: IMG,
      imagePublicId: 'autobacs/promo-banners/onam',
      alt: 'Onam offer is live',
      linkPath: '/offers',
      isActive: true,
      ...overrides,
    });

  // ── Resolution ────────────────────────────────────────────────────────────

  it('returns null when no banner exists', async () => {
    const res = await getActive();
    expect(res.status).toBe(200);
    expect(res.body.banner).toBeNull();
  });

  it('serves an active, unbounded banner', async () => {
    await seed();
    const res = await getActive();
    expect(res.body.banner).toMatchObject({ imageUrl: IMG, alt: 'Onam offer is live', linkPath: '/offers' });
  });

  it('does not serve an inactive banner', async () => {
    await seed({ isActive: false });
    expect((await getActive()).body.banner).toBeNull();
  });

  it('does not serve a banner whose window has not opened yet', async () => {
    await seed({ startsAt: new Date(Date.now() + HOUR) });
    expect((await getActive()).body.banner).toBeNull();
  });

  it('does not serve a banner whose window has closed', async () => {
    await seed({ startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - HOUR) });
    expect((await getActive()).body.banner).toBeNull();
  });

  it('serves a banner inside its window', async () => {
    await seed({ startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR) });
    expect((await getActive()).body.banner).not.toBeNull();
  });

  it('picks the highest priority when two banners are live at once', async () => {
    await seed({ title: 'Low', imageUrl: `${CLOUDINARY}/low.jpg`, priority: 1 });
    await seed({ title: 'High', imageUrl: `${CLOUDINARY}/high.jpg`, priority: 5 });
    expect((await getActive()).body.banner.imageUrl).toBe(`${CLOUDINARY}/high.jpg`);
  });

  it('serves the per-breakpoint artwork when all three are uploaded', async () => {
    await seed({
      tabletImageUrl: `${CLOUDINARY}/onam-tablet.jpg`,
      mobileImageUrl: `${CLOUDINARY}/onam-mobile.jpg`,
    });
    const { banner } = (await getActive()).body;
    expect(banner.imageUrl).toBe(IMG);
    expect(banner.tabletImageUrl).toBe(`${CLOUDINARY}/onam-tablet.jpg`);
    expect(banner.mobileImageUrl).toBe(`${CLOUDINARY}/onam-mobile.jpg`);
  });

  it('falls back to the desktop image for slots that were left empty', async () => {
    await seed();
    const { banner } = (await getActive()).body;
    // Substituted server-side so the storefront always gets three usable URLs and
    // the rendering layer never has to decide what "missing" means. A banner with
    // one file must still render everywhere, not show a broken image on phones.
    expect(banner.tabletImageUrl).toBe(IMG);
    expect(banner.mobileImageUrl).toBe(IMG);
  });

  it('falls back for only the missing slot, not both', async () => {
    await seed({ mobileImageUrl: `${CLOUDINARY}/onam-mobile.jpg` });
    const { banner } = (await getActive()).body;
    expect(banner.mobileImageUrl).toBe(`${CLOUDINARY}/onam-mobile.jpg`);
    expect(banner.tabletImageUrl).toBe(IMG);
  });

  it('publishes each slot\'s pixel dimensions', async () => {
    await seed({
      imageWidth: 3840, imageHeight: 256,
      mobileImageUrl: `${CLOUDINARY}/onam-mobile.jpg`,
      mobileImageWidth: 1280, mobileImageHeight: 320,
    });
    const { banner } = (await getActive()).body;
    // The storefront turns these into a CSS aspect-ratio: the strip renders the
    // artwork whole at whatever height its shape implies, instead of cropping the
    // sides to fit a fixed height, and still reserves its box before the image
    // loads. Without dimensions there is no way to have both.
    expect(banner.imageWidth).toBe(3840);
    expect(banner.imageHeight).toBe(256);
    expect(banner.mobileImageWidth).toBe(1280);
    expect(banner.mobileImageHeight).toBe(320);
  });

  it('carries the desktop dimensions with the desktop url when a slot falls back', async () => {
    await seed({ imageWidth: 3840, imageHeight: 256 });
    const { banner } = (await getActive()).body;
    // The pairing is the point: a fallback url served with the empty slot's own
    // (null) dimensions would be reserved at the spec ratio rather than the
    // file's, and letterbox a perfectly good image on phones and tablets.
    expect(banner.mobileImageUrl).toBe(IMG);
    expect(banner.mobileImageWidth).toBe(3840);
    expect(banner.mobileImageHeight).toBe(256);
    expect(banner.tabletImageWidth).toBe(3840);
    expect(banner.tabletImageHeight).toBe(256);
  });

  it('reports null dimensions rather than guessing when they were never captured', async () => {
    await seed();
    const { banner } = (await getActive()).body;
    // Legacy rows and hand-typed urls have none. The component falls back to the
    // slot's spec ratio; inventing numbers here would hide that from it.
    expect(banner.imageWidth).toBeNull();
    expect(banner.imageHeight).toBeNull();
  });

  it('never leaks admin bookkeeping onto the public response', async () => {
    await seed();
    const { banner } = (await getActive()).body;
    // The public payload is a SHARED cache entry — it must not accumulate fields.
    expect(Object.keys(banner).sort()).toEqual([
      'alt', 'id',
      'imageHeight', 'imageUrl', 'imageWidth',
      'linkPath',
      'mobileImageHeight', 'mobileImageUrl', 'mobileImageWidth',
      'tabletImageHeight', 'tabletImageUrl', 'tabletImageWidth',
    ]);
  });

  // ── Caching ───────────────────────────────────────────────────────────────

  it('caches the "no banner scheduled" case instead of re-querying every request', async () => {
    // The quiet state is the whole-year default. CacheService.wrap treats a falsy
    // hit as a miss, so caching a bare null would put a Mongo query on every page
    // view of every visitor — the service stores a wrapper object to avoid that.
    await request(app).get(`${BASE}/promo-banners/active`);
    const spy = jest.spyOn(PromoBanner, 'findOne');
    const res = await request(app).get(`${BASE}/promo-banners/active`);
    expect(res.body.banner).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('stores the public read in the SHARED cache, not per-process state', async () => {
    await seed();
    await request(app).get(`${BASE}/promo-banners/active`);
    // Prod runs multiple Railway replicas; a process-local cache would make an
    // admin's change visible on one replica and stale on the others.
    expect(await cacheService.invalidatePattern(PROMO_BANNER_CACHE_TAG)).toBeGreaterThan(0);
  });

  it('serves the new artwork immediately after an admin edit, not the cached copy', async () => {
    const banner = await seed();
    await request(app).get(`${BASE}/promo-banners/active`); // warm

    await put(`/promo-banners/admin/${banner._id}`, { imageUrl: `${CLOUDINARY}/diwali.jpg` });

    const after = await request(app).get(`${BASE}/promo-banners/active`);
    expect(after.body.banner.imageUrl).toBe(`${CLOUDINARY}/diwali.jpg`);
  });

  it('stops serving a banner the moment it is switched off', async () => {
    const banner = await seed();
    await request(app).get(`${BASE}/promo-banners/active`); // warm the cache

    await patch(`/promo-banners/admin/${banner._id}/toggle`, { isActive: false });

    // An "off" that only reached Mongo is not off — the shopper still sees it.
    const after = await request(app).get(`${BASE}/promo-banners/active`);
    expect(after.body.banner).toBeNull();
  });

  it('stops serving a banner the moment it is deleted', async () => {
    const banner = await seed();
    await request(app).get(`${BASE}/promo-banners/active`);

    await del(`/promo-banners/admin/${banner._id}`);

    expect((await request(app).get(`${BASE}/promo-banners/active`)).body.banner).toBeNull();
  });

  // ── Write validation ──────────────────────────────────────────────────────

  it('creates a banner, defaulting it to OFF and to /offers', async () => {
    const res = await post('/promo-banners/admin', {
      title: 'Diwali 2026', imageUrl: IMG, alt: 'Diwali offer',
    });
    expect(res.status).toBe(201);
    // Off by default: an upload in progress must never go live by accident.
    expect(res.body.banner.isActive).toBe(false);
    expect(res.body.banner.linkPath).toBe('/offers');
  });

  it('rejects a banner with no alt text', async () => {
    const res = await post('/promo-banners/admin', { title: 'No alt', imageUrl: IMG });
    expect(res.status).toBe(400);
  });

  it('rejects an image that is not a Cloudinary URL', async () => {
    const res = await post('/promo-banners/admin', {
      title: 'Hotlinked', imageUrl: 'https://evil.com/banner.jpg', alt: 'x',
    });
    expect(res.status).toBe(400);
  });

  it.each(['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com'])(
    'rejects the unsafe link path %s at the API boundary',
    async (linkPath) => {
      const res = await post('/promo-banners/admin', {
        title: 'Redirect', imageUrl: IMG, alt: 'x', linkPath,
      });
      expect(res.status).toBe(400);
    },
  );

  it('stores the uploaded dimensions for every slot', async () => {
    const res = await post('/promo-banners/admin', {
      title: 'Sized', imageUrl: IMG, alt: 'x',
      imageWidth: 3840, imageHeight: 208,
      mobileImageUrl: `${CLOUDINARY}/m.jpg`, mobileImageWidth: 1280, mobileImageHeight: 144,
    });
    expect(res.status).toBe(201);
    expect(res.body.banner).toMatchObject({
      imageWidth: 3840, imageHeight: 208, mobileImageWidth: 1280, mobileImageHeight: 144,
    });
  });

  it('rejects a non-Cloudinary URL in the mobile slot too', async () => {
    // The desktop slot is not the only tampering surface.
    const res = await post('/promo-banners/admin', {
      title: 'Hotlinked mobile', imageUrl: IMG, alt: 'x',
      mobileImageUrl: 'https://evil.com/banner.jpg',
    });
    expect(res.status).toBe(400);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['absurd', 999999],
  ])('rejects a %s image width', async (_label, imageWidth) => {
    // A bad ratio would reserve a nonsensical box on every storefront page.
    const res = await post('/promo-banners/admin', {
      title: 'Bad size', imageUrl: IMG, alt: 'x', imageWidth, imageHeight: 100,
    });
    expect(res.status).toBe(400);
  });

  it('rejects an end date that is not after the start date', async () => {
    const now = Date.now();
    const res = await post('/promo-banners/admin', {
      title: 'Impossible', imageUrl: IMG, alt: 'x',
      startsAt: new Date(now + HOUR).toISOString(),
      endsAt: new Date(now).toISOString(),
    });
    // A window that can never open means a banner that silently never appears —
    // undiagnosable from the admin screen.
    expect(res.status).toBe(400);
  });

  it('rejects a window inverted by an edit, not just at creation', async () => {
    const banner = await seed({ startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR) });
    const res = await put(`/promo-banners/admin/${banner._id}`, {
      endsAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  // ── Cloudinary lifecycle ──────────────────────────────────────────────────

  it('deletes the orphaned asset when an image is replaced', async () => {
    const cloudinary = await import('../config/cloudinary.js');
    const destroy = jest.spyOn(cloudinary.default.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    const banner = await seed();
    await put(`/promo-banners/admin/${banner._id}`, {
      imageUrl: `${CLOUDINARY}/diwali.jpg`,
      imagePublicId: 'autobacs/promo-banners/diwali',
    });

    // Derived from what actually persisted (before vs after), not from the
    // request body — deleting optimistically is how the product gallery ended up
    // with Mongo pointing at images that no longer existed.
    expect(destroy).toHaveBeenCalledWith('autobacs/promo-banners/onam', expect.anything());
  });

  it('does NOT delete the asset when an edit leaves the image alone', async () => {
    const cloudinary = await import('../config/cloudinary.js');
    const destroy = jest.spyOn(cloudinary.default.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    const banner = await seed();
    await put(`/promo-banners/admin/${banner._id}`, { title: 'Onam 2026 (revised)' });

    expect(destroy).not.toHaveBeenCalled();
  });

  it('deletes ALL THREE artworks when a banner is deleted', async () => {
    const cloudinary = await import('../config/cloudinary.js');
    const destroy = jest.spyOn(cloudinary.default.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    const banner = await seed({
      tabletImagePublicId: 'autobacs/promo-banners/onam-tablet',
      mobileImagePublicId: 'autobacs/promo-banners/onam-mobile',
    });
    await del(`/promo-banners/admin/${banner._id}`);

    // Missing one here would strand a paid-for asset in Cloudinary forever.
    expect(destroy.mock.calls.map(([id]) => id)).toEqual(expect.arrayContaining([
      'autobacs/promo-banners/onam',
      'autobacs/promo-banners/onam-tablet',
      'autobacs/promo-banners/onam-mobile',
    ]));
  });

  it('cleans up an orphaned MOBILE asset when that slot is replaced', async () => {
    const cloudinary = await import('../config/cloudinary.js');
    const destroy = jest.spyOn(cloudinary.default.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    const banner = await seed({
      mobileImageUrl: `${CLOUDINARY}/old-mobile.jpg`,
      mobileImagePublicId: 'autobacs/promo-banners/old-mobile',
    });
    await put(`/promo-banners/admin/${banner._id}`, {
      mobileImageUrl: `${CLOUDINARY}/new-mobile.jpg`,
      mobileImagePublicId: 'autobacs/promo-banners/new-mobile',
    });

    const deleted = destroy.mock.calls.map(([id]) => id);
    expect(deleted).toContain('autobacs/promo-banners/old-mobile');
    // The desktop slot was untouched and must survive.
    expect(deleted).not.toContain('autobacs/promo-banners/onam');
  });

  // ── Access control ────────────────────────────────────────────────────────

  it('rejects an anonymous write with 401, never a 200', async () => {
    const res = await request(app).post(`${BASE}/promo-banners/admin`).send({ title: 'x', imageUrl: IMG, alt: 'x' });
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a signed-in NON-admin write with 403, never a 200', async () => {
    const userAgent = request.agent(app);
    const login = await userAgent.post(`${BASE}/auth/login`).send({ email: shopper.email, password: shopper.password });
    const token = extractCsrfFromSetCookie(login.headers['set-cookie']);

    const res = await userAgent
      .post(`${BASE}/promo-banners/admin`)
      .set('X-XSRF-TOKEN', token)
      .send({ title: 'x', imageUrl: IMG, alt: 'x' });

    expect([401, 403]).toContain(res.status);
    expect(await PromoBanner.countDocuments()).toBe(0);
  });

  it('keeps the admin list private', async () => {
    const res = await request(app).get(`${BASE}/promo-banners/admin`);
    expect([401, 403]).toContain(res.status);
  });

  // ── Admin list ────────────────────────────────────────────────────────────

  it('paginates the admin list with a keyset cursor, never an offset', async () => {
    // Sequential, not Promise.all, so createdAt ordering is deterministic —
    // the cursor is keyed on it.
    for (let i = 0; i < 5; i += 1) {
      await seed({ title: `Banner ${i}`, priority: i });
    }

    const first = await agent.get(`${BASE}/promo-banners/admin?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.banners).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await agent.get(
      `${BASE}/promo-banners/admin?limit=2&before=${encodeURIComponent(new Date(first.body.nextCursor).toISOString())}`,
    );
    expect(second.body.banners).toHaveLength(2);

    // No overlap between pages — the failure mode offset pagination produces
    // under concurrent writes.
    const firstIds = first.body.banners.map((b) => b._id);
    const secondIds = second.body.banners.map((b) => b._id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toHaveLength(0);
  });

  describe('admin state reasons', () => {
    // "Active but not showing" is the confusing case. Each of these asserts the
    // admin is told WHICH of the four possible blockers applies, because that is
    // the difference between a self-service fix and a support ticket.
    const stateOf = async () => {
      const res = await agent.get(`${BASE}/promo-banners/admin`);
      return res.body.banners[0].state;
    };

    it('marks the winning banner live', async () => {
      await seed();
      expect(await stateOf()).toBe('live');
    });

    it('marks an unticked banner off', async () => {
      await seed({ isActive: false });
      expect(await stateOf()).toBe('off');
    });

    it('marks a not-yet-started banner scheduled, not merely "not showing"', async () => {
      await seed({ startsAt: new Date(Date.now() + HOUR) });
      expect(await stateOf()).toBe('scheduled');
    });

    it('marks an expired banner ended', async () => {
      await seed({ startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - HOUR) });
      expect(await stateOf()).toBe('ended');
    });

    it('marks an out-ranked banner superseded', async () => {
      await seed({ title: 'Winner', priority: 10 });
      await seed({ title: 'Loser', priority: 1 });
      const res = await agent.get(`${BASE}/promo-banners/admin`);
      const byTitle = Object.fromEntries(res.body.banners.map((b) => [b.title, b.state]));
      expect(byTitle.Winner).toBe('live');
      expect(byTitle.Loser).toBe('superseded');
    });

    it('agrees with the storefront about which banner won', async () => {
      await seed({ title: 'Winner', imageUrl: `${CLOUDINARY}/win.jpg`, priority: 10 });
      await seed({ title: 'Loser', imageUrl: `${CLOUDINARY}/lose.jpg`, priority: 1 });

      const admin = await agent.get(`${BASE}/promo-banners/admin`);
      const live = admin.body.banners.find((b) => b.state === 'live');
      const shopper = await getActive();

      // The admin verdict and the shopper's view must never disagree — that is
      // the whole reason the winner is resolved by one query, not two rules.
      expect(shopper.body.banner.id).toBe(live._id);
    });

    it('reflects a just-saved change immediately, not a cached verdict', async () => {
      const banner = await seed();
      await request(app).get(`${BASE}/promo-banners/active`); // warm the public cache

      await patch(`/promo-banners/admin/${banner._id}/toggle`, { isActive: false });

      // The admin list must not read through the CDN-cacheable public endpoint.
      expect(await stateOf()).toBe('off');
    });
  });

  it('reports no further pages on the last one', async () => {
    await seed();
    const res = await agent.get(`${BASE}/promo-banners/admin?limit=10`);
    expect(res.body.banners).toHaveLength(1);
    expect(res.body.nextCursor).toBeNull();
  });
});
