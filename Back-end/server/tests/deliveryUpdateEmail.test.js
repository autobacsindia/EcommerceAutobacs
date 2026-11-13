/**
 * "Your delivery details were updated" (services/deliveryUpdateEmailService.js),
 * against a real in-memory Mongo, through the REAL team-panel edit path.
 *
 * What must hold:
 *   - a real tracking/courier correction on a parcel in transit sends ONE email
 *   - the same save twice, a queue retry, or two workers at once still send one
 *   - edits the customer cannot see (photos, nothing changed) send none
 *   - packed (not yet shipped), delivered and lost parcels send none
 *   - on a multi-parcel order only the edited parcel is emailed about
 *   - at most one email per parcel per 10 minutes, carrying the LATEST values
 *   - no customer email → nothing sent; a provider failure is retried, not lost
 *
 * The provider (emailHandler.sendEmail) is stubbed: nothing leaves the machine.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const enqueued = [];
const mockQueue = { add: (name, data, opts) => { enqueued.push({ name, data, opts }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
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

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { default: shipmentService } = await import('../services/shipmentService.js');
const { default: orderTrackingService } = await import('../services/orderTrackingService.js');
const { default: emailHandler } = await import('../services/emailHandler.js');
const wf = await import('../services/teamWorkflowService.js');
const { emailOrderStatusUpdate } = await import('../services/orderStatusEmailService.js');
const {
  emailDeliveryUpdate, JOB_NAME, RATE_WINDOW_MS, SETTLE_MS, CLAIM_LEASE_MS,
} = await import('../services/deliveryUpdateEmailService.js');
const { deliveryUpdateEmail } = await import('../utils/emailTemplates.js');

const ORIGINAL = { REDIS_URL: process.env.REDIS_URL, FRONTEND_URL: process.env.FRONTEND_URL };
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.FRONTEND_URL = 'https://shop.example.test';
afterAll(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);
const photo = () => ({ buffer: JPEG, mimetype: 'image/jpeg', originalname: 'proof.jpg' });

let sent;
let n = 0;
beforeEach(() => {
  enqueued.length = 0;
  sent = [];
  jest.spyOn(emailHandler, 'sendEmail').mockImplementation(async (msg) => { sent.push(msg); return { success: true }; });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Order.deleteMany({});
});

const procurement = () => User.create({
  name: `Proc ${++n}`, email: `proc${n}@autobacs.test`, phone: '9000000001',
  passwordHash: 'x', role: 'staff', staff: { team: 'procurement', isHead: false, active: true },
});
const customer = (email = `asha${++n}@example.test`) => User.create({ name: 'Asha', email, passwordHash: 'x', role: 'customer' });

/** Paid the way production pays: awaiting_payment → processing (enters the team workflow). */
async function paidOrder(user, { items } = {}) {
  const order = await Order.create({
    user: user?._id || new mongoose.Types.ObjectId(),
    source: 'web',
    items: items || [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 2 },
    ],
    shippingAddress: { fullName: 'Asha K', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 7000, totalAmount: 7000,
    status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return String(order._id);
}

/** Ship through the team panel, then send the shipped email (records what the customer saw). */
async function shippedParcel({ user, p, itemIds = [], courierName = 'Delhivery', trackingNumber = 'DL111' } = {}) {
  p = p || await procurement();
  user = user === undefined ? await customer() : user;
  const id = await paidOrder(user);
  const view = await wf.shipWithProof(p, id, { itemIds, courierName, trackingNumber }, [photo()], req);
  const parcelId = view.parcels[view.parcels.length - 1].id;
  await emailOrderStatusUpdate(id, 'shipped', { shipmentId: parcelId });
  sent.length = 0;
  enqueued.length = 0;
  return { id, parcelId, p, user };
}

const updateJobs = () => enqueued.filter((j) => j.name === JOB_NAME);
const parcelOf = async (id, parcelId) => (await Order.findById(id).lean()).shipments.find((s) => String(s._id) === parcelId);
/** Run the worker as BullMQ would, after the settle delay. */
const runJob = (id, parcelId, at = Date.now() + SETTLE_MS) => emailDeliveryUpdate(id, parcelId, { now: at });
/** Pretend the shipped email went out `ms` ago (beyond the rate window by default). */
const ageNotice = (id, parcelId, ms = RATE_WINDOW_MS + 1000) =>
  Order.updateOne({ _id: id, 'shipments._id': parcelId }, { $set: { 'shipments.$.deliveryNotice.sentAt': new Date(Date.now() - ms) } });

describe('a real correction', () => {
  it('sends exactly one email with the new tracking number and courier, and a link to the order', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);

    await wf.editShipment(p, id, parcelId, { courierName: 'Blue Dart', trackingNumber: 'BD999' }, [], req);
    expect(updateJobs()).toEqual([{ name: JOB_NAME, data: { orderId: id, shipmentId: parcelId }, opts: { delay: SETTLE_MS } }]);

    expect(await runJob(id, parcelId)).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    const ref = `AB-${id.slice(-8).toUpperCase()}`;
    expect(sent[0].subject).toBe(`Delivery update for your order #${ref}`);
    expect(sent[0].to).toMatch(/@example\.test$/);
    expect(sent[0].text).toContain('Tracking number: BD999');
    expect(sent[0].text).toContain('Courier: Blue Dart');
    expect(sent[0].text).toContain(`https://shop.example.test/orders/${id}`);
    expect(sent[0].html).toContain('BD999');
    expect(sent[0].text).not.toContain('DL111');
  });

  it('the same save twice sends one email; so does running the job twice (a queue retry)', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);

    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL222' }, [], req);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL222' }, [], req); // double-save: nothing changed
    expect(updateJobs()).toHaveLength(1);

    expect((await runJob(id, parcelId)).status).toBe('sent');
    expect((await runJob(id, parcelId)).status).toBe('unchanged'); // retry / duplicate job
    expect(sent).toHaveLength(1);
  });

  it('a genuinely new correction later sends again', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL222' }, [], req);
    await runJob(id, parcelId);
    await ageNotice(id, parcelId);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL333' }, [], req);
    expect((await runJob(id, parcelId)).status).toBe('sent');
    expect(sent.map((m) => m.text.match(/Tracking number: (\w+)/)[1])).toEqual(['DL222', 'DL333']);
  });
});

