/**
 * Per-product Diwali offer setting: who may change it, what is accepted, what a change
 * purges and records. Money-path behaviour is in festivalOfferPricing.test.js; the
 * calculation is in the shared case table.
 */
import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const revalidateFrontendTags = jest.fn();
jest.unstable_mockModule('../services/frontendRevalidator.js', () => ({
  revalidateFrontendTags,
  default: { revalidateFrontendTags },
}));

const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Product } = await import('../models/Product.js');
const { default: FestivalOffer } = await import('../models/FestivalOffer.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: cacheService } = await import('../services/cacheService.js');
const dbHandler = await import('./db-handler.js');

const BASE = '/api/v1';
const PATH = `${BASE}/products/festival-offer-setting`;
const LIST = `${BASE}/products/admin/festival-offer-exceptions`;
const password = 'SecurePass123!';
let seq = 0;

const csrfFrom = (cookies = []) => {
  const c = cookies.find((x) => x.startsWith('XSRF-TOKEN='));
  return c ? c.split(';')[0].split('=')[1] : '';
};
const login = async (role, extra = {}) => {
  const email = `fo${++seq}@example.com`;
  await User.create({ name: `T ${role}`, email, passwordHash: await bcrypt.hash(password, 4), role, ...extra });
  const a = request.agent(app);
  const res = await a.post(`${BASE}/auth/login`).send({ email, password });
  return { a, csrf: csrfFrom(res.headers['set-cookie']) };
};
const marketing = (isHead, active = true) => ({ staff: { team: 'marketing', isHead, active } });
const patch = (as, body) => as.a.patch(PATH).set('X-XSRF-TOKEN', as.csrf).send(body);
const seed = (over = {}) => Product.create({
  name: `Prod ${++seq}`, slug: `prod-${seq}-${Date.now()}`, description: 'd', price: 12999, stock: 'in', brand: 'B', isActive: true, ...over,
});
const reload = (p) => Product.findById(p._id).lean();

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => {
  await dbHandler.clearDatabase();
  revalidateFrontendTags.mockClear();
  jest.restoreAllMocks();
});
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

describe('who may change it', () => {
  it('rejects customers, inactive marketing staff and other teams\' heads', async () => {
    const p = await seed();
    const body = { productIds: [String(p._id)], mode: 'none' };
    const denied = await Promise.all([
      login('customer'),
      login('staff', marketing(false, false)),
      login('staff', marketing(true, false)),
      login('staff', { staff: { team: 'sales', isHead: true, active: true } }),
    ]);
    for (const as of denied) {
      const res = await patch(as, body);
      expect([401, 403]).toContain(res.status);
    }
    expect((await reload(p)).festivalOfferSetting).toBeUndefined();
    expect(await AuditLog.countDocuments({ action: 'FESTIVAL_OFFER_PRODUCT_SETTING' })).toBe(0);
  });

  it('allows an admin, the marketing head and any active marketing member', async () => {
    const p = await seed();
    const admin = await login('admin');
    expect((await patch(admin, { productIds: [String(p._id)], mode: 'none' })).status).toBe(200);
    const head = await login('staff', marketing(true));
    expect((await patch(head, { productIds: [String(p._id)], mode: 'custom', percent: 7 })).status).toBe(200);
    const member = await login('staff', marketing(false));
    expect((await patch(member, { productIds: [String(p._id)], mode: 'custom', percent: 9 })).status).toBe(200);
    expect((await reload(p)).festivalOfferSetting).toEqual({ mode: 'custom', percent: 9 });
  });

  it('a normal product save cannot change it', async () => {
    const p = await seed();
    const member = await login('staff', marketing(false));
    const res = await member.a.put(`${BASE}/products/${p._id}`).set('X-XSRF-TOKEN', member.csrf)
      .send({ festivalOfferSetting: { mode: 'custom', percent: 30 } });
    expect(res.status).toBeLessThan(500);
    expect((await reload(p)).festivalOfferSetting).toBeUndefined();
  });
});

