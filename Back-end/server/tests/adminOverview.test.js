/**
 * Admin Company overview (services/adminOverviewService.js), through the real
 * workflow. Read-only; admins only.
 *
 * What must hold:
 *   - today's paid orders, split GTM vs website, exclude earlier days
 *   - money waiting: requests by state, paid this month by team, item refunds
 *     approved but not yet paid
 *   - every team with its people, who is waiting and overdue
 *   - an activity feed of what staff did, newest first, in words, with links
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
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
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const { companyOverview, describeAction } = await import('../services/adminOverviewService.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { STAGE } = await import('../utils/teamWorkflow.js');

const H = 3600 * 1000;
const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);

let n = 0;
const person = (team, isHead = false, name) => User.create({
  name: name || `${team} ${n + 1}`, email: `${team}${++n}@autobacs.test`, phone: '9000000001',
  passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
});

async function paidOrder(items = 1, salesUser = null) {
  const order = await Order.create({
    salesUser,
    user: new mongoose.Types.ObjectId(),
    items: Array.from({ length: items }, (_, i) => ({ product: new mongoose.Types.ObjectId(), name: `Part ${i + 1}`, price: 1000, quantity: 1 })),
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 1000 * items, totalAmount: 1000 * items, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}
const itemIds = (o) => o.items.map((i) => String(i._id));




const reqAs = (user) => ({ ...req, user });
const flush = () => new Promise((r) => setTimeout(r, 50)); // audit writes are fire-and-forget

let procurement, seller, accounts, operations, admin;
beforeEach(async () => {
  procurement = await person('procurement', false, 'Priya');
  seller = await person('sales', false, 'Sam');
  accounts = await person('accounts', false, 'Anu');
  operations = await person('operations', false, 'Omar');
  admin = await User.create({ name: 'Owner', email: `owner${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });
});

const payReq = (over) => PaymentRequest.create({
  number: `PR-${++n}`, kind: 'expense', status: 'submitted', team: 'operations', requestedBy: operations._id,
  requestedByName: 'Omar', amount: 1000, category: 'fuel', payee: { name: 'Fuel', method: 'upi', upiId: 'f@ok' }, ...over,
});

it('is for admins only', async () => {
  await expect(companyOverview(procurement)).rejects.toMatchObject({ statusCode: 403 });
});

it('counts today\'s paid orders by source, and not yesterday\'s', async () => {
  await paidOrder(1, seller._id);
  await paidOrder();
  const old = await paidOrder();
  // createdAt is immutable through Mongoose; move it back on the raw collection.
  await Order.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 3 * 24 * H) } });
  const o = await companyOverview(admin);
  expect(o.today).toMatchObject({ paidOrders: 2, gtmOrders: 1, websiteOrders: 1, paidValue: 2000 });
});

it('shows money waiting, paid this month by team, and item refunds still to pay', async () => {
  await payReq({ amount: 1000 });
  await payReq({ amount: 500, status: 'approved' });
  await payReq({ amount: 250, status: 'on_hold' });
  await payReq({ amount: 4000, status: 'paid', team: 'procurement', kind: 'supplier', category: 'supplier', payment: { method: 'bank', reference: 'UTR1', paidAt: new Date() } });
  await payReq({ amount: 9999, status: 'paid', payment: { method: 'bank', reference: 'UTR0', paidAt: new Date(Date.now() - 60 * 24 * H) } }); // an earlier month

  const order = await paidOrder();
  const id = String(order._id);
  const [item] = itemIds(order);
  await wf.setStock(procurement, id, item, { stock: 'out_of_stock' }, req);
  await wf.recordDecision(admin, id, item, { decision: 'refund' }, req);
  await wf.reviewRefund(accounts, id, item, { approve: true }, req);

  const { money } = await companyOverview(admin);
  expect(money.awaitingApproval).toEqual({ n: 1, amount: 1000 });
  expect(money.withAccounts).toEqual({ n: 2, amount: 750, onHold: 1 });
  expect(money.paidThisMonth).toMatchObject({ n: 1, amount: 4000, byTeam: [{ team: 'procurement', n: 1, amount: 4000 }] });
  expect(money.itemRefundsToPay).toBe(1);
});

it('lists every team with its people, waiting and overdue work', async () => {
  const stale = await paidOrder();
  await Order.updateOne({ _id: stale._id }, { $set: { 'workflow.enteredAt': new Date(Date.now() - 30 * H) } });
  const o = await companyOverview(admin);
  const proc = o.teams.find((t) => t.team === 'procurement');
  expect(proc).toMatchObject({ label: 'Procurement', members: 1, waiting: 1, overdue: 1 });
  expect(o.teams.find((t) => t.team === 'sales')).toMatchObject({ label: 'GTM', members: 1 });
  expect(o.people.find((p) => p.name === 'Sam')).toMatchObject({ teamLabel: 'GTM', role: 'GTM lead', online: false });
  expect(o.overdue[0]).toMatchObject({ team: 'procurement', overdue: true });
});

it('shows what staff did, newest first, in words with a link', async () => {
  const order = await paidOrder();
  const id = String(order._id);
  await wf.setStock(procurement, id, itemIds(order)[0], { stock: 'in_stock' }, reqAs(procurement));
  await flush();
  await wf.setStock(procurement, id, itemIds(order)[0], { stock: 'ordered', supplierName: 'ARB' }, reqAs(procurement));
  await flush();
  const { feed, people } = await companyOverview(admin);
  expect(feed.slice(0, 2).map((f) => f.text)).toEqual(['Marked an item ordered', 'Marked an item in stock']);
  expect(feed[0]).toMatchObject({ who: 'Priya', team: 'Procurement', area: 'Procurement', link: `/admin/orders/${id}` });
  expect(people.find((p) => p.name === 'Priya').actionsThisWeek).toBe(2);
});

it('describes payment and staff actions too', () => {
  expect(describeAction({ resource: 'PaymentRequest', action: 'CREATE', details: { kind: 'supplier', amount: 38000 } }).text).toBe('Raised a supplier payment (₹38,000)');
  expect(describeAction({ resource: 'PaymentRequest', action: 'UPDATE', details: { change: 'paid' } }).text).toBe('Paid a payment');
  expect(describeAction({ resource: 'User', action: 'UPDATE', details: { change: 'staff_password_reset' } }).text).toBe('Changed a staff password');
  expect(describeAction({ resource: 'Order', action: 'CREATE', details: { via: 'sales_panel', totalAmount: 9000 } }).text).toBe('Created a sales order (₹9,000)');
});
