/**
 * Campaign engine integration tests — REAL database, REAL transactions.
 *
 * The campaign gate sits on the money path, so the cases that matter are the ones a
 * happy-path smoke test misses: an uninvited shopper who knows the code, an invited
 * customer who never confirmed their email, two simultaneous checkouts racing for the
 * last redemption slot, and a refund that must hand the slot back.
 *
 * Like couponKarmaIntegration.test.js this spins up its own single-node REPLICA SET,
 * because the order writes run inside session.withTransaction and a standalone
 * in-memory Mongo cannot do transactions.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import Campaign from '../models/Campaign.js';
import CampaignMember from '../models/CampaignMember.js';
import LoyaltyConfig from '../models/LoyaltyConfig.js';

import orderService from '../services/orderService.js';
import couponService from '../services/couponService.js';
import campaignService from '../services/campaignService.js';
import pricingService from '../services/pricingService.js';
import { invalidateLoyaltyConfig } from '../services/loyaltyConfigService.js';
import {
  CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE, CAMPAIGN_REASON, CAMPAIGN_MEMBER_STATUS,
} from '../config/campaign.js';

jest.setTimeout(120000);


const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

const CODE = 'FESTIVE2026';

let seq = 0;
const seedProduct = (price) => Product.create({
  name: `Prod ${price}`, slug: `prod-${price}-${++seq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
});

const seedUser = ({ email, isVerified = true, mustResetPassword = false } = {}) => User.create({
  name: 'U', email: email || `u${++seq}${Date.now()}@x.com`, passwordHash: 'x',
  isVerified, mustResetPassword,
});

/**
 * The live festival configuration: 20% capped at ₹20,000, or 10% uncapped above ₹1 lakh,
 * best-for-customer, one redemption each, ₹50,000 absolute ceiling.
 */
async function seedCampaign(overrides = {}) {
  const campaign = await Campaign.create({
    slug: `festive-${++seq}`,
    name: 'Festive 2026',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.LIST,
    requireVerifiedEmail: true,
    endsAt: new Date(Date.now() + 7 * 864e5),
    couponCode: CODE,
    resolution: 'best',
    maxDiscountPerOrder: 50000,
    tiers: [
      { id: 'festive20', label: 'Festive 20', minCartValue: 0, percent: 20, maxDiscount: 20000 },
      { id: 'grand10', label: 'Grand 10', minCartValue: 100000, percent: 10, maxDiscount: null },
    ],
    ...overrides,
  });
  // The managed coupon: hidden so it never appears in the public offers list, and
  // limited to one use per customer — the atomic enforcement point.
  await Coupon.create({
    code: CODE, type: 'percentage', value: 0, isActive: true,
    visibility: 'hidden', usageLimitPerUser: 1, campaign: campaign._id,
  });
  return campaign;
}

const invite = (campaign, email, name = 'Invitee') =>
  CampaignMember.create({ campaign: campaign._id, email: email.toLowerCase(), name });

const quoteFor = (userId, product) => pricingService.computeQuote({
  items: [{ product: product._id, quantity: 1 }],
  couponCode: CODE, userId, shippingCost: 0,
});

beforeAll(async () => {
  await useTransactionalDb();
  // The unique {coupon,user} index is what enforces one-redemption-per-customer, and
  // autoIndex does not run here. Without it the concurrency test would pass vacuously.
  await ensureCampaignIndexes();
});

async function ensureCampaignIndexes() {
  await mongoose.connection.db
    .collection('couponuserusages')
    .createIndex({ coupon: 1, user: 1 }, { unique: true });
  await mongoose.connection.db
    .collection('campaignmembers')
    .createIndex({ campaign: 1, email: 1 }, { unique: true });
}


