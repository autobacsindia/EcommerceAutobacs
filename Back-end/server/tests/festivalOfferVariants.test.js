/**
 * Per-MODEL Diwali offer through the real money path.
 *
 *   - the shared resolver case table (same table the storefront mirror runs);
 *   - each model is charged by its own choice: Automatic (its own price), Custom, None;
 *   - a model with no choice follows the product default;
 *   - a product with no models is unchanged;
 *   - the switch off returns every model to its normal price;
 *   - the quote/order total for each model equals what the display mirror computes
 *     (applyFestivalOffer + resolveFestivalSetting — the PDP runs the TS mirror of both);
 *   - a tampered client price / setting is ignored and the order snapshots the
 *     discounted model price;
 *   - an entry left for a deleted model never prices anything.
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { useTransactionalDb } from './helpers/replicaSet.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import FestivalOffer from '../models/FestivalOffer.js';
import pricingService from '../services/pricingService.js';
import orderService from '../services/orderService.js';
import {
  resolveFestivalSetting, applyFestivalOffer, toStoredVariantSetting, pruneVariantSettings,
} from '../utils/festivalOffer.js';

jest.setTimeout(120000);

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/festivalVariantSettingCases.json', import.meta.url), 'utf8'));

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};
let seq = 0;
const offerOn = () => FestivalOffer.findOneAndUpdate(
  { key: 'default' }, { $set: { enabled: true, startsAt: null, endsAt: null } }, { upsert: true, new: true },
);
const offerOff = () => FestivalOffer.updateOne({ key: 'default' }, { $set: { enabled: false } });
const seedUser = () => User.create({ name: 'U', email: `fov${++seq}${Date.now()}@x.com`, passwordHash: 'x' });

/** Jerry Can style product: three models, ₹3,060 / ₹4,200 / ₹6,390 (+ one ₹60,000 to cross a tier). */
const seedJerryCan = async (over = {}) => {
  const n = ++seq;
  return Product.create({
    name: `Jerry Can ${n}`, slug: `jerry-can-${n}-${Date.now()}`, description: 'd', brand: 'B',
    isActive: true, stock: 'in', price: 3060, productType: 'variable',
    variants: [
      { label: 'Red', sku: `R${n}${Date.now()}`, price: 3060, stock: 'in' },
      { label: 'Black', sku: `K${n}${Date.now()}`, price: 4200, stock: 'in' },
      { label: 'Kit', sku: `T${n}${Date.now()}`, price: 6390, stock: 'in' },
      { label: 'Pro', sku: `P${n}${Date.now()}`, price: 60000, stock: 'in' },
    ],
    ...over,
  });
};
const withEntries = async (p, entries, productSetting) => {
  const $set = { festivalOfferVariantSettings: entries.map(([i, mode, percent]) => ({
    variantId: p.variants[i]._id, mode, ...(percent != null && { percent }),
  })) };
  if (productSetting) $set.festivalOfferSetting = productSetting;
  await Product.updateOne({ _id: p._id }, { $set });
  return Product.findById(p._id);
};
const quoteOne = (p, variantId, qty = 1) => pricingService.computeQuote({
  items: [{ product: p._id, quantity: qty, ...(variantId ? { variantId } : {}) }],
});
const priceEach = (p) => Promise.all(p.variants.map(async (v) => (await quoteOne(p, v._id)).orderItems[0].price));

beforeAll(async () => { await useTransactionalDb(); });
afterEach(async () => { await FestivalOffer.deleteMany({}); });

