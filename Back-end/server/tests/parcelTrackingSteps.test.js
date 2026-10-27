/**
 * Courier progress on a parcel in transit (teamWorkflowService.addParcelStep),
 * against a real in-memory Mongo, through the REAL order and shipment services.
 *
 * What must hold:
 *   - operations (and the admin) record picked up / in transit / out for delivery /
 *     delivery failed on a parcel in transit; nobody else can
 *   - a step never changes the order or parcel status — "Delivered" is markDelivered
 *   - a double press, or two people at once, adds ONE step (compare-and-set)
 *   - nothing is added to a parcel that is delivered or lost; undo delivered reopens it
 *   - the customer sees the steps without who recorded them; the /track timeline gets them
 *   - each parcel keeps its own steps, newest MAX_PARCEL_STEPS
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
const { shipmentsForViewer } = await import('../utils/shipmentView.js');
const { MAX_PARCEL_STEPS } = await import('../utils/parcelSteps.js');

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
    name: `${team} ${n}`, email: `trk-${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
}
const admin = () => User.create({ name: 'Admin', email: `trk-admin${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });

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


async function shippedOrder({ parcels = 1 } = {}) {
  const p = await staff('procurement');
  const order = await paidOrder();
  const id = String(order._id);
  const [cover, mat] = ids(order);
  for (const i of [cover, mat]) await wf.setStock(p, id, i, { stock: 'own_stock' }, req);
  if (parcels === 1) {
    await wf.dispatchOwnStock(p, id, TRACK, null, req);
  } else {
    await wf.dispatchOwnStock(p, id, { ...TRACK, itemIds: [cover] }, null, req);
    await wf.dispatchOwnStock(p, id, { courierName: 'Blue Dart', trackingNumber: 'BD9', itemIds: [mat] }, null, req);
  }
  const fresh = await Order.findById(id).lean();
  return { id, order: fresh, parcelIds: fresh.shipments.map((s) => String(s._id)) };
}
const step = (actor, id, sid, status, expectedSteps, note) => wf.addParcelStep(actor, id, sid, { status, note, expectedSteps }, req);

describe('operations records the courier\'s progress', () => {
  it('picked up → in transit → out for delivery → delivered; status only moves on Delivered', async () => {
    const ops = await staff('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();

    let view = await step(ops, id, sid, 'picked_up', 0);
    view = await step(ops, id, sid, 'in_transit', 1, 'Reached Ernakulam hub');
    view = await step(await staff('operations'), id, sid, 'out_for_delivery', 2);

    const parcel = view.parcels[0];
    expect(parcel.steps.map((s) => [s.label, s.note])).toEqual([
      ['Out for delivery', ''], ['In transit', 'Reached Ernakulam hub'], ['Picked up', ''],
    ]);
    expect(parcel.steps[2].by).toBe(ops.name);
    expect(parcel).toMatchObject({ stepCount: 3, canAddStep: true, status: 'shipped' });
    let fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('shipped');
    expect(fresh.shipments[0].status).toBe('shipped');
    // The order-level tracking timeline (the /track page) has them too.
    expect(fresh.trackingEvents.map((e) => [e.status, e.location || null])).toEqual([
      ['picked_up', null], ['in_transit', 'Reached Ernakulam hub'], ['out_for_delivery', null],
    ]);
    expect(view.history.map((h) => h.action)).toContain('Parcel update');
    // No customer email for a step: only the parcel's own emails.
    expect(enqueued.filter((j) => j.name === 'send-shipment-email' && j.data.kind !== 'shipped')).toHaveLength(0);

    view = await wf.markDelivered(ops, id, { shipmentId: sid }, req);
    fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('delivered');
    expect(view.parcels[0].canAddStep).toBe(false);
  });

  it('delivery failed keeps the parcel in transit, and the courier can try again', async () => {
    const ops = await staff('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await step(ops, id, sid, 'out_for_delivery', 0);
    const view = await step(ops, id, sid, 'delivery_failed', 1, 'Customer not at home');
    expect(view.parcels[0]).toMatchObject({ status: 'shipped', canAddStep: true });
    expect((await Order.findById(id).lean()).trackingEvents.at(-1)).toMatchObject({ status: 'failed_delivery', location: 'Customer not at home' });
    expect((await step(ops, id, sid, 'out_for_delivery', 2)).parcels[0].steps[0].label).toBe('Out for delivery');
  });

  it('a double press or two people at once add ONE step', async () => {
    const ops = await staff('operations');
    const ops2 = await staff('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();

    const results = await Promise.allSettled([step(ops, id, sid, 'picked_up', 0), step(ops2, id, sid, 'picked_up', 0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ statusCode: 409 });
    // A stale screen is refused too.
    await expect(step(ops, id, sid, 'in_transit', 0)).rejects.toMatchObject({ statusCode: 409 });
    const fresh = await Order.findById(id).lean();
    expect(fresh.shipments[0].trackingSteps).toHaveLength(1);
    expect(fresh.shipments[0].stepCount).toBe(1);
    expect(fresh.trackingEvents).toHaveLength(1);
  });

  it('each parcel keeps its own steps', async () => {
    const ops = await staff('operations');
    const { id, parcelIds: [first, second] } = await shippedOrder({ parcels: 2 });
    await step(ops, id, first, 'picked_up', 0);
    const view = await step(ops, id, second, 'out_for_delivery', 0);
    expect(view.parcels.map((p) => p.steps.map((s) => s.status))).toEqual([['picked_up'], ['out_for_delivery']]);
    expect((await Order.findById(id).lean()).trackingEvents.map((e) => e.description)).toEqual(['Parcel 1: Picked up', 'Parcel 2: Out for delivery']);
  });

  it('keeps the newest steps only', async () => {
    const ops = await staff('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    for (let i = 0; i < MAX_PARCEL_STEPS + 2; i += 1) await step(ops, id, sid, 'in_transit', i, `hop ${i}`);
    const parcel = (await Order.findById(id).lean()).shipments[0];
    expect(parcel.trackingSteps).toHaveLength(MAX_PARCEL_STEPS);
    expect(parcel.trackingSteps.at(-1).note).toBe(`hop ${MAX_PARCEL_STEPS + 1}`);
    expect(parcel.stepCount).toBe(MAX_PARCEL_STEPS + 2);
  });
});

describe('who and when', () => {
  it('operations and the admin only', async () => {
    const { id, parcelIds: [sid] } = await shippedOrder();
    for (const team of ['procurement', 'sales', 'accounts', 'marketing']) {
      await expect(step(await staff(team, { isHead: true }), id, sid, 'picked_up', 0)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect((await step(await admin(), id, sid, 'picked_up', 0)).parcels[0].steps).toHaveLength(1);
    // Only operations see the button.
    expect((await wf.getOrder(await staff('procurement'), id)).parcels[0].canAddStep).toBe(false);
  });

  it('not on a delivered parcel — until "Undo delivered" puts it back in transit', async () => {
    const ops = await staff('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await wf.markDelivered(ops, id, { shipmentId: sid }, req);
    await expect(step(ops, id, sid, 'out_for_delivery', 0)).rejects.toMatchObject({ statusCode: 409 });

    await wf.undoDelivered(ops, id, { shipmentId: sid }, req);
    expect((await step(ops, id, sid, 'out_for_delivery', 0)).parcels[0].steps).toHaveLength(1);
  });

  it('refuses an unknown step, a parcel that is not on the order, and a long note is cut', async () => {
    const ops = await staff('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await expect(step(ops, id, sid, 'delivered', 0)).rejects.toMatchObject({ statusCode: 400 });
    await expect(step(ops, id, String(new mongoose.Types.ObjectId()), 'picked_up', 0)).rejects.toMatchObject({ statusCode: 404 });
    const view = await step(ops, id, sid, 'in_transit', 0, 'x'.repeat(300));
    expect(view.parcels[0].steps[0].note).toHaveLength(120);
  });
});

describe('what the customer sees', () => {
  it('the step, its time and note — never who recorded it', async () => {
    const ops = await staff('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await step(ops, id, sid, 'in_transit', 0, 'Reached Kochi');
    const order = await Order.findById(id).lean();

    const [customerView] = shipmentsForViewer(order.shipments, { orderId: id, isAdmin: false });
    expect(customerView.trackingSteps).toEqual([{ status: 'in_transit', note: 'Reached Kochi', at: expect.any(Date) }]);
    expect(customerView.stepCount).toBeUndefined();
    expect(JSON.stringify(customerView)).not.toContain(ops.name);

    const [adminView] = shipmentsForViewer(order.shipments, { orderId: id, isAdmin: true });
    expect(adminView.trackingSteps[0].byName).toBe(ops.name);
  });
});