beforeEach(async () => {
  await LoyaltyConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: { enabled: false, earnRatePercent: 0, pointValueInRupees: 1, redeemMaxPercent: 20, minRedeemPoints: 100, pointsExpiryDays: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  invalidateLoyaltyConfig();
  // Recreate indexes dropped by setup.js's per-test collection clearing.
  await ensureCampaignIndexes();
});

describe('eligibility gate', () => {
  it('prices the tier discount for an invited, verified customer', async () => {
    const product = await seedProduct(50000);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'invited@x.com' });
    await invite(campaign, 'invited@x.com');

    const quote = await quoteFor(user._id, product);

    expect(quote.couponError).toBeNull();
    expect(quote.couponDiscount).toBe(10000);        // 20% of ₹50,000
    expect(quote.totalAmount).toBe(40000);
    expect(quote.appliedCampaign).toMatchObject({ tierId: 'festive20', percent: 20 });
  });

  it('refuses a shopper who is not on the list, even with the exact code', async () => {
    // The QR is printed on 200 cards and will be shared; the allowlist, not the code,
    // is the security boundary. A stranger typing FESTIVE2026 must get nothing.
    const product = await seedProduct(50000);
    await seedCampaign();
    const stranger = await seedUser({ email: 'stranger@x.com' });

    const quote = await quoteFor(stranger._id, product);

    expect(quote.couponError).toBe(CAMPAIGN_REASON.NOT_INVITED);
    expect(quote.couponDiscount).toBe(0);
    expect(quote.totalAmount).toBe(50000);
  });

  it('refuses an invited customer who has not confirmed their email', async () => {
    // Registration creates accounts with isVerified:false and login does not gate on
    // it, so without this check anyone who guessed an invited address could register
    // it and take the offer without ever opening that inbox.
    const product = await seedProduct(50000);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'unconfirmed@x.com', isVerified: false });
    await invite(campaign, 'unconfirmed@x.com');

    const quote = await quoteFor(user._id, product);

    expect(quote.couponError).toBe(CAMPAIGN_REASON.UNVERIFIED);
    expect(quote.couponDiscount).toBe(0);
  });

  it('gives nothing to a logged-out visitor', async () => {
    const product = await seedProduct(50000);
    await seedCampaign();

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }], couponCode: CODE, userId: null, shippingCost: 0,
    });

    expect(quote.couponError).toBe(CAMPAIGN_REASON.LOGIN);
    expect(quote.couponDiscount).toBe(0);
  });

  it('respects the off switch, the date window, and the redemption cap', async () => {
    const product = await seedProduct(50000);

    for (const [overrides, expected] of [
      [{ status: CAMPAIGN_STATUS.OFF }, CAMPAIGN_REASON.INACTIVE],
      [{ status: CAMPAIGN_STATUS.DRAFT }, CAMPAIGN_REASON.INACTIVE],
      [{ startsAt: new Date(Date.now() + 864e5) }, CAMPAIGN_REASON.NOT_STARTED],
      [{ endsAt: new Date(Date.now() - 864e5) }, CAMPAIGN_REASON.ENDED],
      [{ maxRedemptions: 5, redeemedCount: 5 }, CAMPAIGN_REASON.EXHAUSTED],
    ]) {
      await Coupon.deleteMany({});
      await Campaign.deleteMany({});
      await CampaignMember.deleteMany({});
      const campaign = await seedCampaign(overrides);
      const user = await seedUser({ email: `gate${++seq}@x.com` });
      await invite(campaign, user.email);

      const quote = await quoteFor(user._id, product);
      expect(quote.couponError).toBe(expected);
      expect(quote.couponDiscount).toBe(0);
    }
  });

  it('in testing mode applies only to listed testers', async () => {
    const product = await seedProduct(50000);
    const campaign = await seedCampaign({
      status: CAMPAIGN_STATUS.TESTING,
      testerEmails: ['tester@x.com'],
    });
    const tester = await seedUser({ email: 'tester@x.com' });
    const customer = await seedUser({ email: 'realcustomer@x.com' });
    await invite(campaign, 'tester@x.com');
    await invite(campaign, 'realcustomer@x.com');

    expect((await quoteFor(tester._id, product)).couponDiscount).toBe(10000);
    expect((await quoteFor(customer._id, product)).couponError).toBe(CAMPAIGN_REASON.TESTING);
  });

  it('applies to any verified customer when the audience is everyone', async () => {
    const product = await seedProduct(50000);
    await seedCampaign({ audience: CAMPAIGN_AUDIENCE.EVERYONE, maxRedemptions: 100 });
    const anyone = await seedUser({ email: 'anyone@x.com' });

    const quote = await quoteFor(anyone._id, product);
    expect(quote.couponDiscount).toBe(10000);
  });
});