describe('resolveFestivalSetting — shared case table', () => {
  it.each(cases.map((c) => [c.name, c]))('%s', (_n, c) => {
    expect(resolveFestivalSetting(c.product, c.variantId)).toEqual(c.expected);
  });

  it('toStoredVariantSetting: inherit removes, auto is explicit, bad custom throws', () => {
    expect(toStoredVariantSetting('inherit')).toBeNull();
    expect(toStoredVariantSetting('auto')).toEqual({ mode: 'auto' });
    expect(toStoredVariantSetting('none')).toEqual({ mode: 'none' });
    expect(toStoredVariantSetting('custom', 12)).toEqual({ mode: 'custom', percent: 12 });
    for (const bad of [0, 31, 7.5, '7', undefined]) expect(() => toStoredVariantSetting('custom', bad)).toThrow(RangeError);
    expect(() => toStoredVariantSetting('free')).toThrow(RangeError);
  });

  it('pruneVariantSettings keeps only entries for models that still exist', () => {
    const entries = [{ variantId: 'a', mode: 'none' }, { variantId: 'b', mode: 'auto' }];
    expect(pruneVariantSettings(entries, [{ _id: 'b' }, { label: 'new, no id yet' }])).toEqual([{ variantId: 'b', mode: 'auto' }]);
    expect(pruneVariantSettings(entries, [])).toEqual([]);
    expect(pruneVariantSettings(undefined, [{ _id: 'a' }])).toEqual([]);
  });
});

describe('per-model offers as charged', () => {
  beforeEach(async () => { await offerOn(); });

  it('no model entries: every model gets Automatic on its OWN price (unchanged behaviour)', async () => {
    const p = await seedJerryCan();
    // 10% under ₹50,000; ₹60,000 crosses into the 5% tier.
    expect(await priceEach(p)).toEqual([2754, 3780, 5751, 57000]);
  });

  it('Automatic, Custom, None and "same as product" side by side', async () => {
    const base = await seedJerryCan();
    // product default Custom 8%; Red → Automatic (10%), Black → None, Kit → Custom 15%, Pro → no entry (8%).
    const p = await withEntries(base, [[0, 'auto'], [1, 'none'], [2, 'custom', 15]], { mode: 'custom', percent: 8 });
    expect(await priceEach(p)).toEqual([2754, 4200, 5431, 55200]);

    const black = (await quoteOne(p, p.variants[1]._id));
    expect(black.orderItems[0].festivalOffer).toBeNull();
    expect(black.savings.festival).toBe(0);
    const kit = await quoteOne(p, p.variants[2]._id, 2);
    expect(kit.orderItems[0].festivalOffer).toMatchObject({ percent: 15, priceBeforeOffer: 6390, discount: 959 });
    expect(kit.subtotal).toBe(5431 * 2);
    expect(kit.savings.festival).toBe(959 * 2);
  });

  it('a model left at "same as product" follows a product None', async () => {
    const p = await withEntries(await seedJerryCan(), [[0, 'auto']], { mode: 'none' });
    expect(await priceEach(p)).toEqual([2754, 4200, 6390, 60000]);
  });

  it('a product with no models ignores stray model entries and prices as before', async () => {
    const simpleStray = new Product().id;
    const simple = await Product.create({
      name: `Simple ${++seq}`, slug: `simple-${seq}-${Date.now()}`, description: 'd', brand: 'B',
      isActive: true, stock: 'in', price: 12999,
      festivalOfferVariantSettings: [{ variantId: simpleStray, mode: 'none' }],
    });
    expect((await quoteOne(simple)).orderItems[0].price).toBe(11699);
    await Product.updateOne({ _id: simple._id }, { $set: { festivalOfferSetting: { mode: 'custom', percent: 7 } } });
    expect((await quoteOne(simple)).orderItems[0].price).toBe(12089);
  });

  it('cart/checkout line for each model equals the display mirror (what the PDP shows)', async () => {
    const p = await withEntries(await seedJerryCan(), [[0, 'custom', 22], [1, 'none'], [3, 'custom', 4]], { mode: 'custom', percent: 6 });
    const plain = p.toObject();
    for (const v of plain.variants) {
      const display = applyFestivalOffer({ unitPrice: v.price, setting: resolveFestivalSetting(plain, v._id) });
      const q = await quoteOne(p, v._id, 3);
      const unit = display ? display.finalPrice : v.price;
      expect(q.orderItems[0].price).toBe(unit);
      expect(q.subtotal).toBe(unit * 3);
      expect(q.totalAmount).toBe(unit * 3);
    }
  });

  it('a mixed cart sums each model at its own offer', async () => {
    const p = await withEntries(await seedJerryCan(), [[1, 'none'], [2, 'custom', 15]]);
    const q = await pricingService.computeQuote({
      items: [0, 1, 2].map((i) => ({ product: p._id, variantId: p.variants[i]._id, quantity: 1 })),
    });
    expect(q.orderItems.map((i) => i.price)).toEqual([2754, 4200, 5431]);
    expect(q.subtotal).toBe(2754 + 4200 + 5431);
    expect(q.savings.festival).toBe(306 + 0 + 959);
  });

  it('an entry left behind for a deleted model never prices anything', async () => {
    const p = await withEntries(await seedJerryCan(), [[1, 'none'], [2, 'custom', 30]]);
    const kitId = p.variants[2]._id;
    // Delete the Kit straight in the DB (no prune) to prove the orphan is harmless.
    await Product.updateOne({ _id: p._id }, { $pull: { variants: { _id: kitId } } });
    const after = await Product.findById(p._id);
    expect(await priceEach(after)).toEqual([2754, 4200, 57000]);
    await expect(quoteOne(after, kitId)).rejects.toThrow(/no longer available/);
  });

  it('a model price change re-tiers Automatic and keeps a Custom %', async () => {
    const p = await withEntries(await seedJerryCan(), [[2, 'custom', 15]]);
    await Product.updateOne({ _id: p._id, 'variants._id': p.variants[0]._id }, { $set: { 'variants.$.price': 55000 } });
    await Product.updateOne({ _id: p._id, 'variants._id': p.variants[2]._id }, { $set: { 'variants.$.price': 7000 } });
    const after = await Product.findById(p._id);
    expect((await quoteOne(after, after.variants[0]._id)).orderItems[0].price).toBe(52250); // 5%
    expect((await quoteOne(after, after.variants[2]._id)).orderItems[0].price).toBe(5950);  // still 15%
  });
});

