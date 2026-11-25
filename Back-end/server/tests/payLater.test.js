/**
 * "Ship before payment" — REAL database and transactions. Only Razorpay's HTTP
 * calls are doubles; no real link, SMS or payment is ever made.
 *
 * The invariants:
 *   - only the admin turns it on, with a reason, only on an unpaid single-payment
 *     sales order, with NO amount limit (owner removed it 2026-11-25), and never
 *     for a customer with an overdue unpaid order
 *   - turning it on never marks the order paid; it sends the order to the teams
 *   - only a paid order or an approved pay-later order can be shipped
 *   - dispatch sends ONE payment link, and the due date runs from dispatch
 *   - only the verified webhook (or accounts confirming a transfer) marks it paid;
 *     the same webhook twice → one Payment; the shipped status is left alone
 *   - a payment the webhook missed is recovered by the sweep, through the same routine
 *   - overdue chasing happens once per IST day, in working hours only
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
delete process.env.REDIS_URL;

const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ folder, basename, buffer }) => ({ publicId: `${folder}/${basename}`, provider: 'r2', bytes: buffer.length, url: '' }),
  deletePrivateAsset: async () => true,
  readPrivateAsset: async () => Buffer.alloc(1),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: BankTransfer } = await import('../models/BankTransfer.js');
const { default: Counter } = await import('../models/Counter.js');
const { default: razorpayService } = await import('../services/razorpayService.js');
const { default: shipmentService } = await import('../services/shipmentService.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const svc = await import('../services/payLaterService.js');
const bank = await import('../services/bankTransferService.js');
const { summaryFor } = await import('../services/notificationService.js');
const { listSalesOrders } = await import('../services/salesOrderService.js');
const util = await import('../utils/payLater.js');
const { PAY_LATER, isPayLaterDue } = await import('../config/payLater.js');

jest.setTimeout(60000);

const ADDRESS = { fullName: 'Ravi', phone: '9820917286', addressLine1: '1 St', city: 'Pune', state: 'MH', postalCode: '411001', country: 'India' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const proof = [{ buffer: JPEG, originalname: 'a.jpg', mimetype: 'image/jpeg', size: JPEG.length }];
const req = { user: {}, headers: {}, ip: '127.0.0.1', get: () => '' };
const DAY = 24 * 60 * 60 * 1000;
// 12:00 IST on a fixed day: inside chase hours.
const NOON_IST = new Date('2026-11-24T06:30:00.000Z');

let n = 0;
const staff = (name, team, extra = {}) => { n += 1; return User.create({ name, email: `${name}${n}@x.test`, passwordHash: 'x', phone: '9876543210', role: 'staff', staff: { team, isHead: false, active: true, ...extra } }); };
let seller; let head; let accounts; let admin; let customer;
let links;

async function unpaidOrder(over = {}) {
  return Order.create({
    user: customer._id, salesUser: seller._id, source: 'offline',
    items: [{ custom: true, name: 'Seat covers', quantity: 1, price: over.totalAmount ?? 8000 }],
    subtotal: over.totalAmount ?? 8000, totalAmount: 8000, shippingAddress: ADDRESS,
    status: 'awaiting_payment', paymentStatus: 'pending',
    paymentLinkId: `plink_old_${new mongoose.Types.ObjectId()}`, paymentLinkUrl: 'https://rzp.io/i/old',
    paymentLinkExpiresAt: new Date(Date.now() + DAY), paymentLinkAttempts: 1,
    ...over,
  });
}
const approve = (o, by = admin, reason = 'Regular dealer, pays after tracking') => svc.approvePayLater(by, String(o._id), { reason }, req);
// Ships, then waits for the after-dispatch step the shipment starts in the background.
const ship = async (o) => {
  const r = await shipmentService.createShipment(String(o._id), { trackingNumber: `AWB${++n}`, carrier: { name: 'Delhivery', code: 'delhivery' } }, { userId: admin._id });
  await svc.whenIdle();
  return r;
};
const capture = (amount = 8000, over = {}) => ({ id: `pay_${new mongoose.Types.ObjectId()}`, amount: Math.round(amount * 100), currency: 'INR', method: 'upi', status: 'captured', notes: {}, ...over });
const webhook = async (orderId, payment) => {
  const o = await Order.findById(orderId).lean();
  return razorpayService.handlePaymentLinkPaid({
    payment_link: { entity: { id: o.paymentLinkId, notes: { orderId: String(orderId) } } },
    payment: { entity: payment },
  });
};
/** Approved, shipped, link sent — the normal "waiting for the customer" state. */
async function shippedUnpaid(over = {}) {
  const o = await unpaidOrder(over);
  await approve(o);
  const s = await ship(o);
  expect(s.success).toBe(true);
  return Order.findById(o._id);
}
const expectFail = async (p, status, msg) => {
  await expect(p).rejects.toMatchObject({ statusCode: status, ...(msg ? { message: expect.stringMatching(msg) } : {}) });
};

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  await Promise.all([Payment.syncIndexes(), BankTransfer.syncIndexes(), Order.syncIndexes()]);
});
beforeEach(async () => {
  links = [];
  jest.spyOn(razorpayService, 'createPaymentLink').mockImplementation(async (_o, _c, opts) => {
    const link = { id: `plink_${new mongoose.Types.ObjectId()}`, shortUrl: 'https://rzp.io/i/new', opts };
    links.push(link);
    return link;
  });
  jest.spyOn(razorpayService, 'cancelPaymentLink').mockResolvedValue({ status: 'cancelled' });
  jest.spyOn(razorpayService, 'fetchPaymentLinkCaptures').mockResolvedValue({ status: 'created', payments: [] });
  jest.spyOn(razorpayService, 'notifyPaymentLink').mockResolvedValue({ sent: true });
  jest.spyOn(razorpayService, '_afterOrderPaid').mockImplementation(() => {});
  [seller, head, accounts] = await Promise.all([
    staff('seller', 'sales', { gtmRole: 'lead' }), staff('head', 'sales', { isHead: true }), staff('acc', 'accounts'),
  ]);
  admin = await User.create({ name: 'Admin', email: `a${Date.now()}${n}@x.test`, passwordHash: 'x', role: 'admin' });
  customer = await User.create({ name: 'Ravi', email: `c${Date.now()}${n}@x.test`, passwordHash: 'x' });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([Order, Payment, User, BankTransfer, Counter].map((m) => m.deleteMany({})));
});

