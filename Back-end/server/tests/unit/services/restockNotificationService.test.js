/**
 * restockNotificationService fan-out + send. Verifies the idempotency guarantee
 * (atomic claim → each pending request emailed exactly once, even across repeated
 * hook fires), per-variant targeting, the re-out flap guard, and the provider send.
 */

import { jest } from '@jest/globals';

const queueAdd = jest.fn().mockResolvedValue(undefined);
const sendBackInStockEmail = jest.fn().mockResolvedValue({ success: true });

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  getNotificationsQueue: () => ({ add: queueAdd }),
  enqueueNotification: jest.fn(),
}));

jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendBackInStockEmail },
}));

const { default: Product } = await import('../../../models/Product.js');
const { default: StockNotificationRequest } = await import('../../../models/StockNotificationRequest.js');
await import('../../../models/User.js'); // register the model so populate('user') works
const { fanOutRestock, emailBackInStock } = await import('../../../services/restockNotificationService.js');

beforeAll(async () => {
  await Product.collection.createIndex({ slug: 1 }, { unique: true });
  await StockNotificationRequest.collection.createIndex(
    { product: 1, variantId: 1, user: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
  );
}, 60_000);

beforeEach(() => {
  queueAdd.mockClear().mockResolvedValue(undefined);
  sendBackInStockEmail.mockClear().mockResolvedValue({ success: true });
});

const oid = () => new (Product.base.Types.ObjectId)();

async function seedVariable(v1Stock, v2Stock) {
  return Product.create({
    name: 'Floor Mat',
    description: 'A perfectly valid product description over ten characters.',
    price: 100,
    productType: 'variable',
    variants: [
      { label: 'Model A', price: 100, stock: v1Stock },
      { label: 'Model B', price: 120, stock: v2Stock },
    ],
  });
}

describe('fanOutRestock', () => {
  test('claims and enqueues one send per pending request for the recovered variant only', async () => {
    const product = await seedVariable('in', 'out'); // v1 recovered, v2 still out
    const v1 = product.variants[0]._id;
    const v2 = product.variants[1]._id;

    await StockNotificationRequest.create([
      { product: product._id, variantId: v1, user: oid(), email: 'a@x.com' },
      { product: product._id, variantId: v1, user: oid(), email: 'b@x.com' },
      { product: product._id, variantId: v2, user: oid(), email: 'c@x.com' },
    ]);

    const result = await fanOutRestock(product._id.toString(), v1.toString());

    expect(result).toEqual({ status: 'ok', claimed: 2 });
    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect(queueAdd).toHaveBeenCalledWith('send-back-in-stock-email', expect.objectContaining({ requestId: expect.any(String) }));

    // v1 requests flipped to notified; v2's request untouched.
    const notified = await StockNotificationRequest.countDocuments({ variantId: v1, status: 'notified' });
    const stillPending = await StockNotificationRequest.countDocuments({ variantId: v2, status: 'pending' });
    expect(notified).toBe(2);
    expect(stillPending).toBe(1);
  });

  test('is idempotent — a second fan-out claims nothing and enqueues nothing', async () => {
    const product = await seedVariable('in', 'out');
    const v1 = product.variants[0]._id;
    await StockNotificationRequest.create({ product: product._id, variantId: v1, user: oid(), email: 'a@x.com' });

    const first = await fanOutRestock(product._id.toString(), v1.toString());
    queueAdd.mockClear();
    const second = await fanOutRestock(product._id.toString(), v1.toString());

    expect(first.claimed).toBe(1);
    expect(second.claimed).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  test('flap guard — if the variant is out again, nothing is claimed', async () => {
    const product = await seedVariable('out', 'out'); // v1 back out before the job ran
    const v1 = product.variants[0]._id;
    await StockNotificationRequest.create({ product: product._id, variantId: v1, user: oid(), email: 'a@x.com' });

    const result = await fanOutRestock(product._id.toString(), v1.toString());

    expect(result).toEqual({ status: 'no-longer-available' });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(await StockNotificationRequest.countDocuments({ status: 'pending' })).toBe(1);
  });
});

describe('emailBackInStock', () => {
  test('sends the email with the resolved variant label and falls back to the snapshot email', async () => {
    const product = await seedVariable('in', 'out');
    const v1 = product.variants[0]._id;
    const req = await StockNotificationRequest.create({
      product: product._id, variantId: v1, user: oid(), email: 'buyer@x.com', status: 'notified', notifiedAt: new Date(),
    });

    const result = await emailBackInStock(req._id.toString());

    expect(result).toEqual({ status: 'sent' });
    expect(sendBackInStockEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'buyer@x.com',
      variantLabel: 'Model A',
      variantId: v1.toString(),
      product: expect.objectContaining({ name: 'Floor Mat', slug: expect.any(String) }),
    }));
  });

  test('a cancelled request is not sent', async () => {
    const product = await seedVariable('in', 'out');
    const req = await StockNotificationRequest.create({
      product: product._id, variantId: product.variants[0]._id, user: oid(), email: 'buyer@x.com', status: 'cancelled',
    });

    const result = await emailBackInStock(req._id.toString());

    expect(result).toEqual({ status: 'cancelled' });
    expect(sendBackInStockEmail).not.toHaveBeenCalled();
  });
});
