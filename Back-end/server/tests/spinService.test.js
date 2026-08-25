/**
 * Spin-to-Win engine — REAL database, REAL transactions.
 *
 * The invariants under test are the ones that cost real goodies if they break:
 * exactly one spin per order however many times it is called, exactly one winner for
 * the last unit however many spins race for it, and stock returned when the money goes
 * back. spinService writes inside session.withTransaction, so this needs a
 * transaction-capable database — useTransactionalDb() reuses the replica set that
 * tests/setup.js already starts.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

delete process.env.REDIS_URL; // keep queue enqueues a no-op

import User from '../models/User.js';
import Order from '../models/Order.js';
import SpinCampaign from '../models/SpinCampaign.js';
import SpinPrize from '../models/SpinPrize.js';
import SpinResult from '../models/SpinResult.js';
import spinService, {
  INELIGIBLE,
  prizeWeight,
  floorWeight,
  weightedPick,
  buildSegments,
} from '../services/spinService.js';
import { SPIN_STATUS, SPIN_RESULT_STATUS, VOID_REASON } from '../config/spin.js';

jest.setTimeout(120000);

const ADDRESS = {
  fullName: 'Spin Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'Maharashtra', postalCode: '400001', country: 'India',
};

let user;

/** A campaign that is live right now, with a floor prize. */
async function seedCampaign(overrides = {}) {
  const campaign = await SpinCampaign.create({
    slug: `test-${new mongoose.Types.ObjectId()}`,
    name: 'Test Campaign',
    status: SPIN_STATUS.LIVE,
    startsAt: new Date(Date.now() - 86400000),
    endsAt: new Date(Date.now() + 86400000),
    goodieWinRatePercent: 100, // deterministic: always win a real goodie while stock lasts
    ...overrides,
  });
  const floor = await SpinPrize.create({
    campaign: campaign._id,
    name: 'Better Luck Coupon',
    kind: 'coupon',
    couponCode: 'SPIN10',
    isFloorPrize: true,
    stockTotal: null,
    stockRemaining: null,
    minOrderValuePaise: 0,
  });
  return { campaign, floor };
}

async function seedPrize(campaign, overrides = {}) {
  return SpinPrize.create({
    campaign: campaign._id,
    name: 'Microfibre Cloth',
    sku: 'GOODIE-MF',
    kind: 'goodie',
    stockTotal: 10,
    stockRemaining: 10,
    ...overrides,
  });
}

async function seedOrder(overrides = {}) {
  return Order.create({
    user: user._id,
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 1000, name: 'Thing' }],
    shippingAddress: ADDRESS,
    subtotal: 1000,
    totalAmount: 1000,
    status: 'processing',
    paymentStatus: 'paid',
    ...overrides,
  });
}

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
});

beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}), SpinCampaign.deleteMany({}),
    SpinPrize.deleteMany({}), SpinResult.deleteMany({}), User.deleteMany({}),
  ]);
  // The unique index is the idempotency guarantee, and prod builds it from config/db.js
  // rather than from the schema (autoIndex is off there). Build it explicitly so these
  // tests exercise the same serialization point production relies on.
  await SpinResult.collection.createIndex({ order: 1 }, { unique: true });
  user = await User.create({
    name: 'Spin Buyer', email: `spin-${Date.now()}-${Math.random()}@test.com`, passwordHash: 'x',
  });
});