describe('eligibility is independent of cart value (regression)', () => {
  // The banner and the landing page both ask about a cart worth nothing. Returning
  // "not eligible" for a zero cart made the site-wide ribbon and the landing page's
  // success panel invisible to every customer, while a ?cartValue=50000 probe passed —
  // which is exactly why this is pinned at zero.
  it('reports an invited customer as eligible with an EMPTY cart', async () => {
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'empty@x.com' });
    await invite(campaign, 'empty@x.com');

    const status = await campaignService.statusForUser(campaign.slug, user._id, 0);

    expect(status.eligible).toBe(true);
    expect(status.reason).toBeNull();
    expect(status.couponCode).toBe(CODE);   // the cart can auto-apply it
    expect(status.tier).toBeNull();         // but no tier is earned yet
  });

  it('still reports an uninvited customer as ineligible with an empty cart', async () => {
    const campaign = await seedCampaign();
    const stranger = await seedUser({ email: 'stranger2@x.com' });

    const status = await campaignService.statusForUser(campaign.slug, stranger._id, 0);
    expect(status.eligible).toBe(false);
    expect(status.reason).toBe(CAMPAIGN_REASON.NOT_INVITED);
    expect(status.couponCode).toBeNull();
  });

  it('claims the invite on eligibility alone, before anything is added', async () => {
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'earlyclaim@x.com' });
    await invite(campaign, 'earlyclaim@x.com');

    await campaignService.statusForUser(campaign.slug, user._id, 0);

    const member = await CampaignMember.findOne({ campaign: campaign._id, email: 'earlyclaim@x.com' });
    expect(member.status).toBe(CAMPAIGN_MEMBER_STATUS.CLAIMED);
  });

  it('still refuses to PRICE a zero-value cart', async () => {
    // Eligible, but there is no discount to apply — a distinct outcome.
    const product = await seedProduct(50000);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'pricezero@x.com' });
    await invite(campaign, 'pricezero@x.com');

    const evaluated = await campaignService.evaluate(campaign, user._id, 0);
    expect(evaluated.reason).toBeUndefined();
    expect(evaluated.tier).toBeNull();

    // And a real cart still prices normally.
    expect((await quoteFor(user._id, product)).couponDiscount).toBe(10000);
  });
});

describe('checkEmail disclosure limits', () => {
  it('does not reveal account state or a name for an "everyone" campaign', async () => {
    // With no allowlist there is nothing this public route can legitimately say about a
    // specific address. Probing the account would make it an existence-and-name oracle
    // for any email.
    const campaign = await seedCampaign({ audience: CAMPAIGN_AUDIENCE.EVERYONE, maxRedemptions: 50 });
    await seedUser({ email: 'realperson@x.com', isVerified: true, mustResetPassword: true });

    const res = await campaignService.checkEmail(campaign.slug, 'realperson@x.com');

    expect(res.name).toBeNull();
    expect(res.action).toBe('login');          // generic, not 'set_password'
  });

  it('still routes an invited customer on a list campaign', async () => {
    const campaign = await seedCampaign();
    await seedUser({ email: 'listed@x.com', isVerified: true, mustResetPassword: true });
    await invite(campaign, 'listed@x.com', 'Listed Person');

    const res = await campaignService.checkEmail(campaign.slug, 'listed@x.com');
    expect(res).toMatchObject({ onList: true, action: 'set_password', name: 'Listed Person' });
  });
});

