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
const { readListFilters, rowMatches, orderQueryFor } = await import('../utils/orderListFilters.js');

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
      .toEqual({ q: 'ab12cd34', stage: null, source: null, sort: 'newest', eta: null });
    expect(readListFilters({ step: 'to_ship', source: 'sales', sort: 'oldest', eta: 'overdue' }))
      .toMatchObject({ stage: 'to_ship', source: 'sales', sort: 'oldest', eta: 'overdue' });
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