// ── 1. Idempotency ────────────────────────────────────────────────────────────
describe('idempotency', () => {
  it('spinning the same order twice yields ONE result and the SAME prize', async () => {
    const { campaign } = await seedCampaign();
    await seedPrize(campaign);
    const order = await seedOrder();

    const first = await spinService.spin(order._id, { userId: user._id });
    const second = await spinService.spin(order._id, { userId: user._id });

    expect(first.alreadySpun).toBe(false);
    expect(second.alreadySpun).toBe(true);
    expect(String(second.result._id)).toBe(String(first.result._id));
    expect(second.result.prizeSnapshot.name).toBe(first.result.prizeSnapshot.name);
    expect(await SpinResult.countDocuments({ order: order._id })).toBe(1);
  });

  it('CONCURRENT first-spins on one order still produce exactly one result', async () => {
    const { campaign } = await seedCampaign();
    await seedPrize(campaign, { stockTotal: 50, stockRemaining: 50 });
    const order = await seedOrder();

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => spinService.spin(order._id, { userId: user._id })),
    );
    const ok = settled.filter((s) => s.status === 'fulfilled');
    expect(ok.length).toBeGreaterThan(0);

    // One row, and every successful caller agrees on which prize it was.
    expect(await SpinResult.countDocuments({ order: order._id })).toBe(1);
    const ids = new Set(ok.map((s) => String(s.value.result._id)));
    expect(ids.size).toBe(1);

    // Exactly one unit left the shelf, no matter how many callers raced.
    const prize = await SpinPrize.findOne({ campaign: campaign._id, isFloorPrize: false });
    expect(prize.stockAwarded).toBe(1);
    expect(prize.stockRemaining).toBe(49);
  });
});

// ── 2. Oversell ───────────────────────────────────────────────────────────────
describe('stock races', () => {
  it('N concurrent spins against stock=1 award it exactly ONCE, others fall back', async () => {
    // Per-user cap off: the axis under test is stock atomicity, not the user cap.
    const { campaign, floor } = await seedCampaign({ maxSpinsPerUserPerCampaign: null });
    const scarce = await seedPrize(campaign, {
      name: 'Dashcam', sku: 'GOODIE-DASH', stockTotal: 1, stockRemaining: 1,
    });

    const orders = await Promise.all(Array.from({ length: 8 }, () => seedOrder()));
    await Promise.all(orders.map((o) => spinService.spin(o._id, { userId: user._id })));

    const fresh = await SpinPrize.findById(scarce._id);
    expect(fresh.stockRemaining).toBe(0);
    expect(fresh.stockAwarded).toBe(1); // ← the oversell guard

    const winners = await SpinResult.countDocuments({ prize: scarce._id });
    expect(winners).toBe(1);

    // Everyone else still won something — nobody saw an error or an empty wheel.
    expect(await SpinResult.countDocuments({})).toBe(8);
    expect(await SpinResult.countDocuments({ prize: floor._id })).toBe(7);
  });

  it('exhausted pool falls back to the floor prize rather than failing', async () => {
    const { campaign, floor } = await seedCampaign();
    await seedPrize(campaign, { stockTotal: 0, stockRemaining: 0 });
    const order = await seedOrder();

    const { result } = await spinService.spin(order._id, { userId: user._id });
    expect(String(result.prize)).toBe(String(floor._id));
    expect(result.prizeSnapshot.isFloorPrize).toBe(true);
  });
});

// ── 3. Payment gate ───────────────────────────────────────────────────────────
describe('payment gate', () => {
  it('an unpaid order cannot spin and no stock is touched', async () => {
    const { campaign } = await seedCampaign();
    const prize = await seedPrize(campaign);
    const order = await seedOrder({ paymentStatus: 'pending', status: 'awaiting_payment' });

    const check = await spinService.checkEligibility(order._id, { userId: user._id });
    expect(check.eligible).toBe(false);
    expect(check.reason).toBe(INELIGIBLE.NOT_PAID);

    await expect(spinService.spin(order._id, { userId: user._id })).rejects.toThrow(/not_paid/);
    expect((await SpinPrize.findById(prize._id)).stockRemaining).toBe(10);
    expect(await SpinResult.countDocuments({})).toBe(0);
  });

  it('a cancelled order cannot spin', async () => {
    const { campaign } = await seedCampaign();
    await seedPrize(campaign);
    const order = await seedOrder({ status: 'cancelled' });
    const check = await spinService.checkEligibility(order._id, { userId: user._id });
    expect(check.reason).toBe(INELIGIBLE.ORDER_CLOSED);
  });

  it('an imported WooCommerce order cannot spin', async () => {
    const { campaign } = await seedCampaign();
    await seedPrize(campaign);
    const order = await seedOrder({ source: 'woocommerce' });
    const check = await spinService.checkEligibility(order._id, { userId: user._id });
    expect(check.reason).toBe(INELIGIBLE.LEGACY_ORDER);
  });

  it('an order placed before the campaign opened cannot spin', async () => {
    const { campaign } = await seedCampaign({ startsAt: new Date(Date.now() - 1000) });
    await seedPrize(campaign);
    const order = await seedOrder();
    // Backdated through the NATIVE driver: Mongoose's timestamps:true rewrites
    // createdAt on save/update, which would silently defeat the very thing under test.
    await Order.collection.updateOne(
      { _id: order._id },
      { $set: { createdAt: new Date(Date.now() - 86400000) } },
    );
    const check = await spinService.checkEligibility(order._id, { userId: user._id });
    expect(check.reason).toBe(INELIGIBLE.PREDATES_CAMPAIGN);
  });
});

