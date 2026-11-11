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
const { default: auditLogger } = await import('../services/auditLogger.js');
const { default: returnRequestRepository } = await import('../repositories/returnRequestRepository.js');
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
const VIDEO = { publicId: 'autobacs/returns/n1/video.mp4' };

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
    description: 'Wrong model sent', images: PHOTOS, video: VIDEO,
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
      description: 'Does not power on', images: PHOTOS, video: VIDEO,
    }, req(lead));
    expect(r).toMatchObject({ status: 'pending', origin: 'staff', stage: 'Check 1 — evidence' });
    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.items[0]).toMatchObject({ reason: 'manufacturing_defect', fault: { claimed: 'ours' } });
    expect(String(saved.items[0].orderItemId)).toBe(o.cam);
    expect(saved.customerPhone).toBe('9876543210');
    expect(enqueued.map((j) => j.name)).toEqual(expect.arrayContaining(['send-return-submitted', 'post-return-update']));
    expect(enqueued.find((j) => j.name === 'post-return-update').data.event).toBe('raised_ops');
  });

  it('needs at least one photo and the unboxing video — every reason, every price', async () => {
    const o = await deliveredOrder({ camPrice: 12000 });
    const ops = await person('operations');
    const base = { orderId: String(o.order._id), description: 'x' };
    await expect(svc.raiseReturn(ops, { ...base, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops)))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/at least one photo/i) });
    for (const reason of ['wrong_item', 'manufacturing_defect', 'installer_damage', 'changed_mind']) {
      await expect(svc.raiseReturn(ops, { ...base, images: PHOTOS, unusedDeclared: true, items: [{ itemId: o.mat, quantity: 1, reason }] }, req(ops)))
        .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/unboxing video is required/i) });
    }
    expect(await ReturnRequest.countDocuments({ order: o.order._id })).toBe(0);
    await expect(svc.raiseReturn(ops, {
      ...base, images: PHOTOS, video: VIDEO, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }],
    }, req(ops))).resolves.toMatchObject({ status: 'pending' });
  });

  it('takes a YouTube link the customer sent on WhatsApp, and shows it to staff', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, {
      orderId: String(o.order._id), description: 'Cracked on arrival', images: PHOTOS,
      videoLink: 'https://www.youtube.com/watch?v=abc123', items: [{ itemId: o.mat, quantity: 1, reason: 'transit_damage' }],
    }, req(ops));
    expect(r.evidence.videoLink).toBe('https://www.youtube.com/watch?v=abc123');
    await expect(svc.raiseReturn(ops, {
      orderId: String(o.order._id), description: 'x', images: PHOTOS,
      videoLink: 'https://vimeo.com/123', items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }],
    }, req(ops))).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/google drive or youtube/i) });
  });

  it('a return raised before the video rule (no video, no link) still moves through the steps', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, {
      orderId: String(o.order._id), description: 'Old one', images: PHOTOS, video: VIDEO,
      items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }],
    }, req(ops));
    // As it would look in the database from before 2026-11-02.
    await ReturnRequest.collection.updateOne({ _id: new mongoose.Types.ObjectId(r.id) }, { $set: { video: null }, $unset: { videoLink: '' } });
    const view = await svc.getReturn(ops, r.id);
    expect(view.evidence.videoLink).toBeNull();
    await expect(svc.reviewReturn(ops, r.id, { decision: 'approve', destination: { kind: 'warehouse' } }, req(ops)))
      .resolves.toMatchObject({ status: 'approved' });
  });

  it('gives our-fault reasons 7 days and customer reasons 4', async () => {
    const o = await deliveredOrder({ deliveredDaysAgo: 5 });
    const ops = await person('operations');
    const base = { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, unusedDeclared: true };
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
    const base = { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO };
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
    const base = { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO };
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.mat, quantity: 3, reason: 'wrong_item' }] }, req(ops)))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.raiseReturn(ops, { ...base, items: [{ itemId: o.fit, quantity: 1, reason: 'wrong_item' }] }, req(ops)))
      .rejects.toMatchObject({ message: expect.stringMatching(/not a catalogue item/i) });
  });
});

