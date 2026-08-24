/**
 * Campaign redemption reporting — who actually bought, and what it actually cost.
 *
 * Two failure modes drive every case here.
 *
 * The first is that the admin roster is STRUCTURALLY EMPTY for a public campaign.
 * `claimForUser` only runs for an allowlist audience and `markRedeemed` does not upsert,
 * so the printed-QR campaign — which is public — writes no member row however many
 * people redeem. Reporting from the roster would show nobody bought while the counters
 * climbed and money went out. These tests pin the report to the redemption rows instead.
 *
 * The second is that `redeemedCount` is incremented inside the ORDER-CREATION
 * transaction, before a rupee moves. It is the budget cap and must behave that way, but
 * read as "customers who bought" it counts every abandoned checkout too. So paid,
 * unpaid, and refunded are reported apart and are never silently added together.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app.js';
import User from '../models/User.js';
import Campaign from '../models/Campaign.js';
import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import Order from '../models/Order.js';
import campaignService from '../services/campaignService.js';
import couponRedemptionRepository from '../repositories/couponRedemptionRepository.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';
import { generateTokenPair } from '../utils/sessionManager.js';

jest.setTimeout(60000);

const SLUG = 'redemption-report-campaign';
const CODE = 'REPORTTEST';
let seq = 0;

const auth = (user) => `Bearer ${generateTokenPair(user, '127.0.0.1', 'jest').accessToken}`;

const seedUser = ({ role = 'customer' } = {}) =>
  User.create({
    name: `U${++seq}`, email: `redeem${seq}${Date.now()}@x.com`,
    passwordHash: 'x', role, isVerified: true,
  });

const seedOrder = (user, { paymentStatus = 'paid', totalAmount = 1000 } = {}) =>
  Order.create({
    user: user._id,
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: totalAmount }],
    shippingAddress: {
      fullName: 'A', phone: '9999999999', addressLine1: 'X',
      city: 'Mumbai', state: 'MH', postalCode: '400001',
    },
    subtotal: totalAmount, totalAmount, paymentStatus,
  });

/** A redemption of the campaign's managed coupon, against a real order. */
const seedRedemption = async (coupon, user, { discountAmount = 100, ...orderOpts } = {}) => {
  const order = await seedOrder(user, orderOpts);
  await CouponRedemption.create({
    coupon: coupon._id, user: user._id, order: order._id, code: coupon.code, discountAmount,
  });
  return order;
};

let coupon, campaign, adminUser, shopper;

beforeEach(async () => {
  await Promise.all([
    Campaign.deleteMany({}), Coupon.deleteMany({}),
    CouponRedemption.deleteMany({}), Order.deleteMany({}),
  ]);
  coupon = await Coupon.create({ code: CODE, type: 'percentage', value: 8, visibility: 'hidden' });
  campaign = await Campaign.create({
    slug: SLUG, name: 'Report Test',
    status: CAMPAIGN_STATUS.LIVE,
    // PUBLIC on purpose: the audience that writes no member rows at all.
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    couponCode: CODE, maxRedemptions: 200,
    productTiers: [{ code: 'base', label: 'Base', percent: 4, isDefault: true }],
  });
  adminUser = await seedUser({ role: 'admin' });
  shopper = await seedUser();
});

describe('realised money, split by payment state', () => {
  it('separates money actually taken from money merely committed', async () => {
    await seedRedemption(coupon, await seedUser(), { discountAmount: 100, totalAmount: 1000 });
    await seedRedemption(coupon, await seedUser(), { discountAmount: 200, totalAmount: 2000 });
    // Committed a slot and a discount, then walked away. `redeemedCount` counts this;
    // the paid figures must not.
    await seedRedemption(coupon, await seedUser(), {
      discountAmount: 500, totalAmount: 5000, paymentStatus: 'pending',
    });

    const stats = await couponRedemptionRepository.statsByCoupon(coupon._id);
    expect(stats.paid).toMatchObject({ count: 2, discount: 300, revenue: 3000 });
    expect(stats.unpaid).toEqual({ count: 1, discount: 500 });
    expect(stats.total).toBe(3);
  });

  it('reports refunds apart rather than folding them into the paid totals', async () => {
    await seedRedemption(coupon, await seedUser(), { discountAmount: 100, totalAmount: 1000 });
    // A refunded order KEEPS its redemption row unless the release path ran, so this
    // would otherwise be counted as realised revenue that no longer exists.
    await seedRedemption(coupon, await seedUser(), {
      discountAmount: 250, totalAmount: 2500, paymentStatus: 'refunded',
    });

    const stats = await couponRedemptionRepository.statsByCoupon(coupon._id);
    expect(stats.paid).toMatchObject({ count: 1, discount: 100, revenue: 1000 });
    expect(stats.refunded).toEqual({ count: 1, discount: 250 });
  });

  it('averages order value over paid orders only', async () => {
    await seedRedemption(coupon, await seedUser(), { totalAmount: 1000 });
    await seedRedemption(coupon, await seedUser(), { totalAmount: 3000 });
    await seedRedemption(coupon, await seedUser(), { totalAmount: 9000, paymentStatus: 'expired' });

    const stats = await couponRedemptionRepository.statsByCoupon(coupon._id);
    expect(stats.paid.avgOrderValue).toBe(2000);
  });

  it('counts an orphaned redemption as unpaid instead of dropping it', async () => {
    const order = await seedRedemption(coupon, await seedUser(), { discountAmount: 100 });
    await Order.deleteOne({ _id: order._id });

    const stats = await couponRedemptionRepository.statsByCoupon(coupon._id);
    expect(stats.total).toBe(1);
    expect(stats.unpaid).toEqual({ count: 1, discount: 100 });
    expect(stats.paid.count).toBe(0);
  });

  it('returns zeroes, not NaN, for a campaign nobody has redeemed', async () => {
    const stats = await couponRedemptionRepository.statsByCoupon(coupon._id);
    expect(stats.total).toBe(0);
    expect(stats.paid).toEqual({ count: 0, discount: 0, revenue: 0, avgOrderValue: 0 });
  });
});