// ── 4. Clawback ───────────────────────────────────────────────────────────────
describe('clawback', () => {
  it('cancelling voids the prize and RETURNS the unit to stock', async () => {
    const { campaign } = await seedCampaign();
    const prize = await seedPrize(campaign, { stockTotal: 5, stockRemaining: 5 });
    const order = await seedOrder();
    await spinService.spin(order._id, { userId: user._id });

    expect((await SpinPrize.findById(prize._id)).stockRemaining).toBe(4);

    const out = await spinService.voidForOrder(order._id, VOID_REASON.ORDER_CANCELLED);
    expect(out).toEqual({ voided: true, stockReturned: true });

    const after = await SpinPrize.findById(prize._id);
    expect(after.stockRemaining).toBe(5);
    expect(after.stockAwarded).toBe(0);

    const result = await SpinResult.findOne({ order: order._id });
    expect(result.status).toBe(SPIN_RESULT_STATUS.VOID);
    expect(result.voidReason).toBe(VOID_REASON.ORDER_CANCELLED);

    const reloaded = await Order.findById(order._id);
    expect(reloaded.spinReward.voidedAt).toBeTruthy(); // packer sees DO NOT PACK
  });

  it('an ALREADY-SHIPPED prize is voided but stock is NOT returned', async () => {
    const { campaign } = await seedCampaign();
    const prize = await seedPrize(campaign, { stockTotal: 5, stockRemaining: 5 });
    const order = await seedOrder();
    await spinService.spin(order._id, { userId: user._id });

    // The goodie physically left the building.
    await SpinResult.updateOne({ order: order._id }, { $set: { fulfilledAt: new Date() } });

    const out = await spinService.voidForOrder(order._id, VOID_REASON.ORDER_RETURNED);
    expect(out).toEqual({ voided: true, stockReturned: false });
    // Incrementing here would invent inventory that does not exist.
    expect((await SpinPrize.findById(prize._id)).stockRemaining).toBe(4);
  });

  it('voiding twice does not return the unit twice', async () => {
    const { campaign } = await seedCampaign();
    const prize = await seedPrize(campaign, { stockTotal: 5, stockRemaining: 5 });
    const order = await seedOrder();
    await spinService.spin(order._id, { userId: user._id });

    await spinService.voidForOrder(order._id);
    const second = await spinService.voidForOrder(order._id);

    expect(second.voided).toBe(false);
    expect((await SpinPrize.findById(prize._id)).stockRemaining).toBe(5); // not 6
  });

  it('voiding an order that never spun is a no-op', async () => {
    const order = await seedOrder();
    await expect(spinService.voidForOrder(order._id)).resolves.toEqual({
      voided: false, stockReturned: false,
    });
  });
});

