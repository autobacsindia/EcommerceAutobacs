/**
 * Search / filter / sort on the team panel's order lists (utils/orderListFilters.js),
 * through the real work-queue and paid-list services. Mongo and the order status
 * machine are real; the queue and private storage are doubles.
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
const { listPaidSalesOrders } = await import('../services/salesOrderService.js');
const { readListFilters, rowMatches, orderQueryFor, withCustomerIds, USER_LANE_MAX_IDS } = await import('../utils/orderListFilters.js');
const { pinOrder } = await import('../services/orderPinService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
async function staff(team, { isHead = false, name } = {}) {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
}
async function paidOrder({ salesUser = null, items } = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(), source: salesUser ? 'offline' : 'web', salesUser,
    items: items || [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 2 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 7000, totalAmount: 7000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(`could not pay test order: ${res?.message}`);
  return Order.findById(order._id).lean();
}
const ids = (o) => o.items.map((i) => String(i._id));

describe('reading the filters', () => {
  it('ignores anything it does not know, and trims / lower-cases the search', () => {
    expect(readListFilters({ q: '  #AB12CD34 ', step: 'nonsense', source: 'x', sort: 'y', eta: 'someday' }))
      .toEqual({ q: 'ab12cd34', stage: null, source: null, sort: 'newest', eta: null, placed: null, amount: null });
    expect(readListFilters({ step: 'to_ship', source: 'sales', sort: 'oldest', eta: 'overdue' }))
      .toMatchObject({ stage: 'to_ship', source: 'sales', sort: 'oldest', eta: 'overdue' });
  });

  it('reads the amount sorts, an India-time placed-on range and an amount range; junk is ignored', () => {
    expect(readListFilters({ sort: 'amount_desc' }).sort).toBe('amount_desc');
    expect(readListFilters({ sort: 'amount_asc' }).sort).toBe('amount_asc');
    const f = readListFilters({ from: '2026-10-01', to: '2026-10-01', min: '500', max: '2000' });
    // 1 Oct India time = 30 Sep 18:30 UTC, up to (not including) the next India midnight.
    expect(f.placed).toEqual({ $gte: new Date('2026-09-30T18:30:00.000Z'), $lt: new Date('2026-10-01T18:30:00.000Z') });
    expect(f.amount).toEqual({ $gte: 500, $lte: 2000 });
    expect(readListFilters({ from: '2026-02-31', to: 'soon', min: 'lots', max: '-5' })).toMatchObject({ placed: null, amount: null });
  });

  it('a work-list row is kept only inside the placed-on and amount ranges', () => {
    const row = { orderNumber: 'AB12CD34', createdAt: '2026-10-01T05:00:00.000Z', totalAmount: 1500, lines: [] };
    expect(rowMatches(row, readListFilters({ from: '2026-10-01', to: '2026-10-01' }))).toBe(true);
    expect(rowMatches(row, readListFilters({ from: '2026-10-02' }))).toBe(false);
    expect(rowMatches(row, readListFilters({ to: '2026-09-30' }))).toBe(false);
    expect(rowMatches(row, readListFilters({ min: '1500', max: '1500' }))).toBe(true);
    expect(rowMatches(row, readListFilters({ min: '1501' }))).toBe(false);
    expect(rowMatches(row, readListFilters({ max: '1499' }))).toBe(false);
  });

  it('the Mongo query carries the list-date (paid date) and amount ranges', () => {
    const q = orderQueryFor(readListFilters({ from: '2026-10-01', min: '100' }));
    expect(q.$and).toEqual(expect.arrayContaining([
      { listDate: { $gte: new Date('2026-09-30T18:30:00.000Z') } },
      { totalAmount: { $gte: 100 } },
    ]));
  });

  it('a row matches only when every word is somewhere in it', () => {
    const row = { orderNumber: 'AB12CD34', source: 'website', soldBy: 'Website', city: 'Kochi, Kerala', customer: { name: 'Ravi', phone: '98765', email: '' }, summaryStage: 'stock_check', lines: [{ name: 'Hilux roof rack', stage: 'stock_check' }] };
    expect(rowMatches(row, readListFilters({ q: 'hilux kochi' }))).toBe(true);
    expect(rowMatches(row, readListFilters({ q: 'hilux delhi' }))).toBe(false);
    expect(rowMatches(row, readListFilters({ source: 'sales' }))).toBe(false);
    expect(rowMatches(row, readListFilters({ step: 'to_ship' }))).toBe(false);
  });

  it('the Mongo form escapes what is typed (no regex injection)', () => {
    const q = orderQueryFor(readListFilters({ q: '.*' }));
    expect(q.$and[0].$or[0]['shippingAddress.fullName'].source).toBe('\\.\\*');
  });
});

describe('search, filter and sort on the team lists', () => {
  async function three() {
    const seller = await staff('sales', { name: 'Nevin' });
    const a = await paidOrder({ items: [{ product: new mongoose.Types.ObjectId(), name: 'Hilux roof rack', price: 9000, quantity: 1 }] });
    await new Promise((r) => setTimeout(r, 10));
    const b = await paidOrder({ salesUser: seller._id, items: [{ product: new mongoose.Types.ObjectId(), name: 'Thar steering wheel', price: 4000, quantity: 1 }] });
    await Order.updateOne({ _id: b._id }, { $set: { 'shippingAddress.fullName': 'Arun Kaushik', 'shippingAddress.city': 'Gurgaon' } });
    await new Promise((r) => setTimeout(r, 10));
    const c = await paidOrder();
    return { a: String(a._id), b: String(b._id), c: String(c._id), seller };
  }
  const idsOf = (res) => res.orders.map((o) => o.id);

  it('work list: search by product, customer, city or order number; every word must match', async () => {
    const p = await staff('procurement');
    const { a, b, c } = await three();
    expect(idsOf(await wf.listQueue(p, 'procurement', { q: 'hilux' }))).toEqual([a]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { q: 'ARUN gurgaon' }))).toEqual([b]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { q: 'arun kochi' }))).toEqual([]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { q: `#${c.slice(-8).toUpperCase()}` }))).toEqual([c]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { q: 'nevin' }))).toEqual([b]); // the seller
  });

  it('work list: filter by website / sales and by stage; sort newest or oldest', async () => {
    const p = await staff('procurement');
    const { a, b, c } = await three();
    expect(idsOf(await wf.listQueue(p, 'procurement', { source: 'sales' }))).toEqual([b]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { source: 'website' }))).toEqual([c, a]);
    await wf.setStock(p, a, ids(await Order.findById(a).lean())[0], { stock: 'in_stock' }, req);
    expect(idsOf(await wf.listQueue(p, 'procurement', { step: 'to_ship' }))).toEqual([a]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { sort: 'oldest' }))).toEqual([a, b, c]);
    expect(idsOf(await wf.listQueue(p, 'procurement', {}))).toEqual([c, b, a]);
    // Unknown values are ignored, not an error.
    expect(idsOf(await wf.listQueue(p, 'procurement', { step: 'nonsense', source: 'x', sort: 'y' }))).toEqual([c, b, a]);
  });

  it('paid list (Order processing): search, website / sales, oldest first — paging keeps the order', async () => {
    const acc = await staff('accounts');
    const { a, b, c } = await three();
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: 'thar' }))).toEqual([b]);
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: c.slice(-8) }))).toEqual([c]);
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', source: 'website' }))).toEqual([c, a]);
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', sort: 'oldest' }))).toEqual([a, b, c]);
    // A regex character typed into search is just a character.
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: '.*' }))).toEqual([]);
  });

  // createdAt is immutable through Mongoose, so the tests move orders in time with the driver.
  const setRaw = (id, set) => Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: set });
  const IST_1_OCT = new Date('2026-10-01T06:00:00.000Z'); // 11:30 on 1 Oct, India time
  const IST_2_OCT = new Date('2026-10-02T06:00:00.000Z');

  it('work list: paid-on dates (India time) and the order total narrow it', async () => {
    const p = await staff('procurement');
    const { a, b, c } = await three();
    // The date range reads the list date — the paid date (utils/orderListDate.js).
    await setRaw(a, { createdAt: IST_1_OCT, paidAt: IST_1_OCT, listDate: IST_1_OCT });
    await setRaw(b, { createdAt: IST_2_OCT, paidAt: IST_2_OCT, listDate: IST_2_OCT, totalAmount: 4000 });
    expect(idsOf(await wf.listQueue(p, 'procurement', { from: '2026-10-01', to: '2026-10-01' }))).toEqual([a]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { from: '2026-10-01', to: '2026-10-02' }))).toEqual([b, a]);
    expect(idsOf(await wf.listQueue(p, 'procurement', { min: '4000', max: '4000' }))).toEqual([b]);
    // Search and a date range together: both must hold.
    expect(idsOf(await wf.listQueue(p, 'procurement', { q: 'hilux', from: '2026-10-02' }))).toEqual([]);
    // A malformed date is ignored, not an error.
    expect(idsOf(await wf.listQueue(p, 'procurement', { from: '2026-02-31' }))).toEqual([c, b, a]);
  });

  it('paid list: dates, total range, amount sorts, and a count with the total on the first page', async () => {
    const acc = await staff('accounts');
    const { a, b, c } = await three();
    await setRaw(a, { totalAmount: 9000, createdAt: IST_1_OCT, paidAt: IST_1_OCT, listDate: IST_1_OCT });
    await setRaw(b, { totalAmount: 4000, createdAt: IST_2_OCT, paidAt: IST_2_OCT, listDate: IST_2_OCT });
    const all = await listPaidSalesOrders(acc, { stage: 'processing' });
    expect(all.summary).toEqual({ count: 3, capped: false, total: 20000 });
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', sort: 'amount_desc' }))).toEqual([a, c, b]);
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', sort: 'amount_asc' }))).toEqual([b, c, a]);
    const big = await listPaidSalesOrders(acc, { stage: 'processing', min: '5000' });
    expect(idsOf(big)).toEqual([c, a]);
    expect(big.summary).toEqual({ count: 2, capped: false, total: 16000 });
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', from: '2026-10-02', to: '2026-10-02' }))).toEqual([b]);
    // Delivered is a different list: none of these are delivered.
    expect((await listPaidSalesOrders(acc, { stage: 'delivered', min: '1' })).summary.count).toBe(0);
  });

  it('paid list: amount-sorted paging with equal totals has no repeats or gaps and keeps the filter', async () => {
    const acc = await staff('accounts');
    const seller = await staff('sales');
    for (let i = 0; i < 27; i += 1) await paidOrder();
    await paidOrder({ salesUser: seller._id }); // a salesman's order: filtered out below
    const p1 = await listPaidSalesOrders(acc, { sort: 'amount_desc', source: 'website' });
    expect(p1.orders).toHaveLength(25);
    expect(p1.summary.count).toBe(27);
    const p2 = await listPaidSalesOrders(acc, { sort: 'amount_desc', source: 'website', cursor: p1.nextCursor });
    expect(p2.summary).toBeUndefined(); // counted once, on the first page
    expect(p2.nextCursor).toBeNull();
    const seen = [...p1.orders, ...p2.orders].map((o) => o.id);
    expect(new Set(seen).size).toBe(27);
    // A cursor made under another sort starts the list over instead of skipping rows.
    const restarted = await listPaidSalesOrders(acc, { sort: 'newest', source: 'website', cursor: p1.nextCursor });
    expect(restarted.orders).toHaveLength(25);
    expect(restarted.summary.count).toBe(27);
  });

  it('paid list: oldest-first paging has no repeats or gaps', async () => {
    const acc = await staff('accounts');
    for (let i = 0; i < 27; i += 1) await paidOrder();
    const p1 = await listPaidSalesOrders(acc, { sort: 'oldest' });
    const p2 = await listPaidSalesOrders(acc, { sort: 'oldest', cursor: p1.nextCursor });
    const all = [...p1.orders, ...p2.orders];
    expect(new Set(all.map((o) => o.id)).size).toBe(27);
    const t = all.map((o) => new Date(o.createdAt).getTime());
    expect(t).toEqual([...t].sort((x, y) => x - y));
  });
});

/*
 * Orders search (owner request, 2026-11): every list's one search box matches the
 * order number (full id or the #xxxxxxxx shown), the customer's name / phone /
 * email — including a registered customer's account email, which is not copied
 * onto the order — and the product name or SKU. Typed regex characters are
 * literal; paging and pins keep honouring the search.
 */