describe('assertPublishable validates the managed coupon', () => {
  // pricingService only applies the eligibility gate when coupon.campaign is set. An
  // unlinked coupon is priced as an ORDINARY coupon at its own static value — so a
  // mislinked code either silently gives nothing or hands its percentage to every
  // shopper with no allowlist and no per-customer limit.
  it('refuses to go live when the coupon does not exist', async () => {
    const campaign = await seedCampaign({ status: CAMPAIGN_STATUS.DRAFT });
    await Coupon.deleteMany({ code: CODE });

    await expect(campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE))
      .rejects.toThrow(/does not exist/i);
  });

  it('refuses to go live when the coupon is not linked back to the campaign', async () => {
    const campaign = await seedCampaign({ status: CAMPAIGN_STATUS.DRAFT });
    await Coupon.updateOne({ code: CODE }, { $set: { campaign: null, value: 20 } });

    await expect(campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE))
      .rejects.toThrow(/not linked to this campaign/i);
  });

  it('refuses a publicly visible coupon, or one without a per-user limit of 1', async () => {
    const campaign = await seedCampaign({ status: CAMPAIGN_STATUS.DRAFT });

    await Coupon.updateOne({ code: CODE }, { $set: { visibility: 'public' } });
    await expect(campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE))
      .rejects.toThrow(/must be hidden/i);

    await Coupon.updateOne({ code: CODE }, { $set: { visibility: 'hidden', usageLimitPerUser: null } });
    await expect(campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE))
      .rejects.toThrow(/per-user limit of 1/i);
  });

  it('goes live when the coupon is correctly wired', async () => {
    const campaign = await seedCampaign({ status: CAMPAIGN_STATUS.DRAFT });
    const updated = await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    expect(updated.status).toBe(CAMPAIGN_STATUS.LIVE);
  });
});

describe('deliberate bracket ladders', () => {
  it('are rejected by default but allowed with an explicit opt-out', async () => {
    // The previous error told the operator to switch to "window", which also failed
    // this check — leaving no way to express intended brackets at all.
    const bracket = {
      slug: 'brackets', name: 'Brackets', couponCode: 'BRACKETS',
      endsAt: new Date(Date.now() + 864e5), resolution: 'window',
      tiers: [
        { id: 'a', minCartValue: 0, maxCartValue: 100000, percent: 20 },
        { id: 'b', minCartValue: 100000, maxCartValue: null, percent: 10 },
      ],
    };

    await expect(campaignService.create(bracket)).rejects.toThrow(/allowNonMonotonicTiers/i);

    const created = await campaignService.create({ ...bracket, allowNonMonotonicTiers: true });
    expect(created.allowNonMonotonicTiers).toBe(true);
    expect(created.tiers).toHaveLength(2);
  });
});

describe('redemption recording is robust', () => {
  it('records the redemption even when the invite was never claimed', async () => {
    // `member.user` is only set by the eligibility endpoint. A buyer can reach checkout
    // without that ever firing, and the redemption would then match no member row —
    // leaving the funnel showing them as never having claimed, and ₹0 given away.
    const product = await seedProduct(50000);
    const campaign = await seedCampaign({ maxRedemptions: 10 });
    const user = await seedUser({ email: 'neverclaimed@x.com' });
    await invite(campaign, 'neverclaimed@x.com');

    const before = await CampaignMember.findOne({ campaign: campaign._id, email: 'neverclaimed@x.com' });
    expect(before.user).toBeNull();          // deliberately unclaimed

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    );

    const after = await CampaignMember.findOne({ campaign: campaign._id, email: 'neverclaimed@x.com' });
    expect(after.status).toBe(CAMPAIGN_MEMBER_STATUS.REDEEMED);
    expect(after.discountRupees).toBe(10000);
    expect(String(after.redeemedOrder)).toBe(String(order._id));
    expect(String(after.user)).toBe(String(user._id));   // backfilled
  });
});

