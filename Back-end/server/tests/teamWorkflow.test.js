/**
 * Team workflow (services/teamWorkflowService.js) against a real in-memory Mongo,
 * through the REAL order, shipment and cancellation services.
 *
 * What must hold:
 *   - an order enters the workflow exactly when it is paid, once; older orders never do
 *   - each team sees its own queue; nobody acts outside their role
 *   - stock check → supplier → proof creates a real parcel (customer email, roll-up)
 *   - operations' "delivered" goes through the parcel machinery and closes the order
 *   - out of stock → customer waits (back to stock check) or refund →
 *     accounts approves → the refund is SENT through cancellationService (the
 *     admin Refunds routine) — no admin step
 *   - a failed send keeps the approval, says why, and accounts can retry it
 *   - one approval = one refund = one gateway call, even when two people click
 *     at once or a retry races the first send
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

// Capture queued emails (plain functions: resetMocks would wipe jest.fn implementations).
const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

// In-memory private storage: records what was stored and deleted.
const stored = new Map();
const deleted = [];
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { deleted.push(publicId); stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { default: razorpayService } = await import('../services/razorpayService.js');
const { default: cancellationService } = await import('../services/cancellationService.js');
const { default: Payment } = await import('../models/Payment.js');
const wf = await import('../services/teamWorkflowService.js');
const { default: orderRepository } = await import('../repositories/orderRepository.js');
const { default: karmaService } = await import('../services/karmaService.js');
const { default: KarmaLedger } = await import('../models/KarmaLedger.js');
const { default: affiliateCommissionRepository } = await import('../repositories/affiliateCommissionRepository.js');
const { default: returnRequestRepository } = await import('../repositories/returnRequestRepository.js');
const { listPaidSalesOrders } = await import('../services/salesOrderService.js');
const { workflowView, STAGE } = await import('../utils/teamWorkflow.js');

// Enqueue paths read REDIS_URL at call time; set it only after imports (see crmOfflineJourney).
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);
const photo = (buffer = JPEG) => ({ buffer, mimetype: 'image/jpeg', originalname: 'proof.jpg' });

let n = 0;
async function staff(team, { isHead = false, name } = {}) {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
}
const admin = () => User.create({ name: 'Admin', email: `admin${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });

/** A paid order, paid the way production pays it: awaiting_payment → processing. */
async function paidOrder({ salesUser = null, items } = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    source: salesUser ? 'offline' : 'web',
    salesUser,
    items: items || [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 2 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 7000, totalAmount: 7000,
    status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(`could not pay test order: ${res?.message}`);
  return Order.findById(order._id).lean();
}
const ids = (o) => o.items.map((i) => String(i._id));

/** The Razorpay capture behind a paid order — what a refund is sent against. */
async function withPayment(order) {
  const payment = await Payment.create({
    order: order._id, user: order.user, amount: order.totalAmount, gatewayPaymentId: `pay_${order._id}`,
    paymentGateway: 'razorpay', paymentMethod: 'upi', status: 'completed',
  });
  await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
  return payment;
}

/** Out of stock → the customer wants a refund → waiting for accounts. */
async function refundRequested(order) {
  const p = await staff('procurement');
  const head = await staff('sales', { isHead: true });
  const id = String(order._id);
  const [cover] = ids(order);
  await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
  await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);
  return { id, cover, procurement: p };
}
const chatEvents = () => enqueued.filter((j) => j.name === 'post-team-chat-update').map((j) => j.data.event);