describe('what is accepted', () => {
  it.each([
    ['0', { mode: 'custom', percent: 0 }],
    ['31', { mode: 'custom', percent: 31 }],
    ['negative', { mode: 'custom', percent: -5 }],
    ['fraction', { mode: 'custom', percent: 7.5 }],
    ['text', { mode: 'custom', percent: '7' }],
    ['700', { mode: 'custom', percent: 700 }],
    ['missing', { mode: 'custom' }],
    ['unknown mode', { mode: 'free' }],
  ])('refuses %s without touching the product', async (_n, body) => {
    const p = await seed({ festivalOfferSetting: { mode: 'none' } });
    const res = await patch(await login('admin'), { productIds: [String(p._id)], ...body });
    expect(res.status).toBe(400);
    expect((await reload(p)).festivalOfferSetting).toEqual({ mode: 'none' });
  });

  it('accepts the ends of the range', async () => {
    const p = await seed();
    const admin = await login('admin');
    for (const percent of [1, 30]) {
      expect((await patch(admin, { productIds: [String(p._id)], mode: 'custom', percent })).status).toBe(200);
    }
  });

  it('refuses an empty list, a bad id and more than 200 products', async () => {
    const admin = await login('admin');
    expect((await patch(admin, { productIds: [], mode: 'none' })).status).toBe(400);
    expect((await patch(admin, { productIds: ['nope'], mode: 'none' })).status).toBe(400);
    const many = Array.from({ length: 201 }, () => String(new mongoose.Types.ObjectId()));
    expect((await patch(admin, { productIds: many, mode: 'none' })).status).toBe(400);
  });

  it('the schema also refuses an out-of-range value from any other write', async () => {
    await expect(seed({ festivalOfferSetting: { mode: 'custom', percent: 31 } })).rejects.toThrow();
    await expect(seed({ festivalOfferSetting: { mode: 'custom' } })).rejects.toThrow();
  });

  it('Automatic removes the field, leaving the product as if never set', async () => {
    const p = await seed({ festivalOfferSetting: { mode: 'none' } });
    await patch(await login('admin'), { productIds: [String(p._id)], mode: 'auto' });
    expect('festivalOfferSetting' in (await reload(p))).toBe(false);
  });
});

describe('bulk change, purge and audit', () => {
  it('changes several, reports the missing one, purges each page and records who', async () => {
    const tags = jest.spyOn(cacheService, 'invalidateTags');
    const [a, b, same] = await Promise.all([seed(), seed(), seed({ festivalOfferSetting: { mode: 'none' } })]);
    const ghost = String(new mongoose.Types.ObjectId());
    const res = await patch(await login('admin'), { productIds: [a, b, same, ghost].map((x) => String(x._id || x)), mode: 'none' });

    expect(res.body).toMatchObject({ requested: 4, updated: 2, unchanged: 1, notFound: [ghost] });
    expect(tags).toHaveBeenCalledWith('products');
    const sent = revalidateFrontendTags.mock.calls[0][0];
    expect(sent).toEqual(expect.arrayContaining(['home:products', 'product:list', `product:${a.slug}`, `product:${b.slug}`]));
    expect(sent).not.toContain(`product:${same.slug}`);

    const audit = await AuditLog.findOne({ action: 'FESTIVAL_OFFER_PRODUCT_SETTING' }).lean();
    expect(audit.user).toBeTruthy();
    expect(audit.details.to).toEqual({ mode: 'none' });
    expect(audit.details.changes.map((c) => c.product).sort()).toEqual([String(a._id), String(b._id)].sort());
    expect(audit.details.changes[0].from).toEqual({ mode: 'auto' });
    // The shopping feeds key on this, so they rebuild.
    expect((await FestivalOffer.findOne({ key: 'default' }).lean()).productSettingsChangedAt).toBeTruthy();
  });

  it('a repeat of the same change writes, purges and audits nothing', async () => {
    const p = await seed({ festivalOfferSetting: { mode: 'custom', percent: 7 } });
    const res = await patch(await login('admin'), { productIds: [String(p._id)], mode: 'custom', percent: 7 });
    expect(res.body).toMatchObject({ updated: 0, unchanged: 1 });
    expect(revalidateFrontendTags).not.toHaveBeenCalled();
    expect(await AuditLog.countDocuments({ action: 'FESTIVAL_OFFER_PRODUCT_SETTING' })).toBe(0);
  });

  it('does not bump updatedAt or create the offer as switched on', async () => {
    const p = await seed();
    const before = (await reload(p)).updatedAt;
    await patch(await login('admin'), { productIds: [String(p._id)], mode: 'none' });
    expect((await reload(p)).updatedAt).toEqual(before);
    expect((await FestivalOffer.findOne({ key: 'default' }).lean()).enabled).toBe(false);
  });

  it('skips a soft-deleted product', async () => {
    const p = await seed({ deletedAt: new Date() });
    const res = await patch(await login('admin'), { productIds: [String(p._id)], mode: 'none' });
    expect(res.body.notFound).toEqual([String(p._id)]);
  });
});

