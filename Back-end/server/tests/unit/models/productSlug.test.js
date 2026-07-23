/**
 * Product slug derivation — the admin create form never sends `slug`, but the
 * schema requires it and indexes it unique. These cover the pre('validate')
 * hook: derive from name, don't clobber an explicit slug, dodge collisions
 * (including slugs held by soft-deleted products), and surface a duplicate as
 * an E11000 rather than silently overwriting.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  enqueueNotification: jest.fn(),
}));

const { default: Product } = await import('../../../models/Product.js');

const baseProduct = (overrides = {}) => ({
  name: 'Bosch Wiper Blade',
  description: 'A perfectly valid product description over ten characters.',
  price: 999,
  stock: 'in',
  ...overrides,
});

// tests/setup.js owns the in-memory Mongo connection and per-test collection
// wipe. We only need the unique `slug` index actually built — collision
// behaviour is meaningless without it. (Can't use syncIndexes(): the schema has
// pre-existing duplicate index declarations on wpId/syncedFromWordPress.)
beforeAll(async () => {
  await Product.collection.createIndex({ slug: 1 }, { unique: true });
}, 60_000);

describe('Product slug pre-validate hook', () => {
  it('derives a slug from name when none is supplied (the admin-create path)', async () => {
    const p = await Product.create(baseProduct());
    expect(p.slug).toBe('bosch-wiper-blade');
  });

  it('normalizes but never renames an explicitly supplied slug', async () => {
    const p = await Product.create(baseProduct({ slug: 'Custom Slug' }));
    expect(p.slug).toBe('custom-slug');
  });

  it('suffixes on collision instead of throwing', async () => {
    await Product.create(baseProduct());
    const second = await Product.create(baseProduct());
    expect(second.slug).toBe('bosch-wiper-blade-2');

    const third = await Product.create(baseProduct());
    expect(third.slug).toBe('bosch-wiper-blade-3');
  });

  it('respects slugs held by soft-deleted products', async () => {
    const first = await Product.create(baseProduct());
    first.deletedAt = new Date();
    await first.save();

    // The soft-delete pre(/^find/) hook hides `first` from normal queries, but it
    // still owns 'bosch-wiper-blade' in the unique index.
    const second = await Product.create(baseProduct());
    expect(second.slug).toBe('bosch-wiper-blade-2');
  });

  it('leaves slug unset when name is missing, so name is the reported error', async () => {
    const err = new Product({ description: 'x'.repeat(20), price: 1, stock: 'in' }).validateSync();
    expect(err.errors.name).toBeDefined();
  });

  it('raises a duplicate-key error when an explicit slug already exists', async () => {
    await Product.create(baseProduct());
    await expect(
      Product.create(baseProduct({ name: 'Totally Different', slug: 'bosch-wiper-blade' })),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
