/**
 * Customer progress updates against a real (in-memory) database, through the REAL
 * team workflow and shipment services.
 *
 * What must hold (services/orderProgressService.js):
 *   • each milestone is hooked to the real state change: a stock decision queues
 *     "preparing" (out of stock does not), a packed parcel queues "packed", a packed
 *     parcel with an AWB queues "courier booked", a dispatched parcel queues neither;
 *   • the same message twice — a BullMQ retry or the sweep re-finding it — emails ONCE;
 *   • a provider failure stamps nothing, so the retry can still send;
 *   • a cancelled order gets nothing, even for a message queued before it was cancelled;
 *   • CUSTOMER_PROGRESS_UPDATES=off sends and queues nothing;
 *   • the WhatsApp twin stays silent until its template is named, then sends once;
 *   • the sweep finds what an order is owed straight from the database.
 *
 * Nothing real is sent: the email provider and Meta are fakes, the queue is captured.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const enqueued = [];
const mockQueue = { add: (name, data, opts) => { enqueued.push({ name, data, opts }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  getMediaQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

const sent = [];
let providerFails = false;
jest.unstable_mockModule('../services/emailHandler.js', () => {
  const ok = async () => ({ success: true });
  const sendOrderProgress = async (args) => {
    if (providerFails) return { success: false, error: 'ZeptoMail 503' };
    sent.push({ kind: args.kind, to: args.to, stage: args.stage, shipment: args.shipment?._id ? String(args.shipment._id) : null });
    return { success: true };
  };
  return { default: new Proxy({ sendOrderProgress }, { get: (t, k) => (k in t ? t[k] : ok) }) };
});

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: NotificationLog } = await import('../models/NotificationLog.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { default: shipmentService } = await import('../services/shipmentService.js');
const wf = await import('../services/teamWorkflowService.js');
const { emailOrderProgress, runCustomerProgressSweep, PROGRESS_EMAIL_JOB } = await import('../services/orderProgressService.js');
const { sendOrderWhatsApp } = await import('../services/whatsapp/orderWhatsAppService.js');
const { _resetWhatsAppWarning } = await import('../config/whatsapp.js');

const ENV_KEYS = ['REDIS_URL', 'CUSTOMER_PROGRESS_UPDATES', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_TEMPLATE_ORDER_PREPARING', 'WHATSAPP_TEST_RECIPIENTS', 'FRONTEND_URL'];
const saved = {};
beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.FRONTEND_URL = 'https://shop.example';
  for (const k of ['CUSTOMER_PROGRESS_UPDATES', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TEMPLATE_ORDER_PREPARING', 'WHATSAPP_TEST_RECIPIENTS']) delete process.env[k];
  enqueued.length = 0;
  sent.length = 0;
  providerFails = false;
  _resetWhatsAppWarning();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await Order.deleteMany({});
  await User.deleteMany({});
  await NotificationLog.deleteMany({});
  jest.restoreAllMocks();
});

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const procurement = () => User.create({
  name: `Proc ${++n}`, email: `proc${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x',
  role: 'staff', staff: { team: 'procurement', active: true },
});

/** A paid order, paid the way production pays it — so it enters the team workflow. */
async function paidOrder(over = {}) {
  const customer = await User.create({ name: 'Asha', email: `asha${++n}@example.test`, passwordHash: 'x' });
  const order = await Order.create({
    user: customer._id,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 }],
    shippingAddress: { fullName: 'Asha K', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 5000, totalAmount: 5000,
    status: 'awaiting_payment', paymentStatus: 'pending',
    whatsappOptIn: true, whatsappOptInBy: 'customer', whatsappOptInAt: new Date(),
    ...over,
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', {
    isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' },
  });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}
const progressJobs = () => enqueued.filter((j) => j.name === PROGRESS_EMAIL_JOB).map((j) => j.data);