// ── 5. Daily cap (IST) ────────────────────────────────────────────────────────
describe('daily cap', () => {
  it('stops awarding once maxWinsPerDay is reached, then resets on the next IST day', async () => {
    // The window must span the simulated `now` values below, or the campaign is not
    // live at them and the test would fail for an unrelated reason.
    const { campaign, floor } = await seedCampaign({
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-01T00:00:00.000Z'),
      // Isolate the axis under test: this is about the PRIZE's maxWinsPerDay, not the
      // per-user cap (which now defaults to 1 and would stop us after one spin).
      maxSpinsPerUserPerCampaign: null,
    });
    const capped = await seedPrize(campaign, {
      name: 'Dashcam', sku: 'D1', stockTotal: 10, stockRemaining: 10, maxWinsPerDay: 2,
    });

    // 08:00 IST on day one.
    const day1 = new Date('2026-09-01T02:30:00.000Z');
    for (let i = 0; i < 4; i += 1) {
      const o = await seedOrder();
      await spinService.spin(o._id, { userId: user._id, now: day1 });
    }
    expect((await SpinPrize.findById(capped._id)).stockAwarded).toBe(2);
    expect(await SpinResult.countDocuments({ prize: floor._id })).toBe(2);

    // 00:30 IST the NEXT day — which is still 2026-09-01 in UTC. A UTC-derived day key
    // would keep the cap closed here; the IST key must roll it over.
    const day2 = new Date('2026-09-01T19:00:00.000Z');
    const o = await seedOrder();
    await spinService.spin(o._id, { userId: user._id, now: day2 });

    const after = await SpinPrize.findById(capped._id);
    expect(after.stockAwarded).toBe(3);
    expect(after.capDate).toBe('2026-09-02');
    expect(after.capCount).toBe(1);
  });
});

// ── 6. Odds ───────────────────────────────────────────────────────────────────
describe('odds', () => {
  it('weights prizes in proportion to remaining stock', () => {
    expect(prizeWeight({ stockRemaining: 500, weightFactor: 1 })).toBe(500);
    expect(prizeWeight({ stockRemaining: 5, weightFactor: 1 })).toBe(5);
    // weightFactor suppresses without faking stock.
    expect(prizeWeight({ stockRemaining: 100, weightFactor: 0.1 })).toBeCloseTo(10);
    // The floor prize is never stock-weighted — unlimited stock would be infinite.
    expect(prizeWeight({ isFloorPrize: true, stockRemaining: null })).toBe(0);
  });

  it('derives the floor weight from goodieWinRatePercent', () => {
    // 20% of spins win a goodie → floor must be 4× the goodie weight.
    expect(floorWeight(100, 20)).toBeCloseTo(400);
    expect(floorWeight(100, 50)).toBeCloseTo(100);
    // 100% → the floor prize never competes; goodies win until they run out.
    expect(floorWeight(100, 100)).toBe(0);
  });

  it('converges on the configured goodie win rate over many draws', () => {
    const goodies = [{ _id: 'g', stockRemaining: 100, weightFactor: 1 }];
    const floor = { _id: 'f', isFloorPrize: true };
    const weights = goodies.map(prizeWeight);
    const fw = floorWeight(weights.reduce((a, b) => a + b, 0), 25);

    // Deterministic sweep instead of a random sample — a distribution assertion that
    // relies on Math.random is a flake waiting to happen.
    let goodieWins = 0;
    const N = 1000;
    for (let i = 0; i < N; i += 1) {
      const picked = weightedPick([...goodies, floor], [...weights, fw], () => i / N);
      if (picked._id === 'g') goodieWins += 1;
    }
    expect(goodieWins / N).toBeCloseTo(0.25, 2);
  });

  it('returns null when every weight is zero', () => {
    expect(weightedPick([{ _id: 'a' }], [0], () => 0.5)).toBeNull();
  });
});

// ── 7. Segments ───────────────────────────────────────────────────────────────
describe('wheel segments', () => {
  const floor = { _id: 'floor', name: 'Coupon', isFloorPrize: true };
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    _id: `p${i}`, name: `Prize ${i}`, stockRemaining: 10, weightFactor: 1,
  }));

  it('fills every slice when there are FEWER prizes than slices', () => {
    const { slices } = buildSegments({
      pool: [floor, ...mk(2)], floorPrize: floor, winner: null, segmentCount: 8, rng: () => 0.5,
    });
    expect(slices).toHaveLength(8);
    expect(slices.every(Boolean)).toBe(true);
  });

  it('does NOT grow the wheel when there are MORE prizes than slices', () => {
    const { slices } = buildSegments({
      pool: [floor, ...mk(30)], floorPrize: floor, winner: null, segmentCount: 8, rng: () => 0.5,
    });
    expect(slices).toHaveLength(8);
  });

  it('always includes the floor prize, so "everyone wins" is visibly true', () => {
    const { slices } = buildSegments({
      pool: [floor, ...mk(30)], floorPrize: floor, winner: null, segmentCount: 8, rng: () => 0.3,
    });
    expect(slices.some((s) => s._id === 'floor')).toBe(true);
  });

  it('guarantees the winner occupies the landed slice even if not sampled', () => {
    const prizes = mk(30);
    const winner = prizes[29];
    const { slices, segmentIndex } = buildSegments({
      pool: [floor, ...prizes], floorPrize: floor, winner, segmentCount: 8, rng: () => 0.01,
    });
    expect(slices[segmentIndex]._id).toBe(winner._id);
  });
});