beforeEach(() => {
  enqueued.length = 0;
  deleted.length = 0;
  stored.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('entering the workflow', () => {
  it('starts when an order is paid, with every line waiting for a stock check', async () => {
    const o = await paidOrder();
    expect(o.workflow.enteredAt).toBeTruthy();
    expect(o.workflow.open).toBe(true);
    expect(o.workflow.lines.map((l) => l.stock)).toEqual(['pending', 'pending']);
    expect(workflowView(o).lines.map((l) => l.stage)).toEqual([STAGE.STOCK_CHECK, STAGE.STOCK_CHECK]);
  });

  it('does not touch orders paid before it existed', async () => {
    const legacy = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Old', price: 100, quantity: 1 }],
      shippingAddress: { fullName: 'A', phone: '9876543210', addressLine1: '1', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 100, totalAmount: 100, status: 'processing', paymentStatus: 'paid',
    });
    expect((await Order.findById(legacy._id).lean()).workflow?.enteredAt).toBeUndefined();
    const p = await staff('procurement');
    expect((await wf.listQueue(p, 'procurement')).orders).toHaveLength(0);
  });
});

describe('who can see and do what', () => {
  it('gives each team only its own queue', async () => {
    const [p, a, o, s, m] = await Promise.all([
      staff('procurement'), staff('accounts'), staff('operations'), staff('sales'), staff('marketing'),
    ]);
    await paidOrder();

    expect((await wf.listQueue(p, 'procurement')).orders).toHaveLength(1);
    await expect(wf.listQueue(a, 'procurement')).rejects.toMatchObject({ statusCode: 403 });
    await expect(wf.listQueue(o, 'refunds')).rejects.toMatchObject({ statusCode: 403 });
    await expect(wf.listQueue(s, 'deliveries')).rejects.toMatchObject({ statusCode: 403 });
    await expect(wf.listQueue(m, 'decisions')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lets procurement, accounts, operations and the sales head open a website order — not a sales member or marketing', async () => {
    const order = await paidOrder();
    for (const u of [await staff('procurement'), await staff('accounts'), await staff('operations'), await staff('sales', { isHead: true }), await admin()]) {
      await expect(wf.getOrder(u, String(order._id))).resolves.toMatchObject({ source: 'website' });
    }
    for (const u of [await staff('sales'), await staff('marketing')]) {
      await expect(wf.getOrder(u, String(order._id))).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  it('refuses stock changes from anyone outside procurement', async () => {
    const order = await paidOrder();
    const [first] = ids(order);
    for (const u of [await staff('sales', { isHead: true }), await staff('accounts'), await staff('operations')]) {
      await expect(wf.setStock(u, String(order._id), first, { stock: 'in_stock' }, req)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
});

describe('product links', () => {
  it('each line carries its product and variant, so the panel can open it on the website', async () => {
    const p = await staff('procurement');
    const product = new mongoose.Types.ObjectId();
    const variant = new mongoose.Types.ObjectId();
    const order = await paidOrder({ items: [
      { product, variantId: variant, variantLabel: 'Black', name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 2 },
    ] });

    const view = await wf.getOrder(p, String(order._id));
    expect(view.lines[0]).toMatchObject({ productId: String(product), variantId: String(variant) });
    expect(view.lines[1].variantId).toBeNull();

    const [row] = (await wf.listQueue(p, 'procurement')).orders;
    expect(row.lines[0]).toMatchObject({ productId: String(product), variantId: String(variant) });
  });
});

describe('in stock → supplier → proof → delivered', () => {
  it('runs the whole happy path through the real parcel machinery', async () => {
    const p = await staff('procurement');
    const ops = await staff('operations');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = ids(order);

    await expect(wf.setStock(p, id, cover, { stock: 'ordered' }, req)).rejects.toMatchObject({ statusCode: 400 }); // supplier needed
    await wf.setStock(p, id, cover, { stock: 'ordered', supplierName: 'Ram Traders' }, req);
    let view = await wf.setStock(p, id, mat, { stock: 'in_stock' }, req);
    expect(view.lines.map((l) => l.stage)).toEqual([STAGE.WITH_SUPPLIER, STAGE.TO_SHIP]);
    expect(view.lines[0].supplierName).toBe('Ram Traders');
    expect(view.canShip).toBe(true);

    view = await wf.shipWithProof(p, id, { courierName: 'Delhivery', trackingNumber: 'DL123' }, photo(), req);

    const fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('shipped');
    expect(fresh.shipments).toHaveLength(1);
    expect(fresh.shipments[0]).toMatchObject({ status: 'shipped', trackingNumber: 'DL123', includesReward: false });
    expect(fresh.shipments[0].carrier.name).toBe('Delhivery');
    expect(fresh.shipments[0].proofPhotos[0].publicId).toMatch(/^shipping-slips\/proof-/);
    expect(fresh.shipments[0].proofPhoto?.publicId).toBeUndefined(); // new parcels use the list only
    expect(stored.size).toBe(1);
    // The customer's normal per-parcel email, and the team alert.
    expect(enqueued.map((j) => j.name)).toEqual(expect.arrayContaining(['send-shipment-email', 'send-team-shipped-alert']));
    expect(view.lines.every((l) => l.stage === STAGE.SHIPPED)).toBe(true);
    expect(view.parcels[0].photoUrl).toMatch(/\/parcels\/.+\/photo$/);
    // Procurement uploads the proof but does not message the customer; sales does.
    expect(view.canContactCustomer).toBe(false);
    expect((await wf.getOrder(await staff('sales', { isHead: true }), id)).canContactCustomer).toBe(true);

    // Operations' queue now has it; procurement's does not.
    expect((await wf.listQueue(ops, 'deliveries')).orders.map((r) => r.id)).toEqual([id]);
    expect((await wf.listQueue(p, 'procurement')).orders).toHaveLength(0);

    // The photo is readable by staff who may see the order.
    const { buffer } = await wf.getProofPhoto(ops, id, view.parcels[0].id);
    expect(Buffer.compare(buffer, JPEG)).toBe(0);

    view = await wf.markDelivered(ops, id, {}, req);
    const done = await Order.findById(id).lean();
    expect(done.status).toBe('delivered');
    expect(done.workflow.open).toBe(false);
    expect(view.history.map((h) => h.action)).toEqual(expect.arrayContaining(['Marked delivered', 'Supplier proof uploaded — shipped']));
    // Each entry also carries its raw action and line, for the order-journey tracker.
    expect(view.history.find((h) => h.code === 'delivered')).toMatchObject({ action: 'Marked delivered' });
    expect(view.history.find((h) => h.code === 'entered')).toMatchObject({ itemId: null });
    const stocked = view.history.find((h) => h.code === 'stock_in_stock');
    expect(stocked.itemId).toBe(String(mat));
    expect((await wf.listQueue(ops, 'deliveries')).orders).toHaveLength(0);
  });

  it('ships only the items chosen, and refuses an out-of-stock item', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'in_stock' }, req);
    await wf.setStock(p, id, mat, { stock: 'out_of_stock' }, req);

    await expect(wf.shipWithProof(p, id, { itemIds: [cover, mat] }, photo(), req)).rejects.toMatchObject({ statusCode: 409 });
    expect(stored.size).toBe(0); // nothing uploaded when refused up front

    const view = await wf.shipWithProof(p, id, { itemIds: [cover] }, photo(), req);
    expect(view.lines.map((l) => l.stage)).toEqual([STAGE.SHIPPED, STAGE.CUSTOMER_DECISION]);
    expect((await Order.findById(id).lean()).workflow.open).toBe(true);
    // "Ship all" now means "all that may ship" — the out-of-stock line is not among them.
    await expect(wf.shipWithProof(p, id, {}, photo(), req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/left to ship/) });
  });

  it('ship all: every item in one parcel, even ones nobody stock-checked — which are then recorded in stock', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'ordered', supplierName: 'Ram Traders' }, req);
    // mat: never checked.
    let view = await wf.getOrder(p, id);
    expect(view.canShip).toBe(true);
    expect(view.lines.find((l) => l.itemId === mat).actions).toContain('ship');

    view = await wf.shipWithProof(p, id, {}, photo(), req);
    const fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('shipped');
    expect(fresh.shipments).toHaveLength(1);
    expect(fresh.shipments[0].lines.map((l) => String(l.itemId)).sort()).toEqual([cover, mat].sort());
    expect(view.lines.every((l) => l.stage === STAGE.SHIPPED)).toBe(true);
    const lines = new Map(fresh.workflow.lines.map((l) => [String(l.itemId), l]));
    expect(lines.get(mat).stock).toBe('in_stock');
    expect(lines.get(cover).stock).toBe('ordered'); // a checked line keeps what procurement said
    expect(view.history.find((h) => h.action === 'Marked in stock')).toMatchObject({ note: 'Shipped without a separate stock check' });
    expect(view.canShip).toBe(false);
  });

  it('the admin can ship too; sales, accounts and operations cannot', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    for (const u of [await staff('sales', { isHead: true }), await staff('accounts'), await staff('operations')]) {
      await expect(wf.shipWithProof(u, id, {}, photo(), req)).rejects.toMatchObject({ statusCode: 403 });
      expect((await wf.getOrder(u, id)).canShip).toBe(false);
    }
    await wf.shipWithProof(await admin(), id, {}, photo(), req);
    expect((await Order.findById(id).lean()).shipments).toHaveLength(1);
  });

  it('refuses a file that is not really a photo or a PDF — and stores none of the batch', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    await wf.setStock(p, String(order._id), ids(order)[0], { stock: 'in_stock' }, req);
    const fake = { buffer: Buffer.from('MZ\x90\x00 a program'), mimetype: 'image/jpeg', originalname: 'parcel.jpg' };
    await expect(wf.shipWithProof(p, String(order._id), {}, [photo(), fake], req))
      .rejects.toMatchObject({ statusCode: 400, message: '"parcel.jpg" is not a photo (JPG, PNG, WebP) or a PDF.' });
    expect(stored.size).toBe(0);
  });

  it('takes several proofs at once — photos and the courier\'s PDF receipt — and serves each privately', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    await wf.setStock(p, id, ids(order)[0], { stock: 'in_stock' }, req);
    const pdf = { buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 32)]), mimetype: 'application/pdf', originalname: 'receipt.pdf' };
    const view = await wf.shipWithProof(p, id, { itemIds: [ids(order)[0]] }, [photo(), photo(), pdf], req);
    const parcel = view.parcels[0];
    expect(parcel.photos.map((x) => [x.contentType, x.name])).toEqual([['image/jpeg', 'proof.jpg'], ['image/jpeg', 'proof.jpg'], ['application/pdf', 'receipt.pdf']]);
    expect(parcel.photos[2].url).toBe(`/api/v1/staff/work/orders/${id}/parcels/${parcel.id}/photos/${parcel.photos[2].id}`);
    expect(stored.size).toBe(3);
    const got = await wf.getProofPhoto(await staff('operations'), id, parcel.id, parcel.photos[2].id);
    expect(got).toMatchObject({ contentType: 'application/pdf', name: 'receipt.pdf' });
    await expect(wf.getProofPhoto(p, id, parcel.id, String(new mongoose.Types.ObjectId()))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('an old parcel with one photo still shows it, and editing folds it into the list', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    await wf.shipWithProof(p, id, {}, photo(), req);
    // Re-shape the parcel as parcels were before Oct 2026: a single proofPhoto.
    const o = await Order.findById(id).lean();
    const old = o.shipments[0].proofPhotos[0];
    await Order.collection.updateOne({ _id: o._id }, {
      $set: { 'shipments.0.proofPhoto': { publicId: old.publicId, provider: old.provider, contentType: 'image/jpeg', bytes: old.bytes } },
      $unset: { 'shipments.0.proofPhotos': '' },
    });
    let view = await wf.getOrder(p, id);
    const parcel = view.parcels[0];
    expect(parcel.photos).toEqual([{ id: 'legacy', url: `/api/v1/staff/work/orders/${id}/parcels/${parcel.id}/photos/legacy`, contentType: 'image/jpeg', name: '' }]);
    expect(parcel.photoUrl).toMatch(/\/photo$/);
    expect((await wf.getProofPhoto(p, id, parcel.id)).contentType).toBe('image/jpeg');
    expect((await wf.getProofPhoto(p, id, parcel.id, 'legacy')).buffer).toBeTruthy();

    view = await wf.editShipment(p, id, parcel.id, {}, [photo()], req);
    expect(view.parcels[0].photos).toHaveLength(2);
    expect(view.parcels[0].photos.every((x) => x.id !== 'legacy')).toBe(true);
    const fresh = (await Order.findById(id).lean()).shipments[0];
    expect(fresh.proofPhoto).toBeUndefined();
    expect(fresh.proofPhotos.map((x) => x.publicId)[0]).toBe(old.publicId); // the old photo kept, first
    expect(stored.size).toBe(2);
  });

  it('edit: remove chosen proofs (files deleted), never the last one; two editors at once cannot lose a photo', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    let view = await wf.shipWithProof(p, id, {}, [photo(), photo()], req);
    const parcel = view.parcels[0];
    const [first, second] = parcel.photos;
    view = await wf.editShipment(p, id, parcel.id, { removePhotoIds: JSON.stringify([first.id]) }, [], req);
    expect(view.parcels[0].photos.map((x) => x.id)).toEqual([second.id]);
    expect(stored.size).toBe(1);
    await expect(wf.editShipment(p, id, parcel.id, { removePhotoIds: [second.id] }, [], req))
      .rejects.toMatchObject({ statusCode: 400, message: 'Keep at least one photo of the parcel, or add a new one.' });

    // Someone else added a photo after we read the parcel: our whole-list write is refused, theirs stands.
    const findForWorkflow = orderRepository.findForWorkflow.bind(orderRepository);
    const stale = await findForWorkflow(id);
    await wf.editShipment(p, id, parcel.id, {}, [photo()], req);
    const spy = jest.spyOn(orderRepository, 'findForWorkflow').mockResolvedValueOnce(stale);
    await expect(wf.editShipment(p, id, parcel.id, {}, [photo()], req)).rejects.toMatchObject({ statusCode: 409 });
    spy.mockRestore();
    expect((await Order.findById(id).lean()).shipments[0].proofPhotos).toHaveLength(2);
    expect(stored.size).toBe(2); // the refused upload was removed again
  });

  it('a parcel holds at most 50 proofs', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const view = await wf.shipWithProof(p, id, {}, Array.from({ length: 20 }, () => photo()), req);
    await wf.editShipment(p, id, view.parcels[0].id, {}, Array.from({ length: 20 }, () => photo()), req);
    await expect(wf.editShipment(p, id, view.parcels[0].id, {}, Array.from({ length: 11 }, () => photo()), req))
      .rejects.toMatchObject({ statusCode: 400, message: 'This record can hold 50 files in all — you can add 10 more.' });
    expect(stored.size).toBe(40);
  });

  it('removes the uploaded photo if the parcel cannot be created', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    await wf.setStock(p, id, ids(order)[0], { stock: 'in_stock' }, req);
    const { default: shipmentService } = await import('../services/shipmentService.js');
    jest.spyOn(shipmentService, 'createShipment').mockResolvedValueOnce({ success: false, message: 'Order changed' });

    await expect(wf.shipWithProof(p, id, {}, photo(), req)).rejects.toMatchObject({ statusCode: 409 });
    expect(deleted).toHaveLength(1);
    expect(stored.size).toBe(0);
  });
});

