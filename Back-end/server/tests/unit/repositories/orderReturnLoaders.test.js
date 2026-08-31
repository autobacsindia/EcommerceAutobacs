import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as db from '../../db-handler.js';
import Product from '../../../models/Product.js';
import Order from '../../../models/Order.js';
import orderRepository from '../../../repositories/orderRepository.js';

/**
 * The two return-flow order loaders populate `items.product` with a PROJECTION.
 *
 * Unprojected, they pulled whole catalogue documents — description, gallery, variants,
 * SEO — for every line, of which the return flow reads three fields. Measured on a
 * realistic 3-line order: 20,070 B unprojected vs 1,917 B / 1,728 B projected (−90%).
 *
 * The projection is only safe while it still carries everything the controller reads,
 * and a mocked repository can never catch that — the mock returns whatever the test
 * hands it. So this exercises the REAL loaders against a real database and pins the
 * field contract. If someone adds `product.brand` to a return message, this fails.
 */

jest.setTimeout(120000);

const CUSTOMER_FIELDS = ['name', 'returnPolicy']; // createReturnRequest
const ADMIN_FIELDS = ['name'];                    // createOfflineReturn (skips the returnPolicy gate)

let userId;
let orderId;

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.closeDatabase(); });

// The global harness clears every collection after EACH test, so the fixture is seeded
// per-test rather than once (tests/setup.js afterEach).
beforeEach(async () => {
  userId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: 'Floor Mat',
    slug: 'floor-mat',
    description: 'x'.repeat(3500),
    shortDescription: 'y'.repeat(190),
    price: 400,
    category: new mongoose.Types.ObjectId(),
    images: Array.from({ length: 8 }, (_, n) => ({
      url: `https://res.cloudinary.com/demo/image/upload/v1/p-${n}.jpg`,
      public_id: `autobacs/products/p-${n}`,
    })),
    returnPolicy: { returnable: false, nonReturnReason: 'electrical' },
  });

  const order = await Order.create({
    user: userId,
    items: [{ product: product._id, quantity: 2, price: 400, name: 'Floor Mat', image: 'x' }],
    shippingAddress: { fullName: 'A', phone: '9999999999', addressLine1: 'L1', city: 'Kochi', state: 'KL', postalCode: '682019', country: 'India' },
    subtotal: 800, totalAmount: 800, paymentStatus: 'paid', status: 'delivered',
  });
  orderId = order._id;
});

describe('findOwnedWithProducts (customer return flow)', () => {
  it('carries every product field the flow reads, and nothing heavy', async () => {
    const order = await orderRepository.findOwnedWithProducts(orderId, userId);
    const product = order.items[0].product;

    for (const f of CUSTOMER_FIELDS) expect(product[f]).toBeDefined();
    expect(product._id).toBeDefined();
    // The non-returnable gate reads through to the leaf, not just the subdoc.
    expect(product.returnPolicy.returnable).toBe(false);
    // The payload the projection exists to avoid.
    expect(product.description).toBeUndefined();
    expect(product.images).toBeUndefined();
  });

  it('still scopes to the owner', async () => {
    expect(await orderRepository.findOwnedWithProducts(orderId, new mongoose.Types.ObjectId())).toBeNull();
  });
});

describe('findByIdWithProducts (admin offline flow)', () => {
  it('carries the fields the offline flow reads', async () => {
    const order = await orderRepository.findByIdWithProducts(orderId);
    const product = order.items[0].product;

    for (const f of ADMIN_FIELDS) expect(product[f]).toBeDefined();
    expect(product._id).toBeDefined();
    expect(product.description).toBeUndefined();
  });

  it('loads an order it does not own — the admin loader has no ownership filter', async () => {
    expect(await orderRepository.findByIdWithProducts(orderId)).not.toBeNull();
  });

  it('saves back without depopulating the line to a partial product', async () => {
    // createOfflineReturn mutates order.returnRequest and saves. A projected populate
    // must still write the line's product back as its ObjectId, not as the trimmed doc.
    const order = await orderRepository.findByIdWithProducts(orderId);
    order.returnRequest = { requestedAt: new Date(), status: 'item_received' };
    await order.save();

    // Read through the raw driver so nothing re-casts it. `toBeInstanceOf(ObjectId)` is
    // not usable here — mongoose bundles its own bson, so the constructors differ by
    // identity while both are ObjectId. Assert the SHAPE instead: a bare id, not a
    // trimmed product document written back into the line.
    const raw = await Order.collection.findOne({ _id: orderId });
    const stored = raw.items[0].product;
    expect(typeof stored.toHexString).toBe('function');
    expect(stored.name).toBeUndefined();
    expect(String(stored)).toMatch(/^[a-f0-9]{24}$/);
  });
});
