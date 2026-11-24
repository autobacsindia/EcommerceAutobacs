/**
 * Reason for overdue on a parcel in transit (teamWorkflowService.setParcelOverdueReason),
 * through the real workflow / shipment services against an in-memory Mongo.
 *
 * What must hold:
 *   - procurement, operations and the admin give it; sales, accounts and inactive staff cannot
 *   - a reason must be picked; "Other" needs a note; an over-long note is refused
 *   - only while the parcel is overdue (not upcoming, not delivered); a stale date is refused
 *   - every save is kept (what, who, when, for which date), newest first, bounded
 *   - a new date makes the reason history (a fresh one is needed if overdue again)
 *   - the list row counts overdue parcels with no reason, carries the first reason,
 *     and the "Overdue — no reason" filter finds exactly those
 *   - procurement may read the deliveries list (where overdue parcels are)
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  getMediaQueue: () => mockQueue,
  variantJobId: () => 'x',
  enqueueVariantGeneration: () => Promise.resolve(),
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


const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');

const { istDay, addDays, etaSummary, MAX_OVERDUE_REASON_HISTORY } = await import('../utils/parcelEta.js');
const { readListFilters, rowMatches } = await import('../utils/orderListFilters.js');


const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

let n = 0;
const person = (team, { isHead = false, active = true } = {}) => User.create({
  name: `${team} ${++n}`, email: `od-${team}${n}@autobacs.test`, phone: '9000000001',
  passwordHash: 'x', role: 'staff', staff: { team, isHead, active },
});
const admin = () => User.create({ name: `Admin ${++n}`, email: `od-admin${n}@autobacs.test`, passwordHash: 'x', role: 'admin' });

async function paidOrder() {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 6000, totalAmount: 6000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

/** A paid order dispatched from our warehouse: one parcel per item when `parcels` is 2. */
async function shippedOrder({ parcels = 1 } = {}) {
  const p = await person('procurement');
  const order = await paidOrder();
  const id = String(order._id);
  const [cover, mat] = order.items.map((i) => String(i._id));
  for (const i of [cover, mat]) await wf.setStock(p, id, i, { stock: 'own_stock' }, req);
  if (parcels === 1) {
    await wf.dispatchOwnStock(p, id, { courierName: 'Delhivery', trackingNumber: 'DL555' }, null, req);
  } else {
    await wf.dispatchOwnStock(p, id, { courierName: 'Delhivery', trackingNumber: 'DL555', itemIds: [cover] }, null, req);
    await wf.dispatchOwnStock(p, id, { courierName: 'Blue Dart', trackingNumber: 'BD9', itemIds: [mat] }, null, req);
  }
  const fresh = await Order.findById(id).lean();
  return { id, parcelIds: fresh.shipments.map((s) => String(s._id)) };
}

const setEta = (actor, id, sid, date, previousDate) => wf.setParcelEta(actor, id, sid, { date, previousDate }, req);
const today = () => istDay();

/** A shipped order whose parcel's expected date passed `daysAgo` days ago (the API refuses past dates, so set it, then age it). */
async function overdueOrder({ daysAgo = 2, parcels = 1 } = {}) {
  const o = await shippedOrder({ parcels });
  const ops = await person('operations');
  for (const sid of o.parcelIds) await setEta(ops, o.id, sid, addDays(today(), 1));
  const day = addDays(today(), -daysAgo);
  await Order.updateOne({ _id: o.id }, { $set: { 'shipments.$[].eta.day': day } });
  return { ...o, day };
}
const explain = (actor, id, sid, body) => wf.setParcelOverdueReason(actor, id, sid, body, req);

