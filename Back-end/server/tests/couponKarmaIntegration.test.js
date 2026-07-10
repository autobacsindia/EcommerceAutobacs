/**
 * Coupon + Karma integration tests — REAL database, REAL transactions.
 *
 * The shared tests/setup.js connects to a standalone in-memory MongoDB, which can't
 * run multi-document transactions. The order/coupon/karma writes all happen inside
 * session.withTransaction, so this suite spins up its own single-node REPLICA SET
 * (transactions require one) and drives the services directly against seeded models —
 * verifying the money-critical paths the mocked unit tests can't: persisted order
 * totals, the atomic coupon/karma guards, earn-on-delivery, and reversals.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import CouponUserUsage from '../models/CouponUserUsage.js';
import LoyaltyConfig from '../models/LoyaltyConfig.js';
import KarmaLedger from '../models/KarmaLedger.js';

import orderService from '../services/orderService.js';
import karmaService from '../services/karmaService.js';
import couponService from '../services/couponService.js';
import userRepository from '../repositories/userRepository.js';
import { invalidateLoyaltyConfig } from '../services/loyaltyConfigService.js';

jest.setTimeout(120000);

let replset;

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

let slugSeq = 0;
async function seedProduct(price) {
  return Product.create({
    name: `Prod ${price}`, slug: `prod-${price}-${++slugSeq}`, description: 'Test product',
    price, stock: 'in', brand: 'B', isActive: true,
  });
}
async function seedUser(karmaPoints = 0) {
  return User.create({ name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x', karmaPoints });
}
async function setConfig(cfg) {
  await LoyaltyConfig.findOneAndUpdate({ key: 'default' }, { $set: cfg }, { upsert: true, new: true, setDefaultsOnInsert: true });
  invalidateLoyaltyConfig();
}

beforeAll(async () => {
  // Replace the standalone connection from setup.js with a replica-set one.
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

beforeEach(async () => {
  // setup.js's afterEach clears collections; re-seed a default config + clear cache.
  await setConfig({ enabled: true, earnRatePercent: 2, pointValueInRupees: 1, redeemMaxPercent: 20, minRedeemPoints: 100, pointsExpiryDays: null });
});

describe('Order creation with coupon + karma (real transaction)', () => {
  it('persists the full discount breakdown and ledger/redemption rows', async () => {
    const product = await seedProduct(10000);
    const user = await seedUser(5000);
    await Coupon.create({ code: 'TEN', type: 'percentage', value: 10, isActive: true });

    const order = await orderService.createOrder(
      user._id,
      [{ product: product._id, quantity: 1 }],
      ADDRESS,
      { couponCode: 'TEN', redeemKarmaPoints: 5000, shippingCost: 0 },
    );

    // coupon: 10% of 10000 = 1000 → after-coupon 9000; karma cap 20% of 9000 = 1800
    expect(order.subtotal).toBe(10000);
    expect(order.couponDiscount).toBe(1000);
    expect(order.karmaPointsUsed).toBe(1800);
    expect(order.karmaDiscount).toBe(1800);
    expect(order.discount).toBe(2800);
    expect(order.totalAmount).toBe(7200);

    const redemption = await CouponRedemption.findOne({ order: order._id });
    expect(redemption).toBeTruthy();
    expect(redemption.discountAmount).toBe(1000);

    const coupon = await Coupon.findOne({ code: 'TEN' });
    expect(coupon.usedCount).toBe(1);

    const fresh = await User.findById(user._id);
    expect(fresh.karmaPoints).toBe(3200); // 5000 − 1800

    const ledger = await KarmaLedger.findOne({ order: order._id, type: 'redeem' });
    expect(ledger.points).toBe(-1800);
    expect(ledger.balanceAfter).toBe(3200);
  });

  it('rejects an invalid coupon at order time', async () => {
    const product = await seedProduct(1000);
    const user = await seedUser(0);
    await expect(orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'NOPE' },
    )).rejects.toThrow(/invalid coupon/i);
  });
});

describe('Concurrency guards', () => {
  it('a usageLimit=1 coupon can only be redeemed once', async () => {
    const product = await seedProduct(1000);
    const u1 = await seedUser(0);
    const u2 = await seedUser(0);
    await Coupon.create({ code: 'ONCE', type: 'fixed', value: 100, isActive: true, usageLimit: 1 });

    await orderService.createOrder(u1._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ONCE' });
    await expect(orderService.createOrder(
      u2._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'ONCE' },
    )).rejects.toThrow(/usage limit/i);

    const coupon = await Coupon.findOne({ code: 'ONCE' });
    expect(coupon.usedCount).toBe(1); // never oversold
  });

  // Both of these depend on the unique {coupon,user} index: the guarded upsert only
  // fails closed because the insert it falls through to violates that index. Build it
  // explicitly rather than racing mongoose's background autoIndex.
  it('a usageLimitPerUser=1 coupon cannot be redeemed twice by the same user', async () => {
    await CouponUserUsage.init();
    const product = await seedProduct(1000);
    const user = await seedUser(0);
    await Coupon.create({ code: 'PERUSER', type: 'fixed', value: 100, isActive: true, usageLimitPerUser: 1 });

    await orderService.createOrder(user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'PERUSER' });
    await expect(orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'PERUSER' },
    )).rejects.toThrow(/already used/i);

    const usage = await CouponUserUsage.findOne({ user: user._id });
    expect(usage.count).toBe(1);
  });

  it('a firstOrderOnly coupon survives two CONCURRENT orders by the same user', async () => {
    await CouponUserUsage.init();
    const product = await seedProduct(1000);
    const user = await seedUser(0);
    await Coupon.create({ code: 'FIRST', type: 'fixed', value: 100, isActive: true, firstOrderOnly: true });

    // Both quotes read zero prior orders on their own snapshot; only the guarded
    // per-user counter can serialize them. Before that guard existed, both committed
    // and the user banked the first-order discount twice.
    const results = await Promise.allSettled([
      orderService.createOrder(user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'FIRST' }),
      orderService.createOrder(user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: 'FIRST' }),
    ]);

    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
    expect(await CouponRedemption.countDocuments({ code: 'FIRST' })).toBe(1);
    const coupon = await Coupon.findOne({ code: 'FIRST' });
    expect(coupon.usedCount).toBe(1);
  });

  it('guarded karma debit prevents concurrent overdraw', async () => {
    const user = await seedUser(100);
    // Two concurrent debits of the full balance — exactly one must win.
    const results = await Promise.allSettled([
      userRepository.debitKarmaGuarded(user._id, 100, undefined),
      userRepository.debitKarmaGuarded(user._id, 100, undefined),
    ]);
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value);
    expect(succeeded.length).toBe(1);
    const fresh = await User.findById(user._id);
    expect(fresh.karmaPoints).toBe(0); // never negative
  });
});

describe('Earn on delivery', () => {
  it('credits earned karma once and is idempotent on retry', async () => {
    const product = await seedProduct(5000);
    const user = await seedUser(0);
    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, {},
    );
    await Order.updateOne({ _id: order._id }, { status: 'delivered' });

    const first = await karmaService.awardForDelivery(order._id.toString());
    expect(first.awarded).toBe(100); // 2% of 5000, 1pt=₹1

    const second = await karmaService.awardForDelivery(order._id.toString());
    expect(second.awarded).toBe(0); // idempotent

    const fresh = await User.findById(user._id);
    expect(fresh.karmaPoints).toBe(100);
    expect(await KarmaLedger.countDocuments({ order: order._id, type: 'earn' })).toBe(1);
  });
});

describe('Cancellation reversal', () => {
  it('releases the coupon and restores redeemed karma', async () => {
    const product = await seedProduct(10000);
    const user = await seedUser(5000);
    await Coupon.create({ code: 'BACK', type: 'percentage', value: 10, isActive: true });

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: 'BACK', redeemKarmaPoints: 1000 },
    );
    expect((await User.findById(user._id)).karmaPoints).toBe(4000); // 5000 − 1000

    await couponService.releaseForOrder(order._id);
    await karmaService.reverseRedemption(order._id.toString());

    expect((await Coupon.findOne({ code: 'BACK' })).usedCount).toBe(0);
    expect(await CouponRedemption.findOne({ order: order._id })).toBeNull();
    expect((await User.findById(user._id)).karmaPoints).toBe(5000); // restored

    const reversal = await KarmaLedger.findOne({ order: order._id, type: 'reverse', points: { $gt: 0 } });
    expect(reversal.points).toBe(1000);
  });
});
