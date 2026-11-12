/**
 * Staff order lists when `Order.listDate` is NOT there yet.
 *
 * PR #413 moved every staff list onto `listDate`, but orders written before that
 * field existed have none until `scripts/backfill-order-list-date.js` has run.
 * In production that took all four staff lists down with
 * `RangeError: Invalid time value` out of encodeCursor — `new Date(undefined)
 * .toISOString()` — so the lists 500'd rather than simply sorting oddly.
 *
 * These cover the safety net: no list may crash on an undated order, and paging
 * over a mix of dated and undated orders must still lose nothing and repeat
 * nothing. Mongo and the order status machine are real; the queue and storage
 * are doubles.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ folder, basename, buffer }) => ({ publicId: `${folder}/${basename}`, provider: 'r2', bytes: buffer.length, url: '' }),
  deletePrivateAsset: async () => true,
  readPrivateAsset: async () => Buffer.alloc(0),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const { listSalesOrders, listPaidSalesOrders, ORDER_LIST_SORTS } = await import('../services/salesOrderService.js');
const { listWebsiteOrders } = await import('../services/orderAttributionService.js');
const { getAllOrdersAdmin } = await import('../controllers/orderController.js');
const { encodeCursor, decodeCursor, afterClause } = await import('../utils/listQuery.js');
const { listDateOf } = await import('../utils/orderListDate.js');

const DAY = 24 * 60 * 60 * 1000;
const oid = () => new mongoose.Types.ObjectId();
let n = 0;
async function staff(team, { isHead = false } = {}) {
  n += 1;
  return User.create({
    name: `${team} ${n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
}
async function admin() {
  n += 1;
  return User.create({ name: `Admin ${n}`, email: `admin${n}@autobacs.test`, phone: '9000000002', passwordHash: 'x', role: 'admin' });
}

async function unpaidOrder({ salesUser = null, daysAgo = 0, total = 7000 } = {}) {
  const o = await Order.create({
    user: oid(), source: salesUser ? 'offline' : 'web', salesUser,
    items: [{ product: oid(), name: 'Seat cover', price: total, quantity: 1 }],
    shippingAddress: { fullName: 'Buyer', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: total, totalAmount: total, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  if (daysAgo) {
    const at = new Date(Date.now() - daysAgo * DAY);
    await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: at, listDate: at } });
  }
  return o._id;
}
async function pay(id) {
  const res = await orderStatusService.updateOrderStatus(String(id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(`could not pay test order: ${res?.message}`);
  return id;
}
async function paidOrder(opts = {}) {
  return pay(await unpaidOrder(opts));
}

/** An order as it was before PR #413: the field the lists sort on is simply not there. */
const undate = (id) => Order.collection.updateOne({ _id: id }, { $unset: { listDate: '' } });
/** ...and one that never had a paid date either, so only createdAt is left. */
const undateFully = (id) => Order.collection.updateOne({ _id: id }, { $unset: { listDate: '', paidAt: '' } });

const idsOf = (page) => page.orders.map((o) => String(o.id));
const s = (id) => String(id);
const adminRun = async (user, query = {}) => {
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  await getAllOrdersAdmin({ query, user }, res);
  return res.body;
};

describe('listDateOf: the fallback every list read goes through', () => {
  it('prefers listDate, then paidAt, then createdAt', () => {
    const a = new Date('2026-11-01T00:00:00Z');
    const b = new Date('2026-10-01T00:00:00Z');
    const c = new Date('2026-09-01T00:00:00Z');
    expect(listDateOf({ listDate: a, paidAt: b, createdAt: c })).toEqual(a);
    expect(listDateOf({ paidAt: b, createdAt: c })).toEqual(b);
    expect(listDateOf({ createdAt: c })).toEqual(c);
  });

  it('is null — never a throw — when there is no usable date at all', () => {
    expect(listDateOf({})).toBeNull();
    expect(listDateOf(null)).toBeNull();
    expect(listDateOf({ listDate: 'not a date', paidAt: null })).toBeNull();
  });
});

describe('encodeCursor never throws on a row with no listDate', () => {
  const sort = ORDER_LIST_SORTS.newest;

  it('a row missing the sort field gets a cursor for the undated class, not a RangeError', () => {
    const _id = oid();
    let cursor;
    expect(() => { cursor = encodeCursor('newest', sort, { _id, createdAt: new Date() }); }).not.toThrow();
    expect(cursor).toEqual(expect.any(String));
    expect(decodeCursor('newest', sort, cursor)).toEqual({ value: null, id: expect.anything() });
  });

  it('an unparseable listDate is treated the same way rather than crashing', () => {
    expect(() => encodeCursor('newest', sort, { _id: oid(), listDate: 'rubbish' })).not.toThrow();
  });

  it('the page after an undated row is the rest of the undated rows, by _id', () => {
    const id = oid();
    expect(afterClause(sort, { value: null, id })).toEqual({ listDate: null, _id: { $lt: id } });
  });

  // The page after a DATED row keeps exactly the clause it always had. It must not
  // grow an $or that also admits the undated rows: that is the shape afterClause's
  // own note measured at 16,000 rows read and a sort in memory, and the index-plan
  // tests (tests/teamListIndexes.test.js) fail on it. The undated rows are reached
  // because they are the tail of the very same page, not by widening the query.
  it('the page after a dated row keeps its single-index-scan clause', () => {
    const value = new Date('2026-11-01T00:00:00Z');
    const clause = afterClause(sort, { value, id: oid() });
    expect(clause.$or).toBeUndefined();
    expect(clause.listDate).toEqual({ $lte: value });
  });

  it('a sort with no fallback is untouched', () => {
    const clause = afterClause(ORDER_LIST_SORTS.amount_desc, { value: 100, id: oid() });
    expect(clause.$or).toBeUndefined();
    expect(clause.totalAmount).toEqual({ $lte: 100 });
  });
});

