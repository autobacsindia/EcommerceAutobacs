/**
 * Team chat follows the order workflow: every handoff is posted in the space of
 * the team that owns the next step, addressed to the person who must act.
 *
 * Driven through the REAL workflow service (teamWorkflowService) against an
 * in-memory Mongo. The queue is captured, and each captured job is then run
 * through postBusinessUpdate exactly as the notification worker does — so these
 * tests prove the whole chain: workflow action → queued job → the right space.
 *
 * What must hold:
 *   - each event lands in the space of the team that acts next, and nowhere else
 *   - #company never receives an automatic post
 *   - out-of-stock / supplier / refund-sent-back / delivered @-mention the
 *     order's seller; a website order (no seller) mentions the sales heads
 *   - a retried job posts once; a genuinely repeated event posts again
 *   - a mention never reaches someone who cannot see the space, and system
 *     posts never email anyone
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const enqueued = [];
const mockQueue = {
  add: (name, data) => { enqueued.push({ name, data, id: String(enqueued.length + 1) }); return Promise.resolve({}); },
};
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

const stored = new Map();
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async () => true,
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { default: emailHandler } = await import('../services/emailHandler.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: razorpayService } = await import('../services/razorpayService.js');
const wf = await import('../services/teamWorkflowService.js');
const { postBusinessUpdate, UPDATE_SPACES, WORKFLOW_CHAT_JOB } = await import('../services/chatBusinessUpdates.js');

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1)]);
const photo = () => ({ buffer: JPEG, mimetype: 'image/jpeg', originalname: 'proof.jpg' });

let n = 0;
async function person(team, { isHead = false, name, active = true } = {}) {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active },
  });
}
const admin = (name = 'Owner') => User.create({ name, email: `admin${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });

async function paidOrder({ salesUser = null } = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    source: salesUser ? 'offline' : 'web',
    salesUser,
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 2 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 7000, totalAmount: 7000,
    status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(`could not pay test order: ${res?.message}`);
  return Order.findById(order._id).lean();
}
const ids = (o) => o.items.map((i) => String(i._id));

/** Run every captured job through the chat poster, as the worker does after its handler. */
async function drainToChat() {
  const jobs = enqueued.splice(0);
  for (const job of jobs) await postBusinessUpdate(job.name, job.data, { jobId: job.id });
  return jobs;
}

/** Every system post, as { space, text, mentions } — oldest first. */
async function posts() {
  const channels = await ChatChannel.find({}).lean();
  const keyOf = new Map(channels.map((c) => [String(c._id), c.key]));
  const msgs = await ChatMessage.find({ kind: 'system' }).sort({ createdAt: 1, seq: 1 }).lean();
  return msgs.map((m) => ({ space: keyOf.get(String(m.channel)), text: m.text, mentions: (m.mentions || []).map(String) }));
}
const inSpace = async (space) => (await posts()).filter((p) => p.space === space);

let procurement, salesHead, seller, accounts, operations, owner;
beforeEach(async () => {
  enqueued.length = 0;
  stored.clear();
  procurement = await person('procurement');
  salesHead = await person('sales', { isHead: true, name: 'Sana' });
  seller = await person('sales', { name: 'Sam' });
  accounts = await person('accounts', { isHead: true });
  operations = await person('operations');
  owner = await admin('Owner');
});
afterEach(() => { jest.restoreAllMocks(); });

