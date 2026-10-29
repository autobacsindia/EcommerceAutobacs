/**
 * "Edit order" — procurement corrects an order by hand (services/orderCorrectionService.js),
 * against a real in-memory Mongo, through the REAL order and shipment services.
 *
 * What must hold:
 *   - an old order can be moved straight to Dispatched or Delivered, with the dates it
 *     really happened, through the same parcel records an admin creates
 *   - the customer is told nothing (no parcel email, no review request) and the team
 *     chat is not posted to — but loyalty points follow delivery as usual
 *   - courier / tracking / dates can be fixed on any parcel, even a delivered one
 *   - an item can go back to New Order, never when a supplier payment is open or paid
 *   - every correction needs a reason and is recorded with the person's name, in the
 *     order history and the audit log
 *   - compare-and-set: a stale view is refused and two people at once make ONE parcel
 *   - never money: payment-pending, out-of-stock, refund and cancelled lines and
 *     cancelled orders are refused; only procurement and the admin may correct
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
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ buffer, folder, basename }) => ({ publicId: `${folder}/${basename}`, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' }),
  deletePrivateAsset: async () => true,
  readPrivateAsset: async () => Buffer.alloc(0),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const { correctOrder } = await import('../services/orderCorrectionService.js');
const { correctionDate } = await import('../utils/orderCorrection.js');
const { STAGE } = await import('../utils/teamWorkflow.js');

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const REASON = 'Sent via Google Chat in March';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);

let n = 0;
async function staff(team, { isHead = false } = {}) {
  n += 1;
  return User.create({
    name: `${team} ${n}`, email: `fix-${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
}
const admin = () => User.create({ name: 'Admin', email: `fix-admin${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });

/** A paid order placed `daysAgo` days ago, in the team workflow. */
async function paidOrder({ daysAgo = 60, extra = {} } = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    source: 'web',
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Bull bar', price: 50000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Fog lamp', price: 4000, quantity: 2 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 58000, totalAmount: 58000,
    status: 'awaiting_payment', paymentStatus: 'pending',
    ...extra,
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(`could not pay test order: ${res?.message}`);
  const placed = new Date(Date.now() - daysAgo * 86400000);
  await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: placed } });
  return Order.findById(order._id).lean();
}
const ids = (o) => o.items.map((i) => String(i._id));
const stagesOf = (view) => Object.fromEntries(view.lines.map((l) => [l.itemId, l.stage]));
const parcelsOf = (view) => Object.fromEntries(view.parcels.map((p) => [p.id, p.status]));
const lineOf = (view, itemId) => view.lines.find((l) => l.itemId === itemId);
const istDay = (daysAgo) => new Date(Date.now() + 5.5 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);
const jobs = () => enqueued.map((j) => j.name);
const lastHistory = (view) => view.history[0];
async function auditRows(orderId) {
  for (let i = 0; i < 20; i += 1) {
    const rows = await AuditLog.find({ resourceId: String(orderId), 'details.change': 'team_correction' }).lean();
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

/** "Ordered From Supplier" on every line — what the old Google Chat orders look like. */
async function orderedOrder(p, opts) {
  const order = await paidOrder(opts);
  const id = String(order._id);
  for (const itemId of ids(order)) await wf.setStock(p, id, itemId, { stock: 'ordered', supplierName: 'ARB India' }, req);
  return { order, id, view: await wf.getOrder(p, id) };
}

beforeEach(() => { enqueued.length = 0; });
afterEach(() => { jest.restoreAllMocks(); });

describe('dispatched', () => {
  it('moves "Ordered From Supplier" items to Dispatched with the real date, and tells nobody', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    expect(view.corrections.dispatch).toEqual(ids(order));
    enqueued.length = 0;

    const after = await correctOrder(p, id, {
      action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view),
      courierName: 'Delhivery', trackingNumber: 'DL123', shippedOn: istDay(40),
    }, req);

    expect(after.lines.map((l) => l.stage)).toEqual([STAGE.SHIPPED, STAGE.SHIPPED]);
    const fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('shipped');
    expect(fresh.shipments).toHaveLength(1);
    const parcel = fresh.shipments[0];
    expect(parcel).toMatchObject({ status: 'shipped', trackingNumber: 'DL123', carrier: { name: 'Delhivery' } });
    expect(parcel.proofPhoto?.publicId).toBeUndefined();
    expect(parcel.shippedAt.toISOString().slice(0, 10)).toBe(istDay(40));
    expect(parcel.lines.map((l) => [String(l.itemId), l.quantity])).toEqual([[ids(order)[0], 1], [ids(order)[1], 2]]);
    // The first parcel's tracking is on the order, as for any dispatch.
    expect(fresh.trackingNumber).toBe('DL123');

    // Nothing to the customer, nothing to team chat.
    expect(jobs()).not.toEqual(expect.arrayContaining(['send-shipment-email']));
    expect(jobs()).not.toEqual(expect.arrayContaining(['send-order-status-email']));
    expect(jobs()).not.toEqual(expect.arrayContaining(['send-team-shipped-alert']));
    expect(jobs().filter((j) => /chat/i.test(j))).toEqual([]);

    // Recorded: who, what, why — in the history and the audit log.
    expect(lastHistory(after)).toMatchObject({ action: 'Order corrected by hand', by: p.name, team: 'Procurement' });
    expect(lastHistory(after).note).toMatch(/^Marked dispatched: Bull bar, Fog lamp · Delhivery DL123 · on .+ — Reason: Sent via Google Chat in March$/);
    const [row] = await auditRows(id);
    expect(row.details).toMatchObject({ action: 'dispatched', reason: REASON, itemIds: ids(order) });

    // Off procurement's list, onto operations'.
    expect((await wf.listQueue(p, 'procurement')).orders.map((r) => r.id)).not.toContain(id);
    expect(after.needs).toEqual(['operations']);
  });

  it('needs no courier, tracking or date — and can send part of the order', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    const [bar, lamp] = ids(order);
    const after = await correctOrder(p, id, { action: 'dispatched', reason: REASON, itemIds: [bar], expectedStages: stagesOf(view) }, req);
    expect(lineOf(after, bar).stage).toBe(STAGE.SHIPPED);
    expect(lineOf(after, lamp).stage).toBe(STAGE.WITH_SUPPLIER);
    const fresh = await Order.findById(id).lean();
    expect(Date.now() - fresh.shipments[0].shippedAt.getTime()).toBeLessThan(60_000);
  });

  it('works from New Order, In Stock and Our Warehouse too', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [bar, lamp] = ids(order);
    await wf.setStock(p, id, lamp, { stock: 'own_stock' }, req);
    const view = await wf.getOrder(p, id);
    expect(stagesOf(view)).toEqual({ [bar]: STAGE.STOCK_CHECK, [lamp]: STAGE.OWN_STOCK });
    const after = await correctOrder(p, id, { action: 'dispatched', reason: REASON, itemIds: [bar, lamp], expectedStages: stagesOf(view) }, req);
    expect(after.lines.map((l) => l.stage)).toEqual([STAGE.SHIPPED, STAGE.SHIPPED]);
  });
});