describe('orders search: what one box matches', () => {
  const idsOf = (res) => res.orders.map((o) => o.id);
  const oneItem = (name) => [{ product: new mongoose.Types.ObjectId(), name, price: 3000, quantity: 1 }];

  it('the customer-account lookup is bounded: three words of 3+ characters, 200 accounts each', async () => {
    const calls = [];
    const find = async (w, opts) => { calls.push([w, opts]); return w === 'ravi' ? ['u1'] : []; };
    const f = await withCustomerIds(readListFilters({ q: 'ab ravi kochi rack hilux mats' }), find);
    expect(calls).toEqual([['ravi', { limit: USER_LANE_MAX_IDS }], ['kochi', { limit: 200 }], ['rack', { limit: 200 }]]);
    expect(f.userIds).toEqual({ ravi: ['u1'] });
    // No search: no lookup at all.
    const none = readListFilters({});
    expect(await withCustomerIds(none, find)).toBe(none);
    expect(calls).toHaveLength(3);
  });

  it('the Mongo form adds the account lane only for words that found accounts', () => {
    const uid = new mongoose.Types.ObjectId();
    const q = orderQueryFor({ ...readListFilters({ q: 'pio ravi' }), userIds: { ravi: [uid] } });
    const [pio, ravi] = q.$and.map((c) => c.$or);
    expect(pio).toEqual(expect.arrayContaining([{ 'items.name': /pio/i }]));
    expect(pio.some((c) => c.user)).toBe(false);
    expect(ravi).toEqual(expect.arrayContaining([{ user: { $in: [uid] } }]));
  });

  it('a work-list row matches its full order id and the short #number', () => {
    const row = { id: '6553f1a2b3c4d5e6f7a8b9c0', orderNumber: 'F7A8B9C0', customer: {}, lines: [{ name: 'Pioneer stereo' }] };
    expect(rowMatches(row, readListFilters({ q: '6553f1a2b3c4d5e6f7a8b9c0' }))).toBe(true);
    expect(rowMatches(row, readListFilters({ q: '#f7a8b9c0' }))).toBe(true);
    expect(rowMatches(row, readListFilters({ q: 'pioneer' }))).toBe(true);
    expect(rowMatches(row, readListFilters({ q: '6553f1a2b3c4d5e6f7a8b9c1' }))).toBe(false);
  });

  it('paid list: finds a registered customer by their account email, a product, and a full id', async () => {
    const acc = await staff('accounts');
    const buyer = await User.create({ name: 'Leela Das', email: 'leela.das@example.test', phone: '9811111111', passwordHash: 'x', role: 'customer' });
    const mine = await paidOrder({ items: oneItem('Pioneer stereo') });
    await Order.updateOne({ _id: mine._id }, { $set: { user: buyer._id } });
    const other = await paidOrder({ items: oneItem('Floor mat') });
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: 'leela.das@example' }))).toEqual([String(mine._id)]);
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: 'pioneer' }))).toEqual([String(mine._id)]);
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: 'FLOOR mat' }))).toEqual([String(other._id)]);
    // The full id, as pasted from a link or an email.
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: String(other._id) }))).toEqual([String(other._id)]);
  });

  it('special characters are matched literally and never break the query', async () => {
    const acc = await staff('accounts');
    const p = await staff('procurement');
    const cpp = await paidOrder({ items: oneItem('Philips H4.1 (C++ edition)') });
    await paidOrder({ items: oneItem('Philips H4X1 standard') });
    for (const q of ['c++', '(c++', 'h4.1']) {
      expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q }))).toEqual([String(cpp._id)]);
      expect(idsOf(await wf.listQueue(p, 'procurement', { q }))).toEqual([String(cpp._id)]);
    }
    for (const q of ['.*', '[', '\\', '$where', '{"$gt":""}', '^', '?']) {
      expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q }))).toEqual([]);
      expect(idsOf(await wf.listQueue(p, 'procurement', { q }))).toEqual([]);
    }
  });

  it('paging with a search: every page honours it, with no repeats or gaps', async () => {
    const acc = await staff('accounts');
    const p = await staff('procurement');
    const wanted = [];
    for (let i = 0; i < 27; i += 1) {
      wanted.push(String((await paidOrder({ items: oneItem(`Roof rack ${i}`) }))._id));
      if (i % 5 === 0) await paidOrder({ items: oneItem('Seat cover') }); // never matches
    }
    const p1 = await listPaidSalesOrders(acc, { stage: 'processing', q: 'roof rack' });
    expect(p1.orders).toHaveLength(25);
    expect(p1.summary.count).toBe(27);
    const p2 = await listPaidSalesOrders(acc, { stage: 'processing', q: 'roof rack', cursor: p1.nextCursor });
    expect(p2.nextCursor).toBeNull();
    const seen = [...idsOf(p1), ...idsOf(p2)];
    expect(new Set(seen).size).toBe(27);
    expect(seen.sort()).toEqual([...wanted].sort());
    // The work queue pages the same way.
    const w1 = await wf.listQueue(p, 'procurement', { q: 'roof rack' });
    const w2 = await wf.listQueue(p, 'procurement', { q: 'roof rack', cursor: w1.nextCursor });
    const wseen = [...idsOf(w1), ...idsOf(w2)];
    expect(new Set(wseen).size).toBe(wseen.length);
    expect(wseen.sort()).toEqual([...wanted].sort());
  });

  it('a pinned order shows on top only when it matches the search', async () => {
    const acc = await staff('accounts');
    const rack = await paidOrder({ items: oneItem('Roof rack') });
    const mat = await paidOrder({ items: oneItem('Floor mat') });
    await pinOrder(acc, String(rack._id));
    const all = await listPaidSalesOrders(acc, { stage: 'processing' });
    expect(idsOf(all)[0]).toBe(String(rack._id));
    expect(idsOf(await listPaidSalesOrders(acc, { stage: 'processing', q: 'floor' }))).toEqual([String(mat._id)]);
  });

  it('the order panel shows each line\'s catalogue SKU (the variant\'s first), read in one go', async () => {
    const { default: Product } = await import('../models/Product.js');
    const p = await staff('procurement');
    const plain = await Product.collection.insertOne({ name: 'Floor mat', slug: 'floor-mat-sku', sku: 'MAT-FTN-3D', price: 4500 });
    const variantId = new mongoose.Types.ObjectId();
    const multi = await Product.collection.insertOne({ name: 'Stereo', slug: 'stereo-sku', sku: 'PIO-BASE', price: 1, variants: [{ _id: variantId, sku: 'PIO-Z6350' }] });
    const o = await paidOrder({ items: [
      { product: plain.insertedId, name: 'Floor mat', price: 4500, quantity: 1 },
      { product: multi.insertedId, variantId, variantLabel: 'Z6350', name: 'Stereo', price: 24990, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Gone from the catalogue', price: 10, quantity: 1 },
    ] });
    const view = await wf.getOrder(p, String(o._id));
    expect(view.lines.map((l) => l.sku)).toEqual(['MAT-FTN-3D', 'PIO-Z6350', null]);
  });
});