describe('each handoff goes to the team that acts next', () => {
  it('paid → #procurement, naming the seller', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    await postBusinessUpdate('send-staff-sales-paid-alert', { orderId: String(order._id) });

    const [post] = await posts();
    expect(post.space).toBe('team:procurement');
    expect(post.text).toMatch(/Paid order #.*sold by Sam.*Procurement: please check stock/);
    expect(await inSpace('team:operations')).toHaveLength(0);
  });

  it('a website order says so', async () => {
    const order = await paidOrder();
    await postBusinessUpdate('send-staff-sales-paid-alert', { orderId: String(order._id) });
    expect((await posts())[0].text).toMatch(/website order/);
  });

  it('out of stock → #sales, @-mentioning the seller (not procurement, who cannot ask the customer)', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    await wf.setStock(procurement, String(order._id), ids(order)[0], { stock: 'out_of_stock' }, req);
    await drainToChat();

    const [post] = await posts();
    expect(post.space).toBe('team:sales');
    expect(post.text).toMatch(/Out of stock on #.* — Seat cover\. @Sam: ask Ravi whether they will wait or want a refund/);
    expect(post.mentions).toEqual([String(seller._id)]);
    expect(await inSpace('team:procurement')).toHaveLength(0);
  });

  it('a website order has no seller, so the sales heads are mentioned', async () => {
    const order = await paidOrder();
    await wf.setStock(procurement, String(order._id), ids(order)[0], { stock: 'out_of_stock' }, req);
    await drainToChat();
    const [post] = await posts();
    expect(post.text).toMatch(/@Sana:/);
    expect(post.mentions).toEqual([String(salesHead._id)]);
  });

  it('a seller who has left falls back to the sales heads', async () => {
    const gone = await person('sales', { name: 'Gone', active: false });
    const order = await paidOrder({ salesUser: gone._id });
    await wf.setStock(procurement, String(order._id), ids(order)[0], { stock: 'out_of_stock' }, req);
    await drainToChat();
    expect((await posts())[0].mentions).toEqual([String(salesHead._id)]);
  });

  it('ordered from a supplier → #sales, so the seller can tell the customer', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    await wf.setStock(procurement, String(order._id), ids(order)[0], { stock: 'ordered', supplierName: 'ARB India' }, req);
    const jobs = await drainToChat();

    expect(jobs.map((j) => j.name)).toContain(WORKFLOW_CHAT_JOB);
    const [post] = await posts();
    expect(post.space).toBe('team:sales');
    expect(post.text).toMatch(/Seat cover ordered from ARB India by procurement \d+\. @Sam: let Ravi know/);
  });

  it('customer will wait → #procurement; wants a refund → #accounts', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    const [cover, mat] = ids(order);
    await wf.setStock(procurement, String(order._id), cover, { stock: 'out_of_stock' }, req);
    await wf.setStock(procurement, String(order._id), mat, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(seller, String(order._id), cover, { decision: 'wait' }, req);
    await wf.recordDecision(seller, String(order._id), mat, { decision: 'refund' }, req);
    await drainToChat();

    expect((await inSpace('team:procurement')).map((p) => p.text).join('\n'))
      .toMatch(/Ravi will wait for Seat cover .*recorded by Sam.*Procurement: please source it/);
    expect((await inSpace('team:accounts')).map((p) => p.text).join('\n'))
      .toMatch(/Refund requested on #.* — Floor mat .*Accounts: please approve or send it back/);
  });

  it('refund sent back → #sales with the reason; approved and sent → #sales so the seller tells the customer', async () => {
    jest.spyOn(razorpayService, 'refundPayment').mockResolvedValue({ refundId: 'rfnd_1', status: 'pending' });
    const order = await paidOrder({ salesUser: seller._id });
    const [cover, mat] = ids(order);
    const id = String(order._id);
    const payment = await Payment.create({
      order: order._id, user: order.user, amount: 7000, gatewayPaymentId: `pay_${id}`,
      paymentGateway: 'razorpay', paymentMethod: 'upi', status: 'completed',
    });
    await Order.updateOne({ _id: order._id }, { $set: { payment: payment._id } });
    for (const item of [cover, mat]) {
      await wf.setStock(procurement, id, item, { stock: 'out_of_stock' }, req);
      await wf.recordDecision(seller, id, item, { decision: 'refund' }, req);
    }
    await wf.reviewRefund(accounts, id, cover, { approve: false, note: 'Customer already took store credit' }, req);
    await wf.reviewRefund(accounts, id, mat, { approve: true }, req);
    await drainToChat();

    const back = (await inSpace('team:sales')).find((p) => /sent back/.test(p.text));
    expect(back.text).toMatch(/sent back the refund on #.* — Seat cover: “Customer already took store credit”\. @Sam: please follow up/);
    expect(back.mentions).toEqual([String(seller._id)]);

    const sent = (await inSpace('team:sales')).find((p) => /Refund sent/.test(p.text));
    expect(sent.text).toMatch(/Refund sent on #.* — Floor mat by accounts \d+ \(₹2000 — .*\)\. @Sam: let Ravi know/);
    expect(sent.mentions).toEqual([String(seller._id)]);
    // No admin step any more: nothing asks an admin to pay it.
    expect((await posts()).some((p) => /please pay it/.test(p.text))).toBe(false);
  });

  it('an approved refund that could not be sent → #accounts, asking accounts to retry', async () => {
    const order = await paidOrder({ salesUser: seller._id }); // no Razorpay capture on file
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(procurement, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(seller, id, cover, { decision: 'refund' }, req);
    await wf.reviewRefund(accounts, id, cover, { approve: true }, req);
    await drainToChat();

    const failed = (await inSpace('team:accounts')).find((p) => /could not be sent/.test(p.text));
    expect(failed.text).toMatch(/Seat cover was approved by accounts \d+ but could not be sent: “No Razorpay payment id.*”\. Accounts: please retry/);
  });

  it('shipped → #operations with courier and tracking; delivered → #sales', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    const id = String(order._id);
    for (const item of ids(order)) await wf.setStock(procurement, id, item, { stock: 'in_stock' }, req);
    await wf.shipWithProof(procurement, id, { courierName: 'DTDC', trackingNumber: 'D123' }, photo(), req);
    await wf.markDelivered(operations, id, {}, req);
    await drainToChat();

    const [shipped] = await inSpace('team:operations');
    expect(shipped.text).toMatch(/Shipped #.*DTDC · D123\. Operations: please follow it to delivery/);
    const delivered = (await inSpace('team:sales')).find((p) => /Delivered/.test(p.text));
    expect(delivered.text).toMatch(/Delivered #.* — Ravi \(confirmed by operations \d+\)\. @Sam:/);
  });

  it('refund failed at the gateway → #accounts, addressed to the admins', async () => {
    const order = await paidOrder();
    await postBusinessUpdate('send-admin-refund-failed-alert', { orderId: String(order._id) }, { jobId: '9' });
    const [post] = await posts();
    expect(post.space).toBe('team:accounts');
    expect(post.text).toMatch(/Refund FAILED .*Accounts \(or @Owner\): please retry/);
  });

  it('a cancelled order → #procurement, but only if the teams were working it', async () => {
    const order = await paidOrder();
    const unpaid = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ product: new mongoose.Types.ObjectId(), name: 'X', price: 1, quantity: 1 }],
      shippingAddress: { fullName: 'A', phone: '9876543210', addressLine1: '1', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 1, totalAmount: 1, status: 'awaiting_payment', paymentStatus: 'pending',
    });
    await postBusinessUpdate('send-admin-order-cancelled-alert', { orderId: String(order._id) });
    await postBusinessUpdate('send-admin-order-cancelled-alert', { orderId: String(unpaid._id) });

    const all = await posts();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ space: 'team:procurement' });
    expect(all[0].text).toMatch(/was cancelled .*Procurement: stop any supplier order/);
  });
});