describe('delivered', () => {
  it('moves items straight to Delivered on the date given: no emails, no review request, points as usual', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    enqueued.length = 0;

    const after = await correctOrder(p, id, {
      action: 'delivered', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view),
      shippedOn: istDay(45), deliveredOn: istDay(40),
    }, req);

    expect(after.lines.map((l) => l.stage)).toEqual([STAGE.DELIVERED, STAGE.DELIVERED]);
    const fresh = await Order.findById(id).lean();
    expect(fresh.status).toBe('delivered');
    expect(fresh.shipments[0].status).toBe('delivered');
    expect(fresh.shipments[0].shippedAt.toISOString().slice(0, 10)).toBe(istDay(45));
    expect(fresh.shipments[0].deliveredAt.toISOString().slice(0, 10)).toBe(istDay(40));
    // The return window and the order's own date run from when it really arrived.
    expect(fresh.deliveredAt.toISOString().slice(0, 10)).toBe(istDay(40));
    expect(fresh.fulfillmentMetrics.deliveredAt.toISOString().slice(0, 10)).toBe(istDay(40));

    expect(jobs()).toContain('post-order-delivered'); // loyalty points, as for any delivery
    expect(jobs()).not.toEqual(expect.arrayContaining(['send-review-request']));
    expect(jobs()).not.toEqual(expect.arrayContaining(['send-shipment-email']));
    expect(jobs()).not.toEqual(expect.arrayContaining(['send-order-status-email']));
    expect(after.needs).toEqual([]);
    expect(lastHistory(after).note).toMatch(/^Marked dispatched: Bull bar, Fog lamp · on .+ · Parcel 1 marked delivered on .+ — Reason:/);
  });

  it('delivers a parcel already in transit, and refuses a delivery date before its dispatch', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    let v = await correctOrder(p, id, { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view), shippedOn: istDay(30) }, req);
    expect(v.corrections.inTransit).toEqual([v.parcels[0].id]);

    await expect(correctOrder(p, id, {
      action: 'delivered', reason: REASON, shipmentIds: [v.parcels[0].id], expectedParcels: parcelsOf(v), deliveredOn: istDay(35),
    }, req)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/dispatched after that delivery date/) });

    v = await correctOrder(p, id, {
      action: 'delivered', reason: REASON, shipmentIds: [v.parcels[0].id], expectedParcels: parcelsOf(v), deliveredOn: istDay(28),
    }, req);
    expect(v.parcels[0].status).toBe('delivered');
    expect((await Order.findById(id).lean()).status).toBe('delivered');
  });

  it('the free gift owed goes in the parcel unless procurement says it did not', async () => {
    const p = await staff('procurement');
    const gift = { spinReward: { result: new mongoose.Types.ObjectId(), prize: new mongoose.Types.ObjectId(), name: 'Cloth', sku: 'C1', kind: 'goodie', wonAt: new Date(), fulfilledAt: null, voidedAt: null } };
    const a = await paidOrder({ extra: gift });
    let v = await wf.getOrder(p, String(a._id));
    await correctOrder(p, String(a._id), { action: 'delivered', reason: REASON, itemIds: ids(a), expectedStages: stagesOf(v) }, req);
    expect((await Order.findById(a._id).lean())).toMatchObject({ status: 'delivered', shipments: [expect.objectContaining({ includesReward: true })] });

    const b = await paidOrder({ extra: gift });
    v = await wf.getOrder(p, String(b._id));
    await correctOrder(p, String(b._id), { action: 'delivered', reason: REASON, itemIds: ids(b), expectedStages: stagesOf(v), includesGift: false }, req);
    // The goods arrived; the gift is still owed, so the order is not complete.
    expect((await Order.findById(b._id).lean())).toMatchObject({ status: 'shipped', shipments: [expect.objectContaining({ includesReward: false, status: 'delivered' })] });
  });
});