describe('switch off', () => {
  it('returns every model to its normal price, whatever its own setting', async () => {
    const p = await withEntries(await seedJerryCan(), [[0, 'auto'], [1, 'none'], [2, 'custom', 30]], { mode: 'custom', percent: 20 });
    await offerOn();
    expect(await priceEach(p)).toEqual([2754, 4200, 4473, 48000]);
    await offerOff();
    expect(await priceEach(p)).toEqual([3060, 4200, 6390, 60000]);
    const q = await quoteOne(p, p.variants[2]._id);
    expect(q.orderItems[0].festivalOffer).toBeNull();
    expect(q.savings.festival).toBe(0);
  });
});

describe('order: server price, tamper-proof, snapshotted', () => {
  it('charges the per-model offer, ignores a tampered client price/setting, snapshots the line', async () => {
    await offerOn();
    const user = await seedUser();
    const p = await withEntries(await seedJerryCan(), [[2, 'custom', 15]], { mode: 'none' });
    const kit = p.variants[2];

    const order = await orderService.createOrder(
      user._id,
      [{
        product: p._id, variantId: kit._id, quantity: 1, price: 1,
        festivalOfferSetting: { mode: 'custom', percent: 30 },
        festivalOfferVariantSettings: [{ variantId: kit._id, mode: 'custom', percent: 30 }],
      }],
      ADDRESS,
      { shippingCost: 0, acceptTerms: true, totalAmount: 1 },
    );
    const stored = await Order.findById(order._id).lean();
    expect(stored.items[0].price).toBe(5431);
    expect(String(stored.items[0].variantId)).toBe(String(kit._id));
    expect(stored.totalAmount).toBe(5431);
    expect(stored.items[0].festivalOffer).toMatchObject({ percent: 15, priceBeforeOffer: 6390, discount: 959 });

    // A model the product default excludes is charged full price in the same flow.
    const black = await orderService.createOrder(
      user._id, [{ product: p._id, variantId: p.variants[1]._id, quantity: 1, price: 1 }], ADDRESS,
      { shippingCost: 0, acceptTerms: true },
    );
    expect((await Order.findById(black._id).lean()).totalAmount).toBe(4200);

    // Editing the offer afterwards never rewrites the placed order.
    await Product.updateOne({ _id: p._id }, { $unset: { festivalOfferVariantSettings: 1 } });
    expect((await Order.findById(order._id).lean()).items[0].price).toBe(5431);
  });
});