describe('the permission matrix', () => {
  it('raise: GTM head/lead, operations, admin — never an executive, procurement or accounts', async () => {
    const o = await deliveredOrder();
    const input = { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] };
    await forbidden(svc.raiseReturn(await person('sales', { subRole: 'executive' }), input, req()));
    await forbidden(svc.raiseReturn(await person('procurement'), input, req()));
    await forbidden(svc.raiseReturn(await person('accounts'), input, req()));
    await expect(svc.raiseReturn(await person('sales'), input, req())).resolves.toBeTruthy();
  });

  it('review: operations and admin — never sales, procurement or accounts', async () => {
    const o = await deliveredOrder();
    const head = await person('sales', { isHead: true });
    const r = await svc.raiseReturn(head, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(head));
    for (const who of [head, await person('procurement'), await person('accounts')]) {
      await forbidden(svc.reviewReturn(who, r.id, { decision: 'approve' }, req(who)));
    }
    await expect(svc.reviewReturn(await person('operations'), r.id, { decision: 'approve' }, req())).resolves.toMatchObject({ status: 'approved' });
  });

  it('installer damage is approved by admin only', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'Scratched dash', images: PHOTOS, video: VIDEO, items: [{ itemId: o.cam, quantity: 1, reason: 'installer_damage' }] }, req(ops));
    await forbidden(svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops)));
    await expect(svc.reviewReturn(await admin(), r.id, { decision: 'approve' }, req())).resolves.toMatchObject({ status: 'approved' });
  });

  it('inspection: operations only; the supplier check: procurement only', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
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
    const own = await svc.raiseReturn(ops, { orderId: String(o2.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o2.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    expect(own.destinationOptions.suppliers).toEqual([]);
  });

  it('a fault change at review needs a note, and decides the money', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'manufacturing_defect' }] }, req(ops));
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
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] }, req(ops));
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

  it("the supplier's check notes may be formatted: cleaned when saved, plain words in the timeline, limit counts words", async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    await svc.reviewReturn(ops, r.id, { decision: 'approve', destination: { kind: 'supplier', supplierName: 'Ram Traders' } }, req(ops));
    const proc = await person('procurement');
    await svc.bookPickup(proc, r.id, { provider: 'Blue Dart', trackingNumber: 'BD9', bookedBy: 'supplier' }, req(proc));
    await svc.markReceived(proc, r.id, {}, req(proc));
    await expect(svc.recordSupplierCheck(proc, r.id, { passed: true, notes: '<p> </p>' }, [photo()], req(proc)))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.recordSupplierCheck(proc, r.id, { passed: true, notes: `<p>${'x'.repeat(1001)}</p>` }, [photo()], req(proc)))
      .rejects.toMatchObject({ statusCode: 400 });
    await svc.recordSupplierCheck(proc, r.id, { passed: true, notes: '<p><strong>Wrong model</strong><img src=x onerror=alert(1)></p><ul><li><p>box sealed</p></li></ul>' }, [photo()], req(proc));
    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.inspection.supplierCheck.notes).toBe('<p><strong>Wrong model</strong></p><ul><li><p>box sealed</p></li></ul>');
    expect(saved.timeline.at(-1).note).toBe("Supplier's check: passed — Wrong model • box sealed");
  });

  it("customer's reason: operations records the pickup cost at check 2 and the refund deducts it", async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, {
      orderId: String(o.order._id), description: 'Ordered for the wrong car', images: PHOTOS, video: VIDEO, unusedDeclared: true,
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
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'manufacturing_defect' }] }, req(ops));
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
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
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
    await expect(svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'again', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops)))
      .resolves.toMatchObject({ status: 'pending' });
  });

  it('two people recording the same failed pickup at once count it once', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
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
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
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
      made.push((await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops))).id);
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
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    expect((await svc.listReturns(lead, { queue: 'mine' })).returns.map((x) => x.id)).toEqual([r.id]);
    await expect(svc.getReturn(other, r.id)).rejects.toMatchObject({ statusCode: 404 });
    await forbidden(svc.listReturns(lead, { queue: 'all' }));
  });

  it('shows the repeat-returner count (a flag, never a block)', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    const second = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'y', images: PHOTOS, video: VIDEO, items: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] }, req(ops));
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
    const r = await svc.raiseReturn(ops, { orderId: String(o.order._id), description: 'x', images: PHOTOS, video: VIDEO, items: [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }] }, req(ops));
    enqueued.length = 0;
    await postBusinessUpdate(RETURN_CHAT_JOB, { event: 'raised_sales', returnId: r.id });
    await postBusinessUpdate(RETURN_CHAT_JOB, { event: 'raised_sales', returnId: r.id });
    const sales = (await posts()).filter((p) => p.space === 'team:sales');
    expect(sales).toHaveLength(1);
    expect(sales[0].mentions).toContain(String(head._id));
    expect(sales[0].text).toMatch(/please call them/);
  });
});