describe('no email', () => {
  it('for edits the customer cannot see: nothing changed, or only the proof photos', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await wf.editShipment(p, id, parcelId, { courierName: 'Delhivery', trackingNumber: 'DL111' }, [], req);
    await wf.editShipment(p, id, parcelId, {}, [photo()], req);
    expect(updateJobs()).toHaveLength(0);
    // And the job itself agrees, should one run anyway.
    expect((await runJob(id, parcelId)).status).toBe('unchanged');
    expect(sent).toHaveLength(0);
  });

  it('when a correction is undone before the email went out', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'TYPO' }, [], req);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL111' }, [], req);
    for (const j of updateJobs()) expect((await runJob(j.data.orderId, j.data.shipmentId)).status).toBe('unchanged');
    expect(sent).toHaveLength(0);
  });

  it('for a parcel not yet shipped (packed)', async () => {
    const user = await customer();
    const id = await paidOrder(user);
    const res = await shipmentService.createShipment(id, { trackingNumber: 'PK1', carrier: { name: 'Delhivery' }, dispatch: false });
    expect(res.success).toBe(true);
    const parcelId = String(res.shipment._id);
    expect((await parcelOf(id, parcelId)).status).toBe('packed');
    expect((await runJob(id, parcelId)).status).toBe('not-in-transit');
    expect(sent).toHaveLength(0);
  });

  it('for a delivered parcel, and for a lost one', async () => {
    const a = await shippedParcel();
    await Order.updateOne({ _id: a.id, 'shipments._id': a.parcelId }, { $set: { 'shipments.$.trackingNumber': 'NEW1' } });
    await shipmentService.markShipmentDelivered(a.id, a.parcelId);
    expect((await runJob(a.id, a.parcelId)).status).toBe('not-in-transit');

    const b = await shippedParcel();
    await Order.updateOne({ _id: b.id, 'shipments._id': b.parcelId }, { $set: { 'shipments.$.trackingNumber': 'NEW2' } });
    await shipmentService.markShipmentLost(b.id, b.parcelId);
    expect((await runJob(b.id, b.parcelId)).status).toBe('not-in-transit');

    expect(sent).toHaveLength(0);
  });

  it('when the order has no customer email', async () => {
    const { id, parcelId, p } = await shippedParcel({ user: null }); // order.user points at nobody
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL999' }, [], req);
    expect((await runJob(id, parcelId)).status).toBe('no-recipient');
    expect(sent).toHaveLength(0);
  });
});