describe('who may give the reason', () => {
  it('procurement and the admin can; the parcel shows it', async () => {
    const { id, parcelIds: [sid], day } = await overdueOrder();
    const p = await person('procurement');
    const v = await explain(p, id, sid, { code: 'courier_delay', note: '  stuck at the Bengaluru hub ', expectedDate: day });
    expect(v.parcels[0]).toMatchObject({
      etaState: 'overdue', canExplainOverdue: true,
      overdueReason: { code: 'courier_delay', label: 'Courier delay', note: 'stuck at the Bengaluru hub', text: 'Courier delay — stuck at the Bengaluru hub', by: p.name },
    });
    const a = await admin();
    expect((await explain(a, id, sid, { code: 'supplier_delay' })).parcels[0].overdueReason).toMatchObject({ code: 'supplier_delay', note: '', by: a.name });
  });

  it('operations (who own the parcel) can, from their own view', async () => {
    const { id, parcelIds: [sid] } = await overdueOrder();
    const ops = await person('operations');
    expect((await wf.getOrder(ops, id)).parcels[0]).toMatchObject({ etaState: 'overdue', overdueReason: null, canExplainOverdue: true });
    const v = await explain(ops, id, sid, { code: 'courier_delay', note: 'DTDC hub delay' });
    expect(v.parcels[0].overdueReason).toMatchObject({ text: 'Courier delay — DTDC hub delay', by: ops.name });
  });

  it('sales, accounts and inactive staff cannot', async () => {
    const { id, parcelIds: [sid] } = await overdueOrder();
    for (const actor of [await person('sales', { isHead: true }), await person('accounts'), await person('procurement', { active: false }), await person('operations', { active: false })]) {
      await expect(explain(actor, id, sid, { code: 'courier_delay' })).rejects.toMatchObject({ statusCode: 403 });
    }
    expect((await Order.findById(id).lean()).shipments[0].overdueReason?.code).toBeUndefined();
    // Accounts sees the badge and the (empty) reason, but no button.
    const accountsView = await wf.getOrder(await person('accounts'), id);
    expect(accountsView.parcels[0]).toMatchObject({ etaState: 'overdue', overdueReason: null, canExplainOverdue: false });
  });
});

