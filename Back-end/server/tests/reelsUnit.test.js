/**
 * Reels — pure pieces and the Redis view counter (with an in-memory fake Redis).
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import Reel from '../models/Reel.js';
import { toProductBlock, clampLimit, recordView } from '../services/reelService.js';
import { REEL_STATUS, reelViewKey } from '../config/reels.js';

/** Just enough of ioredis for recordView: SET … EX … NX, INCR, MGET. */
function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(key, val, _ex, _ttl, nx) {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
    async incr(key) { const n = Number(store.get(key) || 0) + 1; store.set(key, String(n)); return n; },
    async mget(...keys) { return keys.map((k) => store.get(k) ?? null); },
  };
}

describe('toProductBlock', () => {
  const base = { _id: new mongoose.Types.ObjectId(), name: 'Mat', slug: 'mat', price: 900, originalPrice: 1200, stock: 'in', averageRating: 4.04, totalReviews: 3 };

  it('reports a sale against MRP', () => {
    expect(toProductBlock(base)).toMatchObject({ price: 900, mrp: 1200, discountPercent: 25, averageRating: 4, ratingCount: 3, availability: 'in' });
  });

  it('an EXPIRED sale shows the full price and no discount (same guard checkout uses)', () => {
    const b = toProductBlock({ ...base, saleEndsAt: new Date(Date.now() - 1000) });
    expect(b).toMatchObject({ price: 1200, mrp: 1200, discountPercent: 0 });
  });

  it('no MRP → mrp equals price, 0% off; backorder passes through; variable flagged', () => {
    const b = toProductBlock({ ...base, originalPrice: undefined, stock: 'backorder', productType: 'variable', averageRating: undefined, totalReviews: undefined });
    expect(b).toMatchObject({ price: 900, mrp: 900, discountPercent: 0, availability: 'backorder', hasVariants: true, averageRating: 0, ratingCount: 0 });
  });

  it('festival price only when the offer is live, and respects a per-product "none"', () => {
    expect(toProductBlock(base).festivalPrice).toBeNull();
    expect(toProductBlock(base, { festivalLive: true }).festivalPrice).toBe(810);
    expect(toProductBlock({ ...base, festivalOfferSetting: { mode: 'none' } }, { festivalLive: true }).festivalPrice).toBeNull();
  });

  it('null product → null block', () => { expect(toProductBlock(null)).toBeNull(); });
});

describe('clampLimit', () => {
  it.each([[undefined, 10], ['5', 5], ['20', 20], ['21', 20], ['0', 10], ['abc', 10], ['-1', 10]])('%s → %s', (raw, want) => {
    expect(clampLimit(raw)).toBe(want);
  });
});

describe('recordView (Redis counter, never Mongo)', () => {
  let reel;
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => { await dbHandler.closeDatabase(); });
  beforeEach(async () => {
    reel = await Reel.create({
      uploadedBy: new mongoose.Types.ObjectId(), product: new mongoose.Types.ObjectId(),
      media: { publicId: 'autobacs/reels/u_1/v', durationSec: 10 }, status: REEL_STATUS.APPROVED, approvedAt: new Date(),
    });
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  it('counts one view per IP per reel within the window; another IP counts again', async () => {
    const redis = fakeRedis();
    expect(await recordView(reel._id, '1.1.1.1', { redis })).toEqual({ counted: true });
    expect(await recordView(reel._id, '1.1.1.1', { redis })).toEqual({ counted: false });
    expect(await recordView(reel._id, '2.2.2.2', { redis })).toEqual({ counted: true });
    expect(redis.store.get(reelViewKey(reel._id))).toBe('2');
    // The raw IP is never stored.
    expect([...redis.store.keys()].some((k) => k.includes('1.1.1.1'))).toBe(false);
    // And no Mongo write happened.
    expect((await Reel.findById(reel._id).lean()).updatedAt).toEqual(reel.updatedAt);
  });

  it('does not count a pending reel or an unknown id', async () => {
    const redis = fakeRedis();
    await Reel.updateOne({ _id: reel._id }, { $set: { status: REEL_STATUS.PENDING } });
    expect(await recordView(reel._id, '1.1.1.1', { redis })).toEqual({ counted: false });
    expect(await recordView(new mongoose.Types.ObjectId(), '1.1.1.1', { redis })).toEqual({ counted: false });
    expect(redis.store.has(reelViewKey(reel._id))).toBe(false);
  });

  it('Redis missing or failing → not counted, never thrown', async () => {
    expect(await recordView(reel._id, '1.1.1.1', { redis: null })).toEqual({ counted: false });
    const broken = { set: async () => { throw new Error('down'); } };
    expect(await recordView(reel._id, '1.1.1.1', { redis: broken })).toEqual({ counted: false });
  });

  it('a junk id is a 404', async () => {
    await expect(recordView('nope', '1.1.1.1', { redis: fakeRedis() })).rejects.toMatchObject({ statusCode: 404 });
  });
});