describe('phone-only customer', () => {
  it('a placeholder .invalid address counts as no email: nothing is sent', async () => {
    const user = await customer(`phone${++n}@customers.autobacs.invalid`);
    const { id, parcelId, p } = await shippedParcel({ user });
    await ageNotice(id, parcelId);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL808' }, [], req);
    expect((await runJob(id, parcelId)).status).toBe('no-recipient');
    expect(sent).toHaveLength(0);
    expect((await parcelOf(id, parcelId)).deliveryNotice?.claimHash).toBeUndefined();
  });
});

describe('multi-parcel orders', () => {
  it('only the edited parcel is emailed about, and says which parcel', async () => {
    const p = await procurement();
    const user = await customer();
    const id = await paidOrder(user);
    const order = await Order.findById(id).lean();
    const [cover, mat] = order.items.map((i) => String(i._id));
    let view = await wf.shipWithProof(p, id, { itemIds: [cover], courierName: 'Delhivery', trackingNumber: 'P1AWB' }, [photo()], req);
    const first = view.parcels[0].id;
    view = await wf.shipWithProof(p, id, { itemIds: [mat], courierName: 'Delhivery', trackingNumber: 'P2AWB' }, [photo()], req);
    const second = view.parcels.find((x) => x.id !== first).id;
    for (const sid of [first, second]) await emailOrderStatusUpdate(id, 'shipped', { shipmentId: sid });
    for (const sid of [first, second]) await ageNotice(id, sid);
    sent.length = 0;
    enqueued.length = 0;

    await wf.editShipment(p, id, second, { trackingNumber: 'P2FIXED' }, [], req);
    expect(updateJobs().map((j) => j.data.shipmentId)).toEqual([second]);

    expect((await runJob(id, second)).status).toBe('sent');
    expect((await runJob(id, first)).status).toBe('unchanged');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('P2FIXED');
    expect(sent[0].text).toContain('parcel 2 of 2');
    expect(sent[0].text).not.toContain('P1AWB');
  });
});

describe('retries, races and the 10-minute guard', () => {
  it('a provider failure is retried (claim released) and then sends once', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL500' }, [], req);

    emailHandler.sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' });
    await expect(runJob(id, parcelId)).rejects.toThrow('provider down');
    expect((await parcelOf(id, parcelId)).deliveryNotice.claimHash).toBeUndefined();

    expect((await runJob(id, parcelId)).status).toBe('sent'); // BullMQ's retry
    expect((await runJob(id, parcelId)).status).toBe('unchanged'); // and another
    expect(sent.filter((m) => m.text.includes('DL500'))).toHaveLength(1);
  });

  it('two workers at once: one sends, the other backs off and re-queues', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL600' }, [], req);
    enqueued.length = 0;

    const results = await Promise.all([runJob(id, parcelId), runJob(id, parcelId)]);
    expect(results.map((r) => r.status).sort()).toEqual(['busy', 'sent']);
    expect(sent).toHaveLength(1);
    expect(updateJobs()).toHaveLength(1); // the loser looks again shortly
  });

  it('a claim left by a crashed worker expires', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL700' }, [], req);
    await Order.updateOne({ _id: id, 'shipments._id': parcelId }, {
      $set: { 'shipments.$.deliveryNotice.claimHash': 'x', 'shipments.$.deliveryNotice.claimedAt': new Date() },
    });
    expect((await runJob(id, parcelId)).status).toBe('busy');
    expect((await runJob(id, parcelId, Date.now() + CLAIM_LEASE_MS + 1000)).status).toBe('sent');
  });

  it('at most one email per parcel per 10 minutes, then one more with the latest values', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await ageNotice(id, parcelId);
    const t0 = Date.now();
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'A1' }, [], req);
    expect((await runJob(id, parcelId, t0)).status).toBe('sent');

    enqueued.length = 0;
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'B2' }, [], req);
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'C3' }, [], req);
    expect((await runJob(id, parcelId, t0 + 60_000)).status).toBe('rescheduled');
    expect((await runJob(id, parcelId, t0 + 120_000)).status).toBe('rescheduled');
    const follow = updateJobs().filter((j) => j.opts.jobId);
    expect(new Set(follow.map((j) => j.opts.jobId)).size).toBe(1); // both collapse into one follow-up
    expect(follow[0].opts.delay).toBe(RATE_WINDOW_MS - 60_000);

    expect((await runJob(id, parcelId, t0 + RATE_WINDOW_MS)).status).toBe('sent');
    expect(sent.map((m) => m.text.match(/Tracking number: (\w+)/)[1])).toEqual(['A1', 'C3']);
  });

  it('waits for a shipped email that has not gone out yet, rather than sending two', async () => {
    const p = await procurement();
    const user = await customer();
    const id = await paidOrder(user);
    const view = await wf.shipWithProof(p, id, { courierName: 'Delhivery', trackingNumber: 'DL1' }, [photo()], req);
    const parcelId = view.parcels[0].id;
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL2' }, [], req);
    expect((await runJob(id, parcelId)).status).toBe('rescheduled');
    await emailOrderStatusUpdate(id, 'shipped', { shipmentId: parcelId }); // carries DL2
    expect((await runJob(id, parcelId, Date.now() + RATE_WINDOW_MS)).status).toBe('unchanged');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('DL2');
  });
});