// ── Pure rules ─────────────────────────────────────────────────────────────────

describe('rules', () => {
  it('days and labels', () => {
    expect(util.istDayKey(new Date('2026-11-24T19:00:00Z'))).toBe('2026-11-25'); // 00:30 IST next day
    expect(util.dueAtFor(new Date('2026-11-24T00:00:00Z')).toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(util.overdueDays(new Date(Date.now() - 1000))).toBe(1);
    expect(util.overdueDays(new Date(Date.now() + DAY))).toBe(0);
    expect(svc.inChaseHours(NOON_IST)).toBe(true);
    expect(svc.inChaseHours(new Date('2026-11-24T20:30:00Z'))).toBe(false); // 02:00 IST
    const base = { payLater: { approvedAt: new Date() }, paymentStatus: 'pending', status: 'processing' };
    expect(util.payLaterLabel(base)).toMatch(/not sent yet/);
    expect(util.payLaterLabel({ ...base, status: 'shipped', payLater: { ...base.payLater, dispatchedAt: new Date(), dueAt: new Date(Date.now() + DAY) } })).toBe('Shipped – payment due');
    expect(util.payLaterLabel({ ...base, status: 'shipped', payLater: { ...base.payLater, dispatchedAt: new Date(), dueAt: new Date(Date.now() - 1) } })).toBe('Shipped – payment overdue');
    expect(util.payLaterLabel({ ...base, paymentStatus: 'paid' })).toBe('Paid after dispatch');
    expect(util.shapePayLater({ status: 'processing' })).toBeNull();
  });

  it('dispatch date comes from the earliest sent parcel', () => {
    const at = util.dispatchedAtOf({ shipments: [
      { status: 'packed', createdAt: new Date('2026-01-01') },
      { status: 'shipped', shippedAt: new Date('2026-01-05') },
      { status: 'delivered', shippedAt: new Date('2026-01-03') },
    ] });
    expect(at.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    expect(util.dispatchedAtOf({ status: 'processing', shipments: [] })).toBeNull();
  });
});

// ── Turning it on ──────────────────────────────────────────────────────────────

describe('approve', () => {
  it('admin turns it on: the order goes to the teams, still NOT paid, old link cancelled', async () => {
    const o = await unpaidOrder();
    const oldLink = o.paymentLinkId;
    const r = await approve(o);
    expect(r.alreadyApproved).toBe(false);
    const saved = await Order.findById(o._id).lean();
    expect(saved.status).toBe('processing');
    expect(saved.paymentStatus).toBe('pending');
    expect(saved.paidAt).toBeUndefined();
    expect(saved.payment).toBeFalsy();
    expect(saved.workflow.enteredAt).toBeInstanceOf(Date);
    expect(saved.payLater).toMatchObject({ approvedByName: 'Admin', reason: 'Regular dealer, pays after tracking' });
    expect(saved.paymentLinkId).toBeUndefined();
    expect(razorpayService.cancelPaymentLink).toHaveBeenCalledWith(oldLink);
    expect(saved.statusHistory.at(-1)).toMatchObject({ status: 'processing', reason: 'pay_later_approved' });
    expect(await Payment.countDocuments()).toBe(0);
    expect(r.order.payLater.label).toMatch(/not sent yet/);
  });

  it('a second click changes nothing', async () => {
    const o = await unpaidOrder();
    await approve(o);
    const again = await approve(o);
    expect(again.alreadyApproved).toBe(true);
    const saved = await Order.findById(o._id).lean();
    expect(saved.statusHistory.filter((h) => h.reason === 'pay_later_approved')).toHaveLength(1);
  });

  it('only the admin', async () => {
    const o = await unpaidOrder();
    for (const who of [accounts, head, seller]) await expectFail(approve(o, who), 403);
    expect((await Order.findById(o._id).lean()).status).toBe('awaiting_payment');
  });

  it('needs a reason', async () => {
    await expectFail(approve(await unpaidOrder(), admin, ' '), 400);
  });

  it('refuses: website order, paid order, paid in parts, bank transfer waiting, cancelled', async () => {
    await expectFail(approve(await unpaidOrder({ salesUser: undefined })), 409, /sales panel/);
    await expectFail(approve(await unpaidOrder({ status: 'processing', paymentStatus: 'paid' })), 409, /already paid/);
    await expectFail(approve(await unpaidOrder({ paymentParts: [{ ref: 1, index: 1, of: 2, amount: 4000, linkId: 'plink_p', linkUrl: 'https://rzp.io/i/p', expiresAt: new Date(Date.now() + DAY), status: 'pending', createdAt: new Date() }] })), 409, /in parts/);
    await expectFail(approve(await unpaidOrder({ bankTransferPendingAt: new Date() })), 409, /bank transfer/);
    await expectFail(approve(await unpaidOrder({ status: 'cancelled' })), 409);
    expect(razorpayService.cancelPaymentLink).not.toHaveBeenCalled();
  });

  it('no amount limit: a ₹70,250 order is approved (regression, owner 2026-11-25)', async () => {
    const big = await unpaidOrder({ totalAmount: 70250 });
    expect(await svc.payLaterOptionFor(admin, String(big._id))).toMatchObject({ canApprove: true });
    await expect(approve(big)).resolves.toMatchObject({ alreadyApproved: false });
    expect(await Order.findById(big._id).lean()).toMatchObject({ status: 'processing', paymentStatus: 'pending' });
  });

  it('several large orders for the same customer are all approved while none is overdue', async () => {
    const orders = [];
    for (const amount of [70250, 90000, 150000]) orders.push(await unpaidOrder({ totalAmount: amount }));
    for (const o of orders) await expect(approve(o)).resolves.toMatchObject({ alreadyApproved: false });
    const approved = await Order.find({ user: customer._id, 'payLater.approvedAt': { $type: 'date' } }).lean();
    expect(approved).toHaveLength(3);
    expect(approved.every((o) => o.paymentStatus === 'pending')).toBe(true);
    const list = await svc.listPayLater(admin, { view: 'due' });
    expect(list.summary).toMatchObject({ owed: 310250, count: 3 });
    expect(list.summary).not.toHaveProperty('limit');
  });

  it('two approvals at the same moment both succeed, each once', async () => {
    const [a, b] = await Promise.all([unpaidOrder({ totalAmount: 60000 }), unpaidOrder({ totalAmount: 60000 })]);
    const results = await Promise.all([approve(a), approve(b)]);
    expect(results.every((r) => r.alreadyApproved === false)).toBe(true);
    for (const o of [a, b]) {
      const saved = await Order.findById(o._id).lean();
      expect(saved.statusHistory.filter((h) => h.reason === 'pay_later_approved')).toHaveLength(1);
    }
  });

  it('a customer with an overdue unpaid order is blocked', async () => {
    const late = await shippedUnpaid();
    await Order.updateOne({ _id: late._id }, { $set: { 'payLater.dueAt': new Date(Date.now() - 1000) } });
    await expectFail(approve(await unpaidOrder()), 409, /overdue/);
    // Once they pay, they are fine again.
    await Order.updateOne({ _id: late._id }, { $set: { paymentStatus: 'paid' } });
    await expect(approve(await unpaidOrder())).resolves.toBeTruthy();
  });

  it('if Razorpay will not cancel the old link (customer may have just paid), nothing changes', async () => {
    razorpayService.cancelPaymentLink.mockRejectedValue(new Error('already paid'));
    jest.spyOn(razorpayService, 'fetchPaymentLinkStatus').mockResolvedValue({ status: 'paid' });
    const o = await unpaidOrder();
    await expectFail(approve(o), 409);
    const saved = await Order.findById(o._id).lean();
    expect(saved.status).toBe('awaiting_payment');
    expect(saved.payLater).toBeUndefined();
  });

  it('the customer paid the old link just before: the approval loses, the payment stands', async () => {
    const o = await unpaidOrder();
    await webhook(o._id, capture());
    await expectFail(approve(o), 409, /already paid/);
    const saved = await Order.findById(o._id).lean();
    expect(saved.paymentStatus).toBe('paid');
    expect(saved.payLater).toBeUndefined();
  });

  it('the option endpoint says why not', async () => {
    expect(await svc.payLaterOptionFor(admin, String((await unpaidOrder())._id))).toMatchObject({ canApprove: true });
    expect(await svc.payLaterOptionFor(admin, String((await unpaidOrder({ salesUser: undefined }))._id))).toMatchObject({ canApprove: false, why: expect.stringMatching(/sales panel/) });
    await expectFail(svc.payLaterOptionFor(accounts, String((await unpaidOrder())._id)), 403);
  });

  it('an unpaid order still cannot be moved on by hand (no regression)', async () => {
    const o = await unpaidOrder();
    const r = await orderStatusService.updateOrderStatus(String(o._id), 'processing', { userId: admin._id, isAdmin: true });
    expect(r.success).toBe(false);
    expect((await Order.findById(o._id).lean()).status).toBe('awaiting_payment');
  });
});

// ── Shipping and the link ──────────────────────────────────────────────────────

describe('dispatch', () => {
  it('an unpaid order without approval cannot ship', async () => {
    const o = await unpaidOrder({ status: 'processing' }); // forced: processing but not paid
    const r = await ship(o);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not been paid/);
  });

  it('first parcel: due date set and ONE 7-day link sent; again / second parcel sends no more', async () => {
    const o = await unpaidOrder({ items: [{ custom: true, name: 'A', quantity: 1, price: 4000 }, { custom: true, name: 'B', quantity: 1, price: 4000 }] });
    await approve(o);
    const fresh = await Order.findById(o._id);
    const r = await shipmentService.createShipment(String(o._id), { lines: [{ itemId: String(fresh.items[0]._id), quantity: 1 }], trackingNumber: 'AWB-A' }, { userId: admin._id });
    expect(r.success).toBe(true);
    // The shipment's own background call and two more at once: still one link.
    await Promise.all([svc.afterDispatch(String(o._id)), svc.afterDispatch(String(o._id))]);
    await svc.whenIdle();
    let saved = await Order.findById(o._id).lean();
    expect(links).toHaveLength(1);
    expect(links[0].opts).toMatchObject({ attempt: 2, ttlSeconds: PAY_LATER.LINK_TTL_DAYS * 86400 });
    expect(saved.paymentLinkId).toBe(links[0].id);
    expect(saved.payLater.linkSentAt).toBeInstanceOf(Date);
    expect(saved.payLater.dueAt.getTime() - saved.payLater.dispatchedAt.getTime()).toBe(PAY_LATER.DUE_DAYS * DAY);
    expect(saved.paymentStatus).toBe('pending');

    await shipmentService.createShipment(String(o._id), { lines: [{ itemId: String(fresh.items[1]._id), quantity: 1 }], trackingNumber: 'AWB-B' }, { userId: admin._id });
    await svc.whenIdle();
    saved = await Order.findById(o._id).lean();
    expect(links).toHaveLength(1);
    expect(saved.status).toBe('shipped');
  });

  it('Razorpay down when sending: claim released, the sweep sends it later', async () => {
    const o = await unpaidOrder();
    await approve(o);
    razorpayService.createPaymentLink.mockRejectedValueOnce(new Error('Razorpay 503'));
    await ship(o);
    expect(links).toHaveLength(0);
    let saved = await Order.findById(o._id).lean();
    expect(saved.payLater.linkClaimedAt).toBeUndefined();
    expect(saved.payLater.dispatchedAt).toBeInstanceOf(Date);
    await svc.sweepPayLater({ now: new Date() });
    saved = await Order.findById(o._id).lean();
    expect(saved.payLater.linkSentAt).toBeInstanceOf(Date);
    expect(links).toHaveLength(1);
  });

  it('paid while the link was being made: the new link is cancelled, not saved', async () => {
    const o = await unpaidOrder();
    await approve(o);
    razorpayService.createPaymentLink.mockImplementationOnce(async () => {
      await Order.updateOne({ _id: o._id }, { $set: { paymentStatus: 'paid' } }); // e.g. a transfer confirmed
      return { id: 'plink_race', shortUrl: 'x' };
    });
    await ship(o);
    expect(razorpayService.cancelPaymentLink).toHaveBeenCalledWith('plink_race');
    expect((await Order.findById(o._id).lean()).paymentLinkId).not.toBe('plink_race');
  });

  it('part of the order was cancelled: no link for the old total, flagged for the admin', async () => {
    const p = await unpaidOrder();
    await approve(p);
    await Order.collection.updateOne({ _id: p._id }, { $set: { cancellations: [{ _id: new mongoose.Types.ObjectId() }] } });
    await ship(p);
    expect(await svc.afterDispatch(String(p._id))).toMatchObject({ sent: false });
    const saved = await Order.findById(p._id).lean();
    expect(saved.payLater.linkBlocked).toBe('part_cancelled');
    expect(saved.paymentLinkId).toBeUndefined();
  });
});

// ── Getting paid ───────────────────────────────────────────────────────────────

describe('payment', () => {
  it('verified webhook marks it paid; status stays shipped; same webhook twice → one Payment', async () => {
    const o = await shippedUnpaid();
    const pay = capture();
    await webhook(o._id, pay);
    await webhook(o._id, pay);
    const saved = await Order.findById(o._id).lean();
    expect(saved.paymentStatus).toBe('paid');
    expect(saved.status).toBe('shipped');
    expect(saved.paidAt).toBeInstanceOf(Date);
    expect(saved.paymentVerification).toMatchObject({ source: 'razorpay', reference: pay.id });
    expect(await Payment.countDocuments({ order: o._id })).toBe(1);
    expect(razorpayService._afterOrderPaid).toHaveBeenCalledTimes(1);
    expect(razorpayService._afterOrderPaid).toHaveBeenCalledWith(String(o._id), { paidLater: true });
    expect(isPayLaterDue(saved)).toBe(false);
  });

  it('two deliveries of the same webhook at once → one Payment', async () => {
    const o = await shippedUnpaid();
    const pay = capture();
    await Promise.allSettled([webhook(o._id, pay), webhook(o._id, pay)]);
    expect(await Payment.countDocuments({ order: o._id })).toBe(1);
    expect((await Order.findById(o._id).lean()).paymentStatus).toBe('paid');
  });

  it('a wrong amount is refused and the order stays unpaid', async () => {
    const o = await shippedUnpaid();
    await expect(webhook(o._id, capture(100))).rejects.toThrow(/Amount mismatch/);
    expect((await Order.findById(o._id).lean()).paymentStatus).toBe('pending');
  });

  it('missed webhook: the sweep finds the capture and records it once', async () => {
    const o = await shippedUnpaid();
    await Order.updateOne({ _id: o._id }, { $set: { 'payLater.linkSentAt': new Date(Date.now() - 60 * 60 * 1000) } });
    const pay = capture();
    razorpayService.fetchPaymentLinkCaptures.mockResolvedValue({ status: 'paid', payments: [pay] });
    const s1 = await svc.sweepPayLater({ now: new Date() });
    expect(s1.recovered).toBe(1);
    expect((await Order.findById(o._id).lean()).paymentStatus).toBe('paid');
    await webhook(o._id, pay); // the late webhook arrives after all
    expect(await Payment.countDocuments({ order: o._id })).toBe(1);
  });

  it('bank transfer: GTM records it, accounts confirms → paid, still shipped', async () => {
    const o = await shippedUnpaid();
    const t = await bank.recordBankTransfer(seller, String(o._id), { amount: 8000, reference: 'UTR998877665', paidOn: new Date().toISOString().slice(0, 10) }, proof, req);
    expect((await Order.findById(o._id).lean()).bankTransferPendingAt).toBeInstanceOf(Date);
    await bank.confirmBankTransfer(accounts, t.id, req);
    const saved = await Order.findById(o._id).lean();
    expect(saved.paymentStatus).toBe('paid');
    expect(saved.status).toBe('shipped');
    expect(saved.paymentVerification).toMatchObject({ source: 'bank_transfer', reference: 'UTR998877665' });
    expect(saved.paidAt).toBeInstanceOf(Date);
    expect(razorpayService._afterOrderPaid).toHaveBeenCalledWith(String(o._id), { paidLater: true });
    // A second click is a no-op.
    await bank.confirmBankTransfer(accounts, t.id, req);
    expect(razorpayService._afterOrderPaid).toHaveBeenCalledTimes(1);
  });

  it('a transfer for the wrong amount is refused', async () => {
    const o = await shippedUnpaid();
    await expectFail(bank.recordBankTransfer(seller, String(o._id), { amount: 7000, reference: 'UTR111', paidOn: new Date().toISOString().slice(0, 10) }, proof, req), 400);
  });
});

// ── Chasing ────────────────────────────────────────────────────────────────────

describe('overdue', () => {
  const makeOverdue = async () => {
    const o = await shippedUnpaid();
    await Order.updateOne({ _id: o._id }, { $set: { 'payLater.dueAt': new Date(NOON_IST.getTime() - DAY), 'payLater.linkSentAt': new Date(NOON_IST.getTime() - 4 * DAY), paymentLinkExpiresAt: new Date(NOON_IST.getTime() + DAY) } });
    return o;
  };

  it('reminds once per IST day, and only in working hours', async () => {
    const o = await makeOverdue();
    const night = new Date('2026-11-24T20:30:00Z'); // 02:00 IST on the 25th
    expect((await svc.sweepPayLater({ now: night })).overdue).toBe(0);
    const s1 = await svc.sweepPayLater({ now: NOON_IST });
    const s2 = await svc.sweepPayLater({ now: new Date(NOON_IST.getTime() + 60 * 60 * 1000) });
    expect(s1).toMatchObject({ overdue: 1, reminded: 1 });
    expect(s2).toMatchObject({ overdue: 0, reminded: 0 });
    expect(razorpayService.notifyPaymentLink).toHaveBeenCalledWith(expect.any(String), 'sms');
    const next = await svc.sweepPayLater({ now: new Date(NOON_IST.getTime() + DAY) });
    expect(next.overdue).toBe(1);
    expect((await Order.findById(o._id).lean()).payLater.chaseCount).toBe(2);
  });

  it('an expired link is replaced with a new one', async () => {
    const o = await makeOverdue();
    await Order.updateOne({ _id: o._id }, { $set: { paymentLinkExpiresAt: new Date(NOON_IST.getTime() - 1000) } });
    const before = links.length;
    const s = await svc.sweepPayLater({ now: NOON_IST });
    expect(s.linksSent).toBe(1);
    expect(links.length).toBe(before + 1);
    const saved = await Order.findById(o._id).lean();
    expect(saved.paymentLinkId).toBe(links.at(-1).id);
    expect(saved.paymentLinkAttempts).toBe(3);
  });

  it('shipped from the status menu (no afterDispatch call): the sweep starts the clock and sends the link', async () => {
    const o = await unpaidOrder();
    await approve(o);
    await ship(o);
    await Order.updateOne({ _id: o._id }, { $unset: { 'payLater.dispatchedAt': '', 'payLater.dueAt': '', 'payLater.linkSentAt': '', paymentLinkId: '', paymentLinkUrl: '', paymentLinkExpiresAt: '' } });
    const s = await svc.sweepPayLater({ now: new Date() });
    expect(s.dispatched).toBe(1);
    expect(s.linksSent).toBe(1);
  });

  it('bell, list and sales row', async () => {
    await makeOverdue();
    const other = await User.create({ name: 'Meera', email: `m${Date.now()}@x.test`, passwordHash: 'x' });
    await shippedUnpaid({ totalAmount: 5000, user: other._id });
    expect(await svc.countOverdue(NOON_IST)).toBe(1);
    const bell = await summaryFor(accounts);
    expect(bell.items.find((i) => i.key === 'pay_later_overdue')).toMatchObject({ count: 1, href: '/team/pay-later' });

    const list = await svc.listPayLater(accounts, { view: 'due' });
    expect(list.orders).toHaveLength(2);
    expect(list.summary).toMatchObject({ owed: 13000, count: 2 });
    expect(list.summary).not.toHaveProperty('limit');
    await expectFail(svc.listPayLater(seller, {}), 403);

    const mine = await listSalesOrders(seller, {});
    const row = mine.orders.find((r) => r.payLater?.label === 'Shipped – payment due');
    expect(row.paymentLinkUrl).toBe('https://rzp.io/i/new');
    expect(row.linkState).toBe('active');
  });

  it('list pages with a cursor, newest approval first', async () => {
    for (let i = 0; i < 27; i += 1) {
      await Order.create({
        user: customer._id, salesUser: seller._id, items: [{ custom: true, name: 'x', quantity: 1, price: 100 }], subtotal: 100, totalAmount: 100,
        shippingAddress: ADDRESS, status: 'processing', paymentStatus: 'pending',
        payLater: { approvedAt: new Date(Date.now() - i * 1000), approvedByName: 'Admin' },
      });
    }
    const p1 = await svc.listPayLater(admin, { view: 'due' });
    const p2 = await svc.listPayLater(admin, { view: 'due', cursor: p1.nextCursor });
    expect(p1.orders).toHaveLength(25);
    expect(p2.orders).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.orders, ...p2.orders].map((o) => o.id)).size).toBe(27);
  });
});