describe('out of stock → customer → accounts sends the refund', () => {
  it('sends a waiting customer back to the stock check', async () => {
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);

    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    expect(enqueued.map((j) => j.name)).toContain('send-team-out-of-stock-alert');
    expect((await wf.listQueue(head, 'decisions')).orders.map((r) => r.id)).toEqual([id]);

    const view = await wf.recordDecision(head, id, cover, { decision: 'wait', note: 'Will wait 2 weeks' }, req);
    expect(view.lines[0].stage).toBe(STAGE.STOCK_CHECK);
    expect((await wf.listQueue(head, 'decisions')).orders).toHaveLength(0);
  });

  it('only the seller or a sales head may decide; a member cannot decide a website order', async () => {
    const p = await staff('procurement');
    const seller = await staff('sales');
    const other = await staff('sales');
    const sold = await paidOrder({ salesUser: seller._id });
    const web = await paidOrder();
    await wf.setStock(p, String(sold._id), ids(sold)[0], { stock: 'out_of_stock' }, req);
    await wf.setStock(p, String(web._id), ids(web)[0], { stock: 'out_of_stock' }, req);

    expect((await wf.listQueue(seller, 'decisions')).orders.map((r) => r.id)).toEqual([String(sold._id)]);
    expect((await wf.listQueue(other, 'decisions')).orders).toHaveLength(0);
    await expect(wf.recordDecision(other, String(sold._id), ids(sold)[0], { decision: 'refund' }, req))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(wf.recordDecision(seller, String(web._id), ids(web)[0], { decision: 'refund' }, req))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('approving cancels the item and SENDS its refund — no admin step', async () => {
    const refundSpy = jest.spyOn(razorpayService, 'refundPayment').mockResolvedValue({ refundId: 'rfnd_1', status: 'pending' });
    const acc = await staff('accounts');
    const order = await paidOrder();
    await withPayment(order);
    const { id, cover } = await refundRequested(order);
    expect(enqueued.map((j) => j.name)).toContain('send-team-refund-requested-alert');
    expect((await wf.listQueue(acc, 'refunds')).orders.map((r) => r.id)).toEqual([id]);

    const view = await wf.reviewRefund(acc, id, cover, { approve: true, note: 'OK' }, req);

    const fresh = await Order.findById(id).lean();
    expect(fresh.cancellations).toHaveLength(1);
    expect(fresh.cancellations[0]).toMatchObject({ reason: 'out_of_stock' });
    expect(fresh.cancellations[0].refund).toMatchObject({ status: 'processing', razorpayRefundId: 'rfnd_1', productValuePaise: 500000 });
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy).toHaveBeenCalledWith(`pay_${id}`, 500000, expect.objectContaining({ orderId: id }));
    expect(String(fresh.workflow.lines[0].cancellationId)).toBe(String(fresh.cancellations[0]._id));
    expect(view.lines[0].stage).toBe(STAGE.CANCELLED);
    expect(fresh.status).toBe('processing'); // the floor mats are still owed
    expect(view.history.map((h) => h.action)).toEqual(expect.arrayContaining(['Refund approved by accounts', 'Refund sent to the customer']));
    expect(view.cancellations[0]).toMatchObject({ refundStatus: 'processing', canSendRefund: false });
    expect(chatEvents()).toContain('refund_sent');
    expect(enqueued.map((j) => j.name)).not.toContain('send-admin-team-refund-ready-alert');
    expect((await wf.listQueue(acc, 'refunds')).orders).toHaveLength(0);
  });

  it('a gateway failure keeps the approval, says why, and accounts can retry it', async () => {
    const refundSpy = jest.spyOn(razorpayService, 'refundPayment').mockRejectedValueOnce(new Error('Gateway timeout'));
    const acc = await staff('accounts');
    const order = await paidOrder();
    await withPayment(order);
    const { id, cover, procurement } = await refundRequested(order);

    const view = await wf.reviewRefund(acc, id, cover, { approve: true }, req);
    expect(view.lines[0].stage).toBe(STAGE.CANCELLED); // approved — not undone by the failed send
    expect(view.cancellations[0]).toMatchObject({ refundStatus: 'failed', canSendRefund: true });
    expect(view.cancellations[0].refundFailure).toMatch(/Gateway timeout/);
    expect(view.history.map((h) => h.action)).toContain('Refund could not be sent — retry it');
    expect(chatEvents()).toContain('refund_send_failed');
    expect((await wf.getOrder(procurement, id)).cancellations[0].canSendRefund).toBe(false);

    refundSpy.mockResolvedValueOnce({ refundId: 'rfnd_2', status: 'processed' });
    const retried = await wf.retryRefund(acc, id, view.cancellations[0].id, req);
    expect(retried.cancellations[0]).toMatchObject({ refundStatus: 'completed', canSendRefund: false });
    expect(refundSpy).toHaveBeenCalledTimes(2);

    // Pressed again after it went through: refused, nothing sent.
    await expect(wf.retryRefund(acc, id, view.cancellations[0].id, req)).rejects.toMatchObject({ statusCode: 409 });
    expect(refundSpy).toHaveBeenCalledTimes(2);
  });

  it('two retries at the same moment send the money once', async () => {
    const refundSpy = jest.spyOn(razorpayService, 'refundPayment').mockRejectedValueOnce(new Error('down'));
    const [a1, a2] = [await staff('accounts'), await staff('accounts')];
    const order = await paidOrder();
    await withPayment(order);
    const { id, cover } = await refundRequested(order);
    const view = await wf.reviewRefund(a1, id, cover, { approve: true }, req);

    refundSpy.mockResolvedValue({ refundId: 'rfnd_3', status: 'pending' });
    const cid = view.cancellations[0].id;
    const results = await Promise.allSettled([wf.retryRefund(a1, id, cid, req), wf.retryRefund(a2, id, cid, req)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refundSpy).toHaveBeenCalledTimes(2); // the failed first try + ONE retry
  });

  it('only accounts (or admin) may retry, and only refunds this panel created', async () => {
    jest.spyOn(razorpayService, 'refundPayment').mockRejectedValue(new Error('down'));
    const acc = await staff('accounts');
    const order = await paidOrder();
    await withPayment(order);
    const { id, cover, procurement } = await refundRequested(order);
    const view = await wf.reviewRefund(acc, id, cover, { approve: true }, req);
    const cid = view.cancellations[0].id;

    await expect(wf.retryRefund(procurement, id, cid, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(wf.retryRefund(await staff('sales', { isHead: true }), id, cid, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(wf.retryRefund(await admin(), id, cid, req)).rejects.toMatchObject({ statusCode: 502 }); // allowed — the gateway is still down

    // An admin cancellation (not from the out-of-stock flow) stays on Admin → Refunds.
    const adminCancel = await cancellationService.cancelLines(id, { lines: [{ itemId: ids(order)[1], quantity: 1 }] }, {});
    await expect(wf.retryRefund(acc, id, String(adminCancel.cancellation._id), req)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('an order with no Razorpay capture on file: approved, and the reason is shown', async () => {
    const refundSpy = jest.spyOn(razorpayService, 'refundPayment');
    const acc = await staff('accounts');
    const order = await paidOrder(); // no payment row
    const { id, cover } = await refundRequested(order);
    const view = await wf.reviewRefund(acc, id, cover, { approve: true }, req);
    expect(view.lines[0].stage).toBe(STAGE.CANCELLED);
    expect(refundSpy).not.toHaveBeenCalled();
    expect(view.history.find((h) => h.action === 'Refund could not be sent — retry it').note).toMatch(/Razorpay payment id/);
  });

  it('a refund sent back by accounts needs a note and returns to the sales decision', async () => {
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const acc = await staff('accounts');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);

    await expect(wf.reviewRefund(acc, id, cover, { approve: false }, req)).rejects.toMatchObject({ statusCode: 400 });
    const view = await wf.reviewRefund(acc, id, cover, { approve: false, note: 'Customer agreed to wait — check again' }, req);
    expect(view.lines[0].stage).toBe(STAGE.CUSTOMER_DECISION);
    expect((await Order.findById(id).lean()).cancellations || []).toHaveLength(0);
  });

  it('approves — and sends — only once when two people approve at the same moment', async () => {
    const refundSpy = jest.spyOn(razorpayService, 'refundPayment').mockResolvedValue({ refundId: 'rfnd_x', status: 'pending' });
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const [a1, a2] = [await staff('accounts'), await staff('accounts')];
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);

    await withPayment(order);
    const results = await Promise.allSettled([
      wf.reviewRefund(a1, id, cover, { approve: true }, req),
      wf.reviewRefund(a2, id, cover, { approve: true }, req),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await Order.findById(id).lean()).cancellations).toHaveLength(1);
    expect(refundSpy).toHaveBeenCalledTimes(1);
  });

  it('releases the approval if the cancellation cannot be recorded, so it can be retried', async () => {
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const acc = await staff('accounts');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);
    jest.spyOn(cancellationService, 'cancelLines').mockResolvedValueOnce({ success: false, message: 'Paid by EMI — refund in full manually' });

    await expect(wf.reviewRefund(acc, id, cover, { approve: true }, req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/EMI/) });
    const view = await wf.getOrder(acc, id);
    expect(view.lines[0]).toMatchObject({ stage: STAGE.ACCOUNTS_APPROVAL, accountsApprovedAt: null });
    expect(view.lines[0].actions).toEqual(['approve', 'reject']);
    expect(view.history.map((h) => h.action)).toContain('Refund approval could not be recorded');
  });

  it('closes the order when every line has been refunded', async () => {
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const acc = await staff('accounts');
    const order = await paidOrder({ items: [{ product: new mongoose.Types.ObjectId(), name: 'Only thing', price: 7000, quantity: 1 }] });
    const id = String(order._id);
    const [only] = ids(order);
    await wf.setStock(p, id, only, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(head, id, only, { decision: 'refund' }, req);
    await wf.reviewRefund(acc, id, only, { approve: true }, req);

    const fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('cancelled');
    expect(fresh.workflow.open).toBe(false);
  });

  it('lets procurement withdraw a refund request when stock turns up before accounts approve', async () => {
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);

    const view = await wf.setStock(p, id, cover, { stock: 'in_stock' }, req);
    expect(view.lines[0]).toMatchObject({ stage: STAGE.TO_SHIP, refundRequestedAt: null });
  });
});

describe('queues heal themselves', () => {
  it('drops an order an admin finished from the admin panel', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    // Admin cancels the whole order outside the team panel.
    await orderStatusService.updateOrderStatus(String(order._id), 'cancelled', { isAdmin: true, reason: 'customer_request' });

    expect((await wf.listQueue(p, 'procurement')).orders).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 50));
    expect((await Order.findById(order._id).lean()).workflow.open).toBe(false);
  });

  it('pages through a long queue without repeats', async () => {
    const p = await staff('procurement');
    for (let i = 0; i < 27; i += 1) await paidOrder();
    const first = await wf.listQueue(p, 'procurement');
    expect(first.orders).toHaveLength(25);
    const second = await wf.listQueue(p, 'procurement', { cursor: first.nextCursor });
    expect(second.orders).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.orders, ...second.orders].map((r) => r.id)).size).toBe(27);
    // Newest first, across the page break too (the teams asked for this order).
    const entered = [...first.orders, ...second.orders].map((r) => new Date(r.enteredAt).getTime());
    expect(entered).toEqual([...entered].sort((a, b) => b - a));
  });

  it('newest first: the order paid last is on top', async () => {
    const p = await staff('procurement');
    const older = await paidOrder();
    await new Promise((r) => setTimeout(r, 15));
    const newer = await paidOrder();
    expect((await wf.listQueue(p, 'procurement')).orders.map((r) => r.id)).toEqual([String(newer._id), String(older._id)]);
  });

  it('each order carries the stage behind its summary, so the pill can be coloured by it', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const [cover, mat] = ids(order);
    let row = (await wf.listQueue(p, 'procurement')).orders[0];
    expect(row).toMatchObject({ summary: 'New Order (2 of 2)', summaryStage: STAGE.STOCK_CHECK });
    await wf.setStock(p, String(order._id), cover, { stock: 'in_stock' }, req);
    await wf.setStock(p, String(order._id), mat, { stock: 'in_stock' }, req);
    row = (await wf.listQueue(p, 'procurement')).orders[0];
    expect(row).toMatchObject({ summary: 'In Stock (2 of 2)', summaryStage: STAGE.TO_SHIP });
  });
});