describe('the reason must say something', () => {
  it('no pick, an unknown pick, "Other" without a note and a long note are refused', async () => {
    const p = await person('procurement');
    const { id, parcelIds: [sid] } = await overdueOrder();
    await expect(explain(p, id, sid, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(explain(p, id, sid, { code: '' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(explain(p, id, sid, { code: 'aliens' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(explain(p, id, sid, { code: 'other', note: '   ' })).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Say what/) });
    await expect(explain(p, id, sid, { code: 'courier_delay', note: 'x'.repeat(301) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(explain(p, id, sid, { code: '__proto__' })).rejects.toMatchObject({ statusCode: 400 });
    const fresh = (await Order.findById(id).lean()).shipments[0];
    expect(fresh.overdueReason?.code).toBeUndefined();
    expect(fresh.overdueReasonHistory).toEqual([]);
    expect((await explain(p, id, sid, { code: 'other', note: 'Customer asked to hold it' })).parcels[0].overdueReason.text).toBe('Other — Customer asked to hold it');
  });
});

describe('only while overdue', () => {
  it('an upcoming, due-today or delivered parcel cannot be explained; a stale date is refused', async () => {
    const p = await person('procurement');
    const ops = await person('operations');
    const up = await shippedOrder();
    await setEta(ops, up.id, up.parcelIds[0], addDays(today(), 2));
    await expect(explain(p, up.id, up.parcelIds[0], { code: 'courier_delay' })).rejects.toMatchObject({ statusCode: 409 });
    await setEta(ops, up.id, up.parcelIds[0], today());
    await expect(explain(p, up.id, up.parcelIds[0], { code: 'courier_delay' })).rejects.toMatchObject({ statusCode: 409 });

    const late = await overdueOrder();
    await expect(explain(p, late.id, late.parcelIds[0], { code: 'courier_delay', expectedDate: addDays(late.day, -1) }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Refresh/) });
    await wf.markDelivered(ops, late.id, { shipmentId: late.parcelIds[0] }, req);
    await expect(explain(p, late.id, late.parcelIds[0], { code: 'courier_delay' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('a missing order / parcel is a 404', async () => {
    const p = await person('procurement');
    const { id } = await overdueOrder();
    await expect(explain(p, id, String(new mongoose.Types.ObjectId()), { code: 'courier_delay' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(explain(p, String(new mongoose.Types.ObjectId()), String(new mongoose.Types.ObjectId()), { code: 'courier_delay' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('history', () => {
  it('every save is kept newest first with who, when and the date it explained; bounded', async () => {
    const p = await person('procurement');
    const a = await admin();
    const { id, parcelIds: [sid], day } = await overdueOrder();
    await explain(p, id, sid, { code: 'supplier_delay', note: 'factory shut' });
    const v = await explain(a, id, sid, { code: 'courier_delay', note: 'handed over late' });
    expect(v.parcels[0].overdueReasonHistory).toEqual([
      { code: 'courier_delay', label: 'Courier delay', note: 'handed over late', forDate: day, by: a.name, at: expect.any(Date), attachment: null },
      { code: 'supplier_delay', label: 'Supplier delay', note: 'factory shut', forDate: day, by: p.name, at: expect.any(Date), attachment: null },
    ]);
    expect(v.history.some((h) => h.action === 'Reason for overdue given' && /Parcel 1: Courier delay/.test(h.note || ''))).toBe(true);

    for (let i = 0; i < MAX_OVERDUE_REASON_HISTORY + 3; i += 1) await explain(p, id, sid, { code: 'other', note: `try ${i}` });
    const kept = (await Order.findById(id).lean()).shipments[0].overdueReasonHistory;
    expect(kept).toHaveLength(MAX_OVERDUE_REASON_HISTORY);
    expect(kept.at(-1).note).toBe(`try ${MAX_OVERDUE_REASON_HISTORY + 2}`);
  });

  it('a new date makes the reason history; overdue again needs a fresh one', async () => {
    const p = await person('procurement');
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await overdueOrder();
    await explain(p, id, sid, { code: 'courier_delay' });
    const moved = await setEta(ops, id, sid, addDays(today(), 3));
    expect(moved.parcels[0]).toMatchObject({ etaState: 'upcoming', overdueReason: null, canExplainOverdue: false });
    expect(moved.parcels[0].overdueReasonHistory).toHaveLength(1);

    await Order.updateOne({ _id: id }, { $set: { 'shipments.0.eta.day': addDays(today(), -1) } });
    const again = await wf.getOrder(p, id);
    expect(again.parcels[0]).toMatchObject({ etaState: 'overdue', overdueReason: null, canExplainOverdue: true });
  });
});

describe('the deliveries list', () => {
  it('counts overdue parcels with no reason, carries the first reason, and filters on it', async () => {
    const p = await person('procurement');
    const a = await overdueOrder({ parcels: 2 });
    const b = await overdueOrder();
    await explain(p, a.id, a.parcelIds[0], { code: 'address_issue', note: 'wrong pin code' });

    const { orders } = await wf.listQueue(p, 'deliveries', {});
    const rowOf = (id) => orders.find((o) => o.id === id);
    expect(rowOf(a.id).eta).toMatchObject({ overdue: 2, noReason: 1, reason: { text: 'Address issue — wrong pin code', by: p.name } });
    expect(rowOf(b.id).eta).toMatchObject({ overdue: 1, noReason: 1, reason: null });

    const ids = async (eta) => (await wf.listQueue(p, 'deliveries', { eta })).orders.map((o) => o.id);
    expect(await ids('overdue_no_reason')).toEqual(expect.arrayContaining([a.id, b.id]));
    await explain(p, a.id, a.parcelIds[1], { code: 'courier_delay' });
    await explain(p, b.id, b.parcelIds[0], { code: 'courier_delay' });
    const left = await ids('overdue_no_reason');
    expect(left).not.toContain(a.id);
    expect(left).not.toContain(b.id);
    expect(await ids('overdue')).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('sales and accounts still cannot open it', async () => {
    for (const actor of [await person('sales', { isHead: true }), await person('accounts')]) {
      await expect(wf.listQueue(actor, 'deliveries', {})).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('a stale reason (from an older date) does not count as a reason', () => {
    const s = etaSummary([{ status: 'shipped', eta: { day: '2026-10-25' }, overdueReason: { code: 'courier_delay', forDay: '2026-10-20' } }], '2026-10-28');
    expect(s).toMatchObject({ overdue: 1, noReason: 1, reason: null });
  });
});
