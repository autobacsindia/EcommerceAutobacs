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
 *     accounts approves → a pending cancellation refund for an ADMIN to pay
 *   - the panel never moves money: the gateway refund is never called
 *   - one approval = one refund, even when two people click at once
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
const wf = await import('../services/teamWorkflowService.js');
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
    expect(fresh.shipments[0].proofPhoto.publicId).toMatch(/^shipping-slips\/proof-/);
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
    expect((await wf.listQueue(ops, 'deliveries')).orders).toHaveLength(0);
  });

  it('ships only the items chosen, and refuses items not yet checked', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'in_stock' }, req);

    await expect(wf.shipWithProof(p, id, { itemIds: [cover, mat] }, photo(), req)).rejects.toMatchObject({ statusCode: 409 });
    expect(stored.size).toBe(0); // nothing uploaded when refused up front

    const view = await wf.shipWithProof(p, id, { itemIds: [cover] }, photo(), req);
    expect(view.lines.map((l) => l.stage)).toEqual([STAGE.SHIPPED, STAGE.STOCK_CHECK]);
    expect((await Order.findById(id).lean()).workflow.open).toBe(true);
  });

  it('refuses a file that is not really an image', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    await wf.setStock(p, String(order._id), ids(order)[0], { stock: 'in_stock' }, req);
    const fake = { buffer: Buffer.from('%PDF-1.4 not an image'), mimetype: 'image/jpeg' };
    await expect(wf.shipWithProof(p, String(order._id), {}, fake, req)).rejects.toMatchObject({ statusCode: 400 });
    expect(stored.size).toBe(0);
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

describe('out of stock → customer → accounts → admin', () => {
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

  it('turns an approved refund into a PENDING cancellation refund — no money moves', async () => {
    const refundSpy = jest.spyOn(razorpayService, 'refundPayment');
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const acc = await staff('accounts');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);

    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);
    expect(enqueued.map((j) => j.name)).toContain('send-team-refund-requested-alert');
    expect((await wf.listQueue(acc, 'refunds')).orders.map((r) => r.id)).toEqual([id]);

    const view = await wf.reviewRefund(acc, id, cover, { approve: true, note: 'OK' }, req);

    const fresh = await Order.findById(id).lean();
    expect(fresh.cancellations).toHaveLength(1);
    expect(fresh.cancellations[0]).toMatchObject({ reason: 'out_of_stock' });
    expect(fresh.cancellations[0].refund.status).toBe('pending');
    expect(fresh.cancellations[0].refund.productValuePaise).toBe(500000);
    expect(String(fresh.workflow.lines[0].cancellationId)).toBe(String(fresh.cancellations[0]._id));
    expect(view.lines[0].stage).toBe(STAGE.CANCELLED);
    expect(fresh.status).toBe('processing'); // the floor mats are still owed
    expect(refundSpy).not.toHaveBeenCalled();
    expect(enqueued.map((j) => j.name)).toContain('send-admin-team-refund-ready-alert');
    expect((await wf.listQueue(acc, 'refunds')).orders).toHaveLength(0);
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

  it('approves only once when two people approve at the same moment', async () => {
    const p = await staff('procurement');
    const head = await staff('sales', { isHead: true });
    const [a1, a2] = [await staff('accounts'), await staff('accounts')];
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(head, id, cover, { decision: 'refund' }, req);

    const results = await Promise.allSettled([
      wf.reviewRefund(a1, id, cover, { approve: true }, req),
      wf.reviewRefund(a2, id, cover, { approve: true }, req),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await Order.findById(id).lean()).cancellations).toHaveLength(1);
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
    expect(all[0].workflowSummary).toBe('Needs stock check (2 of 2)');
    await expect(listPaidSalesOrders(seller)).rejects.toMatchObject({ statusCode: 403 });
  });
});