describe('Paid orders list', () => {
  it('includes website orders, opens to operations, and pages with the filter intact', async () => {
    const ops = await staff('operations');
    const seller = await staff('sales');
    const legacyWeb = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Old', price: 100, quantity: 1 }],
      shippingAddress: { fullName: 'A', phone: '9876543210', addressLine1: '1', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 100, totalAmount: 100, status: 'processing', paymentStatus: 'paid',
    });
    for (let i = 0; i < 26; i += 1) await paidOrder();
    await paidOrder({ salesUser: seller._id });

    const first = await listPaidSalesOrders(ops);
    const second = await listPaidSalesOrders(ops, { cursor: first.nextCursor });
    const all = [...first.orders, ...second.orders];

    expect(all).toHaveLength(27);
    expect(all.map((o) => o.id)).not.toContain(String(legacyWeb._id)); // paid before the workflow
    expect(all.filter((o) => o.source === 'sales')).toHaveLength(1);
    expect(all[0].workflowSummary).toBe('New Order (2 of 2)');
    await expect(listPaidSalesOrders(seller)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('the old "payment initiated" mark', () => {
  it('is no longer offered — a supplier payment request replaces it', async () => {
    const p = await staff('procurement', { name: 'Priya P' });
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    const view = await wf.setStock(p, id, cover, { stock: 'in_stock' }, req);
    const line = view.lines.find((l) => l.itemId === cover);
    expect(line.actions).not.toContain('payment_initiated');
    await expect(wf.setPaymentInitiated(p, id, cover, { initiated: true }, req)).rejects.toMatchObject({ statusCode: 410 });
  });
});

describe('undo and correct — no time limit, the owning team', () => {
  const lineOf = (view, itemId) => view.lines.find((l) => l.itemId === itemId);
  const age = async (orderId, field, minutes) => {
    const o = await Order.findById(orderId).lean();
    const lines = o.workflow.lines.map((l) => ({ ...l, [field]: new Date(Date.now() - minutes * 60000) }));
    await Order.collection.updateOne({ _id: o._id }, { $set: { 'workflow.lines': lines } });
  };

  it('anyone in procurement undoes "In Stock" (a New Order again), days later too; other teams cannot', async () => {
    const p = await staff('procurement', { name: 'Priya P' });
    const p2 = await staff('procurement', { name: 'Pavan' });
    const ops = await staff('operations');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    let view = await wf.setStock(p, id, cover, { stock: 'in_stock' }, req);
    expect(lineOf(view, cover).actions).toContain('stock_undo');
    // A teammate can fix it too.
    expect(lineOf(await wf.getOrder(p2, id), cover).actions).toContain('stock_undo');
    await expect(wf.undoStock(ops, id, cover, req)).rejects.toMatchObject({ statusCode: 409 });
    view = await wf.undoStock(p2, id, cover, req);
    expect(lineOf(view, cover)).toMatchObject({ stage: 'stock_check', stageLabel: 'New Order' });
    expect(view.history[0].action).toBe('Stock decision undone');

    // No clock: marked out of stock five days ago, still undoable.
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    await age(id, 'stockAt', 5 * 24 * 60);
    view = await wf.undoStock(p, id, cover, req);
    expect(lineOf(view, cover).stage).toBe('stock_check');
  });

  it('cannot undo once something else happened (a supplier payment raised)', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'in_stock' }, req);
    await wf.markPaymentPending(p, id, cover, { supplierName: 'ARB', ref: 'PR-0001' }, req);
    const view = await wf.getOrder(p, id);
    expect(lineOf(view, cover)).toMatchObject({ stage: 'payment_pending', stageLabel: 'Payment Pending', supplierPaymentRef: 'PR-0001' });
    expect(lineOf(view, cover).actions).not.toContain('stock_undo');
    await expect(wf.undoStock(p, id, cover, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('sales undoes "wants a refund" before accounts acts, and "will wait"', async () => {
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    let view = await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);
    expect(lineOf(view, cover).actions).toContain('decision_undo');
    view = await wf.undoDecision(head, id, cover, req);
    expect(lineOf(view, cover).stage).toBe('customer_decision');
    view = await wf.recordDecision(head, id, cover, { decision: 'wait' }, req);
    expect(lineOf(view, cover).stage).toBe('stock_check');
    view = await wf.undoDecision(head, id, cover, req);
    expect(lineOf(view, cover).stage).toBe('customer_decision');
  });

  it('procurement corrects the dispatch details while in transit — any time, any teammate; not once delivered', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    let view = await wf.shipWithProof(p, id, { courierName: 'Delhivery', trackingNumber: 'DL123' }, photo(), req);
    const parcel = view.parcels[0];
    expect(parcel.canEdit).toBe(true);
    view = await wf.editShipment(p, id, parcel.id, { courierName: 'Blue Dart', trackingNumber: 'BD999' }, null, req);
    expect(view.parcels[0]).toMatchObject({ courier: 'Blue Dart', trackingNumber: 'BD999' });
    expect(view.history[0]).toMatchObject({ action: 'Dispatch details corrected' });
    const o = await Order.findById(id).lean();
    const shipments = o.shipments.map((s) => ({ ...s, proofPhotos: s.proofPhotos.map((x) => ({ ...x, uploadedAt: new Date(Date.now() - 5 * 24 * 3600000) })) }));
    await Order.collection.updateOne({ _id: o._id }, { $set: { shipments } });
    const teammate = await staff('procurement', { name: 'Pavan' });
    view = await wf.editShipment(teammate, id, parcel.id, { trackingNumber: 'BD1000' }, null, req);
    expect(view.parcels[0].trackingNumber).toBe('BD1000');
    await expect(wf.editShipment(await staff('operations'), id, parcel.id, { trackingNumber: 'X' }, null, req)).rejects.toMatchObject({ statusCode: 403 });
    await wf.markDelivered(await staff('operations'), id, {}, req);
    await expect(wf.editShipment(p, id, parcel.id, { trackingNumber: 'X' }, null, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('labels: the six stages', async () => {
    const { STAGE_LABELS } = await import('../utils/teamWorkflow.js');
    expect([STAGE_LABELS.stock_check, STAGE_LABELS.to_ship, STAGE_LABELS.payment_pending, STAGE_LABELS.with_supplier, STAGE_LABELS.shipped, STAGE_LABELS.delivered])
      .toEqual(['New Order', 'In Stock', 'Payment Pending', 'Ordered From Supplier', 'Dispatched', 'Delivered']);
  });
});

describe('undo delivered (operations, admin)', () => {

  async function deliveredOrder() {
    const p = await staff('procurement');
    const ops = await staff('operations');
    const order = await paidOrder();
    const id = String(order._id);
    await wf.shipWithProof(p, id, { courierName: 'Delhivery', trackingNumber: 'DL1' }, photo(), req);
    const view = await wf.markDelivered(ops, id, {}, req);
    return { id, ops, parcelId: view.parcels[0].id };
  }

  it('puts the parcel back in transit; the order back to shipped and into the deliveries queue — once', async () => {
    const { id, ops, parcelId } = await deliveredOrder();
    expect((await Order.findById(id).lean()).status).toBe('delivered');
    expect((await wf.getOrder(ops, id)).parcels[0].canUndoDelivered).toBe(true);

    let view = await wf.undoDelivered(ops, id, { shipmentId: parcelId }, req);
    expect(view.parcels[0]).toMatchObject({ status: 'shipped', canMarkDelivered: true, canUndoDelivered: false });
    expect(view.history[0].action).toBe('Delivery undone — back in transit');
    const fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('shipped');
    expect(fresh.deliveredAt).toBeUndefined();
    expect(fresh.shipments[0].deliveredAt).toBeUndefined();
    expect(fresh.workflow.open).toBe(true);
    expect((await wf.listQueue(ops, 'deliveries')).orders.map((r) => r.id)).toEqual([id]);

    // Double click: no second event.
    view = await wf.undoDelivered(ops, id, { shipmentId: parcelId }, req);
    expect(view.history.filter((h) => h.action === 'Delivery undone — back in transit')).toHaveLength(1);

    // And it can be delivered again.
    await wf.markDelivered(ops, id, {}, req);
    expect((await Order.findById(id).lean()).status).toBe('delivered');
  });

  it('only operations and the admin; not other teams', async () => {
    const { id, parcelId } = await deliveredOrder();
    for (const u of [await staff('procurement'), await staff('accounts'), await staff('sales', { isHead: true })]) {
      await expect(wf.undoDelivered(u, id, { shipmentId: parcelId }, req)).rejects.toMatchObject({ statusCode: 403 });
    }
    await wf.undoDelivered(await admin(), id, { shipmentId: parcelId }, req);
    expect((await Order.findById(id).lean()).status).toBe('shipped');
  });

  it('loyalty points: kept on undo, and never awarded twice on re-delivery', async () => {
    const { id, ops, parcelId } = await deliveredOrder();
    const buyer = await User.create({ name: 'Ravi', email: `ravi${Date.now()}@example.com`, passwordHash: 'x', role: 'customer' });
    await Order.updateOne({ _id: id }, { $set: { user: buyer._id } });
    const earn = jest.spyOn(karmaService, '_earnedPointsFor').mockReturnValue(50);
    await karmaService.awardForDelivery(id);
    expect((await User.findById(buyer._id).lean()).karmaPoints).toBe(50);

    await wf.undoDelivered(ops, id, { shipmentId: parcelId }, req);
    expect((await User.findById(buyer._id).lean()).karmaPoints).toBe(50); // kept
    await wf.markDelivered(ops, id, {}, req);
    await karmaService.awardForDelivery(id);
    expect((await User.findById(buyer._id).lean()).karmaPoints).toBe(50); // not twice
    expect(await KarmaLedger.countDocuments({ order: id, type: 'earn' })).toBe(1);
    earn.mockRestore();
  });

  it('refused once an affiliate commission was approved / paid, or while a return is in progress', async () => {
    const { id, ops, parcelId } = await deliveredOrder();
    const accrual = jest.spyOn(affiliateCommissionRepository, 'findAccrual').mockResolvedValueOnce({ status: 'paid' });
    await expect(wf.undoDelivered(ops, id, { shipmentId: parcelId }, req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/affiliate/) });
    accrual.mockRestore();
    const ret = jest.spyOn(returnRequestRepository, 'hasInFlightForOrder').mockResolvedValueOnce(true);
    await expect(wf.undoDelivered(ops, id, { shipmentId: parcelId }, req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/return/) });
    ret.mockRestore();
    expect((await Order.findById(id).lean()).status).toBe('delivered');
  });

  it('clears a pending affiliate maturity date stamped on delivery', async () => {
    const { id, ops, parcelId } = await deliveredOrder();
    const clear = jest.spyOn(affiliateCommissionRepository, 'clearMaturity');
    await wf.undoDelivered(ops, id, { shipmentId: parcelId }, req);
    expect(clear).toHaveBeenCalledWith(id);
    clear.mockRestore();
  });

  it('a parcel that is not delivered cannot be undone', async () => {
    const p = await staff('procurement');
    const ops = await staff('operations');
    const order = await paidOrder();
    const id = String(order._id);
    const view = await wf.shipWithProof(p, id, {}, photo(), req);
    const r = await wf.undoDelivered(ops, id, { shipmentId: view.parcels[0].id }, req);
    expect(r.parcels[0].status).toBe('shipped'); // already in transit: nothing to do
    await expect(wf.undoDelivered(ops, id, { shipmentId: new mongoose.Types.ObjectId() }, req)).rejects.toMatchObject({ statusCode: 404 });
  });
});