describe('fixing a parcel', () => {
  it('corrects courier, tracking and dates on a DELIVERED parcel, mirrored to the order', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    let v = await correctOrder(p, id, { action: 'delivered', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view), deliveredOn: istDay(20) }, req);
    const parcelId = v.parcels[0].id;
    expect(v.corrections.parcels).toEqual([parcelId]);

    v = await correctOrder(p, id, {
      action: 'parcel', reason: 'Wrong AWB typed earlier', shipmentIds: [parcelId], expectedParcels: parcelsOf(v),
      courierName: 'Blue Dart', trackingNumber: 'BD777', shippedOn: istDay(25), deliveredOn: istDay(22),
    }, req);
    expect(v.parcels[0]).toMatchObject({ courier: 'Blue Dart', trackingNumber: 'BD777', status: 'delivered' });
    const fresh = await Order.findById(id).lean();
    expect(fresh).toMatchObject({ trackingNumber: 'BD777', carrier: { name: 'Blue Dart' } });
    expect(fresh.shipments[0].deliveredAt.toISOString().slice(0, 10)).toBe(istDay(22));
    expect(fresh.deliveredAt.toISOString().slice(0, 10)).toBe(istDay(22));
    expect(lastHistory(v).note).toMatch(/^Parcel 1: courier Blue Dart, tracking BD777, dispatched .+, delivered .+ — Reason: Wrong AWB typed earlier$/);
    // A dispatch date after the parcel arrived is refused.
    await expect(correctOrder(p, id, { action: 'parcel', reason: REASON, shipmentIds: [parcelId], expectedParcels: parcelsOf(v), shippedOn: istDay(21) }, req))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/before the dispatch date/) });
  });

  it('refuses a change that changes nothing; a parcel in transit takes a new dispatch date', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    const v = await correctOrder(p, id, { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view), courierName: 'DTDC', shippedOn: istDay(10) }, req);
    const base = { action: 'parcel', reason: REASON, shipmentIds: [v.parcels[0].id], expectedParcels: parcelsOf(v) };
    await expect(correctOrder(p, id, { ...base, courierName: 'DTDC' }, req)).rejects.toMatchObject({ statusCode: 400, message: 'Nothing was changed.' });
    // A parcel in transit has no delivery date to set; an earlier dispatch date is fine.
    const ok = await correctOrder(p, id, { ...base, shippedOn: istDay(12) }, req);
    expect(new Date(ok.parcels[0].shippedAt).toISOString().slice(0, 10)).toBe(istDay(12));
  });
});

