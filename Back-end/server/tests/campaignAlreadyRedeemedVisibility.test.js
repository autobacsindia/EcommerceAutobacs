/**
 * Once a customer has spent the offer, everything that DISPLAYS it must stop.
 *
 * "Already used" was checked only where a discount is actually priced
 * (pricingService._evaluateCoupon). Every display surface — the site-wide ribbon, the
 * product-page rate, the cart notice, the add-to-cart congratulation, the landing page —
 * asks campaignService.evaluate instead, and that never looked. So the offer went on
 * advertising itself after it was gone, and `already_used` was a reason the UI branched
 * on that the engine could not produce.
 *
 * An allowlist campaign masked it: its member row flips to `redeemed`. A PUBLIC campaign
 * has no member row at all, which is exactly the shape of the live festive offer.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';

import campaignService from '../services/campaignService.js';
import pricingService from '../services/pricingService.js';
import orderService from '../services/orderService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE, CAMPAIGN_REASON } from '../config/campaign.js';

jest.setTimeout(120000);

let replset;
let seq = 0;

const ADDRESS = {
  fullName: 'A B', addressLine1: '1 Road', city: 'Kochi',
  state: 'Kerala', postalCode: '682001', country: 'India', phone: '9999999999',
};

const seedProduct = (price = 10000) => Product.create({
  name: `Prod ${++seq}`, slug: `prod-${seq}`, description: 'Test',
  price, stock: 'in', brand: 'B', isActive: true,
});

const seedUser = () =>
  User.create({ name: 'U', email: `u${++seq}${Date.now()}@x.com`, passwordHash: 'x', isVerified: true });

async function seedCampaign(code) {
  const campaign = await Campaign.create({
    slug: `festive-${++seq}`, name: 'Festive',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.EVERYONE,   // public — no member row to fall back on
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

describe('a customer who has already redeemed', () => {
  async function redeemOnce(code) {
    const campaign = await seedCampaign(code);
    const product = await seedProduct();
    const user = await seedUser();
    await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code },
    );
    return { campaign, product, user };
  }

  it('is reported as ineligible, with a reason the UI can act on', async () => {
    const { campaign, user } = await redeemOnce('USEDVIS1');

    const status = await campaignService.statusForUser(campaign.slug, user._id, 0);

    expect(status.eligible).toBe(false);
    expect(status.reason).toBe(CAMPAIGN_REASON.ALREADY_USED);
    // The stable key every display surface branches on — the ribbon, the product badge,
    // the cart notice and the add-to-cart congratulation all hide on exactly this.
    expect(status.reasonCode).toBe('already_used');
  });

  it('is given no coupon code to auto-apply', async () => {
    // The cart auto-applies whatever `couponCode` this returns. Handing it back to a
    // spent customer means a failed apply on every cart render.
    const { campaign, user } = await redeemOnce('USEDVIS2');
    const status = await campaignService.statusForUser(campaign.slug, user._id, 0);
    expect(status.couponCode).toBeNull();
  });

  it('agrees with what the pricing engine would actually charge', async () => {
    /* The bug in one line: display said eligible, pricing said already used. Whatever
       else changes, these two must not disagree — that gap is what let the site promise
       a discount checkout refuses. */
    const { user, product } = await redeemOnce('USEDVIS3');

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: 'USEDVIS3',
      userId: user._id,
    });

    expect(quote.couponError).toBe(CAMPAIGN_REASON.ALREADY_USED);
    expect(quote.couponDiscount).toBe(0);
  });

  it('still reports a fresh customer as eligible', async () => {
    // The gate must not swallow everyone: a different account is untouched.
    const { campaign } = await redeemOnce('USEDVIS4');
    const fresh = await seedUser();

    const status = await campaignService.statusForUser(campaign.slug, fresh._id, 0);
    expect(status.eligible).toBe(true);
    expect(status.couponCode).toBe('USEDVIS4');
  });

  it('becomes eligible again if the redemption is released', async () => {
    /* Abandoned checkouts hand the reward back (sweepStaleCheckoutHolds). The display
       has to follow, or a customer who was given their reward back is still told they
       have used it. */
    const { campaign, user, product } = await redeemOnce('USEDVIS5');
    expect((await campaignService.statusForUser(campaign.slug, user._id, 0)).eligible).toBe(false);

    const { default: couponService } = await import('../services/couponService.js');
    const { default: Order } = await import('../models/Order.js');
    const order = await Order.findOne({ user: user._id }).lean();
    await couponService.releaseForOrder(order._id);

    const after = await campaignService.statusForUser(campaign.slug, user._id, 0);
    expect(after.eligible).toBe(true);
    expect(after.couponCode).toBe('USEDVIS5');

    // ...and it really prices again, not just displays.
    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }], couponCode: 'USEDVIS5', userId: user._id,
    });
    expect(quote.couponDiscount).toBe(400);
  });
});