/*
  Editing a raised return (owner, 2026-11-06). What must hold:
    - money is never typed: the refund is recomputed from the ORDER's price, quantity
      only goes down, and a sent price field is ignored
    - who: the person who raised it, operations, admin — never accounts or another seller
    - locked once the refund is with Accounts (processing / completed)
    - every edit is one History line naming who and what (old → new)
    - saving the same edit twice writes once; a stale form is refused, not merged
    - the Accounts refund queue shows the new amount
*/
describe('editing a raised return', () => {
  const raise = async (o, raiser, items) => svc.raiseReturn(raiser, {
    orderId: String(o.order._id), items, description: 'Wrong model sent', images: PHOTOS, video: VIDEO,
  }, req(raiser));
  const edits = async (id) => (await ReturnRequest.findById(id).lean()).timeline.filter((t) => /^Edited by/.test(t.note));

  it('lowering the quantity lowers the refund from the order price, and History says who and what', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await raise(o, lead, [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }]);
    const before = (await ReturnRequest.findById(r.id).lean()).refund.finalAmount;
    expect(before).toBeGreaterThan(0);

    const out = await svc.editReturn(lead, r.id, {
      updatedAt: r.updatedAt, lines: [{ key: o.mat, quantity: 1, unitPrice: 1, price: 99999 }],
    }, req(lead));

    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.items[0].quantity).toBe(1);
    expect(saved.items[0].unitPrice).toBe(1000); // the order's price, never the client's
    expect(saved.refund.finalAmount).toBeCloseTo(before / 2, 2);
    expect(out.refund.amount).toBeCloseTo(before / 2, 2);
    const [line] = await edits(r.id);
    expect(line.note).toMatch(new RegExp(`^Edited by ${lead.name}: Floor mat: quantity 2 → 1 \\(refund ₹`));
    expect(String(line.updatedBy)).toBe(String(lead._id));
  });

  it('saving the same edit twice writes one History line; a stale form is refused', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await raise(o, lead, [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }]);
    const first = await svc.editReturn(lead, r.id, { description: 'Wrong colour sent' }, req(lead));
    await svc.editReturn(lead, r.id, { description: 'Wrong colour sent' }, req(lead)); // double-click
    expect(await edits(r.id)).toHaveLength(1);

    // A form opened before the first save carries the old version.
    await expect(svc.editReturn(lead, r.id, { updatedAt: r.updatedAt, description: 'Something else' }, req(lead)))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(first.updatedAt).not.toEqual(r.updatedAt);
    expect((await ReturnRequest.findById(r.id).lean()).problemDescription).toBe('Wrong colour sent');
  });

  it('quantity only goes down — never up, never to zero', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await raise(o, lead, [{ itemId: o.mat, quantity: 1, reason: 'wrong_item' }]);
    await expect(svc.editReturn(lead, r.id, { lines: [{ key: o.mat, quantity: 2 }] }, req(lead))).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.editReturn(lead, r.id, { lines: [{ key: o.mat, quantity: 0 }] }, req(lead))).rejects.toMatchObject({ statusCode: 400 });
    expect(await edits(r.id)).toHaveLength(0);
  });

  it('who: the raiser, operations, admin — never accounts, procurement or another seller', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await raise(o, lead, [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }]);
    const otherHead = await person('sales', { isHead: true }); // can SEE every return, but didn't raise this one
    await forbidden(svc.editReturn(otherHead, r.id, { description: 'x y' }, req(otherHead)));
    await forbidden(svc.editReturn(await person('accounts'), r.id, { description: 'x y' }, req()));
    await forbidden(svc.editReturn(await person('procurement'), r.id, { description: 'x y' }, req()));
    const ops = await person('operations');
    await svc.editReturn(ops, r.id, { description: 'Edited by ops' }, req(ops));
    const boss = await admin();
    await svc.editReturn(boss, r.id, { description: 'Edited by admin' }, req(boss));
    expect(await edits(r.id)).toHaveLength(2);
    expect((await svc.getReturn(otherHead, r.id)).can.edit).toBe(false);
    expect((await svc.getReturn(lead, r.id)).can.edit).toBe(true);
  });

  it('the reason changes only before approval, and a customer reason needs the declaration', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await raise(o, lead, [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }]);
    await expect(svc.editReturn(lead, r.id, { lines: [{ key: o.mat, reason: 'changed_mind' }] }, req(lead)))
      .rejects.toMatchObject({ statusCode: 400 });
    await svc.editReturn(lead, r.id, { unusedDeclared: true, lines: [{ key: o.mat, reason: 'changed_mind' }] }, req(lead));
    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.items[0]).toMatchObject({ reason: 'changed_mind', fault: { claimed: 'customer', confirmed: null } });
    expect(saved.unusedDeclaredAt).toBeTruthy();

    const ops = await person('operations');
    await svc.reviewReturn(ops, r.id, { decision: 'approve' }, req(ops));
    await expect(svc.editReturn(lead, r.id, { lines: [{ key: o.mat, reason: 'wrong_item' }] }, req(lead)))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('an item comes off the return only until it reaches us, and one always stays', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await raise(o, lead, [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }, { itemId: o.mat, quantity: 2, reason: 'wrong_item' }]);
    await expect(svc.editReturn(lead, r.id, { lines: [{ key: o.cam, remove: true }, { key: o.mat, remove: true }] }, req(lead)))
      .rejects.toMatchObject({ statusCode: 400 });
    await svc.editReturn(lead, r.id, { lines: [{ key: o.cam, remove: true }] }, req(lead));
    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.items.map((i) => String(i.orderItemId))).toEqual([o.mat]);
    expect((await edits(r.id))[0].note).toMatch(/Dash cam taken off the return/);

    const two = await passedReturn(o, { lines: [{ itemId: o.cam, quantity: 1, reason: 'wrong_item' }] });
    await expect(svc.editReturn(two.ops, two.id, { lines: [{ key: o.cam, remove: true }] }, req(two.ops)))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('is locked once the refund is with Accounts — even if it started after the form opened', async () => {
    const o = await deliveredOrder();
    const { id, ops } = await passedReturn(o, { lines: [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }] });
    const view = await svc.getReturn(ops, id);
    expect(view.can.edit).toBe(true);
    await ReturnRequest.updateOne({ _id: id }, { $set: { 'refund.status': 'processing' } });
    await expect(svc.editReturn(ops, id, { updatedAt: view.updatedAt, lines: [{ key: o.mat, quantity: 1 }] }, req(ops)))
      .rejects.toMatchObject({ statusCode: 409, message: svc.REFUND_LOCKED_MESSAGE });
    const after = await svc.getReturn(ops, id);
    expect(after.can.edit).toBe(false);
    expect(after.editLock).toBe(svc.REFUND_LOCKED_MESSAGE);

    const o2 = await deliveredOrder();
    const sent = await passedReturn(o2, { lines: [{ itemId: o2.mat, quantity: 2, reason: 'wrong_item' }] });
    const accounts = await person('accounts');
    await svc.sendRefund(accounts, sent.id, req(accounts, {}, { id: sent.id }));
    await expect(svc.editReturn(sent.ops, sent.id, { description: 'Too late' }, req(sent.ops)))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('the Accounts refund queue shows the new amount after an edit at inspection', async () => {
    const o = await deliveredOrder();
    const { id, ops } = await passedReturn(o, { lines: [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }] });
    const accounts = await person('accounts');
    const row = async () => (await svc.listReturns(accounts, { queue: 'refund' })).returns.find((x) => x.id === id);
    const before = (await row()).refund.amount;
    const previewBefore = (await svc.refundPreviewFor(accounts, id)).preview.refundNow;
    await svc.editReturn(ops, id, { lines: [{ key: o.mat, quantity: 1 }] }, req(ops));
    expect((await row()).refund.amount).toBeCloseTo(before / 2, 2);
    // The send screen prices the same lines from the order — the amount Accounts sends.
    expect((await svc.refundPreviewFor(accounts, id)).preview.refundNow).toBeCloseTo(previewBefore / 2, 2);
  });

  it('photos: add and remove, but never the last one; history names it', async () => {
    const o = await deliveredOrder();
    const lead = await person('sales');
    const r = await raise(o, lead, [{ itemId: o.mat, quantity: 2, reason: 'wrong_item' }]);
    await expect(svc.editReturn(lead, r.id, { evidence: { keepImages: [] } }, req(lead))).rejects.toMatchObject({ statusCode: 400 });
    await svc.editReturn(lead, r.id, {
      evidence: { keepImages: [], newImages: [{ publicId: 'autobacs/returns/n2/photo-1.jpg' }], videoLink: 'https://youtu.be/abc123' },
    }, req(lead));
    const saved = await ReturnRequest.findById(r.id).lean();
    expect(saved.images.map((i) => i.publicId)).toEqual(['autobacs/returns/n2/photo-1.jpg']);
    expect(saved.video).toBeNull();
    expect(saved.videoLink).toBe('https://youtu.be/abc123');
    expect((await edits(r.id))[0].note).toMatch(/1 photo added; 1 photo removed; unboxing video replaced/);
  });
});