describe('tier pricing through the real money path', () => {
  it.each([
    [50000, 10000],
    [100000, 20000],   // 20% hits its ₹20,000 cap
    [150000, 20000],   // holds flat instead of dropping to 10%
    [300000, 30000],   // 10% overtakes the cap
    [800000, 50000],   // absolute per-order ceiling bites
  ])('a ₹%s cart is discounted ₹%s', async (price, expected) => {
    await Coupon.deleteMany({});
    await Campaign.deleteMany({});
    const product = await seedProduct(price);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: `tier${++seq}@x.com` });
    await invite(campaign, user.email);

    const quote = await quoteFor(user._id, product);
    expect(quote.couponDiscount).toBe(expected);
  });

  it('ignores the managed coupon\'s own static value', async () => {
    // The coupon is seeded with value:0. If the campaign hook were bypassed the buyer
    // would silently get ₹0 off, which is the failure mode that looks like "the offer
    // just doesn't work" rather than an error.
    const product = await seedProduct(50000);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'static@x.com' });
    await invite(campaign, user.email);

    expect((await quoteFor(user._id, product)).couponDiscount).toBe(10000);
  });

  it('suppresses karma stacking unless the campaign opts in', async () => {
    await LoyaltyConfig.findOneAndUpdate(
      { key: 'default' },
      { $set: { enabled: true, pointValueInRupees: 1, redeemMaxPercent: 20, minRedeemPoints: 100 } },
      { upsert: true, new: true },
    );
    invalidateLoyaltyConfig();

    const product = await seedProduct(50000);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'karma@x.com' });
    await User.updateOne({ _id: user._id }, { karmaPoints: 5000 });
    await invite(campaign, user.email);

    const blocked = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: CODE, userId: user._id, redeemKarmaPoints: 5000, shippingCost: 0,
    });
    expect(blocked.karmaPointsUsed).toBe(0);
    expect(blocked.karmaDiscount).toBe(0);

    await Campaign.updateOne({ _id: campaign._id }, { allowKarmaStacking: true });
    const allowed = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: CODE, userId: user._id, redeemKarmaPoints: 5000, shippingCost: 0,
    });
    expect(allowed.karmaPointsUsed).toBeGreaterThan(0);
  });
});

describe('redemption — once per customer, and the budget cap', () => {
  it('records the order, the campaign counter, and the member row', async () => {
    const product = await seedProduct(50000);
    const campaign = await seedCampaign({ maxRedemptions: 200 });
    const user = await seedUser({ email: 'buyer@x.com' });
    await invite(campaign, 'buyer@x.com');
    await campaignService.claim(campaign._id, 'buyer@x.com', user._id);

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    );

    expect(order.couponDiscount).toBe(10000);
    expect(order.discount).toBe(10000);
    expect(order.totalAmount).toBe(40000);
    expect(order.couponCode).toBe(CODE);

    const fresh = await Campaign.findById(campaign._id);
    expect(fresh.redeemedCount).toBe(1);
    expect(fresh.discountGivenRupees).toBe(10000);

    const member = await CampaignMember.findOne({ campaign: campaign._id, user: user._id });
    expect(member.status).toBe(CAMPAIGN_MEMBER_STATUS.REDEEMED);
    expect(member.discountRupees).toBe(10000);
    expect(String(member.redeemedOrder)).toBe(String(order._id));
  });

  it('refuses a second discounted order from the same customer', async () => {
    const product = await seedProduct(50000);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'twice@x.com' });
    await invite(campaign, 'twice@x.com');

    await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    );

    await expect(orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    )).rejects.toThrow(/already used/i);

    expect((await Campaign.findById(campaign._id)).redeemedCount).toBe(1);
  });

  it('yields exactly ONE redemption when two checkouts run concurrently', async () => {
    // A double-clicked Pay button, or two tabs. The per-user counter's guarded upsert
    // against a unique index is what serialises these; a status-field check would let
    // both through and give one customer two discounted orders.
    const product = await seedProduct(50000);
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'race@x.com' });
    await invite(campaign, 'race@x.com');

    const attempt = () => orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    );
    const results = await Promise.allSettled([attempt(), attempt()]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await Campaign.findById(campaign._id)).redeemedCount).toBe(1);
    expect(await CouponRedemption.countDocuments({})).toBe(1);
  });

  it('stops at the global redemption cap', async () => {
    const product = await seedProduct(50000);
    const campaign = await seedCampaign({ maxRedemptions: 1 });
    const first = await seedUser({ email: 'first@x.com' });
    const second = await seedUser({ email: 'second@x.com' });
    await invite(campaign, 'first@x.com');
    await invite(campaign, 'second@x.com');

    await orderService.createOrder(
      first._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    );

    // The cap is now full: the second customer is refused at quote time.
    const quote = await quoteFor(second._id, product);
    expect(quote.couponError).toBe(CAMPAIGN_REASON.EXHAUSTED);

    await expect(orderService.createOrder(
      second._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    )).rejects.toThrow();

    expect((await Campaign.findById(campaign._id)).redeemedCount).toBe(1);
  });
});

