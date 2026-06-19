import mongoose from 'mongoose';
import Product from '../models/Product.js';

/**
 * Read guard: until the numeric→status migration runs, the DB may still hold
 * numeric `stock` values. The post-find hook on the Product model must coerce
 * those to a valid status on every read (hydrated and lean).
 */
describe('Product stock read guard (legacy numeric → status)', () => {
  // Insert raw numeric stock via the native driver to bypass schema casting,
  // simulating pre-migration documents.
  const insertRaw = (stock) =>
    Product.collection.insertOne({
      name: 'Legacy Product',
      description: 'Pre-migration product with numeric stock',
      slug: `legacy-${stock}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      price: 100,
      images: [{ url: 'http://example.com/i.jpg' }],
      stock,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  it('coerces the 999 import sentinel to "in" (hydrated read)', async () => {
    const { insertedId } = await insertRaw(999);
    const doc = await Product.findById(insertedId);
    expect(doc.stock).toBe('in');
  });

  it('coerces numeric 0 to "out"', async () => {
    const { insertedId } = await insertRaw(0);
    const doc = await Product.findById(insertedId);
    expect(doc.stock).toBe('out');
  });

  it('coerces a small positive quantity to "low"', async () => {
    const { insertedId } = await insertRaw(3);
    const doc = await Product.findById(insertedId);
    expect(doc.stock).toBe('low');
  });

  it('coerces on lean queries too', async () => {
    await insertRaw(999);
    const docs = await Product.find({ name: 'Legacy Product' }).lean();
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) {
      expect(['in', 'low', 'out']).toContain(d.stock);
    }
  });

  it('leaves an already-valid status untouched', async () => {
    const created = await Product.create({
      name: 'Valid Product',
      description: 'Already on the enum',
      slug: `valid-${Date.now()}`,
      price: 100,
      images: [{ url: 'http://example.com/i.jpg' }],
      stock: 'low',
    });
    const doc = await Product.findById(created._id);
    expect(doc.stock).toBe('low');
  });

  afterAll(async () => {
    await Product.deleteMany({ name: { $in: ['Legacy Product', 'Valid Product'] } }).setOptions({ includeDeleted: true });
  });
});