// ── 8. Kill switch & config ───────────────────────────────────────────────────
describe('kill switch', () => {
  it.each([SPIN_STATUS.OFF, SPIN_STATUS.DRAFT])('status "%s" offers no wheel', async (status) => {
    const { campaign } = await seedCampaign();
    await seedPrize(campaign);
    await SpinCampaign.updateOne({ _id: campaign._id }, { status });
    const order = await seedOrder();

    const check = await spinService.checkEligibility(order._id, { userId: user._id });
    expect(check.eligible).toBe(false);
    expect(check.reason).toBe(INELIGIBLE.NO_CAMPAIGN);
    await expect(spinService.spin(order._id, { userId: user._id })).rejects.toThrow(/no_campaign/);
  });

  it('a live campaign with no floor prize refuses rather than throwing at the customer', async () => {
    const { campaign, floor } = await seedCampaign();
    await seedPrize(campaign);
    await SpinPrize.deleteOne({ _id: floor._id });
    const order = await seedOrder();

    const check = await spinService.checkEligibility(order._id, { userId: user._id });
    expect(check.eligible).toBe(false);
    expect(check.reason).toBe(INELIGIBLE.MISCONFIGURED);
  });
});

// ── 9. Gates ──────────────────────────────────────────────────────────────────
describe('order-value and user gates', () => {
  it('filters out prizes above the order value', async () => {
    const { campaign, floor } = await seedCampaign();
    // ₹1,000 order (100,000 paise); dashcam needs ₹8,000.
    const dashcam = await seedPrize(campaign, {
      name: 'Dashcam', sku: 'D', stockTotal: 100, stockRemaining: 100, minOrderValuePaise: 800000,
    });
    const order = await seedOrder();
    const { result } = await spinService.spin(order._id, { userId: user._id });

    expect(String(result.prize)).not.toBe(String(dashcam._id));
    expect(String(result.prize)).toBe(String(floor._id));
    expect((await SpinPrize.findById(dashcam._id)).stockRemaining).toBe(100);
  });

  it('includes the prize once the order clears its minimum', async () => {
    const { campaign } = await seedCampaign();
    const dashcam = await seedPrize(campaign, {
      name: 'Dashcam', sku: 'D', stockTotal: 100, stockRemaining: 100, minOrderValuePaise: 800000,
    });
    const order = await seedOrder({ totalAmount: 9000 }); // 900,000 paise
    const { result } = await spinService.spin(order._id, { userId: user._id });
    expect(String(result.prize)).toBe(String(dashcam._id));
  });

  it('caps a user at ONE spin per campaign by default (no config needed)', async () => {
    // The default is 1: an operator who configures nothing still gets one spin per
    // person per window, rather than one per order.
    const { campaign } = await seedCampaign();
    expect(campaign.maxSpinsPerUserPerCampaign).toBe(1);
    await seedPrize(campaign);

    const first = await seedOrder();
    await spinService.spin(first._id, { userId: user._id });

    const second = await seedOrder();
    const check = await spinService.checkEligibility(second._id, { userId: user._id });
    expect(check.reason).toBe(INELIGIBLE.USER_CAP_REACHED);
  });

  it('a voided spin hands the allowance back', async () => {
    // A refund should not cost the customer their one spin.
    const { campaign } = await seedCampaign();
    await seedPrize(campaign);

    const first = await seedOrder();
    await spinService.spin(first._id, { userId: user._id });
    await spinService.voidForOrder(first._id, VOID_REASON.ORDER_CANCELLED);

    const second = await seedOrder();
    const check = await spinService.checkEligibility(second._id, { userId: user._id });
    expect(check.eligible).toBe(true);
  });

  it('null lets every ORDER earn its own spin', async () => {
    const { campaign } = await seedCampaign({ maxSpinsPerUserPerCampaign: null });
    await seedPrize(campaign, { stockTotal: 20, stockRemaining: 20 });

    const a = await seedOrder();
    const b = await seedOrder();
    await spinService.spin(a._id, { userId: user._id });
    const check = await spinService.checkEligibility(b._id, { userId: user._id });
    expect(check.eligible).toBe(true);
  });

  it('the cap is scoped per campaign — a NEW window unlocks a capped customer', async () => {
    // The whole reason cloning exists rather than date-editing: the count filters on
    // campaign _id, so a fresh campaign row starts the customer's allowance over.
    const { campaign } = await seedCampaign();
    await seedPrize(campaign);
    const first = await seedOrder();
    await spinService.spin(first._id, { userId: user._id });

    const capped = await seedOrder();
    expect((await spinService.checkEligibility(capped._id, { userId: user._id })).reason)
      .toBe(INELIGIBLE.USER_CAP_REACHED);

    // Close the old window and open a new one (what /clone produces).
    await SpinCampaign.updateOne({ _id: campaign._id }, { status: SPIN_STATUS.OFF });
    const next = await seedCampaign();
    await seedPrize(next.campaign);

    const fresh = await seedOrder();
    expect((await spinService.checkEligibility(fresh._id, { userId: user._id })).eligible)
      .toBe(true);
  });

  it('DOCUMENTED LIMITATION: the per-user cap is not race-safe under concurrency', async () => {
    // The cap is a read-then-act check with no atomic guard, unlike the stock claim.
    // Fired truly concurrently, every caller reads a count of 0 before any of them
    // commits, so all of them pass. This test pins the real behaviour so it is a known
    // property rather than something discovered in production.
    //
    // Why this is tolerable: the cap is a soft anti-abuse heuristic, and the HARD
    // guarantees are unaffected — stock is claimed atomically (never oversold), one
    // spin per order is enforced by a unique index, and minOrderValuePaise still gates
    // the expensive goodies. The worst case is a scripted user taking one or two extra
    // cheap prizes, bounded by real stock.
    //
    // In practice spins are sequential (one per order-success page), so the cap holds.
    // Making it airtight needs an atomic per-user counter document; see the note on
    // SpinCampaign.maxSpinsPerUserPerCampaign.
    const { campaign } = await seedCampaign(); // default cap = 1
    await seedPrize(campaign, { stockTotal: 20, stockRemaining: 20 });

    const orders = await Promise.all(Array.from({ length: 4 }, () => seedOrder()));
    await Promise.all(orders.map((o) => spinService.spin(o._id, { userId: user._id })));

    const granted = await SpinResult.countDocuments({ user: user._id });
    expect(granted).toBeGreaterThan(1); // ← the leak, asserted rather than assumed

    // The guarantee that actually matters still holds: never more stock than exists.
    const prize = await SpinPrize.findOne({ campaign: campaign._id, isFloorPrize: false });
    expect(prize.stockRemaining).toBe(20 - prize.stockAwarded);
    expect(prize.stockRemaining).toBeGreaterThanOrEqual(0);
  });

  it('enforces an explicitly configured per-user campaign cap', async () => {
    const { campaign } = await seedCampaign({ maxSpinsPerUserPerCampaign: 1 });
    await seedPrize(campaign);

    const a = await seedOrder();
    await spinService.spin(a._id, { userId: user._id });

    const b = await seedOrder();
    const check = await spinService.checkEligibility(b._id, { userId: user._id });
    expect(check.reason).toBe(INELIGIBLE.USER_CAP_REACHED);
  });

  it('suppresses the wheel in an excluded state', async () => {
    const { campaign } = await seedCampaign({ excludedStates: ['Tamil Nadu'] });
    await seedPrize(campaign);
    const order = await seedOrder({
      shippingAddress: { ...ADDRESS, state: 'tamil nadu' }, // case-insensitive
    });
    const check = await spinService.checkEligibility(order._id, { userId: user._id });
    expect(check.reason).toBe(INELIGIBLE.STATE_EXCLUDED);
  });
});