describe('no staff list crashes when nothing has been backfilled', () => {
  it('the GTM, paid, work-queue, Marketing and Admin lists all load', async () => {
    const seller = await staff('sales', { isHead: true });
    const acc = await staff('accounts');
    const proc = await staff('procurement');
    const mk = await staff('marketing');
    const a = await admin();
    const sales = await paidOrder({ salesUser: seller._id });
    const web = await paidOrder();
    const open = await unpaidOrder({ salesUser: seller._id });
    await Promise.all([undateFully(sales), undateFully(web), undateFully(open)]);

    expect(idsOf(await listSalesOrders(seller, {}))).toEqual(expect.arrayContaining([s(sales), s(open)]));
    expect(idsOf(await listPaidSalesOrders(acc, {}))).toEqual(expect.arrayContaining([s(sales), s(web)]));
    expect((await wf.listQueue(proc, 'procurement', {})).orders.length).toBeGreaterThan(0);
    expect(idsOf(await listWebsiteOrders(mk, {}))).toEqual([s(web)]);
    expect((await adminRun(a)).orders.length).toBe(3);
  });

  // A date filter compares the stored listDate only, on purpose: widening it to the
  // fallback would need an $or, and that costs an in-memory sort of every matching
  // row (utils/listQuery.js afterClause, tests/teamListIndexes.test.js). So an
  // undated order is missing from a DATE-FILTERED list until the backfill has run —
  // the unfiltered list, which is the one that was 500ing, still shows it.
  it('a date filter sees an undated order once it is backfilled, and the plain list sees it either way', async () => {
    const a = await admin();
    const id = await paidOrder({ daysAgo: 4 });
    await undateFully(id);
    const day = new Date(Date.now() - 4 * DAY).toISOString().slice(0, 10);
    expect((await adminRun(a, { startDate: day, endDate: day })).orders).toEqual([]);
    expect((await adminRun(a)).orders.map((o) => s(o._id))).toEqual([s(id)]);
    // What the backfill writes, applied here: the order comes back into the filter.
    await Order.collection.updateOne({ _id: id }, [{ $set: { listDate: '$createdAt' } }]);
    expect((await adminRun(a, { startDate: day, endDate: day })).orders.map((o) => s(o._id))).toEqual([s(id)]);
  });
});

describe('paging over a mix of dated and undated orders loses nothing', () => {
  // 15 orders keep their listDate and 15 have it removed. MongoDB sorts the
  // undated ones with null — below every real date — so they are the tail of a
  // newest-first list and the head of an oldest-first one. Either way both pages
  // together must be all 30, each exactly once.
  it.each(['newest', 'oldest'])('%s: page 1 + page 2 = 30 orders, no repeats', async (sort) => {
    const acc = await staff('accounts');
    const all = [];
    for (let i = 0; i < 30; i += 1) all.push(await paidOrder());
    await Promise.all(all.map((id, i) => {
      const at = new Date(Date.UTC(2026, 10, 1 + i));
      return i % 2 === 0
        ? Order.collection.updateOne({ _id: id }, { $set: { paidAt: at, listDate: at } })
        : Order.collection.updateOne({ _id: id }, { $set: { paidAt: at }, $unset: { listDate: '' } });
    }));

    const p1 = await listPaidSalesOrders(acc, { sort });
    expect(p1.orders).toHaveLength(25);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = await listPaidSalesOrders(acc, { sort, cursor: p1.nextCursor });
    const seen = [...idsOf(p1), ...idsOf(p2)];
    expect(new Set(seen).size).toBe(30);
    expect(seen.sort()).toEqual(all.map(s).sort());
  });

  it('the work queue pages through undated orders without repeating one', async () => {
    const proc = await staff('procurement');
    const all = [];
    for (let i = 0; i < 30; i += 1) all.push(await paidOrder());
    await Promise.all(all.map((id, i) => (i % 2 === 0 ? undate(id) : Promise.resolve())));
    const p1 = await wf.listQueue(proc, 'procurement', {});
    expect(p1.orders).toHaveLength(25);
    const p2 = await wf.listQueue(proc, 'procurement', { cursor: p1.nextCursor });
    const seen = [...idsOf(p1), ...idsOf(p2)];
    expect(new Set(seen).size).toBe(30);
  });

  it('Marketing pages through undated website orders without repeating one', async () => {
    const mk = await staff('marketing');
    const all = [];
    for (let i = 0; i < 30; i += 1) all.push(await paidOrder());
    await Promise.all(all.map((id, i) => (i % 2 === 0 ? undate(id) : Promise.resolve())));
    const p1 = await listWebsiteOrders(mk, {});
    expect(p1.orders).toHaveLength(25);
    const p2 = await listWebsiteOrders(mk, { cursor: p1.nextCursor });
    const seen = [...idsOf(p1), ...idsOf(p2)];
    expect(new Set(seen).size).toBe(30);
  });
});
