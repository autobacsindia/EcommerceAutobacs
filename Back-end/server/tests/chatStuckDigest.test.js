/**
 * Morning stuck-order digest (services/chatStuckDigest.js), driven through the
 * REAL workflow service against an in-memory Mongo. Time is moved by passing a
 * later `now`, never by faking timers, so the orders' own timestamps are real.
 *
 * What must hold:
 *   - an order is reported to the team that owns its stuck step, only past that
 *     step's threshold
 *   - the clock starts at the last action on the line, not when the order was paid
 *   - one post per team per day, however often the job runs; nothing when nothing
 *     is stuck; never in #company
 *   - finished orders are never reported
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
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const { postStuckDigests, stuckOn, STUCK_AFTER_HOURS } = await import('../services/chatStuckDigest.js');
const { STAGE } = await import('../utils/teamWorkflow.js');

const H = 3600 * 1000;
const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);

let n = 0;
const person = (team, isHead = false) => User.create({
  name: `${team} ${++n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
  passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
});

async function paidOrder(items = 1) {
  const order = await Order.create({
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

async function digests() {
  const channels = await ChatChannel.find({}).lean();
  const keyOf = new Map(channels.map((c) => [String(c._id), c.key]));
  const msgs = await ChatMessage.find({ kind: 'system' }).sort({ createdAt: 1 }).lean();
  return msgs.map((m) => ({ space: keyOf.get(String(m.channel)), text: m.text, refs: m.refs.length }));
}

let procurement, salesHead;
beforeEach(async () => {
  procurement = await person('procurement');
  salesHead = await person('sales', true);
});

describe('who is reminded, and when', () => {
  it('an unchecked order reaches #procurement only after 24 hours', async () => {
    await paidOrder();
    await postStuckDigests(Date.now() + 23 * H);
    expect(await digests()).toHaveLength(0);

    await postStuckDigests(Date.now() + 25 * H);
    const [post] = await digests();
    expect(post.space).toBe('team:procurement');
    expect(post.text).toMatch(/1 order waiting on this team longer than usual/);
    expect(post.text).toMatch(/Needs stock check for over 24h: 1 — #\S+ \(2[45]h\)/);
    expect(post.refs).toBe(1);
  });

  it('out of stock waits on #sales; the clock starts when it went out of stock', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    await wf.setStock(procurement, id, itemIds(order)[0], { stock: 'out_of_stock' }, req);

    await postStuckDigests(Date.now() + 47 * H);
    expect(await digests()).toHaveLength(0);
    await postStuckDigests(Date.now() + 49 * H);
    const [post] = await digests();
    expect(post.space).toBe('team:sales');
    expect(post.text).toMatch(/Out of stock — ask customer for over 48h: 1/);
  });

  it('an order paid days ago but acted on today is not stuck', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    await Order.updateOne({ _id: order._id }, { $set: { 'workflow.enteredAt': new Date(Date.now() - 5 * 24 * H) } });
    await wf.setStock(procurement, id, itemIds(order)[0], { stock: 'out_of_stock' }, req);
    await postStuckDigests(Date.now() + 24 * H); // 6 days since paid, 1 day since out of stock
    expect(await digests()).toHaveLength(0);
  });

  it('a refund waiting for approval reaches #accounts after a day', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    await wf.setStock(procurement, id, itemIds(order)[0], { stock: 'out_of_stock' }, req);
    await wf.recordDecision(salesHead, id, itemIds(order)[0], { decision: 'refund' }, req);
    await postStuckDigests(Date.now() + 25 * H);
    const [post] = await digests();
    expect(post.space).toBe('team:accounts');
    expect(post.text).toMatch(/Refund — waiting for accounts for over 24h: 1/);
  });

  it('a parcel in transit for over a week reaches #operations', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    await wf.setStock(procurement, id, itemIds(order)[0], { stock: 'in_stock' }, req);
    await wf.shipWithProof(procurement, id, {}, { buffer: JPEG, mimetype: 'image/jpeg' }, req);

    await postStuckDigests(Date.now() + 6 * 24 * H);
    expect(await digests()).toHaveLength(0);
    await postStuckDigests(Date.now() + 8 * 24 * H);
    const [post] = await digests();
    expect(post.space).toBe('team:operations');
    expect(post.text).toMatch(/In transit for over 7d: 1 — #\S+ \(8d\)/);
  });

  it('counts orders, not lines: two stuck lines on one order is one order', async () => {
    await paidOrder(2);
    await postStuckDigests(Date.now() + 25 * H);
    const [post] = await digests();
    expect(post.text).toMatch(/— 1 order waiting/);
    expect(post.text).toMatch(/Needs stock check for over 24h: 1 —/);
  });

  it('lists the oldest first, caps the examples and the links', async () => {
    for (let i = 0; i < 7; i += 1) await paidOrder();
    await postStuckDigests(Date.now() + 25 * H);
    const [post] = await digests();
    expect(post.text).toMatch(/7 orders waiting/);
    expect(post.text).toMatch(/: 7 — #\S+ \(\d+h\), #\S+ \(\d+h\), #\S+ \(\d+h\), \+4 more/);
    expect(post.refs).toBe(5);
  });
});

describe('noise control', () => {
  it('posts once per team per day, however often it runs; again the next day', async () => {
    await paidOrder();
    const day1 = Date.UTC(2030, 0, 7, 4, 0); // 09:30 IST, a Monday
    await postStuckDigests(day1);
    await postStuckDigests(day1 + 10 * 60 * 1000);
    expect(await digests()).toHaveLength(1);
    await postStuckDigests(day1 + 24 * H);
    expect(await digests()).toHaveLength(2);
  });

  it('posts nothing at all when nothing is stuck, and never in #company', async () => {
    await paidOrder();
    expect(await postStuckDigests(Date.now() + H)).toEqual({});
    await postStuckDigests(Date.now() + 25 * H);
    expect((await digests()).map((d) => d.space)).not.toContain('company');
  });

  it('a finished order is never reported', async () => {
    const order = await paidOrder();
    await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered', 'workflow.open': false } });
    await postStuckDigests(Date.now() + 30 * 24 * H);
    expect(await digests()).toHaveLength(0);
  });
});

describe('stuckOn (pure)', () => {
  it('has a threshold for every stage a team owns', () => {
    for (const stage of [STAGE.STOCK_CHECK, STAGE.TO_SHIP, STAGE.WITH_SUPPLIER, STAGE.CUSTOMER_DECISION, STAGE.ACCOUNTS_APPROVAL, STAGE.SHIPPED]) {
      expect(STUCK_AFTER_HOURS[stage]).toBeGreaterThan(0);
    }
  });

  it('ignores an order that never entered the workflow', () => {
    expect(stuckOn({ items: [], workflow: null }, Date.now())).toEqual([]);
  });
});
