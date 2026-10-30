/**
 * A customer raising a return on the website (returnService.createCustomerReturn) against
 * a real in-memory Mongo — every rule the old controller tests pinned, now on the shared
 * rules (one return system for customers and staff), plus the 2026-10-30 changes:
 *
 *   - reasons claim a fault: 7 days for ours, 4 for the customer's own reason
 *   - customer reasons need the unused-in-box declaration and a returnable product;
 *     a fault on our side is always accepted (Consumer Protection (E-Commerce) Rules 2020)
 *   - evidence: a photo always; a video for transit damage or a line over ₹10,000;
 *     proof of purchase optional
 *   - per-line windows on split parcels; never more units than were DELIVERED and are
 *     unclaimed; one in-flight return per product; a rejected product goes to support
 *   - debit-card EMI is all-or-nothing
 *   - the estimate the customer sees before submitting
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const enqueued = [];
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => ({ add: () => Promise.resolve({}) }),
  getOrderQueue: () => ({ add: () => Promise.resolve({}) }),
  getSearchSyncQueue: () => ({ add: () => Promise.resolve({}) }),
  enqueueNotification: (name, data) => { enqueued.push({ name, data }); },
  closeQueues: () => Promise.resolve(),
}));
const asset = (raw, resourceType) => (raw?.publicId ? { publicId: raw.publicId, resourceType, bytes: 100, provider: 'r2' } : null);
jest.unstable_mockModule('../services/returnEvidence.js', () => {
  const m = {
    verifyVideo: async (raw) => asset(raw, 'video'),
    verifyProof: async (raw) => asset(raw, 'image'),
    verifyPhotos: async (raws) => (raws || []).map((r) => asset(r, 'image')).filter(Boolean),
    uploadTargets: async () => ({}),
    withSignedEvidence: async (rr) => rr,
  };
  return { ...m, default: m };
});

const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: ReturnRequest } = await import('../models/ReturnRequest.js');
const svc = await import('../services/returnService.js');
const { getMyReturns } = await import('../controllers/returnController.js');

jest.setTimeout(120000);
beforeAll(async () => { await ReturnRequest.createIndexes(); });
beforeEach(() => { enqueued.length = 0; });

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);
const PHOTOS = [{ publicId: 'autobacs/returns/n1/photo-1.jpg' }];
const VIDEO = { publicId: 'autobacs/returns/n1/video.mp4' };
const oid = () => new mongoose.Types.ObjectId();

/** A delivered order owned by `user`: wipers ×3 (₹500) and polish ×1 (₹250). */
async function order(user, over = {}) {
  const a = oid();
  const b = oid();
  const doc = await Order.create({
    user,
    items: [
      { _id: a, product: oid(), name: 'Wiper', price: 500, quantity: 3 },
      { _id: b, product: oid(), name: 'Polish', price: 250, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 1750, shippingCost: 0, totalAmount: 1750, status: 'delivered', paymentStatus: 'paid', deliveredAt: ago(1),
    ...over,
  });
  return { o: await Order.findById(doc._id).lean(), a: String(a), b: String(b) };
}
const customer = () => ({ _id: oid() });
const raise = (user, o, items, extra = {}) => svc.createCustomerReturn(user, {
  orderId: String(o._id), items, problemDescription: 'It rattles', images: PHOTOS, ...extra,
}, null);

describe('reasons, windows and the non-returnable list', () => {
  it("our fault: 7 days; customer's reason: 4 days (to the hour, never rounded)", async () => {
    const u = customer();
    const { o, a, b } = await order(u._id, { deliveredAt: new Date(Date.now() - (4 * DAY + 23 * 3600e3)) });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'changed_mind' }], { unusedDeclared: true }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/window .* closed/i) });
    await expect(raise(u, o, [{ itemId: b, quantity: 1, reason: 'manufacturing_defect' }])).resolves.toBeTruthy();
    const late = await order(u._id, { deliveredAt: new Date(Date.now() - (7 * DAY + 3600e3)) });
    await expect(raise(u, late.o, [{ itemId: late.a, quantity: 1, reason: 'wrong_item' }]))
      .rejects.toMatchObject({ statusCode: 400 });
    const inside = await order(u._id, { deliveredAt: new Date(Date.now() - (3 * DAY + 23 * 3600e3)) });
    await expect(raise(u, inside.o, [{ itemId: inside.a, quantity: 1, reason: 'ordered_wrong' }], { unusedDeclared: true })).resolves.toBeTruthy();
  });

  it('never lets a customer claim installer damage', async () => {
    const u = customer();
    const { o, a } = await order(u._id);
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'installer_damage' }]))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('a non-returnable product: refused for the customer\'s reason, accepted for a defect', async () => {
    const u = customer();
    const { o, a } = await order(u._id);
    await Product.collection.insertOne({ _id: o.items[0].product, name: 'Wiper', returnPolicy: { returnable: false, nonReturnReason: 'electrical' } });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'changed_mind' }], { unusedDeclared: true }))
      .rejects.toMatchObject({ message: expect.stringMatching(/non-returnable/i) });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'manufacturing_defect' }])).resolves.toBeTruthy();
  });

  it('a customer reason needs the unused-in-box declaration', async () => {
    const u = customer();
    const { o, a } = await order(u._id);
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'ordered_wrong' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/unused/i) });
    const rr = await raise(u, o, [{ itemId: a, quantity: 1, reason: 'ordered_wrong' }], { unusedDeclared: true });
    expect(rr.unusedDeclaredAt).toBeTruthy();
    expect(rr.items[0].fault.claimed).toBe('customer');
  });

  it('a product since removed from the catalogue can still be returned', async () => {
    const u = customer();
    const { o, a } = await order(u._id); // its products were never in the catalogue at all
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }])).resolves.toBeTruthy();
  });

  it("someone else's order is not found", async () => {
    const { o, a } = await order(oid());
    await expect(raise(customer(), o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }])).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('evidence', () => {
  it('a photo always; a video for transit damage or a line over ₹10,000; proof optional; a description', async () => {
    const u = customer();
    const { o, a } = await order(u._id);
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }], { images: [] }))
      .rejects.toMatchObject({ message: expect.stringMatching(/photo/i) });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'transit_damage' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/video/i) });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }], { problemDescription: ' ' }))
      .rejects.toMatchObject({ message: expect.stringMatching(/description/i) });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'transit_damage' }], { video: VIDEO })).resolves.toBeTruthy();

    const big = await order(u._id, { items: [{ _id: oid(), product: oid(), name: 'Dash cam', price: 12000, quantity: 1 }], subtotal: 12000, totalAmount: 12000 });
    await expect(raise(u, big.o, [{ itemId: String(big.o.items[0]._id), quantity: 1, reason: 'wrong_item' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/video/i) });
  });

  it('creates the request, snapshots the value, tells the customer, support and both teams', async () => {
    const u = customer();
    const { o, a } = await order(u._id);
    const rr = await raise(u, o, [{ itemId: a, quantity: 2, reason: 'manufacturing_defect' }]);
    expect(rr).toMatchObject({ status: 'pending', origin: 'customer', customerPhone: '9876543210' });
    expect(rr.refund.productValue).toBe(1000);
    expect(String(rr.items[0].orderItemId)).toBe(a);
    const names = enqueued.map((j) => j.name);
    expect(names).toEqual(expect.arrayContaining(['send-return-submitted', 'send-admin-return-alert', 'create-support-ticket']));
    expect(enqueued.filter((j) => j.name === 'post-return-update').map((j) => j.data.event)).toEqual(['raised_ops', 'raised_sales']);
    const saved = await Order.findById(o._id).lean();
    expect(saved.returnRequest).toMatchObject({ status: 'pending' });
  });
});