describe('going back', () => {
  it('In Stock / Our Warehouse / Ordered From Supplier → New Order', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [bar, lamp] = ids(order);
    await wf.setStock(p, id, bar, { stock: 'in_stock' }, req);
    await wf.setStock(p, id, lamp, { stock: 'ordered', supplierName: 'ARB' }, req);
    const view = await wf.getOrder(p, id);
    expect(view.corrections.back).toEqual([bar, lamp]);
    const after = await correctOrder(p, id, { action: 'back_to_new', reason: REASON, itemIds: [bar, lamp], expectedStages: stagesOf(view) }, req);
    expect(after.lines.map((l) => [l.stage, l.supplierName])).toEqual([[STAGE.STOCK_CHECK, ''], [STAGE.STOCK_CHECK, '']]);
    expect(lastHistory(after).note).toBe(`Bull bar: In Stock → New Order · Fog lamp: Ordered From Supplier → New Order — Reason: ${REASON}`);
  });

  it('never when a supplier payment for the item is open or paid (it would be paid twice)', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    const [bar, lamp] = ids(order);
    const pr = (status, itemId, number) => PaymentRequest.create({
      number, kind: 'supplier', status, team: 'procurement', requestedBy: p._id, requestedByName: p.name,
      amount: 1000, category: 'purchase', payee: { name: 'ARB', method: 'upi', upiId: 'arb@okaxis' },
      order: order._id, itemIds: [itemId], description: 'x',
    });
    await pr('paid', bar, 'PR-0001');
    await pr('cancelled', lamp, 'PR-0002');
    await expect(correctOrder(p, id, { action: 'back_to_new', reason: REASON, itemIds: [bar], expectedStages: stagesOf(view) }, req))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/PR-0001 \(paid\)/) });
    // A cancelled request never moved money: that item may go back.
    const after = await correctOrder(p, id, { action: 'back_to_new', reason: REASON, itemIds: [lamp], expectedStages: stagesOf(view) }, req);
    expect(lineOf(after, lamp).stage).toBe(STAGE.STOCK_CHECK);
    expect(lineOf(after, bar).stage).toBe(STAGE.WITH_SUPPLIER);
  });

  it('Delivered → Dispatched', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    let v = await correctOrder(p, id, { action: 'delivered', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view) }, req);
    expect(v.corrections.delivered).toEqual([v.parcels[0].id]);
    v = await correctOrder(p, id, { action: 'undeliver', reason: 'Marked delivered by mistake', shipmentIds: [v.parcels[0].id], expectedParcels: parcelsOf(v) }, req);
    expect(v.parcels[0].status).toBe('shipped');
    expect((await Order.findById(id).lean()).status).toBe('shipped');
  });
});

describe('compare-and-set', () => {
  it('refuses a stale view and writes nothing', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    const stale = { ...stagesOf(view), [ids(order)[0]]: STAGE.TO_SHIP };
    await expect(correctOrder(p, id, { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stale }, req))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/changed by someone else/) });
    expect((await Order.findById(id).lean()).shipments).toHaveLength(0);
    expect(await auditRows(id)).toEqual([]);
  });

  it('two people correcting at once make ONE parcel', async () => {
    const p1 = await staff('procurement');
    const p2 = await staff('procurement');
    const { order, id, view } = await orderedOrder(p1);
    const body = { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view) };
    const results = await Promise.allSettled([correctOrder(p1, id, body, req), correctOrder(p2, id, body, req)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.statusCode).toBe(409);
    expect((await Order.findById(id).lean()).shipments).toHaveLength(1);
  });

  it('a replay of the same correction is refused, not applied twice', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    const body = { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view) };
    await correctOrder(p, id, body, req);
    await expect(correctOrder(p, id, body, req)).rejects.toMatchObject({ statusCode: 409 });
    expect((await Order.findById(id).lean()).shipments).toHaveLength(1);
  });
});

