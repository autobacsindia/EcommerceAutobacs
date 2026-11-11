/**
 * PUT /products/:id/festival-offer — the product editor's Diwali box with per-model
 * choices: who may save it, what is accepted, what a save purges and records, and how
 * model deletes/adds in the normal product save keep it free of orphans.
 * Money-path behaviour is in festivalOfferVariants.test.js.
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
const password = 'SecurePass123!';
let seq = 0;

const csrfFrom = (cookies = []) => {
  const c = cookies.find((x) => x.startsWith('XSRF-TOKEN='));
  return c ? c.split(';')[0].split('=')[1] : '';
};
const login = async (role, extra = {}) => {
  const email = `fvs${++seq}@example.com`;
  await User.create({ name: `T ${role}`, email, passwordHash: await bcrypt.hash(password, 4), role, ...extra });
  const a = request.agent(app);
  const res = await a.post(`${BASE}/auth/login`).send({ email, password });
  return { a, csrf: csrfFrom(res.headers['set-cookie']) };
};
const marketing = (isHead, active = true) => ({ staff: { team: 'marketing', isHead, active } });
const put = (as, id, body) => as.a.put(`${BASE}/products/${id}/festival-offer`).set('X-XSRF-TOKEN', as.csrf).send(body);
const seedVariable = () => {
  const n = ++seq;
  return Product.create({
    name: `Jerry ${n}`, slug: `jerry-${n}-${Date.now()}`, description: 'd', brand: 'B', isActive: true,
    stock: 'in', price: 3060, productType: 'variable',
    variants: [
      { label: 'Red', sku: `R${n}${Date.now()}`, price: 3060, stock: 'in' },
      { label: 'Black', sku: `K${n}${Date.now()}`, price: 4200, stock: 'in' },
      { label: 'Kit', sku: `T${n}${Date.now()}`, price: 6390, stock: 'in' },
    ],
  });
};
const seedSimple = () => Product.create({
  name: `Simple ${++seq}`, slug: `simple-${seq}-${Date.now()}`, description: 'd', price: 12999, stock: 'in', brand: 'B', isActive: true,
});
const reload = (p) => Product.findById(p._id).lean();
const entriesOf = (doc) => (doc.festivalOfferVariantSettings || []).map((e) => ({ ...e, variantId: String(e.variantId) }));

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

describe('who may save it (unchanged: admin + marketing only)', () => {
  it('rejects customers and other teams; allows admin and marketing', async () => {
    const p = await seedVariable();
    const body = { mode: 'auto', variants: [{ variantId: String(p.variants[0]._id), mode: 'none' }] };
    for (const as of [await login('customer'), await login('staff', { staff: { team: 'sales', isHead: true, active: true } }), await login('staff', marketing(false, false))]) {
      expect([401, 403]).toContain((await put(as, p._id, body)).status);
    }
    expect((await reload(p)).festivalOfferVariantSettings).toBeUndefined();

    expect((await put(await login('admin'), p._id, body)).status).toBe(200);
    expect((await put(await login('staff', marketing(false)), p._id, { ...body, mode: 'none' })).status).toBe(200);
  });

  it('a normal product save cannot inject per-model offers', async () => {
    const p = await seedVariable();
    const admin = await login('admin');
    const res = await admin.a.put(`${BASE}/products/${p._id}`).set('X-XSRF-TOKEN', admin.csrf)
      .send({ festivalOfferVariantSettings: [{ variantId: String(p.variants[0]._id), mode: 'custom', percent: 30 }] });
    expect(res.status).toBeLessThan(500);
    expect((await reload(p)).festivalOfferVariantSettings).toBeUndefined();
  });
});

describe('what is accepted', () => {
  it.each([
    ['custom 31', { mode: 'custom', percent: 31 }],
    ['custom 0', { mode: 'custom', percent: 0 }],
    ['custom fraction', { mode: 'custom', percent: 7.5 }],
    ['custom text', { mode: 'custom', percent: '7' }],
    ['unknown mode', { mode: 'free' }],
  ])('refuses a model %s without touching the product', async (_n, bad) => {
    const p = await seedVariable();
    const admin = await login('admin');
    const res = await put(admin, p._id, { mode: 'auto', variants: [{ variantId: String(p.variants[0]._id), ...bad }] });
    expect(res.status).toBe(400);
    expect((await reload(p)).festivalOfferVariantSettings).toBeUndefined();
  });

  it('refuses a model id that is not on this product (deleted / stale page) with 409', async () => {
    const p = await seedVariable();
    const res = await put(await login('admin'), p._id, {
      mode: 'auto', variants: [{ variantId: String(new mongoose.Types.ObjectId()), mode: 'none' }],
    });
    expect(res.status).toBe(409);
    expect(res.body.message || res.body.error).toMatch(/reload/i);
  });

  it('refuses the same model twice, and model choices on a product with no models', async () => {
    const p = await seedVariable();
    const admin = await login('admin');
    const id = String(p.variants[0]._id);
    expect((await put(admin, p._id, { mode: 'auto', variants: [{ variantId: id, mode: 'none' }, { variantId: id, mode: 'auto' }] })).status).toBe(400);
    const s = await seedSimple();
    expect((await put(admin, s._id, { mode: 'auto', variants: [{ variantId: id, mode: 'none' }] })).status).toBe(400);
  });

  it('a product with no models still saves its single choice exactly as before', async () => {
    const s = await seedSimple();
    const res = await put(await login('admin'), s._id, { mode: 'custom', percent: 7 });
    expect(res.status).toBe(200);
    const doc = await reload(s);
    expect(doc.festivalOfferSetting).toEqual({ mode: 'custom', percent: 7 });
    expect(doc.festivalOfferVariantSettings).toBeUndefined();
  });
});

describe('save, purge, audit', () => {
  it('saves product + models together, purges every cache layer and records the change', async () => {
    const tags = jest.spyOn(cacheService, 'invalidateTags');
    const p = await seedVariable();
    const [red, black, kit] = p.variants.map((v) => String(v._id));
    const res = await put(await login('admin'), p._id, {
      mode: 'custom', percent: 8,
      variants: [
        { variantId: red, mode: 'auto' },
        { variantId: black, mode: 'none' },
        { variantId: kit, mode: 'custom', percent: 15 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    const doc = await reload(p);
    expect(doc.festivalOfferSetting).toEqual({ mode: 'custom', percent: 8 });
    expect(entriesOf(doc)).toEqual([
      { variantId: red, mode: 'auto' },
      { variantId: black, mode: 'none' },
      { variantId: kit, mode: 'custom', percent: 15 },
    ]);

    // Redis + Cloudflare (invalidateCache → tags) and the Next.js tags for this page.
    expect(tags).toHaveBeenCalledWith('products');
    expect(revalidateFrontendTags.mock.calls[0][0]).toEqual(expect.arrayContaining(['product:list', `product:${p.slug}`]));
    // Shopping feeds rebuild.
    expect((await FestivalOffer.findOne({ key: 'default' }).lean()).productSettingsChangedAt).toBeTruthy();

    const audit = await AuditLog.findOne({ action: 'FESTIVAL_OFFER_PRODUCT_SETTING' }).lean();
    expect(audit.details.to).toEqual({
      mode: 'custom', percent: 8,
      models: [{ model: 'Red', mode: 'auto' }, { model: 'Black', mode: 'none' }, { model: 'Kit', mode: 'custom', percent: 15 }],
    });
    expect(audit.details.from).toEqual({ mode: 'auto', models: [] });
  });

  it('"same as product" removes the model entry; all inherit removes the field', async () => {
    const p = await seedVariable();
    const admin = await login('admin');
    const [red, black] = p.variants.map((v) => String(v._id));
    await put(admin, p._id, { mode: 'auto', variants: [{ variantId: red, mode: 'none' }, { variantId: black, mode: 'none' }] });
    await put(admin, p._id, { mode: 'auto', variants: [{ variantId: red, mode: 'inherit' }, { variantId: black, mode: 'none' }] });
    expect(entriesOf(await reload(p))).toEqual([{ variantId: black, mode: 'none' }]);
    await put(admin, p._id, { mode: 'auto', variants: [{ variantId: black, mode: 'inherit' }] });
    expect('festivalOfferVariantSettings' in (await reload(p))).toBe(false);
  });

  it('a repeat of the same save writes, purges and audits nothing', async () => {
    const p = await seedVariable();
    const admin = await login('admin');
    const body = { mode: 'none', variants: [{ variantId: String(p.variants[2]._id), mode: 'custom', percent: 12 }] };
    await put(admin, p._id, body);
    revalidateFrontendTags.mockClear();
    const tags = jest.spyOn(cacheService, 'invalidateTags');
    const res = await put(admin, p._id, body);
    expect(res.body.updated).toBe(false);
    expect(tags).not.toHaveBeenCalled();
    expect(revalidateFrontendTags).not.toHaveBeenCalled();
    expect(await AuditLog.countDocuments({ action: 'FESTIVAL_OFFER_PRODUCT_SETTING' })).toBe(1);
  });
});

describe('the normal product save keeps per-model offers tidy', () => {
  const sendVariants = (as, p, variants) => as.a.put(`${BASE}/products/${p._id}`).set('X-XSRF-TOKEN', as.csrf).send({
    productType: 'variable',
    variants: variants.map((v) => ({ ...(v._id && { _id: String(v._id) }), label: v.label, price: v.price, stock: 'in', sku: v.sku })),
  });

  it('deleting a model removes its offer; the others survive; a new model starts on "same as product"', async () => {
    const p = await seedVariable();
    const admin = await login('admin');
    const [red, black, kit] = p.variants.map((v) => String(v._id));
    await put(admin, p._id, { mode: 'auto', variants: [{ variantId: red, mode: 'none' }, { variantId: kit, mode: 'custom', percent: 15 }] });

    // Drop Kit, keep Red + Black, add a new model.
    const res = await sendVariants(admin, p, [p.variants[0], p.variants[1], { label: 'Blue', price: 3500, sku: `BL${Date.now()}` }]);
    expect(res.status).toBe(200);
    const doc = await reload(p);
    expect(doc.variants.map((v) => v.label)).toEqual(['Red', 'Black', 'Blue']);
    expect(entriesOf(doc)).toEqual([{ variantId: red, mode: 'none' }]);
    expect(entriesOf(doc).some((e) => e.variantId === kit || e.variantId === black)).toBe(false);
  });

  it('an edit that keeps every model (e.g. a price change) keeps every offer', async () => {
    const p = await seedVariable();
    const admin = await login('admin');
    const red = String(p.variants[0]._id);
    await put(admin, p._id, { mode: 'auto', variants: [{ variantId: red, mode: 'custom', percent: 9 }] });
    const changed = p.variants.map((v) => ({ ...v.toObject(), price: v.price + 100 }));
    expect((await sendVariants(admin, p, changed)).status).toBe(200);
    expect(entriesOf(await reload(p))).toEqual([{ variantId: red, mode: 'custom', percent: 9 }]);
  });

  it('turning the product into a simple product drops every model offer', async () => {
    const p = await seedVariable();
    const admin = await login('admin');
    await put(admin, p._id, { mode: 'auto', variants: [{ variantId: String(p.variants[0]._id), mode: 'none' }] });
    const res = await admin.a.put(`${BASE}/products/${p._id}`).set('X-XSRF-TOKEN', admin.csrf).send({ productType: 'simple', price: 3000 });
    expect(res.status).toBe(200);
    expect((await reload(p)).festivalOfferVariantSettings || []).toEqual([]);
  });
});
