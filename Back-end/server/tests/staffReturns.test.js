/**
 * Returns in the team panel (services/returnService.js) against a real in-memory Mongo,
 * through the REAL refund service, repositories and order services.
 *
 * What must hold (owner-approved rule 9, 2026-10-30):
 *   - the permission matrix: who may raise, review, pick up, inspect, refund, chase the
 *     supplier and confirm supplier money — and who may NOT
 *   - the destination is pre-filled from where each line came from
 *   - own stock skips the supplier track; supplier lines open it after check 2
 *   - the customer refund never waits for the supplier — not while the claim is open,
 *     not when the supplier rejects it
 *   - a supplier settlement is confirmed exactly once, however many people press it
 *   - "Suppliers owe us" lists every promised-but-unreceived settlement, oldest first
 *   - two failed pickups cancel the return (and tell the customer once)
 *   - the bell counts are the list queries
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: (name, data) => { enqueued.push({ name, data }); },
  closeQueues: () => Promise.resolve(),
}));

const stored = new Map();
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

// Evidence lives in private storage the test cannot reach: accept any reference given.
const asset = (raw, resourceType) => (raw?.publicId ? { publicId: raw.publicId, resourceType, bytes: 100, provider: 'r2' } : null);
jest.unstable_mockModule('../services/returnEvidence.js', () => {
  const m = {
    verifyVideo: async (raw) => asset(raw, 'video'),
    verifyProof: async (raw) => asset(raw, 'image'),
    verifyPhotos: async (raws) => (raws || []).map((r) => asset(r, 'image')).filter(Boolean),
    uploadTargets: async () => ({ provider: 'r2', uploads: [] }),
    withSignedEvidence: async (rr) => ({ ...rr, video: null, proofOfPurchase: null, images: [] }),
  };
  return { ...m, default: m };
});

const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: User } = await import('../models/User.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: ReturnRequest } = await import('../models/ReturnRequest.js');
const { default: razorpayService } = await import('../services/razorpayService.js');
const { default: orderRepository } = await import('../repositories/orderRepository.js');
const svc = await import('../services/returnService.js');
const { postBusinessUpdate, RETURN_CHAT_JOB } = await import('../services/chatBusinessUpdates.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

jest.setTimeout(120000);
beforeAll(async () => { await ReturnRequest.createIndexes(); });

const DAY = 24 * 60 * 60 * 1000;
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);
const photo = () => ({ buffer: JPEG, mimetype: 'image/jpeg', originalname: 'item.jpg' });
const req = (user, body = {}, params = {}) => ({ headers: {}, ip: '127.0.0.1', connection: {}, get: () => '', user, body, params });
const PHOTOS = [{ publicId: 'autobacs/returns/n1/photo-1.jpg' }];

let n = 0;
async function person(team, { isHead = false, subRole } = {}) {
  n += 1;
  return User.create({
    name: `${team} ${n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true, ...(subRole && { subRole }) },
  });
}
const admin = () => User.create({ name: 'Admin', email: `admin${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });
const customer = () => User.create({ name: 'Ravi', email: `c${++n}@x.test`, passwordHash: 'x', role: 'customer' });

/**
 * A delivered, paid order: a dash cam from a supplier (Ram Traders, paid by PR-0042),
 * floor mats from our own stock, an installation custom line, ₹200 shipping.
 */
