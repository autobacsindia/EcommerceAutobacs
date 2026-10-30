/**
 * Team workflow — items sent from OUR OWN warehouse (services/teamWorkflowService.js),
 * against a real in-memory Mongo, through the REAL order and shipment services.
 *
 * What must hold:
 *   - "Our Warehouse" skips the supplier entirely: no supplier name, no supplier
 *     payment (so no accounts approval or admin payment) — courier + tracking and
 *     the items are shipped, then operations follows them to delivery
 *   - courier and tracking are required; the photo is optional but, if given, must be an image
 *   - our-warehouse items never go in a supplier parcel, and supplier items never go in ours
 *   - a double press (or two people at once) creates ONE parcel
 *   - a free gift still owed goes in the box we pack ourselves
 *   - every follow-on record moves: order status, customer email, team alert, history,
 *     timeline, the stuck / overdue digests
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const { buildTimeline } = await import('../services/teamActivityService.js');
const { STUCK_AFTER_HOURS } = await import('../services/chatStuckDigest.js');
const { STAGE, STAGE_TEAM } = await import('../utils/teamWorkflow.js');

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);
const photo = (buffer = JPEG) => ({ buffer, mimetype: 'image/jpeg', originalname: 'parcel.jpg' });
const TRACK = { courierName: 'Delhivery', trackingNumber: 'DL555' };

let n = 0;
async function staff(team, { isHead = false } = {}) {
  n += 1;
  return User.create({
    name: `${team} ${n}`, email: `own-${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
}
const admin = () => User.create({ name: 'Admin', email: `own-admin${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });

const GOODIE = {
  spinReward: {
    result: new mongoose.Types.ObjectId(),
    prize: new mongoose.Types.ObjectId(),
    name: 'Microfibre Cloth', sku: 'MF-1', kind: 'goodie',
    wonAt: new Date(), fulfilledAt: null, voidedAt: null,
  },
};

async function paidOrder(extra = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    source: 'web',
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 2 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 7000, totalAmount: 7000,
    status: 'awaiting_payment', paymentStatus: 'pending',
    ...extra,
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(`could not pay test order: ${res?.message}`);
  return Order.findById(order._id).lean();
}
const ids = (o) => o.items.map((i) => String(i._id));
const lineOf = (view, itemId) => view.lines.find((l) => l.itemId === itemId);

beforeEach(() => {
  enqueued.length = 0;
  stored.clear();
});
afterEach(() => { jest.restoreAllMocks(); });

describe('our warehouse → courier + tracking → operations → delivered', () => {
  it('runs end to end with no supplier, no supplier payment and no photo', async () => {
    const p = await staff('procurement');
    const ops = await staff('operations');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = ids(order);

    expect(lineOf(await wf.getOrder(p, id), cover).actions).toContain('own_stock');
    await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);
    let view = await wf.setStock(p, id, mat, { stock: 'own_stock' }, req);

    expect(view.lines.map((l) => [l.stage, l.stageLabel])).toEqual([[STAGE.OWN_STOCK, 'Our Warehouse'], [STAGE.OWN_STOCK, 'Our Warehouse']]);
    expect(lineOf(view, cover).actions).toEqual(expect.arrayContaining(['dispatch_own', 'out_of_stock', 'stock_undo']));
    // No supplier route on these lines: neither the supplier parcel nor a supplier order.
    expect(lineOf(view, cover).actions).not.toEqual(expect.arrayContaining(['ship']));
    expect(lineOf(view, cover).actions).not.toContain('ordered');
    expect(view.canDispatchOwn).toBe(true);
    expect(view.canShip).toBe(false);
    // Still procurement's to pack.
    expect((await wf.listQueue(p, 'procurement')).orders.map((r) => r.id)).toEqual([id]);

    view = await wf.dispatchOwnStock(p, id, TRACK, null, req);

    const fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('shipped');
    expect(fresh.shipments).toHaveLength(1);
    expect(fresh.shipments[0]).toMatchObject({ status: 'shipped', trackingNumber: 'DL555' });
    expect(fresh.shipments[0].carrier.name).toBe('Delhivery');
    expect(fresh.shipments[0].proofPhoto?.publicId).toBeUndefined();
    expect(fresh.shipments[0].lines.map((l) => [String(l.itemId), l.quantity])).toEqual([[cover, 1], [mat, 2]]);
    expect(stored.size).toBe(0);
    // The customer's normal shipped email, and the team alert marked as ours.
    expect(enqueued.map((j) => j.name)).toEqual(expect.arrayContaining(['send-shipment-email', 'send-team-shipped-alert']));
    expect(enqueued.find((j) => j.name === 'send-team-shipped-alert').data).toMatchObject({ fromWarehouse: true });
    expect(view.lines.every((l) => l.stage === STAGE.SHIPPED)).toBe(true);
    expect(view.parcels[0].photoUrl).toBeNull();
    expect(view.history.map((h) => h.action)).toEqual(expect.arrayContaining(['From our warehouse', 'Dispatched from our warehouse']));

    // Operations follows it; procurement is done.
    expect((await wf.listQueue(ops, 'deliveries')).orders.map((r) => r.id)).toEqual([id]);
    expect((await wf.listQueue(p, 'procurement')).orders).toHaveLength(0);

    await wf.markDelivered(ops, id, {}, req);
    const done = await Order.findById(id).lean();
    expect(done.status).toBe('delivered');
    expect(done.workflow.open).toBe(false);
  });

  it('requires the courier and the tracking number', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    for (const itemId of ids(order)) await wf.setStock(p, id, itemId, { stock: 'own_stock' }, req);

    await expect(wf.dispatchOwnStock(p, id, { trackingNumber: 'DL1' }, null, req)).rejects.toMatchObject({ statusCode: 400, message: 'Enter the courier name.' });
    await expect(wf.dispatchOwnStock(p, id, { courierName: 'Delhivery', trackingNumber: '   ' }, null, req)).rejects.toMatchObject({ statusCode: 400, message: 'Enter the tracking number.' });
    expect((await Order.findById(id).lean()).shipments).toHaveLength(0);
  });

  it('takes optional proofs — and refuses one that is not really a photo or PDF, storing nothing', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    for (const itemId of ids(order)) await wf.setStock(p, id, itemId, { stock: 'own_stock' }, req);

    await expect(wf.dispatchOwnStock(p, id, TRACK, [photo(), photo(Buffer.from('<html>not a photo</html>'))], req)).rejects.toMatchObject({ statusCode: 400 });
    expect(stored.size).toBe(0);

    const view = await wf.dispatchOwnStock(p, id, TRACK, photo(), req);
    expect(view.parcels[0].photoUrl).toMatch(/\/parcels\/.+\/photo$/);
    expect(stored.size).toBe(1);
  });

  it('a mixed order: ours and the supplier\'s go in separate parcels, never together', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);
    await wf.setStock(p, id, mat, { stock: 'in_stock' }, req);

    // Our item cannot be picked into the supplier parcel, nor theirs into ours.
    await expect(wf.shipWithProof(p, id, { itemIds: [cover] }, photo(), req)).rejects.toMatchObject({ statusCode: 409 });
    await expect(wf.dispatchOwnStock(p, id, { ...TRACK, itemIds: [mat] }, null, req)).rejects.toMatchObject({ statusCode: 409 });

    // "Ship all" on the supplier side leaves our item alone…
    let view = await wf.shipWithProof(p, id, {}, photo(), req);
    expect(view.lines.map((l) => l.stage)).toEqual([STAGE.OWN_STOCK, STAGE.SHIPPED]);
    // …and ours ships only ours.
    view = await wf.dispatchOwnStock(p, id, TRACK, null, req);
    const fresh = await Order.findById(id).lean();
    expect(fresh.shipments.map((s) => s.lines.map((l) => String(l.itemId)))).toEqual([[mat], [cover]]);
    expect(view.lines.every((l) => l.stage === STAGE.SHIPPED)).toBe(true);
  });

  it('two presses at the same moment create ONE parcel', async () => {
    const p = await staff('procurement');
    const p2 = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    for (const itemId of ids(order)) await wf.setStock(p, id, itemId, { stock: 'own_stock' }, req);

    const results = await Promise.allSettled([
      wf.dispatchOwnStock(p, id, TRACK, null, req),
      wf.dispatchOwnStock(p2, id, { courierName: 'Blue Dart', trackingNumber: 'BD1' }, null, req),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ statusCode: 409 });
    const fresh = await Order.findById(id).lean();
    expect(fresh.shipments).toHaveLength(1);
    expect(enqueued.filter((j) => j.name === 'send-team-shipped-alert')).toHaveLength(1);
    expect(enqueued.filter((j) => j.name === 'send-shipment-email')).toHaveLength(1);
  });

  it('a free gift still owed goes in the box we pack ourselves', async () => {
    const p = await staff('procurement');
    const order = await paidOrder(GOODIE);
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);

    await wf.dispatchOwnStock(p, id, TRACK, null, req);
    const fresh = await Order.findById(id).lean();
    expect(fresh.shipments[0].includesReward).toBe(true);
    // The rest of the order is still owed: it is not finished by the gift going out.
    expect(fresh.status).not.toBe('delivered');
  });
});

describe('who and when', () => {
  it('procurement and the admin only — sales, accounts and operations cannot', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = ids(order);
    for (const team of ['sales', 'accounts', 'operations']) {
      const s = await staff(team, { isHead: true });
      await expect(wf.setStock(s, id, cover, { stock: 'own_stock' }, req)).rejects.toMatchObject({ statusCode: 403 });
    }
    await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);
    for (const team of ['sales', 'accounts', 'operations']) {
      const s = await staff(team, { isHead: true });
      await expect(wf.dispatchOwnStock(s, id, TRACK, null, req)).rejects.toMatchObject({ statusCode: 403 });
    }
    const a = await admin();
    await wf.setStock(a, id, mat, { stock: 'own_stock' }, req);
    expect((await wf.dispatchOwnStock(a, id, TRACK, null, req)).parcels).toHaveLength(1);
  });

  it('undo puts it back to New Order — until it has been dispatched', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);

    let view = await wf.undoStock(await staff('procurement'), id, cover, req);
    expect(lineOf(view, cover).stage).toBe(STAGE.STOCK_CHECK);

    await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);
    view = await wf.dispatchOwnStock(p, id, { ...TRACK, itemIds: [cover] }, null, req);
    expect(lineOf(view, cover).actions).not.toContain('stock_undo');
    await expect(wf.undoStock(p, id, cover, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('out of stock after all: the usual customer decision', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);
    const view = await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    expect(lineOf(view, cover).stage).toBe(STAGE.CUSTOMER_DECISION);
  });

  it('stock found in our warehouse while the customer is deciding; the old supplier name is dropped', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'ordered', supplierName: 'Ram Traders' }, req);
    await wf.setStock(p, id, cover, { stock: 'out_of_stock' }, req);
    const view = await wf.setStock(p, id, cover, { stock: 'own_stock' }, req);
    expect(lineOf(view, cover).stage).toBe(STAGE.OWN_STOCK);
    const line = (await Order.findById(id).lean()).workflow.lines.find((l) => String(l.itemId) === cover);
    expect(line.supplierName).toBeUndefined();
  });

  it('an item already ordered from a supplier cannot switch to our warehouse', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(p, id, cover, { stock: 'ordered', supplierName: 'Ram Traders' }, req);
    await expect(wf.setStock(p, id, cover, { stock: 'own_stock' }, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('nothing in our warehouse: nothing to dispatch', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    await expect(wf.dispatchOwnStock(p, String(order._id), TRACK, null, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('the records around it', () => {
  it('the activity timeline reads the steps and closes the wait at dispatch', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    for (const itemId of ids(order)) await wf.setStock(p, id, itemId, { stock: 'own_stock' }, req);
    await wf.dispatchOwnStock(p, id, TRACK, null, req);

    const steps = buildTimeline(await Order.findById(id).lean());
    expect(steps.map((s) => s.label)).toEqual(expect.arrayContaining(['From our warehouse', 'Dispatched from our warehouse']));
    const dispatched = steps.find((s) => s.action === 'shipped_own');
    expect(dispatched.waited).not.toBeNull();
  });

  it('every stage a team owns has a "stuck after" limit, so the digests can remind about it', () => {
    for (const stage of Object.keys(STAGE_TEAM)) expect(STUCK_AFTER_HOURS[stage]).toBeGreaterThan(0);
  });
});
