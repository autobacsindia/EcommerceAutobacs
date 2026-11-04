/**
 * Staff order lists sort on the PAID date (utils/orderListDate.js), and personal
 * pins keep chosen orders on top (services/orderPinService.js).
 *
 * The owner's report: an offline order created earlier and paid on 3 Nov sat low
 * in the list, under orders created later. These pin that down on every list —
 * GTM (sales), Accounts / Procurement (paid list), the work queues, Marketing
 * (website orders) and Admin — plus paging, pins and the backfill rules.
 * Mongo and the order status machine are real; the queue and storage are doubles.
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
const { default: OrderPin } = await import('../models/OrderPin.js');
const { default: User } = await import('../models/User.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { default: orderRepository } = await import('../repositories/orderRepository.js');
const wf = await import('../services/teamWorkflowService.js');
const { listSalesOrders, listPaidSalesOrders } = await import('../services/salesOrderService.js');
const { listWebsiteOrders } = await import('../services/orderAttributionService.js');
const pins = await import('../services/orderPinService.js');
const { getAllOrdersAdmin } = await import('../controllers/orderController.js');
const { endOfIstDay, paidAtFor, stampListDate } = await import('../utils/orderListDate.js');
const { derivePaidAt, planFor } = await import('../scripts/backfill-order-list-date.js');

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

// createdAt is immutable through Mongoose, so orders are moved in time with the driver,
// together with the listDate the save hook gave them when they were created.
const backdate = (id, at) => Order.collection.updateOne({ _id: id }, { $set: { createdAt: at, listDate: at } });

/** An unpaid order (a GTM order when `salesUser` is given), created `daysAgo` days ago. */
async function unpaidOrder({ salesUser = null, daysAgo = 0, total = 7000 } = {}) {
  const o = await Order.create({
    user: oid(), source: salesUser ? 'offline' : 'web', salesUser,
    items: [{ product: oid(), name: 'Seat cover', price: total, quantity: 1 }],
    shippingAddress: { fullName: 'Buyer', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: total, totalAmount: total, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  if (daysAgo) await backdate(o._id, new Date(Date.now() - daysAgo * DAY));
  return o._id;
}
/** Pays an order the way the webhook / accounts do: through the status machine. */
async function pay(id) {
  const res = await orderStatusService.updateOrderStatus(String(id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(`could not pay test order: ${res?.message}`);
  return Order.findById(id).lean();
}
async function paidOrder(opts = {}) {
  const id = await unpaidOrder(opts);
  await pay(id);
  return id;
}
const idsOf = (page) => page.orders.map((o) => String(o.id));
const s = (id) => String(id);

describe('the paid date and list date (utils/orderListDate.js)', () => {
  it('an unpaid order is listed under its created date and has no paid date', async () => {
    const id = await unpaidOrder();
    const o = await Order.findById(id).lean();
    expect(o.paidAt).toBeUndefined();
    expect(o.listDate.getTime()).toBe(o.createdAt.getTime());
  });

  it('paying an order created days ago lists it under the moment it was paid', async () => {
    const id = await unpaidOrder({ daysAgo: 6 });
    const before = Date.now();
    const o = await pay(id);
    expect(o.paidAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(o.listDate.getTime()).toBe(o.paidAt.getTime());
    expect(o.createdAt.getTime()).toBeLessThan(before - 5 * DAY); // created date untouched
  });

  it('a bank transfer is dated by the day the money arrived, not the day accounts confirmed it', async () => {
    const id = await unpaidOrder({ daysAgo: 6 });
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    const paidOn = new Date(Date.UTC(twoDaysAgo.getUTCFullYear(), twoDaysAgo.getUTCMonth(), twoDaysAgo.getUTCDate()));
    // What confirmBankTransfer writes, then the move to processing.
    await Order.collection.updateOne({ _id: id }, { $set: { offlinePayment: { method: 'bank_transfer', reference: 'UTR1', paidOn, amount: 7000, confirmedAt: new Date() } } });
    const o = await pay(id);
    expect(o.paidAt.getTime()).toBe(endOfIstDay(paidOn).getTime());
    expect(o.listDate.getTime()).toBe(o.paidAt.getTime());
  });

  it('bank transfer edge days: today keeps the confirmation moment; a future day never floats above now', () => {
    const now = new Date('2026-11-03T10:55:00.000Z'); // 4:25 pm India time, 3 Nov
    expect(paidAtFor({ offlinePayment: { paidOn: new Date('2026-11-03T00:00:00.000Z') } }, now)).toEqual(now);
    expect(paidAtFor({ offlinePayment: { paidOn: new Date('2026-11-04T00:00:00.000Z') } }, now)).toEqual(now);
    // 1 Nov → 11:59:59.999 pm India time on 1 Nov = 18:29:59.999 UTC.
    expect(paidAtFor({ offlinePayment: { paidOn: new Date('2026-11-01T00:00:00.000Z') } }, now))
      .toEqual(new Date('2026-11-01T18:29:59.999Z'));
    expect(paidAtFor({}, now)).toEqual(now);
  });

  it('a refund keeps the paid date; a later save never moves it', async () => {
    const id = await paidOrder();
    const first = await Order.findById(id);
    const paidAt = first.paidAt.getTime();
    first.paymentStatus = 'refunded';
    await first.save();
    const again = await Order.findById(id).lean();
    expect(again.paidAt.getTime()).toBe(paidAt);
    expect(again.listDate.getTime()).toBe(paidAt);
  });

  it('a NEW order saved already paid (an import) is dated by its own created date', () => {
    const createdAt = new Date('2025-03-01T05:00:00.000Z');
    const doc = { isNew: true, createdAt, paymentStatus: 'paid' };
    stampListDate(doc, new Date());
    expect(doc.paidAt).toEqual(createdAt);
    expect(doc.listDate).toEqual(createdAt);
  });

  it('stamping changes no money and no payment state', async () => {
    const id = await paidOrder({ total: 12345 });
    const o = await Order.findById(id).lean();
    expect(o).toMatchObject({ totalAmount: 12345, subtotal: 12345, paymentStatus: 'paid', status: 'processing' });
  });
});

describe('GTM: My orders sorts on the paid date', () => {
  it("the owner's case: an offline order created earlier and paid today is above a newer unpaid one", async () => {
    const seller = await staff('sales');
    const createdEarlierPaidToday = await unpaidOrder({ salesUser: seller._id, daysAgo: 6 });
    const newerUnpaid = await unpaidOrder({ salesUser: seller._id, daysAgo: 1 });
    await pay(createdEarlierPaidToday);
    expect(idsOf(await listSalesOrders(seller, {}))).toEqual([s(createdEarlierPaidToday), s(newerUnpaid)]);
    // Oldest first is the exact reverse.
    expect(idsOf(await listSalesOrders(seller, { sort: 'oldest' }))).toEqual([s(newerUnpaid), s(createdEarlierPaidToday)]);
  });

  it('unpaid orders still sort by their created date', async () => {
    const seller = await staff('sales');
    const a = await unpaidOrder({ salesUser: seller._id, daysAgo: 5 });
    const b = await unpaidOrder({ salesUser: seller._id, daysAgo: 3 });
    const c = await unpaidOrder({ salesUser: seller._id, daysAgo: 1 });
    expect(idsOf(await listSalesOrders(seller, {}))).toEqual([s(c), s(b), s(a)]);
  });

  it('rows carry the paid date for the panel to show; the created date is unchanged', async () => {
    const seller = await staff('sales');
    const id = await paidOrder({ salesUser: seller._id });
    const [row] = (await listSalesOrders(seller, {})).orders;
    expect(row.id).toBe(s(id));
    expect(row.paidAt).toBeTruthy();
    expect(row.createdAt).toBeTruthy();
  });
});

describe('Accounts / Procurement: the paid-order list sorts on the paid date', () => {
  it('created first but paid last → on top; the date filter reads the paid date', async () => {
    const acc = await staff('accounts');
    const seller = await staff('sales');
    const createdFirst = await unpaidOrder({ salesUser: seller._id, daysAgo: 9 });
    const website = await paidOrder({ daysAgo: 4 });
    await Order.collection.updateOne({ _id: website }, { $set: { paidAt: new Date(Date.now() - 4 * DAY), listDate: new Date(Date.now() - 4 * DAY) } });
    await pay(createdFirst);
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing' }))).toEqual([s(createdFirst), s(website)]);
    const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10); // India date
    expect(idsOf(await listPaidSalesOrders(acc, { from: today, to: today }))).toEqual([s(createdFirst)]);
  });

  it('the amount sorts are unchanged', async () => {
    const acc = await staff('accounts');
    const small = await paidOrder({ total: 1000 });
    const big = await paidOrder({ total: 9000 });
    expect(idsOf(await listPaidSalesOrders(acc, { sort: 'amount_desc' }))).toEqual([s(big), s(small)]);
    expect(idsOf(await listPaidSalesOrders(acc, { sort: 'amount_asc' }))).toEqual([s(small), s(big)]);
  });
});

describe('paging: no repeats and no gaps at page boundaries', () => {
  it('30 paid orders with shared paid dates, newest and oldest, page 1 + page 2', async () => {
    const acc = await staff('accounts');
    const all = [];
    for (let i = 0; i < 30; i += 1) all.push(await paidOrder());
    // Five orders share each paid moment: _id must break the tie.
    const at = (i) => new Date(Date.UTC(2026, 10, 1 + Math.floor(i / 5)));
    await Promise.all(all.map((id, i) => Order.collection.updateOne({ _id: id }, { $set: { paidAt: at(i), listDate: at(i) } })));
    for (const sort of ['newest', 'oldest']) {
      const p1 = await listPaidSalesOrders(acc, { sort });
      expect(p1.orders).toHaveLength(25);
      const p2 = await listPaidSalesOrders(acc, { sort, cursor: p1.nextCursor });
      expect(p2.nextCursor).toBeNull();
      const seen = [...idsOf(p1), ...idsOf(p2)];
      expect(seen).toHaveLength(30);
      expect(new Set(seen).size).toBe(30);
      const dates = [...p1.orders, ...p2.orders].map((o) => new Date(o.paidAt).getTime());
      expect(dates).toEqual([...dates].sort((x, y) => (sort === 'newest' ? y - x : x - y)));
    }
  });
});

describe('work queues and Marketing sort on the paid date', () => {
  it('Procurement: the order paid last is on top, though it was created first', async () => {
    const p = await staff('procurement');
    const createdFirst = await unpaidOrder({ daysAgo: 8 });
    const second = await paidOrder({ daysAgo: 3 });
    await Order.collection.updateOne({ _id: second }, { $set: { paidAt: new Date(Date.now() - 3 * DAY), listDate: new Date(Date.now() - 3 * DAY) } });
    await pay(createdFirst);
    const page = await wf.listQueue(p, 'procurement', {});
    expect(idsOf(page)).toEqual([s(createdFirst), s(second)]);
    expect(page.orders[0].paidAt).toBeTruthy();
  });

  it('a work-queue cursor made before this change starts the list over instead of skipping', async () => {
    const p = await staff('procurement');
    await paidOrder();
    const old = Buffer.from(`${new Date().toISOString()}|${oid()}`).toString('base64url');
    expect((await wf.listQueue(p, 'procurement', { cursor: old })).orders).toHaveLength(1);
  });

  it('Marketing: website orders newest paid first', async () => {
    const mk = await staff('marketing');
    const createdFirst = await unpaidOrder({ daysAgo: 8 });
    const second = await paidOrder({ daysAgo: 3 });
    await Order.collection.updateOne({ _id: second }, { $set: { paidAt: new Date(Date.now() - 3 * DAY), listDate: new Date(Date.now() - 3 * DAY) } });
    await pay(createdFirst);
    expect(idsOf(await listWebsiteOrders(mk, {}))).toEqual([s(createdFirst), s(second)]);
  });
});

describe('Admin: the Orders page opens sorted by paid date', () => {
  const run = async (user, query = {}) => {
    const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
    await getAllOrdersAdmin({ query, user }, res);
    return res.body;
  };

  it('default sort is the paid date; created date is still a sort the admin can pick', async () => {
    const a = await admin();
    const createdFirst = await unpaidOrder({ daysAgo: 8 });
    const second = await paidOrder({ daysAgo: 3 });
    await Order.collection.updateOne({ _id: second }, { $set: { paidAt: new Date(Date.now() - 3 * DAY), listDate: new Date(Date.now() - 3 * DAY) } });
    await pay(createdFirst);
    expect((await run(a)).orders.map((o) => s(o._id))).toEqual([s(createdFirst), s(second)]);
    expect((await run(a, { sortBy: 'createdAt' })).orders.map((o) => s(o._id))).toEqual([s(second), s(createdFirst)]);
  });

  it('pins: on top of page 1 only, never repeated on page 2, and the total is unchanged', async () => {
    const a = await admin();
    const ids = [];
    for (let i = 0; i < 25; i += 1) ids.push(await paidOrder());
    const oldest = ids[0];
    await pins.pinOrder(a, oldest);
    const p1 = await run(a, { limit: '20' });
    const p2 = await run(a, { limit: '20', page: '2' });
    expect(s(p1.orders[0]._id)).toBe(s(oldest));
    expect(p1.orders[0].pinned).toBe(true);
    const seen = [...p1.orders, ...p2.orders].map((o) => s(o._id));
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});

describe('pins (personal, newest pin first, at most 5)', () => {
  it('a pinned order stays on top across pages and is not repeated further down', async () => {
    const acc = await staff('accounts');
    const all = [];
    for (let i = 0; i < 30; i += 1) all.push(await paidOrder());
    const [oldest, second] = all;
    await pins.pinOrder(acc, oldest);
    await new Promise((r) => setTimeout(r, 5));
    await pins.pinOrder(acc, second);
    const p1 = await listPaidSalesOrders(acc, {});
    expect(idsOf(p1).slice(0, 2)).toEqual([s(second), s(oldest)]); // newest pin first
    expect(p1.orders.slice(0, 2).every((o) => o.pinned)).toBe(true);
    const p2 = await listPaidSalesOrders(acc, { cursor: p1.nextCursor });
    expect(p2.orders.some((o) => o.pinned)).toBe(false);
    const seen = [...idsOf(p1), ...idsOf(p2)];
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    // The count on page 1 still counts every order once.
    expect(p1.summary.count).toBe(30);
  });

  it('personal: another person — same team or another — sees no pin', async () => {
    const acc = await staff('accounts');
    const otherAcc = await staff('accounts');
    const proc = await staff('procurement');
    const a = await paidOrder();
    const b = await paidOrder();
    await pins.pinOrder(acc, a);
    expect(idsOf(await listPaidSalesOrders(acc, {}))).toEqual([s(a), s(b)]);
    for (const other of [otherAcc, proc]) {
      const page = await listPaidSalesOrders(other, {});
      expect(idsOf(page)).toEqual([s(b), s(a)]);
      expect(page.orders.some((o) => o.pinned)).toBe(false);
      expect(await pins.listPins(other)).toEqual({ pins: [], max: 5 });
    }
  });

  it('a pin shows nothing the list would not: a seller pinning another seller\'s order sees nothing new', async () => {
    const mine = await staff('sales');
    const theirs = await staff('sales');
    const theirOrder = await unpaidOrder({ salesUser: theirs._id });
    const myOrder = await unpaidOrder({ salesUser: mine._id });
    await pins.pinOrder(mine, theirOrder);
    expect(idsOf(await listSalesOrders(mine, {}))).toEqual([s(myOrder)]);
  });

  it('a pinned order that does not match the filter is not shown', async () => {
    const acc = await staff('accounts');
    const small = await paidOrder({ total: 1000 });
    const big = await paidOrder({ total: 9000 });
    await pins.pinOrder(acc, small);
    expect(idsOf(await listPaidSalesOrders(acc, { min: '5000' }))).toEqual([s(big)]);
  });

  it('pinned on the work queue and the Marketing list too', async () => {
    const p = await staff('procurement');
    const mk = await staff('marketing');
    const a = await paidOrder();
    const b = await paidOrder();
    await pins.pinOrder(p, a);
    await pins.pinOrder(mk, a);
    const q = await wf.listQueue(p, 'procurement', {});
    expect(idsOf(q)).toEqual([s(a), s(b)]);
    expect(q.orders[0].pinned).toBe(true);
    const m = await listWebsiteOrders(mk, {});
    expect(idsOf(m)).toEqual([s(a), s(b)]);
    expect(m.orders[0].pinned).toBe(true);
  });

  it('work queue: a pin stays on top of page 1 and is never repeated on later pages', async () => {
    const p = await staff('procurement');
    const all = [];
    for (let i = 0; i < 30; i += 1) all.push(await paidOrder());
    await pins.pinOrder(p, all[0]);
    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const page = await wf.listQueue(p, 'procurement', { cursor });
      if (pages === 0) expect(page.orders[0]).toMatchObject({ id: s(all[0]), pinned: true });
      else expect(page.orders.some((o) => o.pinned)).toBe(false);
      seen.push(...idsOf(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });

  it('at most 5; a sixth is refused; pinning twice is one pin; unpin frees a slot', async () => {
    const acc = await staff('accounts');
    const ids = [];
    for (let i = 0; i < 6; i += 1) ids.push(await paidOrder());
    for (const id of ids.slice(0, 5)) await pins.pinOrder(acc, id);
    await pins.pinOrder(acc, ids[0]); // again: no error, no second pin
    expect(await OrderPin.countDocuments({ user: acc._id })).toBe(5);
    await expect(pins.pinOrder(acc, ids[5])).rejects.toMatchObject({ statusCode: 409 });
    await pins.unpinOrder(acc, ids[0]);
    await expect(pins.pinOrder(acc, ids[5])).resolves.toMatchObject({ pinned: true });
    expect((await pins.listPins(acc)).pins[0]).toBe(s(ids[5]));
  });

  it('a missing order or a bad id is a 404; a customer cannot pin', async () => {
    const acc = await staff('accounts');
    await expect(pins.pinOrder(acc, String(oid()))).rejects.toMatchObject({ statusCode: 404 });
    await expect(pins.pinOrder(acc, 'nope')).rejects.toMatchObject({ statusCode: 404 });
    const customer = await User.create({ name: 'C', email: 'c@autobacs.test', phone: '9000000003', passwordHash: 'x', role: 'customer' });
    await expect(pins.pinOrder(customer, String(await paidOrder()))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('pinning changes nothing on the order', async () => {
    const acc = await staff('accounts');
    const id = await paidOrder({ total: 4321 });
    const before = await Order.findById(id).lean();
    await pins.pinOrder(acc, id);
    const after = await Order.findById(id).lean();
    expect(after).toEqual(before);
  });
});

describe('index hint fallback', () => {
  it('a list whose list-date index is not built yet still answers (unhinted), never fails', async () => {
    const seller = await staff('sales');
    const id = await unpaidOrder({ salesUser: seller._id });
    const spy = jest.spyOn(orderRepository, 'find');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    spy.mockImplementationOnce(async () => { throw new Error('error processing query: planner returned error :: caused by :: hint provided does not correspond to an existing index'); });
    try {
      expect(idsOf(await listSalesOrders(seller, {}))).toEqual([s(id)]);
      expect(warn).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('backfill rules (scripts/backfill-order-list-date.js)', () => {
  const createdAt = new Date('2026-10-28T05:00:00.000Z');
  it('derives the paid date in order: bank transfer, parts, workflow, history, created', () => {
    const paidOn = new Date('2026-11-01T00:00:00.000Z');
    expect(derivePaidAt({ createdAt, offlinePayment: { paidOn, confirmedAt: new Date('2026-11-03T08:00:00.000Z') } }))
      .toEqual(new Date('2026-11-01T18:29:59.999Z'));
    expect(derivePaidAt({ createdAt, offlinePayment: { paidOn, confirmedAt: new Date('2026-11-01T08:00:00.000Z') } }))
      .toEqual(new Date('2026-11-01T08:00:00.000Z'));
    expect(derivePaidAt({ createdAt, paymentParts: [
      { status: 'paid', paidAt: new Date('2026-11-02T00:00:00.000Z') },
      { status: 'paid', paidAt: new Date('2026-11-03T00:00:00.000Z') },
      { status: 'cancelled', paidAt: null },
    ] })).toEqual(new Date('2026-11-03T00:00:00.000Z'));
    expect(derivePaidAt({ createdAt, workflow: { enteredAt: new Date('2026-11-03T10:55:00.000Z') } }))
      .toEqual(new Date('2026-11-03T10:55:00.000Z'));
    const history = [{ status: 'awaiting_payment', timestamp: createdAt }, { status: 'processing', timestamp: new Date('2026-10-30T00:00:00.000Z') }];
    expect(derivePaidAt({ createdAt, statusHistory: history })).toEqual(new Date('2026-10-30T00:00:00.000Z'));
    // A WooCommerce import's history was written at import time: its created date stands.
    expect(derivePaidAt({ createdAt, source: 'woocommerce', statusHistory: history })).toEqual(createdAt);
    expect(derivePaidAt({ createdAt })).toEqual(createdAt);
  });

  it('plans only what is missing, conditionally, and nothing for an order already done', () => {
    const _id = oid();
    expect(planFor({ _id, createdAt, paymentStatus: 'pending' }))
      .toEqual({ filter: { _id, listDate: { $exists: false } }, set: { listDate: createdAt } });
    expect(planFor({ _id, createdAt, paymentStatus: 'refunded' }))
      .toEqual({ filter: { _id, paidAt: { $exists: false } }, set: { paidAt: createdAt, listDate: createdAt } });
    expect(planFor({ _id, createdAt, paymentStatus: 'paid', paidAt: createdAt, listDate: createdAt })).toBeNull();
  });
});