async function deliveredOrder({ deliveredDaysAgo = 1, camPrice = 9000, gateway = true, salesUser = null } = {}) {
  const cam = new mongoose.Types.ObjectId();
  const mat = new mongoose.Types.ObjectId();
  const fit = new mongoose.Types.ObjectId();
  const buyer = await customer();
  const order = await Order.create({
    user: buyer._id,
    salesUser,
    items: [
      { _id: cam, product: new mongoose.Types.ObjectId(), name: 'Dash cam', price: camPrice, quantity: 1 },
      { _id: mat, product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 2 },
      { _id: fit, product: null, custom: true, name: 'Installation', price: 1000, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '+91 98765 43210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: camPrice + 3000, shippingCost: 200, totalAmount: camPrice + 3200,
    status: 'delivered', paymentStatus: 'paid',
    deliveredAt: new Date(Date.now() - deliveredDaysAgo * DAY),
    workflow: {
      enteredAt: new Date(Date.now() - 10 * DAY),
      open: false,
      lines: [
        { itemId: cam, stock: 'ordered', supplierName: 'Ram Traders' },
        { itemId: mat, stock: 'own_stock' },
        { itemId: fit, stock: 'own_stock' },
      ],
    },
  });
  if (gateway) {
    const payment = await Payment.create({
      order: order._id, user: buyer._id, amount: order.totalAmount, gatewayPaymentId: `pay_${order._id}`,
      paymentGateway: 'razorpay', paymentMethod: 'upi', status: 'completed',
    });
    await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
  }
  const proc = await person('procurement');
  await PaymentRequest.create({
    number: `PR-${String(++n).padStart(4, '0')}`, kind: 'supplier', status: 'paid', team: 'procurement',
    requestedBy: proc._id, requestedByName: proc.name, amount: 7000, category: 'supplier',
    payee: { name: 'Ram Traders', method: 'upi', upiId: 'ram@upi' },
    order: order._id, itemIds: [cam],
  });
  return { order: await Order.findById(order._id).lean(), cam: String(cam), mat: String(mat), fit: String(fit) };
}

/** Raise → approve → courier → received → inspection passed. */
async function passedReturn(o, { lines, destination = { kind: 'warehouse' } } = {}) {
  const ops = await person('operations');
  const seller = await person('sales', { isHead: true });
  const raised = await svc.raiseReturn(seller, {
    orderId: String(o.order._id), items: lines || [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }],
    description: 'Wrong model sent', images: PHOTOS, video: { publicId: 'autobacs/returns/n1/video.mp4' },
  }, req(seller));
  await svc.reviewReturn(ops, raised.id, { decision: 'approve', destination }, req(ops));
  if (destination.kind === 'supplier') {
    const proc = await person('procurement');
    await svc.bookPickup(proc, raised.id, { provider: 'Delhivery', trackingNumber: 'DL1', bookedBy: 'supplier' }, req(proc));
    await svc.markReceived(proc, raised.id, {}, req(proc));
    await svc.recordSupplierCheck(proc, raised.id, { passed: true, notes: 'Supplier confirms the wrong model' }, [photo()], req(proc));
    await svc.recordInspection(ops, raised.id, { passed: true, notes: 'Confirmed', disposition: 'return_to_supplier' }, [], req(ops));
  } else {
    await svc.bookPickup(ops, raised.id, { provider: 'Delhivery', trackingNumber: 'DL1' }, req(ops));
    await svc.markReceived(ops, raised.id, {}, req(ops));
    await svc.recordInspection(ops, raised.id, { passed: true, notes: 'Wrong model, unused', disposition: 'resell' }, [photo()], req(ops));
  }
  return { id: raised.id, ops, seller };
}

const forbidden = (p) => expect(p).rejects.toMatchObject({ statusCode: 403 });

beforeEach(() => {
  enqueued.length = 0;
  stored.clear();
  jest.spyOn(razorpayService, 'refundPayment').mockImplementation(async (_pay, amountPaise) => ({ refundId: `rfnd_${++n}`, status: 'processed', amount: amountPaise }));
});
afterEach(() => { jest.restoreAllMocks(); });

describe('raising a return (staff, for the customer)', () => {
  it('a GTM lead raises one with the customer\'s photo; the customer is emailed and operations told', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await svc.raiseReturn(lead, {
      orderId: String(o.order._id), items: [{ itemId: o.cam, quantity: 1, reason: 'manufacturing_defect' }],
      description: 'Does not power on', images: PHOTOS,
    }, req(lead));
    expect(r).toMatchObject({ status: 'pending', origin: 'staff', stage: 'Check 1 — evidence' });
    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.items[0]).toMatchObject({ reason: 'manufacturing_defect', fault: { claimed: 'ours' } });
    expect(String(saved.items[0].orderItemId)).toBe(o.cam);
    expect(saved.customerPhone).toBe('9876543210');
    expect(enqueued.map((j) => j.name)).toEqual(expect.arrayContaining(['send-return-submitted', 'post-return-update']));
    expect(enqueued.find((j) => j.name === 'post-return-update').data.event).toBe('raised_ops');
  });

  it('needs at least one photo, and a video for transit damage or a line over ₹10,000', async () => {
    const o = await deliveredOrder({ camPrice: 12000 });
    const ops = await person('operations');
    const base = { orderId: String(o.order._id), description: 'x' };
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops)))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/at least one photo/i) });
    await expect(svc.raiseReturn(ops, { ...base, images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'transit_damage' }] }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/video/i) });
    await expect(svc.raiseReturn(ops, { ...base, images: PHOTOS, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/video/i) });
    await expect(svc.raiseReturn(ops, {
      ...base, images: PHOTOS, video: { publicId: 'autobacs/returns/n1/video.mp4' }, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }],
    }, req(ops))).resolves.toMatchObject({ status: 'pending' });
  });

  it('gives our-fault reasons 7 days and customer reasons 4', async () => {
    const o = await deliveredOrder({ deliveredDaysAgo: 5 });
    const ops = await person('operations');
    const base = { orderId: String(o.order._id), description: 'x', images: PHOTOS, unusedDeclared: true };
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.mat, quantity: 1, reason: 'changed_mind' }] }, req(ops)))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/window .* closed/i) });
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.mat, quantity: 1, reason: 'missing_part' }] }, req(ops)))
      .resolves.toMatchObject({ status: 'pending' });
    const late = await deliveredOrder({ deliveredDaysAgo: 8 });
    await expect(svc.raiseReturn(ops, { ...base, orderId: String(late.order._id), items: [{ itemId: late.mat, quantity: 1, reason: 'missing_part' }] }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/closed/i) });
  });

  it("customer's reason: needs the unused-in-box declaration and a returnable product; our fault never does", async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const base = { orderId: String(o.order._id), description: 'x', images: PHOTOS };
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.mat, quantity: 1, reason: 'ordered_wrong' }] }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/unused/i) });

    const order = await Order.findById(o.order._id);
    await Product.collection.insertOne({ _id: order.items[1].product, name: 'Floor mat', returnPolicy: { returnable: false, nonReturnReason: 'custom' } });
    await expect(svc.raiseReturn(ops, { ...base, unusedDeclared: true, items: [{ itemId: o.mat, quantity: 1, reason: 'ordered_wrong' }] }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/non-returnable/i) });
    // A defect is always accepted, non-returnable list or not (Consumer Protection Rules 2020).
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.mat, quantity: 1, reason: 'manufacturing_defect' }] }, req(ops)))
      .resolves.toMatchObject({ status: 'pending' });
  });

  it('never returns more units than were delivered, nor an installation line on its own', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const base = { orderId: String(o.order._id), description: 'x', images: PHOTOS };
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.mat, quantity: 3, reason: 'wrong_item' }] }, req(ops)))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.fit, quantity: 1, reason: 'wrong_item' }] }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/not a catalogue item/i) });
  });
});

