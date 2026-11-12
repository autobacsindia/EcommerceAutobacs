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
 *   - a past IST day (?date=): that day's events only (00:00–23:59:59.999 IST),
 *     the month to that day, no live-only figures; future/invalid dates are a 400
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
const { companyOverview, describeAction, overviewDay } = await import('../services/adminOverviewService.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: Consultation } = await import('../models/Consultation.js');
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
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
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
  // A baht bill approved but not yet paid: no rupees yet — counted, not totalled, and said so.
  await payReq({ amount: 0, status: 'approved', team: 'procurement', category: 'import_purchase', currency: 'THB', foreignAmount: 22950 });
  await payReq({ amount: 4000, status: 'paid', team: 'procurement', kind: 'supplier', category: 'supplier', payment: { method: 'bank', reference: 'UTR1', paidAt: new Date() } });
  await payReq({ amount: 9999, status: 'paid', payment: { method: 'bank', reference: 'UTR0', paidAt: new Date(Date.now() - 60 * 24 * H) } }); // an earlier month

  const order = await paidOrder();
  const id = String(order._id);
  const [item] = itemIds(order);
  await wf.setStock(procurement, id, item, { stock: 'out_of_stock' }, req);
  await wf.recordDecision(admin, id, item, { decision: 'refund' }, req);
  await wf.reviewRefund(accounts, id, item, { approve: true }, req);

  const { money } = await companyOverview(admin);
  expect(money.awaitingApproval).toEqual({ n: 1, amount: 1000, pending: 0 });
  expect(money.toPay).toEqual({ n: 3, amount: 750, pending: 1, onHold: 1 });
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
  await wf.undoStock(procurement, id, itemIds(order)[0], reqAs(procurement));
  await flush();
  const { feed, people } = await companyOverview(admin);
  expect(feed.slice(0, 2).map((f) => f.text)).toEqual(['Undid a stock decision', 'Marked an item in stock']);
  expect(feed[0]).toMatchObject({ who: 'Priya', team: 'Procurement', area: 'Procurement', link: `/admin/orders/${id}` });
  expect(people.find((p) => p.name === 'Priya').actionsThisWeek).toBe(2);
});

it('describes payment and staff actions too', () => {
  expect(describeAction({ resource: 'PaymentRequest', action: 'CREATE', details: { kind: 'supplier', amount: 38000 } }).text).toBe('Raised a supplier payment (₹38,000)');
  expect(describeAction({ resource: 'PaymentRequest', action: 'UPDATE', details: { change: 'paid' } }).text).toBe('Paid a payment');
  expect(describeAction({ resource: 'BankTransfer', action: 'UPDATE', details: { change: 'withdrawn' } }).text).toBe('Withdrew a bank transfer');
  expect(describeAction({ resource: 'Order', action: 'UPDATE', details: { change: 'team_dispatch_edited' } }).text).toBe('Corrected dispatch details');
  expect(describeAction({ resource: 'User', action: 'UPDATE', details: { change: 'staff_password_reset' } }).text).toBe('Changed a staff password');
  expect(describeAction({ resource: 'Order', action: 'CREATE', details: { via: 'sales_panel', totalAmount: 9000 } }).text).toBe('Created a sales order (₹9,000)');
});