describe('one thread per order per space', () => {
  it('an order\'s #sales updates are one thread: out of stock starts it, the rest reply', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    const id = String(order._id);
    const [cover, mat] = ids(order);
    await wf.setStock(procurement, id, cover, { stock: 'out_of_stock' }, req);
    await wf.setStock(procurement, id, mat, { stock: 'ordered', supplierName: 'ARB' }, req);
    await drainToChat();

    const salesChannel = await ChatChannel.findOne({ key: 'team:sales' }).lean();
    const all = await ChatMessage.find({ channel: salesChannel._id }).sort({ seq: 1 }).lean();
    expect(all).toHaveLength(2);
    expect(all[0].threadRoot).toBeNull();
    expect(String(all[0].threadOrder)).toBe(id);
    expect(String(all[1].threadRoot)).toBe(String(all[0]._id));
    const root = await ChatMessage.findById(all[0]._id).lean();
    expect(root.replyCount).toBe(1);
    expect(root.lastReplyPreview).toMatch(/ordered from ARB/);
  });
});

describe('#company stays for people', () => {
  it('no automatic update may target it', () => {
    expect(UPDATE_SPACES).not.toContain('company');
    expect(UPDATE_SPACES.every((s) => s.startsWith('team:'))).toBe(true);
  });

  it('a full order journey posts nothing in #company', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    const id = String(order._id);
    await postBusinessUpdate('send-staff-sales-paid-alert', { orderId: id });
    await wf.setStock(procurement, id, ids(order)[0], { stock: 'out_of_stock' }, req);
    await wf.recordDecision(seller, id, ids(order)[0], { decision: 'wait' }, req);
    await drainToChat();
    expect(await inSpace('company')).toHaveLength(0);
    expect((await posts()).length).toBeGreaterThanOrEqual(3);
  });
});