// ── 10. The order snapshot ────────────────────────────────────────────────────
describe('order denormalisation', () => {
  it('writes spinReward onto the order WITHOUT adding a line item', async () => {
    const { campaign } = await seedCampaign();
    await seedPrize(campaign);
    const order = await seedOrder();
    const itemsBefore = order.items.length;
    const totalBefore = order.totalAmount;

    await spinService.spin(order._id, { userId: user._id });
    const reloaded = await Order.findById(order._id);

    expect(reloaded.spinReward.name).toBe('Microfibre Cloth');
    expect(reloaded.spinReward.sku).toBe('GOODIE-MF');
    expect(reloaded.spinReward.fulfilledAt).toBeNull();
    // The financial record is untouched — no ₹0 line, no changed total.
    expect(reloaded.items).toHaveLength(itemsBefore);
    expect(reloaded.totalAmount).toBe(totalBefore);
  });

  it('leaves spinReward null on an order that never spun (no phantom subdoc)', async () => {
    const order = await seedOrder();
    const reloaded = await Order.findById(order._id);
    expect(reloaded.spinReward).toBeNull();
  });
});

// ── 11. Publish gate ──────────────────────────────────────────────────────────
describe('publish gate', () => {
  it('passes a correctly configured campaign', async () => {
    const { campaign } = await seedCampaign({
      reviewCta: { enabled: true, url: 'https://search.google.com/local/writereview?placeid=abc' },
    });
    await seedPrize(campaign);
    expect(await spinService.validateForPublish(campaign._id)).toEqual([]);
  });

  it('BLOCKS a campaign with no floor prize — the critical guard', async () => {
    const { campaign, floor } = await seedCampaign();
    await seedPrize(campaign);
    await SpinPrize.deleteOne({ _id: floor._id });

    const errors = await spinService.validateForPublish(campaign._id);
    expect(errors.some((e) => e.field === 'prizes.isFloorPrize')).toBe(true);
  });

  it('blocks a floor prize with finite stock', async () => {
    const { campaign, floor } = await seedCampaign();
    await seedPrize(campaign);
    await SpinPrize.updateOne({ _id: floor._id }, { stockTotal: 10, stockRemaining: 10 });

    const errors = await spinService.validateForPublish(campaign._id);
    expect(errors.some((e) => e.field === 'prizes.stockRemaining')).toBe(true);
  });

  it('blocks a floor prize an order could be too small to win', async () => {
    const { campaign, floor } = await seedCampaign();
    await seedPrize(campaign);
    await SpinPrize.updateOne({ _id: floor._id }, { minOrderValuePaise: 50000 });

    const errors = await spinService.validateForPublish(campaign._id);
    expect(errors.some((e) => e.field === 'prizes.minOrderValuePaise')).toBe(true);
  });

  it('blocks a wheel with nothing but the floor prize', async () => {
    const { campaign } = await seedCampaign();
    const errors = await spinService.validateForPublish(campaign._id);
    expect(errors.some((e) => e.field === 'prizes')).toBe(true);
  });

  it('blocks a goodie with no SKU — the packer would have nothing to find', async () => {
    const { campaign } = await seedCampaign();
    const p = await seedPrize(campaign);
    await SpinPrize.updateOne({ _id: p._id }, { $unset: { sku: 1 } });

    const errors = await spinService.validateForPublish(campaign._id);
    expect(errors.some((e) => String(e.field).endsWith('.sku'))).toBe(true);
  });

  it.each([
    ['//evil.com', 'protocol-relative'],
    ['https://evil.com/?q=search.google.com', 'hostname in the query string'],
    ['https://search.google.com.evil.com/x', 'suffixed hostname'],
    ['http://search.google.com/x', 'plain http'],
  ])('rejects review URL %s (%s)', async (url) => {
    const { campaign } = await seedCampaign({ reviewCta: { enabled: true, url } });
    await seedPrize(campaign);
    const errors = await spinService.validateForPublish(campaign._id);
    expect(errors.some((e) => e.field === 'reviewCta.url')).toBe(true);
  });

  it('every error names the field that is wrong, never a bare message', async () => {
    const { campaign, floor } = await seedCampaign();
    await SpinPrize.deleteOne({ _id: floor._id });
    const errors = await spinService.validateForPublish(campaign._id);
    expect(errors.length).toBeGreaterThan(0);
    errors.forEach((e) => {
      expect(typeof e.field).toBe('string');
      expect(e.field.length).toBeGreaterThan(0);
      expect(typeof e.message).toBe('string');
    });
  });
});