describe('the courier link', () => {
  it('same courier, new number: the link follows the number; new courier: the old link is dropped', async () => {
    const { id, parcelId, p } = await shippedParcel();
    await Order.updateOne({ _id: id, 'shipments._id': parcelId }, {
      $set: { 'shipments.$.carrier.trackingUrl': 'https://track.example.test/?awb=DL111', 'shipments.$.carrier.code': 'DELHIVERY' },
    });
    await wf.editShipment(p, id, parcelId, { trackingNumber: 'DL444' }, [], req);
    expect((await parcelOf(id, parcelId)).carrier).toMatchObject({ trackingUrl: 'https://track.example.test/?awb=DL444', code: 'DELHIVERY' });

    await wf.editShipment(p, id, parcelId, { courierName: 'Blue Dart' }, [], req);
    const c = (await parcelOf(id, parcelId)).carrier;
    expect(c.name).toBe('Blue Dart');
    expect(c.trackingUrl).toBeUndefined();
    expect(c.code).toBeUndefined();
  });

  it('a link built for an old number is never put in the email', () => {
    const order = { _id: new mongoose.Types.ObjectId(), user: null, shipments: [] };
    const { text } = deliveryUpdateEmail({ order, details: { trackingNumber: 'NEW', courier: 'X', courierUrl: '' } });
    expect(text).not.toContain('Track with the courier');
  });
});

describe('legacy order shipped without parcels (POST /orders/:id/tracking)', () => {
  it('a correction emails once; an order with parcels is left to the parcel edit', async () => {
    const user = await customer();
    const legacy = await Order.create({
      user: user._id, items: [{ product: new mongoose.Types.ObjectId(), name: 'Wax', price: 500, quantity: 1 }],
      shippingAddress: { fullName: 'Asha K', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 500, totalAmount: 500, status: 'shipped', paymentStatus: 'paid',
      trackingNumber: 'OLD1', carrier: { name: 'Other courier', code: 'OTHER' }, notifiedStatuses: ['shipped'],
      deliveryNotice: { hash: 'whatever-was-sent', sentAt: new Date(Date.now() - RATE_WINDOW_MS * 2) },
    });
    const id = String(legacy._id);

    const r = await orderTrackingService.addTrackingInfo(id, { trackingNumber: 'NEW1', carrierCode: 'OTHER', carrierName: 'Other courier' });
    expect(r.success).toBe(true);
    expect(updateJobs().map((j) => j.data)).toEqual([{ orderId: id, shipmentId: null }]);
    expect((await emailDeliveryUpdate(id, null)).status).toBe('sent');
    expect((await emailDeliveryUpdate(id, null)).status).toBe('unchanged');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('NEW1');

    enqueued.length = 0;
    const { id: withParcels } = await shippedParcel();
    enqueued.length = 0;
    await orderTrackingService.addTrackingInfo(withParcels, { trackingNumber: 'ZZZ', carrierCode: 'OTHER', carrierName: 'Other courier' });
    expect(updateJobs()).toHaveLength(0);
    expect((await emailDeliveryUpdate(withParcels, null)).status).toBe('not-in-transit');
  });
});
