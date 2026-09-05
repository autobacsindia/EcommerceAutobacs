/**
 * Applying a coupon to a cart that holds a VARIABLE product.
 *
 * A variable product is priced from its SELECTED variant — the parent's price must never
 * be charged for one — so priceItems throws outright for a line with no `variantId`.
 * That throw is an AppError, not a CouponRejected, so it escapes computeQuote's
 * reported-not-thrown contract entirely and surfaces to the shopper as a bare
 * "Something went wrong".
 *
 * Both cart callers were building their line items without that id. One variable item in
 * the basket therefore broke coupon apply completely — and because the cart's campaign
 * auto-apply runs through the same endpoint and swallows its own failure, a correctly
 * configured live campaign simply never applied and said nothing about why.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';

import pricingService from '../services/pricingService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';

jest.setTimeout(120000);

let replset;
let seq = 0;

const seedSimple = (price) => Product.create({
  name: `Simple ${++seq}`, slug: `simple-${seq}`, description: 'Test',
  price, stock: 'in', brand: 'B', isActive: true,
});

/** A variable product, as the Hypersonic aux light is: priced per beam pattern. */
const seedVariable = (price) => Product.create({
  name: `Variable ${++seq}`, slug: `variable-${seq}`, description: 'Test',
  price, stock: 'in', brand: 'B', isActive: true,
  productType: 'variable',
  variants: [
    { label: 'BEAM PATTERN A', price, stock: 'in' },
    { label: 'BEAM PATTERN B', price: price + 1000, stock: 'in' },
  ],
});

const seedUser = () =>
  User.create({ name: 'U', email: `u${++seq}${Date.now()}@x.com`, passwordHash: 'x', isVerified: true });

async function seedCampaign(code) {
  const campaign = await Campaign.create({
    slug: `festive-${++seq}`, name: 'Festive',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    requireVerifiedEmail: true,
    endsAt: new Date(Date.now() + 30 * 864e5),
    maxRedemptions: 200,
    productTiers: [{ code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true }],
    tiers: [],
    couponCode: code,
  });
  await Coupon.create({
    code, type: 'percentage', value: 0, visibility: 'hidden',
    usageLimitPerUser: 1, isActive: true, campaign: campaign._id,
  });
  return campaign;
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: '7.0.14' },
  });
  await mongoose.connect(replset.getUri(), { serverSelectionTimeoutMS: 30000 });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

afterEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

describe('coupon apply with a variable product in the cart', () => {
  it('prices the campaign across a mixed cart when variantId is carried', async () => {
    await seedCampaign('VARFIX1');
    const simple = await seedSimple(89850);
    const variable = await seedVariable(19990);
    const user = await seedUser();

    const quote = await pricingService.computeQuote({
      items: [
        { product: simple._id, quantity: 1 },
        { product: variable._id, quantity: 1, variantId: variable.variants[0]._id },
      ],
      couponCode: 'VARFIX1',
      userId: user._id,
    });

    expect(quote.couponError).toBeNull();
    expect(quote.subtotal).toBe(109840);
    expect(quote.couponDiscount).toBe(4393.6);   // 4% of the whole bag
    expect(quote.tax).toBeGreaterThan(0);         // ...and tax is real, not ₹0
  });

  it('THROWS rather than reporting when a variable line has no variantId', async () => {
    /* The behaviour that made the cart show "Something went wrong": this failure is an
       AppError, so it escapes the reported-not-thrown contract every coupon rejection
       follows, and no caller upstream turned it into anything a shopper could act on. */
    await seedCampaign('VARFIX2');
    const variable = await seedVariable(19990);
    const user = await seedUser();

    await expect(
      pricingService.computeQuote({
        items: [{ product: variable._id, quantity: 1 }],
        couponCode: 'VARFIX2',
        userId: user._id,
      }),
    ).rejects.toThrow(/select a variant/i);
  });

  it('prices the SELECTED variant, never the parent', async () => {
    // Variant B costs ₹1,000 more. Charging the parent price would under-charge, and is
    // exactly why a missing variantId has to be a hard failure rather than a fallback.
    await seedCampaign('VARFIX3');
    const variable = await seedVariable(19990);
    const user = await seedUser();

    const quote = await pricingService.computeQuote({
      items: [{ product: variable._id, quantity: 1, variantId: variable.variants[1]._id }],
      couponCode: 'VARFIX3',
      userId: user._id,
    });

    expect(quote.subtotal).toBe(20990);
    expect(quote.couponDiscount).toBe(839.6);
  });

  it('still reports a genuine coupon rejection rather than throwing', async () => {
    // The contract this file is really protecting: eligibility failures are REPORTED so
    // the cart can show a reason. Only a broken cart line throws.
    const variable = await seedVariable(19990);
    const user = await seedUser();

    const quote = await pricingService.computeQuote({
      items: [{ product: variable._id, quantity: 1, variantId: variable.variants[0]._id }],
      couponCode: 'NOSUCHCODE',
      userId: user._id,
    });

    expect(quote.couponError).toMatch(/invalid/i);
    expect(quote.couponDiscount).toBe(0);
  });
});

// ── The order line's image snapshot ─────────────────────────────────────────

describe('order line image is the SELECTED model, snapshotted', () => {
  const R2 = 'https://img.autobacsindia.com/autobacs/products';

  /** A variable product whose two models have different photos. */
  const seedWithPhotos = () => Product.create({
    name: `Photo ${++seq}`, slug: `photo-${seq}`, description: 'Test',
    price: 11900, stock: 'in', brand: 'B', isActive: true,
    productType: 'variable',
    images: [
      { url: `${R2}/pack.jpg`, public_id: 'pack', isPrimary: true },
      { url: `${R2}/smoked.jpg`, public_id: 'smoked', variantOwned: true },
    ],
    variants: [
      { label: 'smoked lights', price: 12500, stock: 'in', imageKey: 'smoked' },
      { label: 'clear lights', price: 11900, stock: 'in' },
    ],
  });

  it('snapshots the chosen model’s own photo, not the parent’s first image', async () => {
    const product = await seedWithPhotos();
    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1, variantId: product.variants[0]._id }],
    });
    // Buying "smoked" must not put the packaging shot on the invoice.
    expect(quote.orderItems[0].image).toContain('smoked.jpg');
  });

  it('falls back to the product image for a model with no photo of its own', async () => {
    const product = await seedWithPhotos();
    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1, variantId: product.variants[1]._id }],
    });
    expect(quote.orderItems[0].image).toContain('pack.jpg');
  });

  it('respects the admin’s chosen primary, not merely images[0]', async () => {
    const product = await Product.create({
      name: `Primary ${++seq}`, slug: `primary-${seq}`, description: 'Test',
      price: 100, stock: 'in', brand: 'B', isActive: true,
      images: [
        { url: `${R2}/first.jpg`, public_id: 'first' },
        { url: `${R2}/hero.jpg`, public_id: 'hero', isPrimary: true },
      ],
    });
    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
    });
    expect(quote.orderItems[0].image).toContain('hero.jpg');
  });

  it('a pointer at a removed image degrades to the product image, never undefined', async () => {
    const product = await seedWithPhotos();
    await Product.updateOne(
      { _id: product._id },
      { $set: { 'variants.0.imageKey': 'deleted-yesterday' } },
    );
    const fresh = await Product.findById(product._id);
    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1, variantId: fresh.variants[0]._id }],
    });
    expect(quote.orderItems[0].image).toContain('pack.jpg');
  });
});