describe('the report endpoint', () => {
  it('carries realised money alongside the committed counters', async () => {
    await seedRedemption(coupon, await seedUser(), { discountAmount: 100, totalAmount: 1000 });
    await seedRedemption(coupon, await seedUser(), { discountAmount: 400, paymentStatus: 'pending' });

    const res = await request(app)
      .get(`/api/v1/campaigns/${SLUG}/report`)
      .set('Authorization', auth(adminUser))
      .expect(200);

    expect(res.body.report.money.paid).toMatchObject({ count: 1, discount: 100 });
    expect(res.body.report.money.unpaid).toEqual({ count: 1, discount: 400 });
    // The cap mechanism is reported unchanged — it is what maxRedemptions is measured
    // against, and quietly redefining it would let a campaign oversell.
    expect(res.body.report).toHaveProperty('redeemedCount');
  });

  /*
    An honest "no answer". A row of zeroes would read as "nobody bought" when the truth
    is that the campaign prices nothing through a coupon and there is nothing to count.
  */
  it('reports null money when the campaign has no managed coupon', async () => {
    await Campaign.updateOne({ _id: campaign._id }, { $set: { couponCode: null } });
    const report = await campaignService.report(SLUG);
    expect(report.money).toBeNull();
  });

  it('reports null money when the named coupon no longer exists', async () => {
    await Coupon.deleteOne({ _id: coupon._id });
    const report = await campaignService.report(SLUG);
    expect(report.money).toBeNull();
  });
});

describe('the redemptions list', () => {
  it('lists redeemers of a PUBLIC campaign, which the member roster never records', async () => {
    const buyer = await seedUser();
    await seedRedemption(coupon, buyer, { discountAmount: 150, totalAmount: 1500 });

    const res = await request(app)
      .get(`/api/v1/campaigns/${SLUG}/redemptions`)
      .set('Authorization', auth(adminUser))
      .expect(200);

    expect(res.body.redemptions).toHaveLength(1);
    const row = res.body.redemptions[0];
    expect(row.user.email).toBe(buyer.email);
    expect(row.discountAmount).toBe(150);
    expect(row.order.paymentStatus).toBe('paid');
    expect(row.order.totalAmount).toBe(1500);

    // The roster it replaces is genuinely empty for this campaign — that is the bug
    // this endpoint exists to route around, so it is asserted rather than assumed.
    const report = await campaignService.report(SLUG);
    expect(report.members.total ?? 0).toBe(0);
  });

  it('never returns a per-customer page from a shared cache', async () => {
    const res = await request(app)
      .get(`/api/v1/campaigns/${SLUG}/redemptions`)
      .set('Authorization', auth(adminUser))
      .expect(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['cache-control']).toMatch(/private/);
  });

  it('pages with a keyset cursor, newest first, without repeating a row', async () => {
    for (let i = 0; i < 5; i++) {
      // Sequential so _id order is deterministic rather than racing.
      await seedRedemption(coupon, await seedUser(), { discountAmount: i + 1 });
    }

    const first = await couponRedemptionRepository.listByCouponPage(coupon._id, { limit: 2 });
    expect(first.redemptions).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = await couponRedemptionRepository.listByCouponPage(coupon._id, {
      cursor: first.nextCursor, limit: 2,
    });
    const ids = [...first.redemptions, ...second.redemptions].map(r => String(r._id));
    expect(new Set(ids).size).toBe(4);
    // Newest first: every id strictly descends.
    expect([...ids].sort().reverse()).toEqual(ids);
  });

  it('ends the walk exactly at the last row, with no phantom extra page', async () => {
    await seedRedemption(coupon, await seedUser());
    await seedRedemption(coupon, await seedUser());

    const page = await couponRedemptionRepository.listByCouponPage(coupon._id, { limit: 2 });
    expect(page.redemptions).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('caps an over-large page request instead of returning the whole collection', async () => {
    const res = await request(app)
      .get(`/api/v1/campaigns/${SLUG}/redemptions?limit=5000`)
      .set('Authorization', auth(adminUser))
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/limit/i);
  });

  it('rejects a hand-edited cursor with a 400, not a cast error', async () => {
    await request(app)
      .get(`/api/v1/campaigns/${SLUG}/redemptions?cursor=not-an-id`)
      .set('Authorization', auth(adminUser))
      .expect(400);
  });

  it('returns an empty page for a campaign with no managed coupon', async () => {
    await Campaign.updateOne({ _id: campaign._id }, { $set: { couponCode: null } });
    const result = await campaignService.listRedemptions(SLUG, {});
    expect(result).toEqual({ redemptions: [], nextCursor: null });
  });

  it('404s an unknown campaign rather than reporting an empty one', async () => {
    await request(app)
      .get('/api/v1/campaigns/no-such-campaign/redemptions')
      .set('Authorization', auth(adminUser))
      .expect(404);
  });
});

describe('admin boundary', () => {
  it('refuses a signed-in shopper — named customers are not shopper-readable', async () => {
    const res = await request(app)
      .get(`/api/v1/campaigns/${SLUG}/redemptions`)
      .set('Authorization', auth(shopper));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).get(`/api/v1/campaigns/${SLUG}/redemptions`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
  });
});