describe('a past day (?date=YYYY-MM-DD, IST)', () => {
  // A fixed "now": 11 Nov 2026, noon in India.
  const NOW = Date.parse('2026-11-11T12:00:00+05:30');
  const at = (iso) => new Date(iso);
  const backdate = (Model, id, createdAt) => Model.collection.updateOne({ _id: id }, { $set: { createdAt } });

  it('is a 400 for a future, unreal or malformed date — never a quiet fallback to today', async () => {
    for (const date of ['2026-11-12', '2027-01-01', '2026-02-30', '2026-13-01', '5-11-2026', 'today', '2026-11-05T00:00', ['2026-11-05']]) {
      await expect(companyOverview(admin, NOW, { date })).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(companyOverview(admin, NOW, { date: '2023-12-31' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('checks the admin before the date', async () => {
    await expect(companyOverview(procurement, NOW, { date: '2026-11-05' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(companyOverview(procurement, NOW, { date: '2099-01-01' })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('treats today\'s date, or none, as the live view', () => {
    expect(overviewDay(undefined, NOW)).toMatchObject({ date: '2026-11-11', isToday: true });
    expect(overviewDay('2026-11-11', NOW)).toMatchObject({ date: '2026-11-11', isToday: true });
    // 00:10 IST on the 12th is still the 11th in UTC — the day follows India, not the server.
    expect(overviewDay(undefined, Date.parse('2026-11-12T00:10:00+05:30')).date).toBe('2026-11-12');
    expect(overviewDay('2026-11-05', NOW)).toMatchObject({
      isToday: false, dayStart: at('2026-11-05T00:00:00+05:30'), until: at('2026-11-06T00:00:00+05:30'),
    });
  });

  it('counts only that IST day — 00:00 and 23:59:59.999 in, the minute either side out', async () => {
    const times = {
      before: '2026-11-04T23:59:59.999+05:30',
      first: '2026-11-05T00:00:00.000+05:30',
      last: '2026-11-05T23:59:59.999+05:30',
      after: '2026-11-06T00:00:00.000+05:30',
    };
    for (const [k, iso] of Object.entries(times)) {
      const o = await paidOrder(1, k === 'first' ? seller._id : null);
      await backdate(Order, o._id, at(iso));
      const c = await Consultation.create({ name: k, whatsapp: '9000000000', email: `${k}@x.test`, city: 'Kochi', makeModel: 'Swift' });
      await backdate(Consultation, c._id, at(iso));
      await AuditLog.create({ user: procurement._id, action: 'UPDATE', resource: 'Order', resourceId: String(o._id), details: { change: 'team_stock', stock: 'in_stock' }, createdAt: at(iso) });
    }
    await flush();
    // Real-time audit rows from paidOrder() land "now" (after NOW's day); keep only ours.
    await AuditLog.deleteMany({ createdAt: { $gt: at('2026-11-07T00:00:00+05:30') } });

    const o = await companyOverview(admin, NOW, { date: '2026-11-05' });
    expect(o.day).toMatchObject({ date: '2026-11-05', isToday: false, monthFrom: '2026-11-01' });
    expect(o.today).toMatchObject({ paidOrders: 2, gtmOrders: 1, websiteOrders: 1, paidValue: 2000, consultationsReceived: 2 });
    expect(o.feed).toHaveLength(2);
    expect(o.feed.every((f) => f.at >= at(times.first) && f.at <= at(times.last))).toBe(true);
    const proc = o.teams.find((t) => t.team === 'procurement');
    // That day: 2. The 7 days to the end of 5 Nov: 'before' too ('after' is outside).
    expect(proc).toMatchObject({ actionsOnDay: 2, actionsThisWeek: 3, online: null });
    expect(o.people.find((p) => p.name === 'Priya')).toMatchObject({ actionsOnDay: 2, actionsThisWeek: 3, online: null });
    expect(o.overdue).toEqual([]);
  });

  it('totals "paid this month" from the 1st of the chosen day\'s month up to that day', async () => {
    const paid = (iso, amount, extra = {}) => payReq({ amount, status: 'paid', team: 'procurement', payment: { method: 'bank', reference: `U${++n}`, paidAt: at(iso) }, ...extra });
    await paid('2026-10-15T10:00:00+05:30', 100);
    await paid('2026-10-31T23:59:59.999+05:30', 200);
    await paid('2026-11-01T00:00:00.000+05:30', 400);
    await paid('2026-11-05T12:00:00+05:30', 800);
    await paid('2026-11-06T09:00:00+05:30', 1600); // after the chosen day
    await paid('2026-11-05T13:00:00+05:30', 0, { category: 'import_purchase', currency: 'THB', foreignAmount: 500 });
    await paid('2026-11-07T13:00:00+05:30', 0, { category: 'import_purchase', currency: 'THB', foreignAmount: 9 });

    const nov5 = await companyOverview(admin, NOW, { date: '2026-11-05' });
    expect(nov5.money.paidThisMonth).toMatchObject({ amount: 1200, byTeam: [{ team: 'procurement', amount: 1200 }] });
    expect(nov5.money.paidThisMonth.foreign).toEqual([{ currency: 'THB', amount: 500 }]);

    const oct31 = await companyOverview(admin, NOW, { date: '2026-10-31' });
    expect(oct31.day.monthFrom).toBe('2026-10-01');
    expect(oct31.money.paidThisMonth.amount).toBe(300);
    expect(oct31.money.paidThisMonth.foreign).toEqual([]);

    const nov1 = await companyOverview(admin, NOW, { date: '2026-11-01' });
    expect(nov1.money.paidThisMonth.amount).toBe(400);
  });

  it('keeps today\'s view as it was: open-ended, live presence and the overdue list', async () => {
    const stale = await paidOrder();
    await Order.updateOne({ _id: stale._id }, { $set: { 'workflow.enteredAt': new Date(Date.now() - 30 * H) } });
    const o = await companyOverview(admin);
    expect(o.day.isToday).toBe(true);
    expect(o.today.paidOrders).toBe(1);
    expect(o.teams.every((t) => typeof t.online === 'number')).toBe(true);
    expect(o.overdue.length).toBe(1);
    // A past day of the same data: the overdue list is live-only.
    const yesterday = new Date(Date.now() - 24 * H + 5.5 * H).toISOString().slice(0, 10);
    expect((await companyOverview(admin, Date.now(), { date: yesterday })).overdue).toEqual([]);
  });
});
