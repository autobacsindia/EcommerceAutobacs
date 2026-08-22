/**
 * Giving back what an abandoned checkout was holding.
 *
 * orderService reserves three things the moment an order is CREATED, before any money
 * moves: the coupon's global and per-user counters, the campaign's redemption slot, and
 * any karma points spent. That has to happen before payment — a guarded counter is the
 * only thing that stops two racing tabs both claiming the last slot.
 *
 * Cancel and refund give them back. Nothing gave them back when the customer simply
 * never paid, which on this store is roughly a quarter of every order created. The
 * customer was then told "you have already used this offer" for ever, having paid
 * nothing, and a capped campaign spent slots on orders that never existed.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';
import Order from '../models/Order.js';
import CouponRedemption from '../models/CouponRedemption.js';
import CouponUserUsage from '../models/CouponUserUsage.js';

import orderService from '../services/orderService.js';
import pricingService from '../services/pricingService.js';
import { sweepStaleCheckoutHolds } from '../services/leadSweepService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';

jest.setTimeout(120000);

let replset;
let seq = 0;

const ADDRESS = {
  fullName: 'A B', addressLine1: '1 Road', city: 'Kochi',
  state: 'Kerala', postalCode: '682001', country: 'India', phone: '9999999999',
};

const seedProduct = (price = 10000) => Product.create({
  name: `Prod ${++seq}`, slug: `prod-${seq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
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

/**
 * Push an order and its redemption row back in time, as an abandoned one would be.
 * Written through the raw driver: Mongoose marks `createdAt` immutable under
 * `timestamps: true` and silently drops the $set otherwise.
 */
async function ageBy(orderId, ms) {
  const when = new Date(Date.now() - ms);
  await Order.collection.updateOne({ _id: orderId }, { $set: { createdAt: when } });
  await CouponRedemption.collection.updateOne({ order: orderId }, { $set: { createdAt: when } });
}

const HOURS = 3600_000;

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

describe('sweepStaleCheckoutHolds', () => {
  it('gives an abandoned customer their reward back', async () => {
    await seedCampaign('ABANDON1');
    const product = await seedProduct();
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ABANDON1' },
    );

    // Before the sweep they are locked out of an offer they never actually used.
    const locked = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }], couponCode: 'ABANDON1', userId: user._id,
    });
    expect(locked.couponError).toMatch(/already/i);

    await ageBy(order._id, 3 * HOURS);
    const result = await sweepStaleCheckoutHolds();
    expect(result.released).toBe(1);

    const recovered = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }], couponCode: 'ABANDON1', userId: user._id,
    });
    expect(recovered.couponError).toBeNull();
    expect(recovered.couponDiscount).toBe(400);
  });

  it('returns the slot to the campaign cap', async () => {
    await seedCampaign('ABANDON2');
    const product = await seedProduct();
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ABANDON2' },
    );
    expect((await Campaign.findOne({ couponCode: 'ABANDON2' }).lean()).redeemedCount).toBe(1);

    await ageBy(order._id, 3 * HOURS);
    await sweepStaleCheckoutHolds();

    // Otherwise a capped public offer closes early on orders that were never orders.
    expect((await Campaign.findOne({ couponCode: 'ABANDON2' }).lean()).redeemedCount).toBe(0);
    expect((await Coupon.findOne({ code: 'ABANDON2' }).lean()).usedCount).toBe(0);
    // The per-user row stays (it is the unique doc two racing checkouts conflict on);
    // what matters is that its count came back down to zero.
    expect((await CouponUserUsage.findOne({}).lean()).count).toBe(0);
  });

  it('leaves a checkout still inside the window alone', async () => {
    await seedCampaign('ABANDON3');
    const product = await seedProduct();
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ABANDON3' },
    );

    // Someone mid-payment — fighting a bank OTP, retrying a UPI request — must keep it.
    await ageBy(order._id, 1 * HOURS);
    const result = await sweepStaleCheckoutHolds();

    expect(result.released).toBe(0);
    expect((await Campaign.findOne({ couponCode: 'ABANDON3' }).lean()).redeemedCount).toBe(1);
    expect(await CouponRedemption.countDocuments({})).toBe(1);
  });

  it('never touches an order that was actually paid', async () => {
    await seedCampaign('ABANDON4');
    const product = await seedProduct();
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ABANDON4' },
    );
    await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'paid', status: 'processing' } });

    await ageBy(order._id, 30 * HOURS);
    const result = await sweepStaleCheckoutHolds();

    expect(result.released).toBe(0);
    expect(result.skipped).toBe(1);
    expect((await Campaign.findOne({ couponCode: 'ABANDON4' }).lean()).redeemedCount).toBe(1);

    // And the customer stays held to one per person.
    const retry = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }], couponCode: 'ABANDON4', userId: user._id,
    });
    expect(retry.couponError).toMatch(/already/i);
  });

  it('is safe to run twice — it does not credit anything back a second time', async () => {
    await seedCampaign('ABANDON5');
    const product = await seedProduct();
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ABANDON5' },
    );
    await ageBy(order._id, 3 * HOURS);

    await sweepStaleCheckoutHolds();
    const second = await sweepStaleCheckoutHolds();

    expect(second.scanned).toBe(0);
    // A double-decrement would push a counter negative and let the cap overrun.
    expect((await Campaign.findOne({ couponCode: 'ABANDON5' }).lean()).redeemedCount).toBe(0);
    expect((await Coupon.findOne({ code: 'ABANDON5' }).lean()).usedCount).toBe(0);
  });

  it('closes the released order to payment, so the discount cannot be charged uncounted', async () => {
    await seedCampaign('ABANDON6');
    const product = await seedProduct();
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ABANDON6' },
    );
    await ageBy(order._id, 3 * HOURS);
    await sweepStaleCheckoutHolds();

    /* routes/razorpay.js refuses to mint a gateway order for a stamped one — without
       that gate the customer could pay the old total while the campaign's cap, now
       given back, records nothing. */
    const after = await Order.findById(order._id).lean();
    expect(after.holdsReleasedAt).toBeInstanceOf(Date);
    expect(after.status).toBe('awaiting_payment');   // fulfilment axis untouched
    expect(after.paymentStatus).toBe('pending');     // and CRM classification with it
  });

  it('releases holds stranded by a hard-deleted order', async () => {
    await seedCampaign('ABANDON7');
    const product = await seedProduct();
    const user = await seedUser();

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ABANDON7' },
    );
    await ageBy(order._id, 3 * HOURS);
    // The offline payment-link rollback path deletes an order outright.
    await Order.deleteOne({ _id: order._id });

    const result = await sweepStaleCheckoutHolds();

    expect(result.released).toBe(1);
    expect((await Campaign.findOne({ couponCode: 'ABANDON7' }).lean()).redeemedCount).toBe(0);
  });
});
