/**
 * notify-me controller: availability gating (only OUT items; variable products
 * require a valid variantId), idempotent create (201 then 200), and self
 * list/cancel. Drives the exported handlers with mocked req/res over in-memory
 * Mongo (no HTTP/auth harness needed — auth is asserted at the route layer).
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  enqueueNotification: jest.fn(),
}));

const { default: Product } = await import('../../../models/Product.js');
const { default: StockNotificationRequest } = await import('../../../models/StockNotificationRequest.js');
const controller = await import('../../../controllers/stockNotificationController.js');

beforeAll(async () => {
  await Product.collection.createIndex({ slug: 1 }, { unique: true });
  await StockNotificationRequest.collection.createIndex(
    { product: 1, variantId: 1, user: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
  );
}, 60_000);

const oid = () => new (Product.base.Types.ObjectId)();

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const user = () => ({ _id: oid(), email: 'buyer@x.com' });

const simple = (stock) => Product.create({
  name: `Wiper ${stock}`, description: 'A perfectly valid product description over ten characters.',
  price: 500, stock,
});

describe('createNotifyRequest', () => {
  test('409 when the item is not out of stock', async () => {
    const p = await simple('in');
    const res = mockRes();
    await controller.createNotifyRequest({ params: { id: p._id.toString() }, body: {}, user: user() }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('NOT_OUT_OF_STOCK');
  });

  test('201 on first request, 200 (alreadyRequested) on repeat — idempotent', async () => {
    const p = await simple('out');
    const u = user();

    const res1 = mockRes();
    await controller.createNotifyRequest({ params: { id: p._id.toString() }, body: {}, user: u }, res1);
    expect(res1.statusCode).toBe(201);
    expect(res1.body.alreadyRequested).toBe(false);

    const res2 = mockRes();
    await controller.createNotifyRequest({ params: { id: p._id.toString() }, body: {}, user: u }, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.alreadyRequested).toBe(true);
    // The idempotent 200 must still carry the real request id so the client can
    // cancel it (regression guard: an id-less 200 made "Cancel alert" a no-op).
    expect(res2.body.request?._id.toString()).toBe(res1.body.request._id.toString());

    expect(await StockNotificationRequest.countDocuments({ product: p._id, status: 'pending' })).toBe(1);
  });

  test('variable product requires a valid variantId', async () => {
    const p = await Product.create({
      name: 'Mat', description: 'A perfectly valid product description over ten characters.',
      price: 100, productType: 'variable',
      variants: [{ label: 'A', price: 100, stock: 'out' }],
    });

    const missing = mockRes();
    await controller.createNotifyRequest({ params: { id: p._id.toString() }, body: {}, user: user() }, missing);
    expect(missing.statusCode).toBe(400);

    const bad = mockRes();
    await controller.createNotifyRequest({ params: { id: p._id.toString() }, body: { variantId: oid().toString() }, user: user() }, bad);
    expect(bad.statusCode).toBe(400);

    const good = mockRes();
    await controller.createNotifyRequest(
      { params: { id: p._id.toString() }, body: { variantId: p.variants[0]._id.toString() }, user: user() },
      good
    );
    expect(good.statusCode).toBe(201);
  });

  test('404 for a non-existent product', async () => {
    const res = mockRes();
    await controller.createNotifyRequest({ params: { id: oid().toString() }, body: {}, user: user() }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('listMyRequests / cancelMyRequest', () => {
  test('lists only the caller\'s pending requests and cancels one', async () => {
    const p = await simple('out');
    const u = user();
    const req = await StockNotificationRequest.create({ product: p._id, variantId: null, user: u._id, email: u.email });
    // Another user's request must not leak.
    await StockNotificationRequest.create({ product: p._id, variantId: null, user: oid(), email: 'other@x.com' });

    const listRes = mockRes();
    await controller.listMyRequests({ query: {}, user: u }, listRes);
    expect(listRes.body.requests).toHaveLength(1);

    const cancelRes = mockRes();
    await controller.cancelMyRequest({ params: { id: req._id.toString() }, user: u }, cancelRes);
    expect(cancelRes.body.success).toBe(true);
    expect(await StockNotificationRequest.countDocuments({ status: 'pending' })).toBe(1); // only the other user's
  });
});

describe('adminListRequests', () => {
  test('groups pending requests per target, highest demand first', async () => {
    const p1 = await simple('out');
    const p2 = await Product.create({
      name: 'Popular', description: 'A perfectly valid product description over ten characters.', price: 200, stock: 'out',
    });
    // p2 has more demand than p1.
    await StockNotificationRequest.create([
      { product: p1._id, variantId: null, user: oid(), email: 'a@x.com' },
      { product: p2._id, variantId: null, user: oid(), email: 'b@x.com' },
      { product: p2._id, variantId: null, user: oid(), email: 'c@x.com' },
    ]);

    const res = mockRes();
    await controller.adminListRequests({ query: {} }, res);

    expect(res.body.items[0].product._id.toString()).toBe(p2._id.toString());
    expect(res.body.items[0].count).toBe(2);
    expect(res.body.pagination.total).toBe(2);
  });
});
