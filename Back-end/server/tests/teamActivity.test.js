/**
 * Admin Team activity (services/teamActivityService.js), through the REAL
 * workflow service. Time is moved by back-dating the order's own timestamps.
 *
 * What must hold:
 *   - each step in an order's timeline names who acted and how long the line had
 *     been waiting, on which team — the team that owned the stage, not the actor
 *   - a wait past the stage's limit is marked late
 *   - the waiting board shows every open stage, overdue first, and who it is on
 *     (the seller for a sales decision; sales heads for a website order)
 *   - per-team and per-person numbers count the right person and the late ones
 *   - admins only; nothing is written
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
const ta = await import('../services/teamActivityService.js');
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



const ago = (h) => new Date(Date.now() - h * H);

/** Back-date an order's entry and every history entry by `hours`. */
async function backdate(orderId, hours) {
  const o = await Order.findById(orderId).lean();
  await Order.updateOne({ _id: orderId }, {
    $set: {
      'workflow.enteredAt': new Date(new Date(o.workflow.enteredAt).getTime() - hours * H),
      'workflow.history': o.workflow.history.map((e) => ({ ...e, at: new Date(new Date(e.at).getTime() - hours * H) })),
    },
  });
}

let procurement, seller, salesHead, operations, admin;
beforeEach(async () => {
  procurement = await person('procurement', false, 'Priya');
  seller = await person('sales', false, 'Sam');
  salesHead = await person('sales', true, 'Sana');
  operations = await person('operations', false, 'Omar');
  admin = await User.create({ name: 'Owner', email: `owner${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });
});

describe('order timeline', () => {
  it('lists every step with who acted and how long it waited, on whose team', async () => {
    const order = await paidOrder(1, seller._id);
    const id = String(order._id);
    const [item] = itemIds(order);
    await backdate(id, 40); // paid 40h ago, untouched since
    await wf.setStock(procurement, id, item, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(seller, id, item, { decision: 'wait' }, req);
    await wf.setStock(procurement, id, item, { stock: 'in_stock' }, req);
    await wf.shipWithProof(procurement, id, {}, { buffer: JPEG, mimetype: 'image/jpeg' }, req);
    await wf.markDelivered(operations, id, {}, req);

    const t = await ta.orderTimeline(admin, id);
    expect(t.steps.map((s) => s.action)).toEqual([
      'entered', 'stock_out_of_stock', 'customer_waits', 'stock_in_stock', 'shipped', 'delivered',
    ]);
    const [, oos, waits, , shipped, delivered] = t.steps;
    expect(oos).toMatchObject({ by: 'Priya', byTeam: 'procurement', waited: { team: 'procurement', stage: STAGE.STOCK_CHECK, late: true } });
    expect(oos.waited.ms).toBeGreaterThanOrEqual(40 * H);
    expect(waits).toMatchObject({ by: 'Sam', waited: { team: 'sales', stage: STAGE.CUSTOMER_DECISION, late: false } });
    expect(shipped.waited).toMatchObject({ team: 'procurement', stage: STAGE.TO_SHIP });
    expect(delivered).toMatchObject({ by: 'Omar', waited: { team: 'operations', stage: STAGE.SHIPPED } });
    expect(t.waitingNow).toEqual([]);
  });

  it('is refused to anyone but an admin, and to an order that never entered the workflow', async () => {
    const order = await paidOrder();
    await expect(ta.orderTimeline(salesHead, String(order._id))).rejects.toMatchObject({ statusCode: 403 });
    const legacy = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Old', price: 1, quantity: 1 }],
      shippingAddress: { fullName: 'A', phone: '9876543210', addressLine1: '1', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 1, totalAmount: 1, status: 'processing', paymentStatus: 'paid',
    });
    await expect(ta.orderTimeline(admin, String(legacy._id))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('waiting board', () => {
  it('shows each open stage, overdue first, and who it is waiting on', async () => {
    const stale = await paidOrder();
    await backdate(String(stale._id), 30); // stock check, 30h > 24h
    const sold = await paidOrder(1, seller._id);
    await wf.setStock(procurement, String(sold._id), itemIds(sold)[0], { stock: 'out_of_stock' }, req);
    const web = await paidOrder();
    await wf.setStock(procurement, String(web._id), itemIds(web)[0], { stock: 'out_of_stock' }, req);

    const { rows, teams } = await ta.waitingBoard(admin);
    expect(rows[0]).toMatchObject({ orderId: String(stale._id), team: 'procurement', overdue: true, waitingFor: 'Procurement team' });
    expect(rows[0].waitingHours).toBeGreaterThanOrEqual(30);
    const decisions = rows.filter((r) => r.stage === STAGE.CUSTOMER_DECISION);
    expect(decisions.find((r) => r.orderId === String(sold._id)).waitingFor).toBe('Sam');
    expect(decisions.find((r) => r.orderId === String(web._id)).waitingFor).toMatch(/GTM head/);
    expect(teams).toEqual(expect.arrayContaining([
      { team: 'procurement', waiting: 1, overdue: 1 },
      { team: 'sales', waiting: 2, overdue: 0 },
    ]));
  });

  it('admins only', async () => {
    await expect(ta.waitingBoard(procurement)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('performance', () => {
  it('charges each wait to the team that owned it and credits the person who moved it', async () => {
    const slow = await paidOrder();
    await backdate(String(slow._id), 30);
    await wf.setStock(procurement, String(slow._id), itemIds(slow)[0], { stock: 'in_stock' }, req); // late
    const quick = await paidOrder();
    await wf.setStock(procurement, String(quick._id), itemIds(quick)[0], { stock: 'in_stock' }, req); // on time
    const byAdmin = await paidOrder();
    await wf.setStock(admin, String(byAdmin._id), itemIds(byAdmin)[0], { stock: 'in_stock' }, req);

    const perf = await ta.teamPerformance(admin, { days: 30 });
    expect(perf.orders).toBe(3);
    expect(perf.teams.find((t) => t.team === 'procurement')).toMatchObject({ steps: 3, late: 1, lateShare: 33 });
    expect(perf.people.find((p) => p.name === 'Priya')).toMatchObject({ steps: 2, late: 1 });
    expect(perf.people.find((p) => p.name === 'Admin')).toMatchObject({ steps: 1, late: 0 });
  });

  it('nothing is written by any of these reads', async () => {
    const order = await paidOrder();
    const before = JSON.stringify(await Order.findById(order._id).lean());
    await ta.waitingBoard(admin);
    await ta.orderTimeline(admin, String(order._id));
    await ta.teamPerformance(admin);
    expect(JSON.stringify(await Order.findById(order._id).lean())).toBe(before);
  });
});
