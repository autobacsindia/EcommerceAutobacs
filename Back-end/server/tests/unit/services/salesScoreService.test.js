/**
 * Trailing-sales ranking signal.
 *
 * Context for why this exists at all: measured on production, 5 of 931 active
 * products carry any review or rating, and the `isFastMoving` flag it replaces was
 * set on 3. So before this, relevance ranking had no commercial input whatsoever
 * for 99.5% of the catalogue — a product that had never sold ranked identically to
 * the best seller.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const invalidateTags = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../../services/cacheService.js', () => ({
  default: { invalidateTags },
  getRedisClient: () => null,
  CACHE_VERSION: 1,
  CACHE_CONFIG: {},
  TTL: {},
}));
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  enqueueNotification: jest.fn(),
}));

const { default: Product } = await import('../../../models/Product.js');
await import('../../../models/Order.js');
const { recomputeSalesScores, decayFactor, HALF_LIFE_DAYS } =
  await import('../../../services/salesScoreService.js');

const Order = mongoose.model('Order');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const makeProduct = (name) =>
  Product.create({ name, price: 1000, description: 'x'.repeat(20) });

const makeOrder = (productId, quantity, ageDays, paymentStatus = 'paid') =>
  Order.collection.insertOne({
    paymentStatus,
    createdAt: daysAgo(ageDays),
    items: [{ product: productId, quantity, price: 1000 }],
  });

beforeEach(async () => {
  invalidateTags.mockClear();
  await Product.deleteMany({});
  await Order.deleteMany({});
});

describe('decayFactor', () => {
  it('halves the value of a sale every half-life', () => {
    // A flat 90-day count makes ranking lurch whenever the window edge crosses a
    // large order; decay changes smoothly instead.
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(HALF_LIFE_DAYS)).toBeCloseTo(0.5);
    expect(decayFactor(HALF_LIFE_DAYS * 2)).toBeCloseTo(0.25);
  });

  it('treats a future or malformed age as fully current rather than exploding', () => {
    expect(decayFactor(-5)).toBe(1);
    expect(decayFactor(NaN)).toBe(1);
    expect(decayFactor(undefined)).toBe(1);
  });
});

describe('recomputeSalesScores', () => {
  it('scores a product from its recent paid sales', async () => {
    const p = await makeProduct('Winch');
    await makeOrder(p._id, 3, 0);

    const result = await recomputeSalesScores();
    expect(result.scored).toBe(1);

    const after = await Product.findById(p._id).lean();
    expect(after.salesScore).toBeCloseTo(3, 1);
  });

  it('weights a recent sale above an older one of the same size', async () => {
    const recent = await makeProduct('Recent');
    const old = await makeProduct('Old');
    await makeOrder(recent._id, 5, 1);
    await makeOrder(old._id, 5, 60);

    await recomputeSalesScores();
    const r = await Product.findById(recent._id).lean();
    const o = await Product.findById(old._id).lean();
    expect(r.salesScore).toBeGreaterThan(o.salesScore * 3);
  });

  it('ignores orders that were never paid', async () => {
    // Gated on paymentStatus, so an abandoned or failed checkout cannot inflate
    // a product's ranking.
    const p = await makeProduct('Unpaid');
    await makeOrder(p._id, 10, 1, 'pending');
    await makeOrder(p._id, 10, 1, 'failed');

    const result = await recomputeSalesScores();
    expect(result.scored).toBe(0);
    expect((await Product.findById(p._id).lean()).salesScore).toBe(0);
  });

  it('ignores sales outside the lookback window', async () => {
    const p = await makeProduct('Ancient');
    await makeOrder(p._id, 50, 200);

    const result = await recomputeSalesScores();
    expect(result.scored).toBe(0);
  });

  it('CLEARS a stale score so the signal measures current demand', async () => {
    // Without this a product that sold well six months ago keeps its boost
    // forever and outranks something that is actually selling now.
    const p = await makeProduct('Faded');
    await Product.updateOne({ _id: p._id }, { $set: { salesScore: 42 } });

    const result = await recomputeSalesScores();
    expect(result.cleared).toBe(1);
    expect((await Product.findById(p._id).lean()).salesScore).toBe(0);
  });

  it('sums across multiple orders and line quantities', async () => {
    const p = await makeProduct('Popular');
    await makeOrder(p._id, 2, 0);
    await makeOrder(p._id, 3, 0);

    await recomputeSalesScores();
    expect((await Product.findById(p._id).lean()).salesScore).toBeCloseTo(5, 1);
  });

  it('survives an order line pointing at a deleted product', async () => {
    // Historical and WooCommerce-imported lines can reference products that no
    // longer exist; the job must not throw on them.
    await makeOrder(new mongoose.Types.ObjectId(), 4, 1);
    await expect(recomputeSalesScores()).resolves.toBeDefined();
  });

  it('purges cached listings, because ranking changed', async () => {
    // Leaving them to TTL would serve yesterday's ordering for a full cache
    // lifetime after the score moved.
    const p = await makeProduct('Winch');
    await makeOrder(p._id, 1, 0);

    await recomputeSalesScores();
    expect(invalidateTags).toHaveBeenCalledWith('products');
  });

  it('does not fail the job when cache invalidation throws', async () => {
    invalidateTags.mockRejectedValueOnce(new Error('redis down'));
    const p = await makeProduct('Winch');
    await makeOrder(p._id, 1, 0);

    await expect(recomputeSalesScores()).resolves.toMatchObject({ scored: 1 });
  });

  it('handles an empty order collection without writing anything', async () => {
    await makeProduct('Untouched');
    const result = await recomputeSalesScores();
    expect(result).toMatchObject({ scored: 0, cleared: 0 });
  });
});