describe('hooked to real state changes', () => {
  it('a stock decision queues "preparing", delayed so an instant dispatch skips it', async () => {
    const order = await paidOrder();
    const p = await procurement();
    await wf.setStock(p, String(order._id), String(order.items[0]._id), { stock: 'in_stock' }, req);
    const job = enqueued.find((j) => j.name === PROGRESS_EMAIL_JOB);
    expect(job.data).toEqual({ orderId: String(order._id), kind: 'preparing' });
    expect(job.opts).toMatchObject({ jobId: `progress|${order._id}|preparing`, delay: 20 * 60 * 1000 });
  });

  it('out of stock queues nothing for the customer', async () => {
    const order = await paidOrder();
    await wf.setStock(await procurement(), String(order._id), String(order.items[0]._id), { stock: 'out_of_stock' }, req);
    expect(progressJobs()).toEqual([]);
  });

  it('packed with no AWB → "packed"; with an AWB → "courier booked"; dispatched → neither', async () => {
    const a = await paidOrder();
    const r1 = await shipmentService.createShipment(String(a._id), { dispatch: false });
    expect(progressJobs()).toEqual([{ orderId: String(a._id), kind: 'packed', shipmentId: String(r1.shipment._id) }]);

    enqueued.length = 0;
    const b = await paidOrder();
    const r2 = await shipmentService.createShipment(String(b._id), { dispatch: false, trackingNumber: 'AWB77', carrier: { name: 'Delhivery' } });
    expect(progressJobs()).toEqual([{ orderId: String(b._id), kind: 'courier_booked', shipmentId: String(r2.shipment._id) }]);

    enqueued.length = 0;
    const c = await paidOrder();
    await shipmentService.createShipment(String(c._id), { trackingNumber: 'AWB78', carrier: { name: 'Delhivery' } });
    expect(progressJobs()).toEqual([]);
  });

  it('switched off → nothing queued', async () => {
    process.env.CUSTOMER_PROGRESS_UPDATES = 'off';
    const order = await paidOrder();
    await wf.setStock(await procurement(), String(order._id), String(order.items[0]._id), { stock: 'in_stock' }, req);
    await shipmentService.createShipment(String(order._id), { dispatch: false });
    expect(progressJobs()).toEqual([]);
  });
});

describe('emailOrderProgress — once per event', () => {
  async function prepared() {
    const order = await paidOrder();
    await wf.setStock(await procurement(), String(order._id), String(order.items[0]._id), { stock: 'ordered', supplierName: 'Ram Traders' }, req);
    return Order.findById(order._id).lean();
  }

  it('preparing: sent once to the customer; a retry is skipped', async () => {
    const order = await prepared();
    expect(await emailOrderProgress(String(order._id), 'preparing')).toEqual({ status: 'sent' });
    expect(await emailOrderProgress(String(order._id), 'preparing')).toEqual({ status: 'skipped' });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toMatch(/@example\.test$/);
    expect((await Order.findById(order._id).lean()).notifiedStatuses).toContain('preparing');
  });

  it('two more jobs for the same event after it landed (sweep + retry) send nothing', async () => {
    const order = await prepared();
    await emailOrderProgress(String(order._id), 'preparing');
    await Promise.all([emailOrderProgress(String(order._id), 'preparing'), emailOrderProgress(String(order._id), 'preparing')]);
    expect(sent).toHaveLength(1);
  });

  it('a provider failure throws and stamps nothing, so the retry sends', async () => {
    const order = await prepared();
    providerFails = true;
    await expect(emailOrderProgress(String(order._id), 'preparing')).rejects.toThrow(/ZeptoMail 503/);
    expect((await Order.findById(order._id).lean()).notifiedStatuses).not.toContain('preparing');
    providerFails = false;
    expect(await emailOrderProgress(String(order._id), 'preparing')).toEqual({ status: 'sent' });
  });

  it('packed and courier booked: one each per parcel', async () => {
    const order = await paidOrder();
    const { shipment } = await shipmentService.createShipment(String(order._id), { dispatch: false });
    const id = String(shipment._id);
    expect(await emailOrderProgress(String(order._id), 'packed', { shipmentId: id })).toEqual({ status: 'sent' });
    expect(await emailOrderProgress(String(order._id), 'packed', { shipmentId: id })).toEqual({ status: 'skipped' });
    // The AWB arrives later: courier booked, once.
    await Order.updateOne({ _id: order._id, 'shipments._id': shipment._id }, { $set: { 'shipments.$.trackingNumber': 'AWB1', 'shipments.$.carrier': { name: 'DTDC' } } });
    expect(await emailOrderProgress(String(order._id), 'courier_booked', { shipmentId: id })).toEqual({ status: 'sent' });
    expect(await emailOrderProgress(String(order._id), 'courier_booked', { shipmentId: id })).toEqual({ status: 'skipped' });
    expect(sent.map((s) => s.kind)).toEqual(['packed', 'courier_booked']);
  });

  it('still on it: sent once for its step; stale once the order moved on', async () => {
    const order = await prepared();
    expect(await emailOrderProgress(String(order._id), 'still_on_it', { stage: 'placed' })).toEqual({ status: 'stale' });
    expect(await emailOrderProgress(String(order._id), 'still_on_it', { stage: 'preparing' })).toEqual({ status: 'sent' });
    expect(await emailOrderProgress(String(order._id), 'still_on_it', { stage: 'preparing' })).toEqual({ status: 'skipped' });
    expect((await Order.findById(order._id).lean()).notifiedStatuses).toContain('still_on_it:preparing');
  });

  it('a cancelled order gets nothing — even for messages queued before the cancel', async () => {
    const order = await prepared();
    await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    for (const [kind, opts] of [['preparing', {}], ['still_on_it', { stage: 'preparing' }]]) {
      expect(await emailOrderProgress(String(order._id), kind, opts)).toEqual({ status: 'stale' });
    }
    expect(sent).toEqual([]);
  });

  it('switched off → nothing sent, even for a job already queued', async () => {
    const order = await prepared();
    process.env.CUSTOMER_PROGRESS_UPDATES = 'off';
    expect(await emailOrderProgress(String(order._id), 'preparing')).toEqual({ status: 'off' });
    expect(sent).toEqual([]);
  });
});