describe('idempotency', () => {
  it('a retried job posts once', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    await wf.setStock(procurement, String(order._id), ids(order)[0], { stock: 'out_of_stock' }, req);
    const [job] = enqueued.splice(0);
    await postBusinessUpdate(job.name, job.data, { jobId: job.id });
    await postBusinessUpdate(job.name, job.data, { jobId: job.id });
    expect(await posts()).toHaveLength(1);
  });

  it('the same item going out of stock a second time is a second post', async () => {
    const order = await paidOrder({ salesUser: seller._id });
    const id = String(order._id);
    const [cover] = ids(order);
    await wf.setStock(procurement, id, cover, { stock: 'out_of_stock' }, req);
    await wf.recordDecision(seller, id, cover, { decision: 'wait' }, req);
    await wf.setStock(procurement, id, cover, { stock: 'out_of_stock' }, req);
    await drainToChat();
    expect((await inSpace('team:sales')).filter((p) => /Out of stock/.test(p.text))).toHaveLength(2);
  });

  it('a paid order posts once however often its alert job runs', async () => {
    const order = await paidOrder();
    await postBusinessUpdate('send-staff-sales-paid-alert', { orderId: String(order._id) }, { jobId: '1' });
    await postBusinessUpdate('send-staff-sales-paid-alert', { orderId: String(order._id) }, { jobId: '2' });
    expect(await posts()).toHaveLength(1);
  });
});

describe('mentions are safe', () => {
  it('system posts never email the people they mention', async () => {
    const send = jest.spyOn(emailHandler, 'sendEmail');
    const order = await paidOrder({ salesUser: seller._id });
    await wf.setStock(procurement, String(order._id), ids(order)[0], { stock: 'out_of_stock' }, req);
    await drainToChat();
    await new Promise((r) => setTimeout(r, 20));
    expect(send).not.toHaveBeenCalled();
  });

  it('a mention never reaches someone outside the space', async () => {
    const { postSystemMessage } = await import('../services/chatService.js');
    const msg = await postSystemMessage('team:sales', 'test', {
      key: 'mention-filter', mentions: [String(seller._id), String(procurement._id), String(owner._id)],
    });
    expect(msg.mentions.sort()).toEqual([String(seller._id), String(owner._id)].sort());
  });

  it('a missing order or unknown workflow event is a no-op', async () => {
    await expect(postBusinessUpdate(WORKFLOW_CHAT_JOB, { event: 'ordered', orderId: '0'.repeat(24) })).resolves.toBeNull();
    await expect(postBusinessUpdate(WORKFLOW_CHAT_JOB, { event: 'nope', orderId: '0'.repeat(24) })).resolves.toBeNull();
    expect(await posts()).toHaveLength(0);
  });
});
