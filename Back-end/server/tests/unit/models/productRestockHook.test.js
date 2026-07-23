/**
 * ProductSchema back-in-stock hooks. The load-bearing part of the feature: verify
 * that a genuine out → purchasable transition enqueues a fan-out job — on BOTH the
 * save() and findByIdAndUpdate() write paths, per-variant for variable products —
 * and that non-restock writes stay silent (no wasted jobs, no wrong sends).
 */

import { jest } from '@jest/globals';

const enqueueNotification = jest.fn();

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  enqueueNotification,
}));

const { default: Product } = await import('../../../models/Product.js');

beforeAll(async () => {
  await Product.collection.createIndex({ slug: 1 }, { unique: true });
}, 60_000);

beforeEach(() => enqueueNotification.mockClear());

const restockCalls = () =>
  enqueueNotification.mock.calls.filter(([name]) => name === 'notify-back-in-stock');

const simple = (overrides = {}) => ({
  name: 'Bosch Wiper Blade',
  description: 'A perfectly valid product description over ten characters.',
  price: 999,
  stock: 'out',
  ...overrides,
});

describe('simple product', () => {
  test('creating an out-of-stock product does NOT enqueue (nothing to recover from)', async () => {
    await Product.create(simple({ stock: 'out' }));
    expect(restockCalls()).toHaveLength(0);
  });

  test('findByIdAndUpdate out → in enqueues a whole-item fan-out', async () => {
    const p = await Product.create(simple({ stock: 'out' }));
    enqueueNotification.mockClear();

    await Product.findByIdAndUpdate(p._id, { stock: 'in' }, { new: true });

    const calls = restockCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ productId: p._id.toString(), variantId: null });
  });

  test('save() out → in enqueues', async () => {
    const p = await Product.create(simple({ stock: 'out' }));
    enqueueNotification.mockClear();

    const doc = await Product.findById(p._id);
    doc.stock = 'in';
    await doc.save();

    expect(restockCalls()).toHaveLength(1);
  });

  test('a price-only update does NOT enqueue', async () => {
    const p = await Product.create(simple({ stock: 'out' }));
    enqueueNotification.mockClear();

    await Product.findByIdAndUpdate(p._id, { price: 1499 }, { new: true });

    expect(restockCalls()).toHaveLength(0);
  });

  test('in → out (going out of stock) does NOT enqueue', async () => {
    const p = await Product.create(simple({ stock: 'in' }));
    enqueueNotification.mockClear();

    await Product.findByIdAndUpdate(p._id, { stock: 'out' }, { new: true });

    expect(restockCalls()).toHaveLength(0);
  });
});

describe('variable product', () => {
  const variable = () =>
    Product.create({
      name: 'Car Mat',
      description: 'A perfectly valid product description over ten characters.',
      price: 100,
      stock: 'out',
      productType: 'variable',
      variants: [
        { label: 'Model A', price: 100, stock: 'out' },
        { label: 'Model B', price: 120, stock: 'out' },
      ],
    });

  test('restocking ONE variant enqueues only that variant', async () => {
    const p = await variable();
    enqueueNotification.mockClear();

    // Mirror the admin edit path: send the full variants array with one flipped to 'in'.
    const variants = p.variants.map((v, i) => ({
      _id: v._id,
      label: v.label,
      price: v.price,
      stock: i === 0 ? 'in' : 'out',
    }));
    await Product.findByIdAndUpdate(p._id, { variants }, { new: true });

    const calls = restockCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ productId: p._id.toString(), variantId: p.variants[0]._id.toString() });
  });

  test('restocking both variants enqueues both', async () => {
    const p = await variable();
    enqueueNotification.mockClear();

    const variants = p.variants.map((v) => ({ _id: v._id, label: v.label, price: v.price, stock: 'in' }));
    await Product.findByIdAndUpdate(p._id, { variants }, { new: true });

    expect(restockCalls()).toHaveLength(2);
  });
});