// ── 12. Odds preview ──────────────────────────────────────────────────────────
describe('odds preview', () => {
  it('reports probabilities that sum to 1 and projects exhaustion', async () => {
    const { campaign } = await seedCampaign({ goodieWinRatePercent: 20 });
    await seedPrize(campaign, { name: 'Keychain', sku: 'K', stockTotal: 500, stockRemaining: 500 });
    await seedPrize(campaign, { name: 'Dashcam', sku: 'D', stockTotal: 5, stockRemaining: 5 });

    const preview = await spinService.previewOdds(campaign._id, { paidOrdersPerDay: 100 });
    const total = preview.rows.reduce((a, r) => a + r.probability, 0);
    expect(total).toBeCloseTo(1, 5);

    const goodieShare = preview.rows
      .filter((r) => !r.isFloorPrize)
      .reduce((a, r) => a + r.probability, 0);
    expect(goodieShare).toBeCloseTo(0.2, 5); // matches goodieWinRatePercent

    // Scarce items are naturally rare under stock-proportional weighting.
    const keychain = preview.rows.find((r) => r.name === 'Keychain');
    const dashcam = preview.rows.find((r) => r.name === 'Dashcam');
    expect(keychain.probability).toBeGreaterThan(dashcam.probability * 50);
    expect(dashcam.daysToExhaustion).toBeGreaterThan(0);
  });
});