describe('quantities and repeats', () => {
  it('returns part of a line, then the rest — never more than was delivered', async () => {
    const u = customer();
    const { o, a } = await order(u._id);
    const first = await raise(u, o, [{ itemId: a, quantity: 1, reason: 'manufacturing_defect' }]);
    // While the first is in flight, the same product is refused…
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'manufacturing_defect' }])).rejects.toMatchObject({ statusCode: 409 });
    await ReturnRequest.updateOne({ _id: first._id }, { $set: { status: 'refunded' } });
    // …once it is done, the other two can come back, but not three.
    await expect(raise(u, o, [{ itemId: a, quantity: 3, reason: 'manufacturing_defect' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/Only 2/) });
    const second = await raise(u, o, [{ itemId: a, quantity: 2, reason: 'manufacturing_defect' }]);
    await ReturnRequest.updateOne({ _id: second._id }, { $set: { status: 'refunded' } });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'manufacturing_defect' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/already been returned/) });
  });

  it('several products at once, each with its own reason', async () => {
    const u = customer();
    const { o, a, b } = await order(u._id);
    const rr = await raise(u, o, [
      { itemId: a, quantity: 2, reason: 'wrong_item' },
      { itemId: b, quantity: 1, reason: 'ordered_wrong' },
    ], { unusedDeclared: true });
    expect(rr.items.map((i) => [i.reason, i.fault.claimed])).toEqual([['wrong_item', 'ours'], ['ordered_wrong', 'customer']]);
  });

  it('a declined product goes to support; a withdrawn one can be raised again', async () => {
    const u = customer();
    const { o, a, b } = await order(u._id);
    const declined = await raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }]);
    await ReturnRequest.updateOne({ _id: declined._id }, { $set: { status: 'rejected' } });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }]))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/declined/i) });
    const withdrawn = await raise(u, o, [{ itemId: b, quantity: 1, reason: 'wrong_item' }]);
    await ReturnRequest.updateOne({ _id: withdrawn._id }, { $set: { status: 'cancelled' } });
    await expect(raise(u, o, [{ itemId: b, quantity: 1, reason: 'wrong_item' }])).resolves.toBeTruthy();
  });

  it('cancelled units were never delivered and cannot be returned', async () => {
    const u = customer();
    const { o, a } = await order(u._id);
    await Order.updateOne({ _id: o._id }, { $push: { cancellations: { sequence: 1, lines: [{ itemId: a, quantity: 2 }], refund: { status: 'completed', amountPaise: 100000 } } } });
    const fresh = await Order.findById(o._id).lean();
    await expect(raise(u, fresh, [{ itemId: a, quantity: 2, reason: 'wrong_item' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/Only 1/) });
  });

  it('an order already marked returned still takes a return for another item', async () => {
    const u = customer();
    const { o, b } = await order(u._id, { status: 'returned' });
    await expect(raise(u, o, [{ itemId: b, quantity: 1, reason: 'wrong_item' }])).resolves.toBeTruthy();
  });
});