describe('the permission matrix', () => {
  it('raise: GTM head/lead, operations, admin — never an executive, procurement or accounts', async () => {
    const o = await deliveredOrder();
    const input = { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] };
    await forbidden(svc.raiseReturn(await person('sales', { subRole: 'executive' }), input, req()));
    await forbidden(svc.raiseReturn(await person('procurement'), input, req()));
    await forbidden(svc.raiseReturn(await person('accounts'), input, req()));
    await expect(svc.raiseReturn(await person('sales'), input, req())).resolves.toBeTruthy();
  });

  it('review: operations and admin — never sales, procurement or accounts', async () => {
    const o = await deliveredOrder();
    const head = await person('sales', { isHead: true });
    const r = await svc.raiseReturn(head, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(head));
    for (const who of [head, await person('procurement'), await person('accounts')]) {
      await forbidden(svc.reviewReturn(who, r.id, { decision: 'approve' }, req(who)));
    }
    await expect(svc.reviewReturn(await person('operations'), r.id, { decision: 'approve' }, req())).resolves.toMatchObject({ status: 'approved' });
  });

  it('installer damage is approved by admin only', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'Scratched dash', images: PHOTOS, items: [{ itemId: o.cam, quantity: 1, reason: 'installer_damage' }] }, req(ops));
    await forbidden(svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops)));
    await expect(svc.reviewReturn(await admin(), r.id, { decision: 'approve' }, req())).resolves.toMatchObject({ status: 'approved' });
  });

  it('inspection: operations only; the supplier check: procurement only', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    await svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops));
    await forbidden(svc.bookPickup(await person('procurement'), r.id, { provider: 'X', trackingNumber: '1' }, req()));
    await svc.markDroppedAtStore(ops, r.id, { note: 'Walk-in' }, req(ops));
    await forbidden(svc.recordInspection(await person('procurement'), r.id, { passed: true, notes: 'ok', disposition: 'resell' }, [photo()], req()));
    await forbidden(svc.recordInspection(await person('accounts'), r.id, { passed: true, notes: 'ok', disposition: 'resell' }, [photo()], req()));
    await expect(svc.recordInspection(ops, r.id, { passed: true, notes: 'ok', disposition: 'resell' }, [photo()], req(ops)))
      .resolves.toMatchObject({ stage: 'Refund to send' });
  });

  it('refund: accounts up to ₹25,000, the accounts head or admin above; never procurement or sales', async () => {
    const o = await deliveredOrder({ camPrice: 30000 });
    const { id } = await passedReturn(o, { lines: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] });
    const accounts = await person('accounts');
    for (const who of [await person('procurement'), await person('sales', { isHead: true }), await person('operations')]) {
      await forbidden(svc.sendRefund(who, id, req(who, {}, { id })));
    }
    await expect(svc.sendRefund(accounts, id, req(accounts, {}, { id })))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/25,000/) });
    expect(razorpayService.refundPayment).not.toHaveBeenCalled();
    const head = await person('accounts', { isHead: true });
    const out = await svc.sendRefund(head, id, req(head, {}, { id }));
    // ₹30,000 + its share of the ₹200 shipping: 200 × 30,000 / 32,000 catalogue goods = ₹187.50.
    expect(out.refund.amount).toBe(30187.5);
  });

  it('a bank-transfer / cash payout is recorded by admin only — never accounts', async () => {
    const o = await deliveredOrder({ gateway: false });
    const { id } = await passedReturn(o, { lines: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] });
    const body = { method: 'offline', offlineMethod: 'bank_transfer', reference: 'UTR123' };
    const accounts = await person('accounts', { isHead: true });
    await forbidden(svc.sendRefund(accounts, id, req(accounts, body, { id })));
    const boss = await admin();
    const out = await svc.sendRefund(boss, id, req(boss, body, { id }));
    expect(out.refund).toMatchObject({ method: 'offline', status: 'completed' });
  });
});