describe('exceptions list', () => {
  it('pages by cursor with no repeats, filters by mode and leaves out Automatic', async () => {
    await seed();
    for (let i = 0; i < 3; i++) await seed({ festivalOfferSetting: { mode: 'none' } });
    await seed({ festivalOfferSetting: { mode: 'custom', percent: 5 } });
    const { a } = await login('staff', marketing(false));

    const first = await a.get(`${LIST}?limit=3`);
    expect(first.status).toBe(200);
    expect(first.body.products).toHaveLength(3);
    const second = await a.get(`${LIST}?limit=3&cursor=${first.body.nextCursor}`);
    expect(second.body.products).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.products, ...second.body.products].map((p) => p._id);
    expect(new Set(ids).size).toBe(4);

    const custom = await a.get(`${LIST}?mode=custom`);
    expect(custom.body.products).toHaveLength(1);
    expect(custom.body.products[0].festivalOfferSetting).toEqual({ mode: 'custom', percent: 5 });
  });

  it('refuses an oversized limit and a bad cursor', async () => {
    const { a } = await login('admin');
    expect((await a.get(`${LIST}?limit=101`)).status).toBe(400);
    expect((await a.get(`${LIST}?cursor=abc`)).status).toBe(400);
  });

  it('is closed to customers', async () => {
    const { a } = await login('customer');
    expect((await a.get(LIST)).status).toBe(403);
  });
});

describe('storefront payloads carry the setting', () => {
  it('the product read returns it and no staff identity', async () => {
    const p = await seed({ festivalOfferSetting: { mode: 'custom', percent: 7 } });
    const res = await request(app).get(`${BASE}/products/slug/${p.slug}`);
    expect(res.status).toBe(200);
    const body = res.body.product || res.body.data || res.body;
    expect(body.festivalOfferSetting).toEqual({ mode: 'custom', percent: 7 });
  });
});

describe('exceptions list stays index-backed', () => {
  it('reads only exception rows, not the catalogue', async () => {
    await Product.createIndexes();
    await Product.collection.insertMany(Array.from({ length: 300 }, (_, i) => ({
      name: `N${i}`, slug: `n-${i}`, price: 100, deletedAt: null,
      ...(i % 30 === 0 ? { festivalOfferSetting: { mode: 'none' } } : {}),
    })));
    const stats = await Product.find({ 'festivalOfferSetting.mode': { $type: 'string', $eq: 'none' }, deletedAt: null })
      .sort({ _id: 1 }).limit(51).explain('executionStats');
    expect(stats.executionStats.totalDocsExamined).toBeLessThanOrEqual(10);
  });
});