describe('split parcels: each line has its own window', () => {
  async function split(u, { aDays, bDays, bDelivered = true, status = 'delivered' }) {
    const a = oid();
    const b = oid();
    const doc = await Order.create({
      user: u._id, status, paymentStatus: 'paid', subtotal: 1000, totalAmount: 1000,
      items: [
        { _id: a, product: oid(), name: 'Wiper', price: 500, quantity: 1 },
        { _id: b, product: oid(), name: 'Polish', price: 500, quantity: 1 },
      ],
      shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      shipments: [
        { sequence: 1, status: 'delivered', deliveredAt: ago(aDays), lines: [{ itemId: a, quantity: 1 }] },
        bDelivered
          ? { sequence: 2, status: 'delivered', deliveredAt: ago(bDays), lines: [{ itemId: b, quantity: 1 }] }
          : { sequence: 2, status: 'shipped', lines: [{ itemId: b, quantity: 1 }] },
      ],
      deliveredAt: ago(bDelivered ? Math.min(aDays, bDays) : aDays),
    });
    return { o: await Order.findById(doc._id).lean(), a: String(a), b: String(b) };
  }

  it("refuses a line whose OWN parcel is out of window, even though the order looks recent", async () => {
    const u = customer();
    const { o, a, b } = await split(u, { aDays: 9, bDays: 1 });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }])).rejects.toMatchObject({ statusCode: 400 });
    await expect(raise(u, o, [{ itemId: b, quantity: 1, reason: 'wrong_item' }])).resolves.toBeTruthy();
  });

  it('allows the arrived line on a still-shipping order, and refuses the one still on its way', async () => {
    const u = customer();
    const { o, a, b } = await split(u, { aDays: 1, bDelivered: false, status: 'shipped' });
    await expect(raise(u, o, [{ itemId: b, quantity: 1, reason: 'wrong_item' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/hasn't been delivered/) });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }])).resolves.toBeTruthy();
  });

  it('a shipped order with no parcels (legacy shape) cannot be returned yet', async () => {
    const u = customer();
    const { o, a } = await order(u._id, { status: 'shipped' });
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }]))
      .rejects.toMatchObject({ message: expect.stringMatching(/Only delivered orders/) });
  });
});