describe('the flow', () => {
  it('pre-fills the destination with the supplier the line came from — never for own stock', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const both = await svc.raiseReturn(ops, {
      orderId: String(o.order._id), description: 'x', images: PHOTOS, video: { publicId: 'v' },
      items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }, { itemId: o.mat, quantity: 1, reason: 'wrong_item' }],
    }, req(ops));
    expect(both.destinationOptions).toEqual({ default: 'warehouse', suppliers: ['Ram Traders'] });
    const o2 = await deliveredOrder();
    const own = await svc.raiseReturn(ops, { orderId: String(o2.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o2.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    expect(own.destinationOptions.suppliers).toEqual([]);
  });

  it('a fault change at review needs a note, and decides the money', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'manufacturing_defect' }] }, req(ops));
    await expect(svc.reviewReturn(ops, r.id, { decision: 'approve', faults: { [o.mat]: { confirmed: 'customer' } } }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/note/i) });
    const done = await svc.reviewReturn(ops, r.id, { decision: 'approve', faults: { [o.mat]: { confirmed: 'customer', note: 'Fitted wrongly by the customer' } } }, req(ops));
    expect(done.lines[0].fault).toMatchObject({ claimed: 'ours', confirmed: 'customer' });
  });

  it('own stock skips the supplier track; a supplier line opens it, linked to the PR that paid for it', async () => {
    const o = await deliveredOrder();
    const own = await passedReturn(o, { lines: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] });
    expect((await ReturnRequest.findById(own.id).lean()).supplierClaims).toEqual([]);

    const o2 = await deliveredOrder();
    const sup = await passedReturn(o2);
    const claims = (await ReturnRequest.findById(sup.id).lean()).supplierClaims;
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ status: 'open', supplierName: 'Ram Traders', paymentRequestRef: expect.stringMatching(/^PR-/) });
    expect(enqueued.filter((j) => j.name === 'post-return-update').map((j) => j.data.event))
      .toEqual(expect.arrayContaining(['inspected_pass', 'supplier_claim_opened']));
  });

  it('the customer refund is not blocked by an open supplier claim', async () => {
    const o = await deliveredOrder();
    const { id } = await passedReturn(o);
    const accounts = await person('accounts');
    const out = await svc.sendRefund(accounts, id, req(accounts, {}, { id }));
    expect(out.refund).toMatchObject({ status: 'completed', amount: 9000 + Math.floor(200 * 9000 / 11000 * 100) / 100 });
    expect((await ReturnRequest.findById(id).lean()).supplierClaims[0].status).toBe('open');
  });

  it('a supplier rejection records the loss and still lets the customer be refunded', async () => {
    const o = await deliveredOrder();
    const { id } = await passedReturn(o);
    const proc = await person('procurement');
    const claimId = String((await ReturnRequest.findById(id).lean()).supplierClaims[0]._id);
    await expect(svc.recordSupplierAnswer(proc, id, claimId, { accepted: false }, req(proc)))
      .rejects.toMatchObject({ message: expect.stringMatching(/why/i) });
    await svc.recordSupplierAnswer(proc, id, claimId, { accepted: false, note: 'Says it left them working' }, req(proc));
    const claim = (await ReturnRequest.findById(id).lean()).supplierClaims[0];
    expect(claim).toMatchObject({ status: 'rejected', loss: { recorded: true } });
    const accounts = await person('accounts');
    await expect(svc.sendRefund(accounts, id, req(accounts, {}, { id }))).resolves.toMatchObject({ success: true });
  });

  it('the refund goes out once when accounts and admin press it together', async () => {
    const o = await deliveredOrder();
    const { id } = await passedReturn(o, { lines: [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }] });
    const accounts = await person('accounts');
    const boss = await admin();
    const outcomes = await Promise.allSettled([
      svc.sendRefund(accounts, id, req(accounts, {}, { id })),
      svc.sendRefund(boss, id, req(boss, {}, { id })),
    ]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(razorpayService.refundPayment).toHaveBeenCalledTimes(1);
  });

  /*
    Two returns on ONE order draw on one capture. Each computes "what is left" from a
    snapshot of the order; before the order's refund fence, a second refund computed
    from the same snapshot as the first could not see it and paid as if it were alone.
    Here the customer paid ₹9,200 (₹12,200 less a ₹3,000 Razorpay offer); the dash cam
    and the mats each fit alone, but not together.
  */
  async function offerOrderWithTwoReturns() {
    const o = await deliveredOrder();
    await Order.updateOne({ _id: o.order._id }, { $set: { gatewayOffer: { discount: 3000, amountPaid: 9200 } } });
    const first = await passedReturn(o, { lines: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] });
    const second = await passedReturn(o, { lines: [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }] });
    return { o, first, second };
  }
  const paidPaise = () => razorpayService.refundPayment.mock.calls.reduce((sum, c) => sum + c[1], 0);

  it('a refund computed before another return on the order was refunded pays nothing, and can be sent again', async () => {
    const { o, first, second } = await offerOrderWithTwoReturns();
    const boss = await admin();
    // What a slow second request read, before the first refund went out.
    const stale = await Order.findById(o.order._id);
    await svc.sendRefund(boss, first.id, req(boss, {}, { id: first.id }));

    const realFind = orderRepository.findById.bind(orderRepository);
    const spy = jest.spyOn(orderRepository, 'findById')
      .mockImplementation(async (id, ...rest) => (String(id) === String(o.order._id) ? stale : realFind(id, ...rest)));
    await expect(svc.sendRefund(boss, second.id, req(boss, {}, { id: second.id })))
      .rejects.toMatchObject({ statusCode: 409 });
    spy.mockRestore();

    expect(razorpayService.refundPayment).toHaveBeenCalledTimes(1);
    const parked = await ReturnRequest.findById(second.id).lean();
    expect(parked.status).toBe('received');
    expect(parked.refund.status).toBe('pending');

    // Sent again with a fresh read, it pays only what is left — never past ₹9,200.
    await Promise.allSettled([svc.sendRefund(boss, second.id, req(boss, {}, { id: second.id }))]);
    expect(paidPaise()).toBe(920000);
  });

  it('two returns on one order refunded at the same moment never pay more than the customer paid', async () => {
    const { first, second } = await offerOrderWithTwoReturns();
    const accounts = await person('accounts', { isHead: true });
    const boss = await admin();
    const outcomes = await Promise.allSettled([
      svc.sendRefund(accounts, first.id, req(accounts, {}, { id: first.id })),
      svc.sendRefund(boss, second.id, req(boss, {}, { id: second.id })),
    ]);
    expect(outcomes.some((x) => x.status === 'fulfilled')).toBe(true);
    expect(paidPaise()).toBeLessThanOrEqual(920000);
    for (const x of outcomes.filter((r) => r.status === 'rejected')) {
      expect([409, 422]).toContain(x.reason.statusCode);
    }
  });

  it('direct to supplier: procurement books it and records the supplier check; operations confirms', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    await svc.reviewReturn(ops, r.id, { decision: 'approve', destination: { kind: 'supplier', supplierName: 'Ram Traders' } }, req(ops));
    await forbidden(svc.bookPickup(ops, r.id, { provider: 'X', trackingNumber: '1' }, req(ops)));
    const proc = await person('procurement');
    await svc.bookPickup(proc, r.id, { provider: 'Blue Dart', trackingNumber: 'BD9', bookedBy: 'supplier' }, req(proc));
    await svc.markReceived(proc, r.id, {}, req(proc));
    await expect(svc.recordInspection(ops, r.id, { passed: true, notes: 'ok', disposition: 'return_to_supplier' }, [], req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/supplier's check first/i) });
    await svc.recordSupplierCheck(proc, r.id, { passed: true, notes: 'Wrong model confirmed' }, [photo()], req(proc));
    const done = await svc.recordInspection(ops, r.id, { passed: true, notes: 'Agree with supplier', disposition: 'return_to_supplier' }, [], req(ops));
    expect(done).toMatchObject({ stage: 'Refund to send', pickupMode: 'supplier_direct' });
    expect(done.pickup).toMatchObject({ mode: 'supplier_direct', bookedBy: 'supplier' });
  });

  it("customer's reason: operations records the pickup cost at check 2 and the refund deducts it", async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, {
      orderId: String(o.order._id), description: 'Ordered for the wrong car', images: PHOTOS, unusedDeclared: true,
      items: [{ itemId: o.mat, quantity: 2, reason: 'ordered_wrong' }],
    }, req(ops));
    await svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops));
    await svc.bookPickup(ops, r.id, { provider: 'Delhivery', trackingNumber: 'DL5' }, req(ops));
    await svc.markReceived(ops, r.id, {}, req(ops));
    // No reason → refused; more than the ₹2,000 the mats are worth → refused.
    await expect(svc.recordInspection(ops, r.id, { passed: true, notes: 'Unused', disposition: 'resell', pickupCostRupees: 300 }, [photo()], req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/pickup cost is for/i) });
    await expect(svc.recordInspection(ops, r.id, { passed: true, notes: 'Unused', disposition: 'resell', pickupCostRupees: 2500, pickupCostReason: 'x' }, [photo()], req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/at most ₹2000/) });
    await svc.recordInspection(ops, r.id, {
      passed: true, notes: 'Unused, in the box', disposition: 'resell', pickupCostRupees: 300, pickupCostReason: 'Delhivery AWB DL5',
    }, [photo()], req(ops));

    const accounts = await person('accounts');
    const preview = await svc.refundPreviewFor(accounts, r.id, null);
    expect(preview.preview.breakdown).toMatchObject({ goodsNet: 2000, shippingShare: 0, pickupDeduction: 300, total: 1700 });
    const out = await svc.sendRefund(accounts, r.id, req(accounts, {}, { id: r.id }));
    expect(out.refund.amount).toBe(1700);
    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.refund).toMatchObject({ pickupDeduction: 300, pickupDeductionReason: 'Delhivery AWB DL5', finalAmount: 1700 });
  });

  it('a failed inspection rejects it, with what happens to the item', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'manufacturing_defect' }] }, req(ops));
    await svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops));
    await svc.markDroppedAtStore(ops, r.id, {}, req(ops));
    await expect(svc.recordInspection(ops, r.id, { passed: false, notes: 'Cut by customer' }, [photo()], req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/send it back|hold/i) });
    const done = await svc.recordInspection(ops, r.id, { passed: false, notes: 'Cut by customer', failAction: 'hold' }, [photo()], req(ops));
    expect(done.status).toBe('rejected');
    expect(done.inspection.holdUntil).toBeTruthy();
    expect(enqueued.some((j) => j.name === 'send-return-status-email' && j.data.event === 'rejected')).toBe(true);
  });

  it('two failed pickups cancel the return and tell the customer once', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    await svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops));
    await svc.bookPickup(ops, r.id, { provider: 'Delhivery', trackingNumber: 'DL1' }, req(ops));
    await expect(svc.recordPickupFailed(ops, r.id, {}, req(ops))).rejects.toMatchObject({ statusCode: 400 });
    const one = await svc.recordPickupFailed(ops, r.id, { note: 'Customer not home' }, req(ops));
    expect(one.status).toBe('courier_booked');
    const two = await svc.recordPickupFailed(ops, r.id, { note: 'Door locked' }, req(ops));
    expect(two.status).toBe('cancelled');
    await expect(svc.recordPickupFailed(ops, r.id, { note: 'again' }, req(ops))).rejects.toMatchObject({ statusCode: 409 });
    expect(enqueued.filter((j) => j.name === 'send-return-status-email' && j.data.event === 'pickup_failed')).toHaveLength(1);
    // The units are free again: a fresh return for them can be raised.
    await expect(svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'again', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops)))
      .resolves.toMatchObject({ status: 'pending' });
  });

  it('two people recording the same failed pickup at once count it once', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    await svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops));
    const outcomes = await Promise.allSettled([1, 2, 3].map(() => svc.recordPickupFailed(ops, r.id, { note: 'Not home' }, req(ops))));
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await ReturnRequest.findById(r.id).lean()).pickupAttempts).toHaveLength(1);
  });
});

