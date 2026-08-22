/**
 * The rate a product advertises on its own page.
 *
 * Before this existed the campaign was invisible until a coupon auto-applied on /cart.
 * That made a single silent failure there — or a shopper who simply never opened the
 * cart — indistinguishable from a campaign that was switched off, which is exactly how
 * a correctly-configured live campaign came to look broken.
 *
 * The rule this file holds: what the product page promises and what checkout charges are
 * resolved by the SAME function against the SAME live sale state, so the badge can never
 * advertise a rate the cart would refuse.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';
import CampaignProductTier from '../models/CampaignProductTier.js';

import campaignService from '../services/campaignService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';

jest.setTimeout(120000);

let replset;
let seq = 0;

const seedProduct = (price, extra = {}) => Product.create({
  name: `Prod ${++seq}`, slug: `prod-${seq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true, ...extra,
});

async function seedCampaign(overrides = {}) {
  const code = `RATE${++seq}`;
  const campaign = await Campaign.create({
    slug: `festive-${seq}`, name: 'Festive',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    endsAt: new Date(Date.now() + 30 * 864e5),
    maxRedemptions: 200,
    productTiers: [
      { code: 'bronkz', label: 'Bronkz', percent: 3 },
      { code: 'thanos', label: 'Thanos', percent: 8 },
      { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
    ],
    tiers: [],
    couponCode: code,
    ...overrides,
  });
  await Coupon.create({
    code, type: 'percentage', value: 0, visibility: 'hidden',
    usageLimitPerUser: 1, isActive: true, campaign: campaign._id,
  });
  return campaign;
}

const assign = (campaign, product, tierCode) =>
  CampaignProductTier.create({ campaign: campaign._id, product: product._id, tierCode });

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

describe('campaignService.productRates', () => {
  it('reports the tier rate for an assigned product', async () => {
    const campaign = await seedCampaign();
    const product = await seedProduct(10000);
    await assign(campaign, product, 'thanos');

    const result = await campaignService.productRates(campaign.slug, [String(product._id)]);
    expect(result.rates[String(product._id)]).toEqual({ percent: 8, onSaleCapped: false });
  });

  it('reports the default rate for a product in no tier', async () => {
    const campaign = await seedCampaign();
    const product = await seedProduct(10000);

    const result = await campaignService.productRates(campaign.slug, [String(product._id)]);
    expect(result.rates[String(product._id)]).toEqual({ percent: 4, onSaleCapped: false });
  });

  it('advertises the CAPPED rate on an already-discounted product', async () => {
    // The badge must say 2%, not 8% — a shopper who sees the headline rate on a sale
    // item and is charged the capped one reads it as the site short-changing them.
    const campaign = await seedCampaign();
    const product = await seedProduct(10000, { originalPrice: 20000 });
    await assign(campaign, product, 'thanos');

    const result = await campaignService.productRates(campaign.slug, [String(product._id)]);
    expect(result.rates[String(product._id)]).toEqual({ percent: 2, onSaleCapped: true });
  });

  it('does NOT cap once the sale window has closed', async () => {
    /* effectivePrice reverts the price UP at the expiry instant, ahead of the cron that
       normalizes the stored fields. Reading a stored flag here would keep advertising a
       capped 2% on a product already earning its full rate. */
    const campaign = await seedCampaign();
    const product = await seedProduct(10000, {
      originalPrice: 20000,
      saleEndsAt: new Date(Date.now() - 60_000),
    });
    await assign(campaign, product, 'thanos');

    const result = await campaignService.productRates(campaign.slug, [String(product._id)]);
    expect(result.rates[String(product._id)]).toEqual({ percent: 8, onSaleCapped: false });
  });

  it('answers for several products at once', async () => {
    const campaign = await seedCampaign();
    const thanos = await seedProduct(10000);
    const bronkz = await seedProduct(20000);
    const plain = await seedProduct(30000);
    await assign(campaign, thanos, 'thanos');
    await assign(campaign, bronkz, 'bronkz');

    const result = await campaignService.productRates(
      campaign.slug, [thanos, bronkz, plain].map(p => String(p._id)),
    );
    expect(result.rates[String(thanos._id)].percent).toBe(8);
    expect(result.rates[String(bronkz._id)].percent).toBe(3);
    expect(result.rates[String(plain._id)].percent).toBe(4);
  });

  it('advertises nothing while the campaign is not live', async () => {
    for (const status of [CAMPAIGN_STATUS.DRAFT, CAMPAIGN_STATUS.OFF]) {
      const campaign = await seedCampaign({ status });
      const product = await seedProduct(10000);
      await assign(campaign, product, 'thanos');

      expect(await campaignService.productRates(campaign.slug, [String(product._id)])).toBeNull();
      await Campaign.deleteMany({});
      await Coupon.deleteMany({});
    }
  });

  it('advertises nothing outside the campaign window', async () => {
    const ended = await seedCampaign({ endsAt: new Date(Date.now() - 864e5) });
    const product = await seedProduct(10000);
    expect(await campaignService.productRates(ended.slug, [String(product._id)])).toBeNull();

    await Campaign.deleteMany({}); await Coupon.deleteMany({});

    const notYet = await seedCampaign({ startsAt: new Date(Date.now() + 864e5) });
    expect(await campaignService.productRates(notYet.slug, [String(product._id)])).toBeNull();
  });

  it('advertises nothing for a cart-value campaign — there is no per-product rate', async () => {
    const campaign = await seedCampaign({
      productTiers: [],
      tiers: [{ id: 'a', label: 'A', minCartValue: 0, percent: 10, maxDiscount: null }],
    });
    const product = await seedProduct(10000);
    expect(await campaignService.productRates(campaign.slug, [String(product._id)])).toBeNull();
  });

  it('omits an inactive product rather than quoting it a rate', async () => {
    const campaign = await seedCampaign();
    const gone = await seedProduct(10000, { isActive: false });
    await assign(campaign, gone, 'thanos');

    const result = await campaignService.productRates(campaign.slug, [String(gone._id)]);
    expect(result.rates).toEqual({});
  });

  it('clamps an oversized request instead of refusing it', async () => {
    const campaign = await seedCampaign();
    const ids = Array.from({ length: 80 }, () => String(new mongoose.Types.ObjectId()));
    const result = await campaignService.productRates(campaign.slug, ids);
    // A public route must not let a caller name an unbounded id list; clamping keeps a
    // legitimate oversized page working rather than failing it whole.
    expect(result.rates).toEqual({});
    expect(result.slug).toBe(campaign.slug);
  });

  it('is unknown-campaign safe', async () => {
    expect(await campaignService.productRates('no-such-campaign', ['x'])).toBeNull();
  });
});