describe('debit-card EMI is all-or-nothing', () => {
  async function emiOrder(u, kind = 'debit_card') {
    const made = await order(u._id);
    const p = await Payment.create({
      order: made.o._id, user: u._id, amount: 1750, gatewayPaymentId: `pay_${made.o._id}`,
      paymentGateway: 'razorpay', paymentMethod: 'emi', status: 'completed', methodDetails: { emi: { kind, issuer: 'ICICI' } },
    });
    await Order.updateOne({ _id: made.o._id }, { $set: { payment: p._id } });
    return { ...made, o: await Order.findById(made.o._id).lean() };
  }

  it('refuses a partial return before anything is collected, accepts everything', async () => {
    const u = customer();
    const { o, a, b } = await emiOrder(u);
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }]))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/refund in full/i) });
    await expect(raise(u, o, [{ itemId: a, quantity: 3, reason: 'wrong_item' }, { itemId: b, quantity: 1, reason: 'wrong_item' }]))
      .resolves.toBeTruthy();
  });

  it('leaves credit-card EMI partial returns alone', async () => {
    const u = customer();
    const { o, a } = await emiOrder(u, 'credit_card');
    await expect(raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }])).resolves.toBeTruthy();
  });
});

describe('the estimate before submitting', () => {
  it('our fault adds the shipping share; a customer reason says the pickup cost comes off', async () => {
    const u = customer();
    const { o, a } = await order(u._id, { shippingCost: 175, totalAmount: 1925 });
    const ours = await svc.estimateForCustomer(u, { orderId: String(o._id), items: [{ itemId: a, quantity: 1, reason: 'wrong_item' }] });
    // ₹500 of ₹1,750 goods → 500/1750 of the ₹175 delivery = ₹50.
    expect(ours).toMatchObject({ goods: 500, shippingShare: 50, total: 550, pickupCostDeducted: false });
    const theirs = await svc.estimateForCustomer(u, { orderId: String(o._id), items: [{ itemId: a, quantity: 1, reason: 'changed_mind' }] });
    expect(theirs).toMatchObject({ goods: 500, shippingShare: 0, total: 500, pickupCostDeducted: true });
    await expect(svc.estimateForCustomer(customer(), { orderId: String(o._id), items: [{ itemId: a, quantity: 1 }] }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('the order page tracker (GET /returns/my-returns?orderId=)', () => {
  it("lists this customer's returns on the order — without staff notes, claims or private evidence", async () => {
    const u = customer();
    const { o, a, b } = await order(u._id);
    const rr = await raise(u, o, [{ itemId: a, quantity: 1, reason: 'wrong_item' }]);
    await ReturnRequest.updateOne({ _id: rr._id }, {
      $set: { adminNotes: 'internal', supplierClaims: [{ supplierName: 'Ram Traders', status: 'open' }] },
      $push: { timeline: { status: 'approved', note: 'staff-only note', timestamp: new Date() } },
    });
    await raise(customer(), (await order(oid())).o, [], {}).catch(() => {}); // another customer's, ignored
    await raise(u, o, [{ itemId: b, quantity: 1, reason: 'wrong_item' }]);

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await getMyReturns({ user: u, query: { orderId: String(o._id) } }, res, next);
    expect(next).not.toHaveBeenCalled();
    const { requests } = res.json.mock.calls[0][0];
    expect(requests).toHaveLength(2);
    const view = requests.find((r) => String(r._id) === String(rr._id));
    expect(view).toMatchObject({ status: 'pending', hasVideo: false, photoCount: 1, refund: { finalAmount: null } });
    // The order line id lets the page work out which units are already coming back.
    expect(view.items[0]).toMatchObject({ reason: 'wrong_item', fault: 'ours' });
    expect(String(view.items[0].orderItemId)).toBe(a);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/internal|staff-only|Ram Traders|publicId/);
  });
});
