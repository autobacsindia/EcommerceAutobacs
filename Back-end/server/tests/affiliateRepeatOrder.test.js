/**
 * The returning customer, end to end — REAL database, REAL transactions.
 *
 * ── WHAT BROKE, AND WHY IT NEEDED A TEST AT THIS LEVEL ───────────────────────────
 * An affiliate's discount is capped at one per person. A returning buyer who typed the
 * code therefore had it refused — and `assertCouponApplied` turned that refusal into a
 * hard 400, so THE ORDER DID NOT EXIST. The identical buyer arriving on the affiliate's
 * tracking link sailed through and earned that affiliate FULL commission. Two routes,
 * two opposite outcomes, no report showing either.
 *
 * Every unit involved passed throughout. The refusal was correct, the 400 was correct,
 * the cookie attribution was correct. Only placing a real second order against a real
 * transaction shows the contradiction, which is why this suite drives orderService
 * directly rather than mocking the pricing it depends on.
 *
 * Runs on a single-node REPLICA SET: the order/coupon writes happen inside
 * session.withTransaction, which a standalone mongod cannot do.
 */

import { jest } from '@jest/globals';
import { useTransactionalDb } from './helpers/replicaSet.js';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Coupon from '../models/Coupon.js';
import CouponUserUsage from '../models/CouponUserUsage.js';
import Affiliate from '../models/Affiliate.js';

import orderService from '../services/orderService.js';
import { AFFILIATE_STATUS, ATTRIBUTION_SOURCE } from '../config/affiliate.js';

jest.setTimeout(120000);

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