describe('who, why, and never money', () => {
  it('procurement and the admin only; everyone else is refused and sees no "Edit order"', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    const body = { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view) };
    for (const team of ['sales', 'accounts', 'operations']) {
      const u = await staff(team, { isHead: true });
      await expect(correctOrder(u, id, body, req)).rejects.toMatchObject({ statusCode: 403 });
      expect((await wf.getOrder(u, id)).corrections).toBeNull();
    }
    const a = await admin();
    expect((await wf.getOrder(a, id)).corrections).not.toBeNull();
    await correctOrder(a, id, body, req);
    expect((await Order.findById(id).lean()).shipments).toHaveLength(1);
  });

  it('a reason is required', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    for (const reason of [undefined, '', '   ', 'abc']) {
      await expect(correctOrder(p, id, { action: 'dispatched', reason, itemIds: ids(order), expectedStages: stagesOf(view) }, req))
        .rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('refuses dates in the future or before the order', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p, { daysAgo: 10 });
    const body = { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view) };
    await expect(correctOrder(p, id, { ...body, shippedOn: istDay(-1) }, req)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/future/) });
    await expect(correctOrder(p, id, { ...body, shippedOn: istDay(11) }, req)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/before the order/) });
    await expect(correctOrder(p, id, { ...body, shippedOn: '2026-02-30' }, req)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('never touches a line with a supplier payment in flight, out of stock, or in the refund flow', async () => {
    const p = await staff('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [bar, lamp] = ids(order);
    await wf.markPaymentPending(p, id, bar, { supplierName: 'ARB', ref: 'PR-0009' }, req);
    await wf.setStock(p, id, lamp, { stock: 'out_of_stock' }, req);
    const view = await wf.getOrder(p, id);
    expect(stagesOf(view)).toEqual({ [bar]: STAGE.PAYMENT_PENDING, [lamp]: STAGE.CUSTOMER_DECISION });
    expect(view.corrections).toBeNull();
    for (const action of ['dispatched', 'delivered', 'back_to_new']) {
      for (const itemId of [bar, lamp]) {
        await expect(correctOrder(p, id, { action, reason: REASON, itemIds: [itemId], expectedStages: stagesOf(view) }, req))
          .rejects.toMatchObject({ statusCode: 409 });
      }
    }
    const fresh = await Order.findById(id).lean();
    expect(fresh.shipments).toHaveLength(0);
    expect(fresh.paymentStatus).toBe('paid');
  });

  it('refuses an open supplier payment request even before it reached the line', async () => {
    const p = await staff('procurement');
    const { order, id, view } = await orderedOrder(p);
    await PaymentRequest.create({
      number: 'PR-0042', kind: 'supplier', status: 'submitted', team: 'procurement', requestedBy: p._id, requestedByName: p.name,
      amount: 1000, category: 'purchase', payee: { name: 'ARB', method: 'upi', upiId: 'arb@okaxis' },
      order: order._id, itemIds: [ids(order)[0]], description: 'x',
    });
    await expect(correctOrder(p, id, { action: 'dispatched', reason: REASON, itemIds: ids(order), expectedStages: stagesOf(view) }, req))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/PR-0042/) });
    expect((await Order.findById(id).lean()).shipments).toHaveLength(0);
  });

  it('leaves a cancelled order alone', async () => {
    const p = await staff('procurement');
    const { id, view } = await orderedOrder(p);
    await Order.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    expect((await wf.getOrder(p, id)).corrections).toBeNull();
    await expect(correctOrder(p, id, { action: 'dispatched', reason: REASON, itemIds: Object.keys(stagesOf(view)), expectedStages: stagesOf(view) }, req))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/cancelled/) });
  });

  it('the normal flow is unchanged: a proof upload still emails the customer', async () => {
    const p = await staff('procurement');
    const { id } = await orderedOrder(p);
    enqueued.length = 0;
    await wf.shipWithProof(p, id, {}, { buffer: JPEG, mimetype: 'image/jpeg' }, req);
    expect(jobs()).toEqual(expect.arrayContaining(['send-shipment-email', 'send-team-shipped-alert']));
  });
});

describe('correctionDate', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  it('records noon in India, never before the order or after now', () => {
    expect(correctionDate('2026-10-01', { now }).toISOString()).toBe('2026-10-01T06:30:00.000Z');
    expect(correctionDate('2026-10-28', { now, notBefore: new Date('2026-10-28T08:00:00Z') }).toISOString()).toBe('2026-10-28T08:01:00.000Z');
    expect(correctionDate('2026-10-28', { now: new Date('2026-10-28T04:00:00Z') }).toISOString()).toBe('2026-10-28T04:00:00.000Z');
    expect(correctionDate('', { now })).toBeNull();
    expect(() => correctionDate('2026-10-29', { now })).toThrow(/future/);
  });
});