describe('release on cancel / refund', () => {
  it('returns the campaign slot and the customer\'s one use', async () => {
    // A cancelled order must not permanently consume a redemption the customer never
    // received, or the cap drifts down and the campaign closes early.
    const product = await seedProduct(50000);
    const campaign = await seedCampaign({ maxRedemptions: 10 });
    const user = await seedUser({ email: 'refund@x.com' });
    await invite(campaign, 'refund@x.com');
    await campaignService.claim(campaign._id, 'refund@x.com', user._id);

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: CODE, shippingCost: 0 },
    );
    expect((await Campaign.findById(campaign._id)).redeemedCount).toBe(1);

    await couponService.releaseForOrder(order._id);

    const released = await Campaign.findById(campaign._id);
    expect(released.redeemedCount).toBe(0);
    expect(released.discountGivenRupees).toBe(0);

    const member = await CampaignMember.findOne({ campaign: campaign._id, user: user._id });
    expect(member.status).toBe(CAMPAIGN_MEMBER_STATUS.CLAIMED);
    expect(member.redeemedOrder).toBeNull();

    // And the customer can use the offer again, since they never really used it.
    const requote = await quoteFor(user._id, product);
    expect(requote.couponError).toBeNull();
    expect(requote.couponDiscount).toBe(10000);
  });

  it('leaves an ordinary coupon\'s release path untouched', async () => {
    const product = await seedProduct(10000);
    const user = await seedUser({ email: 'plain@x.com' });
    await Coupon.create({ code: 'PLAIN10', type: 'percentage', value: 10, isActive: true });

    const order = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS,
      { couponCode: 'PLAIN10', shippingCost: 0 },
    );
    expect(order.couponDiscount).toBe(1000);

    await couponService.releaseForOrder(order._id);
    expect((await Coupon.findOne({ code: 'PLAIN10' })).usedCount).toBe(0);
    expect(await CouponRedemption.countDocuments({})).toBe(0);
  });
});

describe('the managed coupon stays hidden', () => {
  it('is absent from the public offers list', async () => {
    // If it leaked into /coupons/available, every shopper would see the festival code
    // in the cart's suggestion chips.
    await seedCampaign();
    await Coupon.create({ code: 'PUBLIC5', type: 'percentage', value: 5, isActive: true, visibility: 'public' });

    const available = await couponService.listAvailable();
    const codes = available.map(c => c.code);
    expect(codes).toContain('PUBLIC5');
    expect(codes).not.toContain(CODE);
  });
});