describe('correcting the pickup cost after inspection (owner, 2026-11-11)', () => {

  /** A customer's-reason return of 2 floor mats (₹2,000), ₹500 pickup cost entered at inspection. */
  async function withPickupCost(pickupCostRupees = 500) {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const raised = await svc.raiseReturn(ops, {
      orderId: String(o.order._id), items: [{ itemId: o.mat, quantity: 2, reason: 'changed_mind' }],
      description: 'Customer changed mind', images: PHOTOS, video: VIDEO, unusedDeclared: true,
    }, req(ops));
    await svc.reviewReturn(ops, raised.id, { decision: 'approve', destination: { kind: 'warehouse' } }, req(ops));
    await svc.bookPickup(ops, raised.id, { provider: 'Delhivery', trackingNumber: 'DL9' }, req(ops));
    await svc.markReceived(ops, raised.id, {}, req(ops));
    await svc.recordInspection(ops, raised.id, {
      passed: true, notes: 'Unused, in box', disposition: 'resell', pickupCostRupees, pickupCostReason: 'Delhivery DL9',
    }, [photo()], req(ops));
    return { o, id: raised.id, ops, accounts: await person('accounts') };
  }
  const refundNow = async (accounts, id) => (await svc.refundPreviewFor(accounts, id)).preview.refundNow;
  const paid = () => razorpayService.refundPayment.mock.calls.map((c) => c[1]);

  it('operations removes a mistaken pickup cost before the refund: Accounts sees the change and sends the full amount', async () => {
    const { id, ops, accounts } = await withPickupCost(500);
    const audit = jest.spyOn(auditLogger, 'logAction');
    expect((await svc.getReturn(ops, id)).can.editPickupCost).toBe(true);
    const before = await refundNow(accounts, id);

    await svc.editReturn(ops, id, { pickupCost: { rupees: 0, reason: 'Added by mistake; company pays shipping' } }, req(ops));

    const saved = await ReturnRequest.findById(id).lean();
    expect(saved.refund.pickupDeduction).toBe(0);
    expect(saved.refund.shippingDeduction).toBe(0);
    expect(saved.refund.pickupDeductionReason).toBeNull();
    expect(saved.refund.deductionChanges).toEqual([expect.objectContaining({
      from: 500, to: 0, reason: 'Added by mistake; company pays shipping', by: ops._id, byName: ops.name,
    })]);
    expect(saved.timeline.at(-1).note).toMatch(/pickup cost ₹500 → ₹0 \(refund up by ₹500\) — reason: Added by mistake/);
    expect(audit).toHaveBeenCalledWith(expect.anything(), 'RETURN_EDIT', 'ReturnRequest', expect.anything(),
      expect.objectContaining({ pickupCost: { from: 500, to: 0, reason: 'Added by mistake; company pays shipping' } }));

    // Accounts' screen shows the change and the new figure, and that is what is sent.
    const view = await svc.getReturn(accounts, id);
    expect(view.refundDetail.deductionChanges).toHaveLength(1);
    expect(await refundNow(accounts, id)).toBe(before + 500);
    await svc.sendRefund(accounts, id, req(accounts, { expectedAmount: before + 500 }, { id }));
    expect(paid()).toEqual([toPaiseT(before + 500)]);
  });

  it('can lower or raise it, needs a reason, stays within the line value, and only operations/admin may change it', async () => {
    const { id, ops, accounts } = await withPickupCost(500);
    await expect(svc.editReturn(ops, id, { pickupCost: { rupees: 200 } }, req(ops))).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.editReturn(ops, id, { pickupCost: { rupees: 999999, reason: 'typo' } }, req(ops))).rejects.toMatchObject({ statusCode: expect.any(Number) });
    await forbidden(svc.editReturn(accounts, id, { pickupCost: { rupees: 0, reason: 'mine' } }, req(accounts)));
    await forbidden(svc.editReturn(await person('sales', { isHead: true }), id, { pickupCost: { rupees: 0, reason: 'mine' } }, req()));
    expect((await ReturnRequest.findById(id).lean()).refund.pickupDeduction).toBe(500);

    await svc.editReturn(ops, id, { pickupCost: { rupees: 200, reason: 'Real courier bill is ₹200' } }, req(ops));
    const boss = await admin();
    await svc.editReturn(boss, id, { pickupCost: { rupees: 250, reason: 'Plus packing' } }, req(boss));
    const saved = await ReturnRequest.findById(id).lean();
    expect(saved.refund.pickupDeduction).toBe(250);
    expect(saved.refund.pickupDeductionReason).toBe('Plus packing');
    expect(saved.refund.deductionChanges.map((c) => [c.from, c.to])).toEqual([[500, 200], [200, 250]]);
  });

  it('ignores any amount the client sends — only the deduction is taken', async () => {
    const { id, ops, accounts } = await withPickupCost(500);
    const before = await refundNow(accounts, id);
    await svc.editReturn(ops, id, {
      pickupCost: { rupees: 0, reason: 'mistake' }, finalAmount: 1, refund: { finalAmount: 1 }, amount: 99999,
    }, req(ops));
    expect(await refundNow(accounts, id)).toBe(before + 500);
    await svc.sendRefund(accounts, id, req(accounts, { amount: 1, finalAmount: 1, refundAmount: 1 }, { id }));
    expect(paid()).toEqual([toPaiseT(before + 500)]);
  });

  it('a change after Accounts opened the refund sends it back to them: the old figure is refused, nothing is paid', async () => {
    const { id, ops, accounts } = await withPickupCost(500);
    const seen = await refundNow(accounts, id);
    await svc.editReturn(ops, id, { pickupCost: { rupees: 0, reason: 'mistake' } }, req(ops));
    await expect(svc.sendRefund(accounts, id, req(accounts, { expectedAmount: seen }, { id })))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/changed to ₹/) });
    expect(razorpayService.refundPayment).not.toHaveBeenCalled();
    expect((await ReturnRequest.findById(id).lean()).refund.status).toBe('pending');
    // Approving the new figure goes through.
    await svc.sendRefund(accounts, id, req(accounts, { expectedAmount: seen + 500 }, { id }));
    expect(paid()).toEqual([toPaiseT(seen + 500)]);
  });

  it('an edit that lands between the send reading the return and claiming it makes the claim miss', async () => {
    const { id, ops } = await withPickupCost(500);
    await svc.editReturn(ops, id, { pickupCost: { rupees: 0, reason: 'mistake' } }, req(ops));
    // The send computed its amount with the OLD stored figure.
    const claim = await returnRequestRepository.claimForRefund(id, {
      productValue: 2000, listValue: 2000, discountShare: 0, shippingDeduction: 500, restockingDeduction: 0,
      finalAmount: 1500, initiatedBy: ops._id, expectStoredPickupDeduction: 500,
    });
    expect(claim).toBeNull();
    expect((await ReturnRequest.findById(id).lean()).refund.status).toBe('pending');
  });

  it('a double-click on save writes one change; a double-click on send pays once', async () => {
    const { id, ops, accounts } = await withPickupCost(500);
    const body = { pickupCost: { rupees: 0, reason: 'mistake' } };
    await Promise.allSettled([svc.editReturn(ops, id, body, req(ops)), svc.editReturn(ops, id, body, req(ops))]);
    expect((await ReturnRequest.findById(id).lean()).refund.deductionChanges).toHaveLength(1);
    await svc.editReturn(ops, id, body, req(ops)); // same value again: no-op
    expect((await ReturnRequest.findById(id).lean()).refund.deductionChanges).toHaveLength(1);

    const head = await person('accounts', { isHead: true });
    await Promise.allSettled([
      svc.sendRefund(accounts, id, req(accounts, {}, { id })),
      svc.sendRefund(head, id, req(head, {}, { id })),
    ]);
    expect(razorpayService.refundPayment).toHaveBeenCalledTimes(1);
  });

  it('is locked once the refund is sent; open again after a FAILED refund, which Accounts must send again', async () => {
    const { id, ops, accounts } = await withPickupCost(500);
    await svc.sendRefund(accounts, id, req(accounts, {}, { id }));
    expect((await svc.getReturn(ops, id)).can.editPickupCost).toBe(false);
    await expect(svc.editReturn(ops, id, { pickupCost: { rupees: 0, reason: 'too late' } }, req(ops)))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await ReturnRequest.findById(id).lean()).refund.pickupDeduction).toBe(500);

    const failed = await withPickupCost(500);
    await ReturnRequest.updateOne({ _id: failed.id }, { $set: { 'refund.status': 'failed', 'refund.failureReason': 'gateway' } });
    expect((await svc.getReturn(failed.ops, failed.id)).can.editPickupCost).toBe(true);
    await svc.editReturn(failed.ops, failed.id, { pickupCost: { rupees: 0, reason: 'mistake' } }, req(failed.ops));
    const saved = await ReturnRequest.findById(failed.id).lean();
    expect(saved.refund.status).toBe('failed');
    expect(saved.refund.pickupDeduction).toBe(0);
  });

  it('cannot be changed before the inspection passes', async () => {
    const o = await deliveredOrder();
    const ops = await person('operations');
    const raised = await svc.raiseReturn(ops, {
      orderId: String(o.order._id), items: [{ itemId: o.mat, quantity: 1, reason: 'changed_mind' }],
      description: 'x y', images: PHOTOS, video: VIDEO, unusedDeclared: true,
    }, req(ops));
    expect((await svc.getReturn(ops, raised.id)).can.editPickupCost).toBe(false);
    await expect(svc.editReturn(ops, raised.id, { pickupCost: { rupees: 100, reason: 'early' } }, req(ops)))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

function toPaiseT(rupees) { return Math.round(rupees * 100); }