describe('WhatsApp twin', () => {
  const on = () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
  };

  it('silent until the template is named, then sends once with the order link', async () => {
    on();
    const order = await paidOrder();
    await wf.setStock(await procurement(), String(order._id), String(order.items[0]._id), { stock: 'in_stock' }, req);
    const send = jest.fn(async () => ({ messageId: 'wamid.1' }));

    expect(await sendOrderWhatsApp(String(order._id), 'preparing', {}, { send })).toEqual({ status: 'no-template' });
    expect(send).not.toHaveBeenCalled();
    expect(enqueued.filter((j) => j.name === 'send-order-whatsapp' && j.data.status === 'preparing')).toEqual([]);

    process.env.WHATSAPP_TEMPLATE_ORDER_PREPARING = 'order_preparing_v1';
    expect(await sendOrderWhatsApp(String(order._id), 'preparing', {}, { send })).toMatchObject({ status: 'sent' });
    expect(await sendOrderWhatsApp(String(order._id), 'preparing', {}, { send })).toEqual({ status: 'skipped' });
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0];
    expect(msg.template).toBe('order_preparing_v1');
    expect(msg.params).toEqual(['Asha K', expect.stringMatching(/^AB-/), `https://shop.example/orders/${order._id}`]);
  });

  it('a cancelled order gets no WhatsApp either', async () => {
    on();
    process.env.WHATSAPP_TEMPLATE_ORDER_PREPARING = 'order_preparing_v1';
    const order = await paidOrder();
    await wf.setStock(await procurement(), String(order._id), String(order.items[0]._id), { stock: 'in_stock' }, req);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    const send = jest.fn();
    expect(await sendOrderWhatsApp(String(order._id), 'preparing', {}, { send })).toEqual({ status: 'stale' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the sweep, from the database', () => {
  it('queues what each order is owed, skips cancelled ones, and a second run queues the same deterministic jobs', async () => {
    const owed = await paidOrder();
    await wf.setStock(await procurement(), String(owed._id), String(owed.items[0]._id), { stock: 'in_stock' }, req);
    const cancelled = await paidOrder();
    await Order.updateOne({ _id: cancelled._id }, { $set: { status: 'cancelled' } });

    const calls = [];
    const enqueue = (orderId, kind, opts) => calls.push({ orderId: String(orderId), kind, ...opts });
    const now = new Date(Date.now() + 30 * 60 * 1000); // past the 20-minute "preparing" delay
    const cfg = {
      enabled: true, reassureAfterMin: 1080, reassureMaxAgeMs: 14 * 86400000, preparingDelayMs: 20 * 60000,
      scanWindowMs: 45 * 86400000, pageSize: 1, maxOrders: 100,
      office: { startMinute: 570, endMinute: 1110, days: [1, 2, 3, 4, 5, 6], holidays: new Set() },
    };
    const res = await runCustomerProgressSweep({ now, cfg, enqueue });
    expect(res.scanned).toBe(1); // the cancelled order is not even read
    expect(calls).toEqual([{ orderId: String(owed._id), kind: 'preparing', shipmentId: null, stage: null }]);

    // Once it was sent, the next run owes nothing.
    await emailOrderProgress(String(owed._id), 'preparing');
    calls.length = 0;
    await runCustomerProgressSweep({ now, cfg, enqueue });
    expect(calls).toEqual([]);
  });

  it('the sweep query is served by the { status, createdAt } index, not a collection scan', async () => {
    await Order.syncIndexes();
    const since = new Date(Date.now() - 45 * 86400000);
    const plan = await Order.find({ status: 'processing', createdAt: { $gte: since } })
      .sort({ createdAt: -1, _id: -1 }).limit(100).explain('queryPlanner');
    const text = JSON.stringify(plan.queryPlanner?.winningPlan ?? plan);
    expect(text).toContain('IXSCAN');
    expect(text).not.toContain('COLLSCAN');
    expect(text).toMatch(/status_1_createdAt_-1/);
  });

  it('switched off → the sweep does nothing', async () => {
    const res = await runCustomerProgressSweep({ cfg: { enabled: false } });
    expect(res).toEqual({ scanned: 0, queued: 0 });
  });
});