describe('supplier money', () => {
  async function promised(amountRupees = 7000) {
    const o = await deliveredOrder();
    const { id } = await passedReturn(o);
    const proc = await person('procurement');
    const claimId = String((await ReturnRequest.findById(id).lean()).supplierClaims[0]._id);
    await svc.recordSupplierAnswer(proc, id, claimId, { accepted: true, reference: 'RMA-7' }, req(proc));
    await svc.promiseSettlement(proc, id, claimId, { kind: 'credit_note', amountRupees, reference: 'CN-RT-1' }, req(proc));
    return { id, claimId };
  }

  it('is confirmed exactly once, however many people press it', async () => {
    const { id, claimId } = await promised();
    const accounts = await person('accounts');
    const boss = await admin();
    const outcomes = await Promise.allSettled([
      svc.confirmSupplierMoney(accounts, id, claimId, { method: 'bank', utr: 'UTR-1' }, req(accounts)),
      svc.confirmSupplierMoney(boss, id, claimId, { method: 'bank', utr: 'UTR-2' }, req(boss)),
      svc.confirmSupplierMoney(accounts, id, claimId, { method: 'bank', utr: 'UTR-3' }, req(accounts)),
    ]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const claim = (await ReturnRequest.findById(id).lean()).supplierClaims[0];
    expect(claim.status).toBe('settled');
    expect(['UTR-1', 'UTR-2', 'UTR-3']).toContain(claim.settlement.received.utr);
  });

  it('accounts and admin confirm it — never procurement or sales', async () => {
    const { id, claimId } = await promised();
    await forbidden(svc.confirmSupplierMoney(await person('procurement'), id, claimId, { method: 'bank', utr: 'U' }, req()));
    await forbidden(svc.confirmSupplierMoney(await person('sales', { isHead: true }), id, claimId, { method: 'bank', utr: 'U' }, req()));
  });

  it('a deduction must name a real supplier payment request', async () => {
    const { id, claimId } = await promised();
    const accounts = await person('accounts');
    await expect(svc.confirmSupplierMoney(accounts, id, claimId, { method: 'deducted', deductedFromRef: 'PR-9999' }, req(accounts)))
      .rejects.toMatchObject({ statusCode: 400 });
    const pr = await PaymentRequest.findOne({ kind: 'supplier' }).lean();
    const done = await svc.confirmSupplierMoney(accounts, id, claimId, { method: 'deducted', deductedFromRef: pr.number }, req(accounts));
    expect(done.supplierClaims[0].settlement.received).toMatchObject({ method: 'deducted', deductedFromRef: pr.number });
  });

  it('"Suppliers owe us" lists every promised, unreceived settlement — oldest first, totals by supplier', async () => {
    const a = await promised(7000);
    await promised(3000);
    const settled = await promised(500);
    const accounts = await person('accounts');
    await svc.confirmSupplierMoney(accounts, settled.id, settled.claimId, { method: 'bank', utr: 'U' }, req(accounts));

    const owed = await svc.suppliersOweUs(accounts);
    expect(owed.items.map((i) => i.amount)).toEqual([7000, 3000]);
    expect(owed.items[0]).toMatchObject({ returnId: a.id, supplierName: 'Ram Traders', kind: 'credit_note', ageDays: 0 });
    expect(owed.totals).toEqual([expect.objectContaining({ supplierName: 'Ram Traders', amount: 10000, claims: 2 })]);
    await forbidden(svc.suppliersOweUs(await person('sales', { isHead: true })));
  });
});

describe('lists and the bell', () => {
  it('each queue lists what waits on that team, and the bell counts the same', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    const review = await svc.listReturns(ops, { queue: 'review' });
    expect(review.returns.map((x) => x.id)).toEqual([r.id]);
    const bell = await svc.countsFor(ops);
    expect(bell.find((b) => b.key === 'returns_review').count).toBe(1);

    await svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops));
    expect((await svc.listReturns(ops, { queue: 'review' })).returns).toEqual([]);
    expect((await svc.listReturns(ops, { queue: 'pickup' })).returns.map((x) => x.id)).toEqual([r.id]);
    expect((await svc.countsFor(ops)).find((b) => b.key === 'returns_pickup').count).toBe(1);
    await forbidden(svc.listReturns(await person('procurement'), { queue: 'review' }));
  });

  it('pages with a cursor, newest first, never repeating a row', async () => {
    const ops = await person('operations');
    const made = [];
    for (let i = 0; i < 27; i += 1) {
      const o = await deliveredOrder();
      made.push((await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops))).id);
    }
    const first = await svc.listReturns(ops, { queue: 'review' });
    expect(first.returns).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    const second = await svc.listReturns(ops, { queue: 'review', cursor: first.nextCursor });
    expect(second.returns).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const all = [...first.returns, ...second.returns].map((x) => x.id);
    expect(new Set(all).size).toBe(27);
    expect(all).toEqual([...made].reverse());
  });

  it('a GTM lead sees only the returns they raised or sold', async () => {
    const lead = await person('sales');
    const other = await person('sales');
    const o = await deliveredOrder({ salesUser: lead._id });
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    expect((await svc.listReturns(lead, { queue: 'mine' })).returns.map((x) => x.id)).toEqual([r.id]);
    await expect(svc.getReturn(other, r.id)).rejects.toMatchObject({ statusCode: 404 });
    await forbidden(svc.listReturns(lead, { queue: 'all' }));
  });

  it('shows the repeat-returner count (a flag, never a block)', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    const second = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'y', images: PHOTOS, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    expect(second.repeatReturns).toBe(2);
  });
});