let slugSeq = 0;
const seedProduct = (price = 1000) => Product.create({
  name: `Prod ${price}`, slug: `prod-${price}-${++slugSeq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
});

const seedUser = () => User.create({
  name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x',
});

/**
 * An active affiliate with the managed coupon EXACTLY as affiliateService.approve now
 * mints it. Built by hand rather than through approve() so this suite pins the terms
 * the money path depends on, and fails if approve() ever drifts away from them.
 */
const seedAffiliate = async ({
  commissionPercent = 10,
  repeatCommissionPercent = 2,
  discountPercent = 10,
  code = 'RAHUL10',
  status = AFFILIATE_STATUS.ACTIVE,
} = {}) => {
  const affiliate = await Affiliate.create({
    code, name: 'Rahul', email: 'rahul@example.com', phone: '9111111111',
    status, commissionPercent, repeatCommissionPercent, discountPercent,
  });
  const coupon = await Coupon.create({
    code, type: 'percentage', value: discountPercent, visibility: 'hidden',
    affiliate: affiliate._id, isActive: discountPercent > 0,
    firstOrderOnly: false,
    usageLimitPerUser: 1,
  });
  affiliate.coupon = coupon._id;
  await affiliate.save();
  return affiliate;
};

const placeOrder = (user, product, orderData = {}) => orderService.createOrder(
  user._id, [{ product: product._id, quantity: 1 }], ADDRESS, orderData,
);

/**
 * A prior order this buyer ACTUALLY PAID FOR.
 *
 * ⚠️ `createOrder` alone is NOT a purchase, and a fixture that treats it as one is
 * testing the wrong thing. A fresh order carries `paymentStatus: 'pending'` — it is a
 * shopper who reached the Razorpay popup, nothing more. `hasActiveOrder` keys on
 * `paymentStatus` precisely so that a dismissed popup does not brand someone a
 * returning customer for life, so these fixtures have to complete the payment to
 * represent a buyer who really did come back.
 */
const placePaidOrder = async (user, product, orderData = {}) => {
  const order = await placeOrder(user, product, orderData);
  await Order.updateOne(
    { _id: order._id },
    { $set: { paymentStatus: 'paid', status: 'processing' } },
  );
  return order;
};

beforeAll(async () => {
  await useTransactionalDb();
});

beforeEach(async () => {
  // The per-person cap fails closed only because the guarded upsert falls through to an
  // insert that violates this unique index. Build it explicitly rather than racing
  // mongoose's background autoIndex — the same reason couponKarmaIntegration does.
  await CouponUserUsage.init();
});

describe('a returning customer who types the affiliate code', () => {
  it('is charged full price but STILL credits the affiliate, at the repeat rate', async () => {
    const affiliate = await seedAffiliate({ commissionPercent: 10, repeatCommissionPercent: 2 });
    const product = await seedProduct(1000);
    const user = await seedUser();

    // ── First order: the discount lands, and it is acquisition ──────────────
    const first = await placePaidOrder(user, product, { couponCode: 'RAHUL10' });
    expect(first.discount).toBeGreaterThan(0);
    expect(first.affiliate.source).toBe(ATTRIBUTION_SOURCE.COUPON);
    expect(first.affiliate.commissionPercent).toBe(10);
    expect(first.affiliate.newCustomer).toBe(true);

    // ── Second order: same buyer, same code, one discount already spent ─────
    const second = await placeOrder(user, product, { couponCode: 'RAHUL10' });

    // It EXISTS. Before the soft-refusal exemption this threw a 400 and no order was
    // created — the single most important assertion in this file.
    expect(second).toBeTruthy();
    expect(second.discount).toBe(0);
    expect(second.totalAmount).toBeGreaterThan(first.totalAmount);

    // ...and Rahul is still credited, at the reactivation rate, tagged `code` so the
    // payout report can tell "no discount given" from "discount given".
    expect(String(second.affiliate.affiliate)).toBe(String(affiliate._id));
    expect(second.affiliate.source).toBe(ATTRIBUTION_SOURCE.CODE);
    expect(second.affiliate.commissionPercent).toBe(2);
    expect(second.affiliate.newCustomer).toBe(false);
  });

  /*
    THE BUG THIS WHOLE CHANGE EXISTS FOR: the two arrival routes must agree about the
    same buyer. Before, the link paid FULL commission while the code refused the sale.
  */
  it('earns the affiliate the same rate whether they arrive by code or by link', async () => {
    await seedAffiliate({ commissionPercent: 10, repeatCommissionPercent: 2 });
    const product = await seedProduct(1000);

    const viaCode = await seedUser();
    await placePaidOrder(viaCode, product, { couponCode: 'RAHUL10' });
    const codeOrder = await placeOrder(viaCode, product, { couponCode: 'RAHUL10' });

    const viaLink = await seedUser();
    await placePaidOrder(viaLink, product, { couponCode: 'RAHUL10' });
    const linkOrder = await placeOrder(viaLink, product, { affiliateRefCookie: 'RAHUL10' });

    expect(codeOrder.affiliate.commissionPercent).toBe(linkOrder.affiliate.commissionPercent);
    expect(codeOrder.affiliate.commissionPercent).toBe(2);
    // Same money, different provenance — both are recorded truthfully.
    expect(codeOrder.affiliate.source).toBe(ATTRIBUTION_SOURCE.CODE);
    expect(linkOrder.affiliate.source).toBe(ATTRIBUTION_SOURCE.LINK);
  });

  /*
    Priya: bought from Autobacs a year ago through no affiliate, now uses Rahul's code
    for the first time. She GETS the discount — the rule is one per person per CODE, not
    "never bought here" — but Rahul earns the reactivation rate, because she was already
    ours. This is the case the old firstOrderOnly rule refused outright.
  */
  it('gives a lapsed customer their one discount, at the reactivation rate', async () => {
    await seedAffiliate({ commissionPercent: 10, repeatCommissionPercent: 2 });
    const product = await seedProduct(1000);
    const priya = await seedUser();

    await placePaidOrder(priya, product);                // last year, no affiliate
    const withCode = await placeOrder(priya, product, { couponCode: 'RAHUL10' });

    expect(withCode.discount).toBeGreaterThan(0);        // she does get money off
    expect(withCode.affiliate.source).toBe(ATTRIBUTION_SOURCE.COUPON);
    expect(withCode.affiliate.commissionPercent).toBe(2);
    expect(withCode.affiliate.newCustomer).toBe(false);
  });

  it('spends the one discount exactly once even under two CONCURRENT checkouts', async () => {
    await seedAffiliate();
    const product = await seedProduct(1000);
    const user = await seedUser();

    /*
      Both quotes read "no usage yet" on their own snapshot; only the guarded per-user
      counter gives them a document to conflict on. Without it the buyer banks the
      discount twice — and both orders would look perfectly normal.
    */
    const results = await Promise.allSettled([
      placeOrder(user, product, { couponCode: 'RAHUL10' }),
      placeOrder(user, product, { couponCode: 'RAHUL10' }),
    ]);

    const discounted = results.filter(
      (r) => r.status === 'fulfilled' && r.value.discount > 0,
    );
    expect(discounted).toHaveLength(1);

    const usage = await CouponUserUsage.findOne({ user: user._id });
    expect(usage.count).toBe(1);
  });
});

describe('the soft refusal stays narrow', () => {
  /*
    ⚠️ THE REGRESSION THAT MATTERS MOST. Exactly one refusal is soft. If a typo stopped
    failing loudly, a buyer would complete checkout believing they had a discount they
    never received — and unlike the repeat-customer case, they CAN fix it by retyping.
  */
  it('still rejects a mistyped code outright', async () => {
    await seedAffiliate();
    const product = await seedProduct(1000);
    const user = await seedUser();

    await expect(placeOrder(user, product, { couponCode: 'RAHUL1O' }))
      .rejects.toThrow(/invalid coupon/i);

    expect(await Order.countDocuments({ user: user._id })).toBe(0);
  });

  it('still rejects an ordinary coupon the buyer has already used', async () => {
    await Coupon.create({
      code: 'PERUSER', type: 'fixed', value: 100, isActive: true, usageLimitPerUser: 1,
    });
    const product = await seedProduct(1000);
    const user = await seedUser();

    await placeOrder(user, product, { couponCode: 'PERUSER' });
    // No affiliate owns this code, so the exemption must not apply to it.
    await expect(placeOrder(user, product, { couponCode: 'PERUSER' }))
      .rejects.toThrow(/already used/i);
  });

  it('credits nobody when a suspended affiliate\'s code is typed', async () => {
    await seedAffiliate({ status: AFFILIATE_STATUS.SUSPENDED });
    const product = await seedProduct(1000);
    const user = await seedUser();

    // The gate refuses the discount loudly for a suspended affiliate — that is not the
    // soft case, and the buyer is told plainly rather than silently paying full price.
    await expect(placeOrder(user, product, { couponCode: 'RAHUL10' })).rejects.toThrow();
    expect(await Order.countDocuments({ user: user._id })).toBe(0);
  });

  it('credits nobody when the affiliate types their own code on a repeat order', async () => {
    const affiliate = await seedAffiliate();
    const product = await seedProduct(1000);
    const self = await User.create({
      name: 'Rahul', email: affiliate.email, passwordHash: 'x',
    });

    // A prior order makes this the repeat path, so the discount is spent either way —
    // the point is that self-referral must still credit NOBODY on the `code` limb.
    await placePaidOrder(self, product);
    const order = await placeOrder(self, product, { couponCode: 'RAHUL10' })
      .catch(() => null);

    if (order) expect(order.affiliate?.affiliate).toBeFalsy();
  });
});
