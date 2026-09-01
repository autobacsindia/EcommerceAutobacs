/**
 * `Product.stockRank` sync hooks.
 *
 * stockRank is denormalized from `stock` purely so the two search engines have a
 * key they can BOTH sort on. Sorting on `stock` itself is actively wrong: the enum
 * orders alphabetically as backorder < in < low < out, so `.sort({stock:1})` — the
 * sort written to sink unavailable products — put backorder FIRST on every browse
 * page instead. A denormalized field is only worth having if it cannot go stale,
 * so these tests pin every Mongoose write path that can change `stock`.
 *
 * What they deliberately do NOT claim to cover: bulkWrite and raw-driver writes,
 * which bypass middleware entirely. That gap is closed by
 * scripts/backfill-stock-rank.js (audit + repair), not by a hook.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  enqueueNotification: jest.fn(),
}));

const { default: Product } = await import('../../../models/Product.js');
const { stockRankFor } = await import('../../../utils/stockStatus.js');

const make = (overrides = {}) => ({
  name: 'Test Product',
  price: 1000,
  description: 'x'.repeat(20),
  ...overrides,
});

describe('stockRankFor — the shared derivation', () => {
  it('ranks buyable stock 0 and unbuyable stock 1', () => {
    expect(stockRankFor('in')).toBe(0);
    expect(stockRankFor('low')).toBe(0);
    expect(stockRankFor('out')).toBe(1);
    // The status the original string sort got wrong.
    expect(stockRankFor('backorder')).toBe(1);
  });
});

describe('stockRank stays in sync with stock', () => {
  it('is set on CREATE, so a product created out of stock is not ranked buyable', async () => {
    const doc = await Product.create(make({ stock: 'out' }));
    expect(doc.stockRank).toBe(1);
  });

  it('defaults a normally-created product to rank 0', async () => {
    const doc = await Product.create(make({ stock: 'in' }));
    expect(doc.stockRank).toBe(0);
  });

  it('updates on save() when stock changes', async () => {
    const doc = await Product.create(make({ stock: 'in' }));
    doc.stock = 'backorder';
    await doc.save();
    expect(doc.stockRank).toBe(1);

    doc.stock = 'low';
    await doc.save();
    expect(doc.stockRank).toBe(0);
  });

  it('updates on findOneAndUpdate — the admin quick-edit and Woo-sync path', async () => {
    const doc = await Product.create(make({ stock: 'in' }));
    await Product.findByIdAndUpdate(doc._id, { stock: 'out' });
    const after = await Product.findById(doc._id).lean();
    expect(after.stockRank).toBe(1);
  });

  it('updates when stock arrives inside $set rather than at the top level', async () => {
    // Mongoose appends its own $set for timestamps, so a payload can carry `stock`
    // in either place. Checking only one is how this kind of hook silently misses.
    const doc = await Product.create(make({ stock: 'in' }));
    await Product.findByIdAndUpdate(doc._id, { $set: { stock: 'backorder' } });
    const after = await Product.findById(doc._id).lean();
    expect(after.stockRank).toBe(1);
  });

  it('updates on updateOne and updateMany — the bulk admin paths', async () => {
    const a = await Product.create(make({ stock: 'in' }));
    const b = await Product.create(make({ stock: 'in' }));

    await Product.updateOne({ _id: a._id }, { stock: 'out' });
    expect((await Product.findById(a._id).lean()).stockRank).toBe(1);

    await Product.updateMany({ _id: { $in: [a._id, b._id] } }, { stock: 'low' });
    expect((await Product.findById(a._id).lean()).stockRank).toBe(0);
    expect((await Product.findById(b._id).lean()).stockRank).toBe(0);
  });

  it('leaves stockRank alone when an update does not touch stock', async () => {
    const doc = await Product.create(make({ stock: 'out' }));
    await Product.findByIdAndUpdate(doc._id, { price: 2000 });
    const after = await Product.findById(doc._id).lean();
    // Still 1 — a price edit must not silently reset availability ranking.
    expect(after.stockRank).toBe(1);
    expect(after.price).toBe(2000);
  });

  it('sorts unbuyable products last — the behaviour the whole field exists for', async () => {
    await Product.deleteMany({});
    await Product.create(make({ name: 'Backorder item', stock: 'backorder' }));
    await Product.create(make({ name: 'Out item', stock: 'out' }));
    await Product.create(make({ name: 'In item', stock: 'in' }));

    const byRank = await Product.find({}).sort({ stockRank: 1, name: 1 }).lean();
    expect(byRank[0].name).toBe('In item');

    // And the regression this replaces: sorting on the enum STRING puts backorder
    // first, which is the opposite of the intent.
    const byString = await Product.find({}).sort({ stock: 1, name: 1 }).lean();
    expect(byString[0].name).toBe('Backorder item');
  });
});