describe('team chat (which also pushes to phones)', () => {
  async function posts() {
    const channels = await ChatChannel.find({}).lean();
    const keyOf = new Map(channels.map((c) => [String(c._id), c.key]));
    const msgs = await ChatMessage.find({ kind: 'system' }).sort({ createdAt: 1, seq: 1 }).lean();
    return msgs.map((m) => ({ space: keyOf.get(String(m.channel)), text: m.text, mentions: (m.mentions || []).map(String) }));
  }
  /** Run every captured return job through the chat poster, as the worker does. */
  async function drain() {
    const jobs = enqueued.splice(0).filter((j) => j.name === RETURN_CHAT_JOB);
    let i = 0;
    for (const job of jobs) await postBusinessUpdate(job.name, job.data, { jobId: `j${++i}` });
    return jobs.map((j) => j.data.event);
  }
  beforeEach(async () => { await ChatMessage.deleteMany({}); });

  it('each step lands in the space of the team that acts next, naming the seller', async () => {
    const seller = await person('sales');
    const o = await deliveredOrder({ salesUser: seller._id });
    await person('accounts');
    const { id } = await passedReturn(o);
    const events = await drain();
    expect(events).toEqual(expect.arrayContaining(['raised_ops', 'approved', 'inspected_pass', 'supplier_claim_opened']));
    const all = await posts();
    expect(all.find((p) => /New return/.test(p.text)).space).toBe('team:operations');
    const approved = all.find((p) => /approved/.test(p.text));
    expect(approved.space).toBe('team:sales');
    expect(approved.mentions).toEqual([String(seller._id)]);
    expect(all.find((p) => /passed inspection/.test(p.text)).space).toBe('team:accounts');
    expect(all.find((p) => /claim from Ram Traders/.test(p.text)).space).toBe('team:procurement');
    expect(all.some((p) => p.space === 'company')).toBe(false);

    const accounts = await person('accounts');
    await svc.sendRefund(accounts, id, req(accounts, {}, { id }));
    expect(await drain()).toEqual(['refunded']);
    const refunded = (await posts()).find((p) => /Refund of/.test(p.text));
    expect(refunded).toMatchObject({ space: 'team:sales', mentions: [String(seller._id)] });
  });

  it('a website return alerts the sales heads when there is no seller; a retried job posts once', async () => {
    const head = await person('sales', { isHead: true });
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    enqueued.length = 0;
    await postBusinessUpdate(RETURN_CHAT_JOB, { event: 'raised_sales', returnId: r.id });
    await postBusinessUpdate(RETURN_CHAT_JOB, { event: 'raised_sales', returnId: r.id });
    const sales = (await posts()).filter((p) => p.space === 'team:sales');
    expect(sales).toHaveLength(1);
    expect(sales[0].mentions).toContain(String(head._id));
    expect(sales[0].text).toMatch(/please call them/);
  });
});
