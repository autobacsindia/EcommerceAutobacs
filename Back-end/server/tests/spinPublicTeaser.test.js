/**
 * GET /api/v1/spin/public/live — the home hero's campaign teaser, over REAL HTTP.
 *
 * This is the ONLY unauthenticated route in the spin router, and it is served to
 * anyone on the internet with no order and no login. That makes two things worth
 * testing that no other spin test covers:
 *
 *   1. It must not leak the odds. Stock counts, weights, win rates, coupon values and
 *      prize ids never appear in the body. Someone who could read `stockRemaining`
 *      could time their order against a nearly-exhausted goodie; someone who could see
 *      `isFloorPrize` would know which slice is the guaranteed-win one. The assertion
 *      is written against the SERIALISED body rather than field-by-field, so a future
 *      field added to teaserPrize fails this test instead of quietly shipping.
 *
 *   2. It must stop advertising a campaign the moment that campaign stops running —
 *      including from cache, which is the case a TTL alone gets wrong.
 *
 * The hero renders straight off this answer, so an empty `prizes` array draws a blank
 * wheel: the populated-list contract is asserted, not assumed.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import SpinCampaign from '../models/SpinCampaign.js';
import SpinPrize from '../models/SpinPrize.js';
import * as dbHandler from './db-handler.js';
import cacheService from '../services/cacheService.js';
import { SPIN_STATUS, SPIN_CACHE_PATTERN, SPIN_TEASER_CACHE_KEY } from '../config/spin.js';

jest.setTimeout(120000);

const ENDPOINT = '/api/v1/spin/public/live';

async function seedCampaign(overrides = {}) {
  return SpinCampaign.create({
    slug: `teaser-${new mongoose.Types.ObjectId()}`,
    name: 'Teaser Campaign',
    status: SPIN_STATUS.LIVE,
    startsAt: new Date(Date.now() - 86400000),
    endsAt: new Date(Date.now() + 86400000),
    goodieWinRatePercent: 40,
    minOrderValuePaise: 100000,
    ...overrides,
  });
}

async function seedPrizes(campaign, extra = {}) {
  await SpinPrize.create({
    campaign: campaign._id,
    name: '₹200 off',
    kind: 'coupon',
    couponType: 'fixed',
    couponValue: 200,
    isFloorPrize: true,
    stockTotal: null,
    stockRemaining: null,
  });
  await SpinPrize.create({
    campaign: campaign._id,
    name: 'Microfibre Cloth',
    sku: 'GOODIE-MF',
    kind: 'goodie',
    stockTotal: 10,
    stockRemaining: 10,
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/cloth.png',
    ...extra,
  });
}

describe('GET /spin/public/live — public campaign teaser', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  // Both the live-campaign key and the teaser key live under this pattern, so one
  // sweep gives each test a cold cache.
  beforeEach(async () => { await cacheService.invalidatePattern(SPIN_CACHE_PATTERN); });

  it('answers 200 with live:false when no campaign exists — no auth required', async () => {
    const res = await request(app).get(ENDPOINT);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.live).toBe(false);
    // The hero keys the whole slide off `live`; a campaign object here would render a
    // wheel with nothing behind it.
    expect(res.body.campaign).toBeUndefined();
    expect(res.body.prizes).toBeUndefined();
  });

  it('returns the campaign window and a populated prize list when one is live', async () => {
    const campaign = await seedCampaign();
    await seedPrizes(campaign);

    const res = await request(app).get(ENDPOINT);

    expect(res.status).toBe(200);
    expect(res.body.live).toBe(true);
    expect(res.body.campaign.slug).toBe(campaign.slug);
    expect(res.body.campaign.minOrderValuePaise).toBe(100000);
    expect(res.body.campaign.endsAt).toBeTruthy();
    // An empty array draws a blank wheel — the hero has no other source for slices.
    expect(Array.isArray(res.body.prizes)).toBe(true);
    expect(res.body.prizes.length).toBeGreaterThan(0);
    expect(res.body.prizes.map((p) => p.name)).toEqual(
      expect.arrayContaining(['₹200 off', 'Microfibre Cloth']),
    );
  });

  it('leaks nothing that prices the prize economy', async () => {
    const campaign = await seedCampaign();
    await seedPrizes(campaign);

    const res = await request(app).get(ENDPOINT);

    // Whole-body assertion on purpose: a new field added to the teaser mapper fails
    // here rather than silently shipping stock or odds to the storefront.
    const body = JSON.stringify(res.body);
    for (const leak of [
      'stockRemaining', 'stockTotal', 'stockAwarded',
      'weightMode', 'manualWeight', 'weightFactor',
      'goodieWinRatePercent', 'couponValue', 'couponPrefix',
      'isFloorPrize', 'maxWinsPerDay', 'sortOrder',
    ]) {
      expect(body).not.toContain(leak);
    }
    // Prize ids are enumerable and are not needed to draw a wheel.
    for (const prize of res.body.prizes) {
      expect(prize.id).toBeUndefined();
      expect(prize._id).toBeUndefined();
      expect(Object.keys(prize).sort()).toEqual(['imageUrl', 'kind', 'name', 'shortLabel']);
    }
  });

  it('reports live:false once the campaign window has closed, even from a warm cache', async () => {
    const campaign = await seedCampaign();
    await seedPrizes(campaign);

    // Warm both the teaser entry and the underlying live-campaign entry.
    const warm = await request(app).get(ENDPOINT);
    expect(warm.body.live).toBe(true);

    // The campaign expires. Nothing writes to it on expiry — that is the whole trap:
    // only the read path's window re-check can catch this, so drop just the teaser
    // entry (simulating its short TTL lapsing) and leave the live-campaign entry warm.
    await SpinCampaign.updateOne(
      { _id: campaign._id },
      { $set: { endsAt: new Date(Date.now() - 1000) } },
    );
    await cacheService.delete(SPIN_TEASER_CACHE_KEY);

    const res = await request(app).get(ENDPOINT);
    expect(res.body.live).toBe(false);
  });

  it('does not advertise a draft or switched-off campaign', async () => {
    const campaign = await seedCampaign({ status: SPIN_STATUS.DRAFT });
    await seedPrizes(campaign);

    const res = await request(app).get(ENDPOINT);
    expect(res.body.live).toBe(false);
  });

  it('omits prizes that are exhausted or deactivated', async () => {
    const campaign = await seedCampaign();
    await seedPrizes(campaign);
    await SpinPrize.create({
      campaign: campaign._id, name: 'Sold Out Cam', sku: 'GOODIE-CAM', kind: 'goodie',
      stockTotal: 5, stockRemaining: 0,
    });
    await SpinPrize.create({
      campaign: campaign._id, name: 'Retired Mug', sku: 'GOODIE-MUG', kind: 'goodie',
      stockTotal: 5, stockRemaining: 5, active: false,
    });

    const res = await request(app).get(ENDPOINT);
    const names = res.body.prizes.map((p) => p.name);

    // A retired or sold-out goodie on the hero is a promise the wheel cannot keep.
    expect(names).not.toContain('Sold Out Cam');
    expect(names).not.toContain('Retired Mug');
  });

  it('does not advertise prizes gated above the campaign\'s own minimum order value', async () => {
    const campaign = await seedCampaign({ minOrderValuePaise: 100000 });
    await seedPrizes(campaign);
    await SpinPrize.create({
      campaign: campaign._id, name: 'Big Spender Dash Cam', sku: 'GOODIE-DASH', kind: 'goodie',
      stockTotal: 3, stockRemaining: 3,
      minOrderValuePaise: 5000000,
    });

    const res = await request(app).get(ENDPOINT);
    const names = res.body.prizes.map((p) => p.name);

    // Every prize shown must be winnable by anyone who qualifies for the campaign at
    // all — this is why the pool is queried at the campaign's own floor rather than an
    // unbounded order value.
    expect(names).not.toContain('Big Spender Dash Cam');
    expect(names).toContain('Microfibre Cloth');
  });
});