describe('admin configuration guards', () => {
  it('rejects a tier ladder that would reduce a discount as the cart grows', async () => {
    // The literal brief. Admin-editable, so this must be refused at save time, not
    // discovered in a customer's cart.
    await expect(campaignService.create({
      slug: 'cliff', name: 'Cliff', couponCode: 'CLIFF', endsAt: new Date(Date.now() + 864e5),
      resolution: 'window',
      tiers: [
        { id: 'a', minCartValue: 0, maxCartValue: 100000, percent: 20 },
        { id: 'b', minCartValue: 100000, maxCartValue: null, percent: 10 },
      ],
    })).rejects.toThrow(/REDUCE a customer's discount/i);
  });

  it('rejects maxCartValue under best resolution', async () => {
    await expect(campaignService.create({
      slug: 'bestmax', name: 'Bad', couponCode: 'BAD', endsAt: new Date(Date.now() + 864e5),
      resolution: 'best',
      tiers: [{ id: 'a', minCartValue: 0, maxCartValue: 100000, percent: 20 }],
    })).rejects.toThrow(/ignored in "best" resolution/i);
  });

  it('will not let an everyone-campaign go live without a redemption cap', async () => {
    const campaign = await seedCampaign({ audience: CAMPAIGN_AUDIENCE.EVERYONE, status: CAMPAIGN_STATUS.DRAFT });
    await Campaign.updateOne({ _id: campaign._id }, { maxRedemptions: null });

    await expect(campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE))
      .rejects.toThrow(/maximum number of redemptions/i);
  });

  it('accepts the live festival ladder and reports exposure', async () => {
    const campaign = await seedCampaign({ maxRedemptions: 200 });
    const report = await campaignService.report(campaign.slug);
    expect(report.redeemedCount).toBe(0);
    expect(report.remainingExposureRupees).toBe(200 * 50000);
  });

  it('simulates a cart value for the admin calculator', async () => {
    const campaign = await seedCampaign();
    expect(campaignService.simulate(campaign, 150000)).toMatchObject({
      discountRupees: 20000, tierId: 'festive20',
    });
    expect(campaignService.simulate(campaign, 300000)).toMatchObject({
      discountRupees: 30000, tierId: 'grand10',
    });
  });
});

describe('allowlist import', () => {
  it('upserts, rejects bad rows, and preserves redemption history on re-import', async () => {
    const campaign = await seedCampaign();

    const first = await campaignService.importMembers(campaign._id, [
      { email: 'A@X.com', name: 'A' },
      { email: 'b@x.com', name: 'B' },
      { email: 'not-an-email', name: 'Bad' },
      { email: 'b@x.com', name: 'Dupe' },
    ]);
    expect(first.accepted).toBe(2);
    expect(first.inserted).toBe(2);
    expect(first.rejected).toHaveLength(2);
    // Emails are stored lowercased so eligibility matching cannot miss on case.
    expect(await CampaignMember.findOne({ campaign: campaign._id, email: 'a@x.com' })).toBeTruthy();

    // Simulate a redemption, then re-import the same list with a corrected name.
    const user = await seedUser({ email: 'b@x.com' });
    await CampaignMember.updateOne(
      { campaign: campaign._id, email: 'b@x.com' },
      { status: CAMPAIGN_MEMBER_STATUS.REDEEMED, user: user._id, discountRupees: 5000 },
    );

    const second = await campaignService.importMembers(campaign._id, [
      { email: 'a@x.com', name: 'A' },
      { email: 'b@x.com', name: 'B Corrected' },
    ]);
    expect(second.inserted).toBe(0);

    const member = await CampaignMember.findOne({ campaign: campaign._id, email: 'b@x.com' });
    expect(member.name).toBe('B Corrected');
    expect(member.status).toBe(CAMPAIGN_MEMBER_STATUS.REDEEMED);   // history intact
    expect(member.discountRupees).toBe(5000);
  });

  it('claim binds the invite to the account, idempotently', async () => {
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'claimer@x.com' });
    await invite(campaign, 'claimer@x.com');

    const first = await campaignService.claim(campaign._id, 'claimer@x.com', user._id);
    expect(first.status).toBe(CAMPAIGN_MEMBER_STATUS.CLAIMED);
    expect(first.claimedAt).toBeTruthy();

    const again = await campaignService.claim(campaign._id, 'CLAIMER@x.com', user._id);
    expect(again.claimedAt.getTime()).toBe(first.claimedAt.getTime());
  });
});