// ── 13. Clawback WIRING ───────────────────────────────────────────────────────
// voidForOrder is covered above; this asserts the hook is actually reached from a real
// status transition. A correct clawback that nothing calls is the failure mode that
// unit-testing the service in isolation cannot see.
describe('clawback wiring through orderStatusService', () => {
  let orderStatusService;

  beforeAll(async () => {
    ({ default: orderStatusService } = await import('../services/orderStatusService.js'));
  });

  it('cancelling an order through the status service returns the goodie to stock', async () => {
    const { campaign } = await seedCampaign();
    const prize = await seedPrize(campaign, { stockTotal: 3, stockRemaining: 3 });
    const order = await seedOrder();

    await spinService.spin(order._id, { userId: user._id });
    expect((await SpinPrize.findById(prize._id)).stockRemaining).toBe(2);

    const res = await orderStatusService.updateOrderStatus(order._id.toString(), 'cancelled', {
      userId: null, isAdmin: true, reason: 'customer_request',
    });
    expect(res.success).toBe(true);

    expect((await SpinPrize.findById(prize._id)).stockRemaining).toBe(3);
    expect((await SpinResult.findOne({ order: order._id })).status).toBe(SPIN_RESULT_STATUS.VOID);
  });

  it('a status change that is not a money reversal leaves the prize alone', async () => {
    const { campaign } = await seedCampaign();
    const prize = await seedPrize(campaign, { stockTotal: 3, stockRemaining: 3 });
    const order = await seedOrder();
    await spinService.spin(order._id, { userId: user._id });

    await orderStatusService.updateOrderStatus(order._id.toString(), 'shipped', {
      userId: null, isAdmin: true,
    });

    expect((await SpinPrize.findById(prize._id)).stockRemaining).toBe(2);
    expect((await SpinResult.findOne({ order: order._id })).status)
      .toBe(SPIN_RESULT_STATUS.GRANTED);
  });
});
