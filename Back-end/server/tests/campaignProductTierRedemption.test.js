/**
 * Does a product-tier campaign actually CONSUME a redemption when an order is placed?
 *
 * `maxRedemptions` is the only thing standing between a public QR offer and an
 * unbounded discount liability — the audience is 'everyone', so there is no allowlist
 * bounding it. campaignService refuses to publish an 'everyone' campaign without a cap
 * precisely because that cap is the budget stop.
 *
 * Enforcing it happens in orderService._applyCampaign, which runs only when the quote
 * reports `appliedCampaign`. This file pins that a per-product campaign reports it —
 * every other campaign test uses the cart-value ladder, so nothing else covers this.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';
import CampaignProductTier from '../models/CampaignProductTier.js';

import pricingService from '../services/pricingService.js';
import orderService from '../services/orderService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';

jest.setTimeout(120000);

let replset;
let seq = 0;

const seedProduct = (price) => Product.create({
  name: `Prod ${price} ${++seq}`, slug: `prod-${price}-${seq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
});

const seedUser = () =>
  User.create({ name: 'U', email: `u${++seq}${Date.now()}@x.com`, passwordHash: 'x', isVerified: true });

const ADDRESS = {
  fullName: 'A B', addressLine1: '1 Road', city: 'Kochi',
  state: 'Kerala', postalCode: '682001', country: 'India', phone: '9999999999',
};

async function seedCampaign({ code = 'FESTQR1', ...overrides } = {}) {
  const campaign = await Campaign.create({
    slug: `festive-qr-${++seq}`, name: 'Festive QR',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    requireVerifiedEmail: true,
    endsAt: new Date(Date.now() + 30 * 864e5),
    maxRedemptions: 2,
    productTiers: [
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

describe('product-tier campaign — redemption accounting', () => {
  it('reports appliedCampaign on the quote so checkout can consume a slot', async () => {
    const campaign = await seedCampaign({ code: 'FESTQRA' });
    const product = await seedProduct(10000);
    const user = await seedUser();

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: 'FESTQRA',
      userId: user._id,
    });

    expect(quote.couponDiscount).toBe(400);          // 4% default tier
    // Without this, orderService never calls _applyCampaign and the cap is dead.
    expect(quote.appliedCampaign).not.toBeNull();
    expect(quote.appliedCampaign.slug).toBe(campaign.slug);
  });

  it('increments redeemedCount when an order is placed', async () => {
    await seedCampaign({ code: 'FESTQRB' });
    const product = await seedProduct(10000);
    const user = await seedUser();

    await orderService.createOrder(
      user._id,
      [{ product: product._id, quantity: 1 }],
      ADDRESS,
      { couponCode: 'FESTQRB' },
    );

    const after = await Campaign.findOne({ couponCode: 'FESTQRB' }).lean();
    expect(after.redeemedCount).toBe(1);
  });

  it('refuses the order that would exceed maxRedemptions', async () => {
    await seedCampaign({ code: 'FESTQRC', maxRedemptions: 1 });
    const product = await seedProduct(10000);
    const first = await seedUser();
    const second = await seedUser();

    await orderService.createOrder(
      first._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'FESTQRC' },
    );

    // The cap is the budget stop for a public offer — the 2nd customer must be refused.
    await expect(
      orderService.createOrder(
        second._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'FESTQRC' },
      ),
    ).rejects.toThrow(/fully claimed|no longer|not available/i);

    const after = await Campaign.findOne({ couponCode: 'FESTQRC' }).lean();
    expect(after.redeemedCount).toBe(1);
  });

  it('does not let karma stack on top unless the campaign opts in', async () => {
    await seedCampaign({ code: 'FESTQRD' });
    const product = await seedProduct(10000);
    const user = await seedUser();

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: 'FESTQRD',
      redeemKarmaPoints: 500,
      userId: user._id,
    });

    expect(quote.karmaPointsUsed).toBe(0);
  });

  /*
    KNOWN BEHAVIOUR, pinned deliberately — not an aspiration.

    The per-customer counter and the campaign slot are both consumed at ORDER CREATION,
    while the order is still `awaiting_payment`. They are released only by an explicit
    transition to `cancelled` or `returned` (queue/workers/orderWorker.js), and nothing
    sweeps orders that are simply abandoned at the payment step. So a customer whose
    UPI times out has spent their one reward on an order that was never paid for, and
    the campaign has spent one of its 200 slots.

    Pinned because the fix — expiring stale `awaiting_payment` orders, which already
    triggers the release path — is an order-lifecycle change, and this test is what will
    tell whoever makes it that they changed this.
  */
  it('consumes the reward at order creation, before any payment is taken', async () => {
    await seedCampaign({ code: 'FESTQRE' });
    const product = await seedProduct(10000);
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'FESTQRE' },
    );
    expect(order.paymentStatus).toBe('pending');

    // Nothing was paid, yet a second attempt by the same customer is already refused.
    const retry = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: 'FESTQRE',
      userId: user._id,
    });
    expect(retry.couponDiscount).toBe(0);
    expect(retry.couponError).toMatch(/already/i);

    // And the campaign's budget is down one slot for an order that may never be paid.
    const after = await Campaign.findOne({ couponCode: 'FESTQRE' }).lean();
    expect(after.redeemedCount).toBe(1);
  });
});
