/**
 * Extra charges on an already-paid order — REAL database and transactions. Only
 * Razorpay's HTTP calls and private storage are doubles.
 *
 * The invariants:
 *   - the Order is never rewritten (total, paid date, list date, invoice, status)
 *   - the server computes original + paid extras; unpaid ones add nothing
 *   - same webhook twice, or concurrently → one Payment, one paid extra
 *   - a wrong amount from Razorpay is refused
 *   - a refund goes against the extra's OWN payment, once
 *   - closing an order puts a paid extra on the refund list and closes unpaid ones
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
const { default: OrderExtraCharge } = await import('../models/OrderExtraCharge.js');
const { default: BankTransfer } = await import('../models/BankTransfer.js');
const { default: razorpayService } = await import('../services/razorpayService.js');
const svc = await import('../services/orderExtraChargeService.js');
const effects = await import('../services/extraChargeEffects.js');
const bank = await import('../services/bankTransferService.js');
const { reconcileSalesLinks } = await import('../services/paymentReconciliationService.js');
const invoice = await import('../services/invoiceService.js');
const { extraTotals, mergeRevenueSeries } = await import('../utils/extraCharge.js');
const { default: repo } = await import('../repositories/orderExtraChargeRepository.js');

jest.setTimeout(40000);

const ADDRESS = { fullName: 'Asha', phone: '9820917286', addressLine1: '1 St', city: 'Kochi', state: 'KL', postalCode: '682001', country: 'India' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const proof = [{ buffer: JPEG, originalname: 'a.jpg', mimetype: 'image/jpeg', size: JPEG.length }];
const req = { user: {}, headers: {}, ip: '127.0.0.1', get: () => '' };
let n = 0;
const staff = (name, team, extra = {}) => { n += 1; return User.create({ name, email: `${name}${n}@x.test`, passwordHash: 'x', phone: '9876543210', role: 'staff', staff: { team, isHead: false, active: true, ...extra } }); };

let seller; let head; let otherSeller; let accounts; let procurement; let marketing; let admin; let customer; let order;
let linkCount = 0;

async function paidOrder(over = {}) {
  return Order.create({
    user: customer._id, salesUser: seller._id, source: 'offline',
    items: [{ custom: true, name: 'Kit', quantity: 1, price: 29000 }],
    subtotal: 29000, totalAmount: 29000, shippingAddress: ADDRESS,
    status: 'processing', paymentStatus: 'paid', invoiceNo: 900000 + Math.floor(Math.random() * 90000), ...over,
  });
}
const key = () => new mongoose.Types.ObjectId().toString();
const ask = (o = order, amount = 5000, by = seller) => svc.requestExtra(by, o._id, { amount, reason: 'Larger screen fitting', customerConfirmed: true, clientKey: key() }, req);
const approved = async (o = order, amount = 5000) => { const e = await ask(o, amount); return svc.approveExtra(accounts, e.id, {}, req); };
const withLink = async (o = order, amount = 5000) => { const e = await approved(o, amount); return svc.sendPaymentLink(seller, e.id, req); };
const capture = (amount = 5000, over = {}) => ({ id: `pay_${new mongoose.Types.ObjectId()}`, amount: Math.round(amount * 100), currency: 'INR', method: 'upi', status: 'captured', notes: {}, ...over });
const linkOf = async (id) => (await OrderExtraCharge.findById(id).lean()).links.at(-1);
const webhook = async (extra, payment) => {
  const link = await linkOf(extra.id);
  return razorpayService.handlePaymentLinkPaid({
    payment_link: { entity: { id: link.id, notes: { orderId: extra.orderId, extraChargeId: extra.id } } },
    payment: { entity: payment },
  });
};
const paidExtra = async (o = order, amount = 5000) => { const e = await withLink(o, amount); await webhook(e, capture(amount)); return OrderExtraCharge.findById(e.id).lean(); };

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  await Promise.all([Payment.syncIndexes(), OrderExtraCharge.syncIndexes(), BankTransfer.syncIndexes()]);
});
beforeEach(async () => {
  linkCount = 0;
  jest.spyOn(razorpayService, 'createPaymentLink').mockImplementation(async () => { linkCount += 1; return { id: `plink_${new mongoose.Types.ObjectId()}`, shortUrl: 'https://rzp.io/i/x' }; });
  jest.spyOn(razorpayService, 'cancelPaymentLink').mockResolvedValue({ status: 'cancelled' });
  jest.spyOn(razorpayService, 'refundPayment').mockResolvedValue({ success: true, refundId: 'rfnd_1', status: 'pending', amount: 500000 });
  jest.spyOn(razorpayService, '_afterOrderPaid').mockImplementation(() => {});
  [seller, head, otherSeller, accounts, procurement, marketing] = await Promise.all([
    staff('seller', 'sales', { gtmRole: 'lead' }), staff('head', 'sales', { isHead: true }), staff('other', 'sales', { gtmRole: 'lead' }),
    staff('acc', 'accounts'), staff('proc', 'procurement'), staff('mkt', 'marketing'),
  ]);
  admin = await User.create({ name: 'Admin', email: `a${Date.now()}@x.test`, passwordHash: 'x', role: 'admin' });
  customer = await User.create({ name: 'Asha', email: `c${Date.now()}@x.test`, passwordHash: 'x', totalSpentPaise: 2900000 });
  order = await paidOrder();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([Order, Payment, User, OrderExtraCharge, BankTransfer].map((m) => m.deleteMany({})));
});

const snapshot = async (id) => {
  const { totalAmount, subtotal, paymentStatus, status, paidAt, listDate, invoiceNo, payment, statusHistory } = await Order.findById(id).lean();
  return { totalAmount, subtotal, paymentStatus, status, paidAt, listDate, invoiceNo, payment, history: statusHistory.length };
};

describe('₹29,000 + ₹5,000, end to end', () => {
  it('request → approve → link → webhook: extra paid, order record untouched', async () => {
    const before = await snapshot(order._id);
    const e = await ask();
    expect(e.status).toBe('awaiting_accounts');
    const a = await svc.approveExtra(accounts, e.id, { note: 'ok' }, req);
    expect(a.status).toBe('approved');
    expect(a.decidedBy).toBe('acc');
    const l = await svc.sendPaymentLink(seller, e.id, req);
    expect(l.statusLabel).toMatch(/waiting for customer/);
    await webhook(e, capture());
    const { extras, totals } = await svc.listForOrder(admin, order._id);
    expect(extras[0].status).toBe('paid');
    expect(totals).toMatchObject({ original: 29000, extrasPaid: 5000, finalAmount: 34000 });
    expect(await snapshot(order._id)).toEqual(before);
    expect((await User.findById(customer._id).lean()).totalSpentPaise).toBe(2900000 + 500000);
    expect(razorpayService._afterOrderPaid).not.toHaveBeenCalled();
  });

  it('several extras on one order are numbered and summed; unpaid ones count for nothing', async () => {
    const one = await paidExtra(order, 5000);
    await paidExtra(order, 1250.5);
    await withLink(order, 700);
    await ask(order, 300);
    const rows = await OrderExtraCharge.find({ order: order._id }).sort({ sequence: 1 }).lean();
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
    expect(extraTotals(order, rows)).toMatchObject({ extrasPaid: 6250.5, extrasWaiting: 700, finalAmount: 35250.5 });
    expect(one.status).toBe('paid');
  });

  it('adds paise exactly (0.1 + 0.2 is not 0.30000000000000004)', () => {
    const t = extraTotals({ totalAmount: 0.1 }, [{ amount: 0.2, status: 'paid' }]);
    expect(t.finalAmount).toBe(0.3);
  });
});

describe('what the server accepts', () => {
  it.each([[0], [-5], ['abc'], [undefined], [NaN], [Infinity], ['12.345'], [100000000]])('refuses amount %p', async (amount) => {
    await expect(svc.requestExtra(seller, order._id, { amount, reason: 'Larger screen', customerConfirmed: true, clientKey: key() }, req)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('requires a reason and the customer confirmation', async () => {
    await expect(svc.requestExtra(seller, order._id, { amount: 5, reason: 'x', customerConfirmed: true, clientKey: key() }, req)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.requestExtra(seller, order._id, { amount: 5, reason: 'Long enough', customerConfirmed: false, clientKey: key() }, req)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('refuses unpaid, cancelled and returned orders', async () => {
    for (const over of [{ paymentStatus: 'pending', status: 'awaiting_payment' }, { status: 'cancelled' }, { status: 'returned' }, { paymentStatus: 'refunded', status: 'delivered' }]) {
      const o = await paidOrder(over);
      await expect(ask(o)).rejects.toMatchObject({ statusCode: 409 });
    }
  });
  it('allows a delivered order', async () => {
    const o = await paidOrder({ status: 'delivered' });
    expect((await ask(o)).status).toBe('awaiting_accounts');
  });
  it('the same form sent twice makes one extra', async () => {
    const clientKey = key();
    const input = { amount: 5000, reason: 'Larger screen', customerConfirmed: true, clientKey };
    const [a, b] = await Promise.all([svc.requestExtra(seller, order._id, input, req), svc.requestExtra(seller, order._id, input, req)]);
    expect(a.id).toBe(b.id);
    expect(await OrderExtraCharge.countDocuments({ order: order._id })).toBe(1);
  });
  it('two different extras at once get different numbers', async () => {
    await Promise.all([ask(order, 100), ask(order, 200), ask(order, 300)]);
    const seqs = (await OrderExtraCharge.find({ order: order._id }).lean()).map((r) => r.sequence).sort();
    expect(seqs).toEqual([1, 2, 3]);
  });
  it('stops at the limit of live extras, not counting cancelled ones', async () => {
    for (let i = 0; i < 10; i += 1) await ask(order, 10 + i);
    await expect(ask(order, 99)).rejects.toMatchObject({ statusCode: 409 });
    const first = await OrderExtraCharge.findOne({ order: order._id }).lean();
    await svc.cancelExtra(seller, first._id, {}, req);
    expect((await ask(order, 99)).status).toBe('awaiting_accounts');
  });
});

describe('who may do what', () => {
  it('only the seller on the order, the GTM head or admin may raise one', async () => {
    await expect(ask(order, 5000, otherSeller)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ask(order, 5000, procurement)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ask(order, 5000, accounts)).rejects.toMatchObject({ statusCode: 403 });
    expect((await ask(order, 100, head)).status).toBe('awaiting_accounts');
    expect((await ask(order, 200, admin)).status).toBe('awaiting_accounts');
  });
  it('only Accounts and the admin decide; GTM head does not', async () => {
    const e = await ask();
    for (const actor of [seller, head, procurement]) await expect(svc.approveExtra(actor, e.id, {}, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.rejectExtra(seller, e.id, { note: 'nope' }, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('an order’s extras are hidden from other sellers and marketing', async () => {
    await ask();
    await expect(svc.listForOrder(otherSeller, order._id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.listForOrder(marketing, order._id)).rejects.toMatchObject({ statusCode: 403 });
    expect((await svc.listForOrder(procurement, order._id)).extras).toHaveLength(1);
  });
  it('procurement sees the extra but not the pay link', async () => {
    await withLink();
    const seen = await svc.listForOrder(procurement, order._id);
    expect(seen.extras[0].payUrl).toBeNull();
    expect((await svc.listForOrder(seller, order._id)).extras[0].payUrl).toBeTruthy();
  });
  it('a seller’s list is only their own', async () => {
    await ask();
    expect((await svc.listExtras(otherSeller, {})).extras).toHaveLength(0);
    expect((await svc.listExtras(seller, {})).extras).toHaveLength(1);
    expect((await svc.listExtras(accounts, {})).extras).toHaveLength(1);
    await expect(svc.listExtras(procurement, {})).rejects.toMatchObject({ statusCode: 403 });
  });
  it('only the admin refunds', async () => {
    const e = await paidExtra();
    for (const actor of [seller, accounts, head]) await expect(svc.refundExtra(actor, e._id, {}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('approving, editing, cancelling', () => {
  it('approve twice is one approval; reject after approve is refused', async () => {
    const e = await ask();
    await Promise.all([svc.approveExtra(accounts, e.id, {}, req), svc.approveExtra(accounts, e.id, {}, req)]);
    const row = await OrderExtraCharge.findById(e.id).lean();
    expect(row.history.filter((h) => h.action === 'approved')).toHaveLength(1);
    await expect(svc.rejectExtra(accounts, e.id, { note: 'changed my mind' }, req)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('reject needs a reason', async () => {
    const e = await ask();
    await expect(svc.rejectExtra(accounts, e.id, {}, req)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('can be edited only until Accounts decides', async () => {
    const e = await ask();
    expect((await svc.editExtra(seller, e.id, { amount: 6000 }, req)).amount).toBe(6000);
    await svc.approveExtra(accounts, e.id, {}, req);
    await expect(svc.editExtra(seller, e.id, { amount: 1 }, req)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('cancelling cancels a live link first; if Razorpay refuses, nothing changes', async () => {
    const e = await withLink();
    razorpayService.cancelPaymentLink.mockRejectedValueOnce(new Error('already paid'));
    await expect(svc.cancelExtra(seller, e.id, {}, req)).rejects.toMatchObject({ statusCode: 409 });
    expect((await OrderExtraCharge.findById(e.id).lean()).status).toBe('approved');
    await svc.cancelExtra(seller, e.id, {}, req);
    const row = await OrderExtraCharge.findById(e.id).lean();
    expect(row.status).toBe('cancelled');
    expect(row.links[0].status).toBe('cancelled');
  });
  it('a paid extra cannot be cancelled', async () => {
    const e = await paidExtra();
    await expect(svc.cancelExtra(seller, e._id, {}, req)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('no link before approval; a double click makes one link', async () => {
    const e = await ask();
    await expect(svc.sendPaymentLink(seller, e.id, req)).rejects.toMatchObject({ statusCode: 409 });
    await svc.approveExtra(accounts, e.id, {}, req);
    await svc.sendPaymentLink(seller, e.id, req);
    await svc.sendPaymentLink(seller, e.id, req);
    expect(linkCount).toBe(1);
  });
  it('after a link expires, a new one can be sent without asking Accounts again', async () => {
    const e = await withLink();
    await OrderExtraCharge.updateOne({ _id: e.id }, { $set: { 'links.0.expiresAt': new Date(Date.now() - 1000) } });
    const again = await svc.sendPaymentLink(seller, e.id, req);
    expect(again.payUrl).toBeTruthy();
    expect(linkCount).toBe(2);
  });
  it('concurrent link requests leave one live link and cancel the loser', async () => {
    const e = await approved();
    await Promise.all([svc.sendPaymentLink(seller, e.id, req).catch(() => {}), svc.sendPaymentLink(seller, e.id, req).catch(() => {})]);
    const row = await OrderExtraCharge.findById(e.id).lean();
    expect(row.links).toHaveLength(1);
    expect(linkCount - row.links.length).toBe(razorpayService.cancelPaymentLink.mock.calls.length);
  });
});

describe('the payment', () => {
  it('the same webhook twice is one payment and one spend increase', async () => {
    const e = await withLink();
    const p = capture();
    await webhook(e, p);
    await webhook(e, p);
    expect(await Payment.countDocuments({ order: order._id })).toBe(1);
    expect((await User.findById(customer._id).lean()).totalSpentPaise).toBe(3400000);
  });
  it('two webhooks at once settle to one payment', async () => {
    const e = await withLink();
    const p = capture();
    await Promise.allSettled([webhook(e, p), webhook(e, p), webhook(e, p)]);
    expect(await Payment.countDocuments({ gatewayPaymentId: p.id })).toBe(1);
    expect((await OrderExtraCharge.findById(e.id).lean()).status).toBe('paid');
    expect((await User.findById(customer._id).lean()).totalSpentPaise).toBe(3400000);
  });
  it('a tampered amount is refused and records nothing', async () => {
    const e = await withLink();
    await expect(webhook(e, capture(1))).rejects.toThrow('Amount mismatch');
    expect((await OrderExtraCharge.findById(e.id).lean()).status).toBe('approved');
    expect(await Payment.countDocuments({})).toBe(0);
  });
  it('another currency is refused', async () => {
    const e = await withLink();
    await expect(webhook(e, capture(5000, { currency: 'USD' }))).rejects.toThrow('Currency mismatch');
  });
  it('rolls back everything if a later write fails', async () => {
    const e = await withLink();
    const { default: userRepository } = await import('../repositories/userRepository.js');
    const spy = jest.spyOn(userRepository, 'incrementSpend').mockRejectedValueOnce(new Error('boom'));
    await expect(webhook(e, capture())).rejects.toThrow('boom');
    expect((await OrderExtraCharge.findById(e.id).lean()).status).toBe('approved');
    expect(await Payment.countDocuments({})).toBe(0);
    spy.mockRestore();
  });
  it('payment.captured ignores an extra charge', async () => {
    const spy = jest.spyOn(razorpayService, 'processPaymentSuccess');
    await razorpayService.handlePaymentCaptured({ payment: { entity: capture(5000, { notes: { orderId: String(order._id), extraChargeId: 'x' } }) } });
    expect(spy).not.toHaveBeenCalled();
  });
  it('paid after it was cancelled: the money is recorded and goes on the refund list', async () => {
    const e = await withLink();
    await svc.cancelExtra(seller, e.id, {}, req);
    await webhook(e, capture());
    const row = await OrderExtraCharge.findById(e.id).lean();
    expect(row.status).toBe('paid');
    expect(row.refund.status).toBe('due');
  });
  it('a missed webhook is recovered by the sweep, through the same routine', async () => {
    const e = await withLink();
    await OrderExtraCharge.updateOne({ _id: e.id }, { $set: { 'links.0.createdAt': new Date(Date.now() - 3600 * 1000 * 3) } });
    const p = capture();
    jest.spyOn(razorpayService, 'fetchPaymentLinkCaptures').mockResolvedValue({ status: 'paid', payments: [p] });
    const r = await reconcileSalesLinks();
    expect(r.recovered).toBe(1);
    await reconcileSalesLinks();
    expect(await Payment.countDocuments({ gatewayPaymentId: p.id })).toBe(1);
  });
  it('the sweep marks a dead link', async () => {
    const e = await withLink();
    await OrderExtraCharge.updateOne({ _id: e.id }, { $set: { 'links.0.createdAt': new Date(Date.now() - 3600 * 1000 * 3) } });
    jest.spyOn(razorpayService, 'fetchPaymentLinkCaptures').mockResolvedValue({ status: 'expired', payments: [] });
    await reconcileSalesLinks();
    expect((await OrderExtraCharge.findById(e.id).lean()).links[0].status).toBe('expired');
  });
});

describe('paid by bank transfer', () => {
  const transfer = (extra, over = {}) => bank.recordExtraChargeTransfer(seller, extra.id, { amount: extra.amount, reference: `UTR${Date.now()}${Math.floor(Math.random() * 1000)}`, paidOn: new Date().toISOString().slice(0, 10), ...over }, proof, req);

  it('Accounts confirms: extra paid; the order is untouched and no order-paid routine runs', async () => {
    const before = await snapshot(order._id);
    const e = await approved();
    const t = await transfer(e);
    expect((await svc.listForOrder(admin, order._id)).extras[0].bankTransferPending).toBe(true);
    await bank.confirmBankTransfer(accounts, t.id, req);
    await bank.confirmBankTransfer(accounts, t.id, req);
    const row = await OrderExtraCharge.findById(e.id).lean();
    expect(row).toMatchObject({ status: 'paid', paidVia: 'bank_transfer' });
    expect(row.bankTransferPendingAt).toBeUndefined();
    expect(await snapshot(order._id)).toEqual(before);
    expect(razorpayService._afterOrderPaid).not.toHaveBeenCalled();
    expect((await User.findById(customer._id).lean()).totalSpentPaise).toBe(3400000);
  });
  it('refuses a wrong amount', async () => {
    const e = await approved();
    await expect(transfer(e, { amount: 4999 })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('rejected: unpaid again, and a new way to pay is open', async () => {
    const e = await approved();
    const t = await transfer(e);
    await bank.rejectBankTransfer(accounts, t.id, { note: 'not in bank' }, req);
    const row = await OrderExtraCharge.findById(e.id).lean();
    expect(row.status).toBe('approved');
    expect(row.bankTransferPendingAt).toBeUndefined();
    expect((await svc.sendPaymentLink(seller, e.id, req)).payUrl).toBeTruthy();
  });
  it('while it waits, the extra cannot be cancelled or get a link', async () => {
    const e = await approved();
    await transfer(e);
    await expect(svc.cancelExtra(seller, e.id, {}, req)).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.sendPaymentLink(seller, e.id, req)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('recording it cancels a live link', async () => {
    const e = await withLink();
    await transfer(e);
    expect(razorpayService.cancelPaymentLink).toHaveBeenCalledTimes(1);
    expect((await OrderExtraCharge.findById(e.id).lean()).links[0].status).toBe('cancelled');
  });
  it('one real UTR pays one thing', async () => {
    const reference = 'UTR778899AA';
    const [a, b] = [await approved(order, 100), await approved(order, 200)];
    await transfer(a, { reference });
    await expect(transfer(b, { reference })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('confirmed after the order closed: paid and on the refund list', async () => {
    const e = await approved();
    const t = await transfer(e);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    await bank.confirmBankTransfer(accounts, t.id, req);
    expect((await OrderExtraCharge.findById(e.id).lean()).refund.status).toBe('due');
  });
});

describe('refunds', () => {
  it('Razorpay refund uses the extra’s OWN payment and only its amount', async () => {
    const e = await paidExtra();
    await svc.refundExtra(admin, e._id, {}, req);
    expect(razorpayService.refundPayment).toHaveBeenCalledWith(e.gatewayPaymentId, 500000, expect.objectContaining({ extraChargeId: String(e._id) }));
    expect((await OrderExtraCharge.findById(e._id).lean()).refund.status).toBe('processing');
  });
  it('refund clicked twice sends one refund', async () => {
    const e = await paidExtra();
    await Promise.allSettled([svc.refundExtra(admin, e._id, {}, req), svc.refundExtra(admin, e._id, {}, req)]);
    expect(razorpayService.refundPayment).toHaveBeenCalledTimes(1);
  });
  it('webhook completes it once; lifetime spend comes back once; replays do nothing', async () => {
    const e = await paidExtra();
    await svc.refundExtra(admin, e._id, {}, req);
    const entity = { id: 'rfnd_1', amount: 500000, notes: { orderId: String(order._id), extraChargeId: String(e._id) } };
    await razorpayService.applyRefundWebhook(entity, 'completed');
    await razorpayService.applyRefundWebhook(entity, 'completed');
    const row = await OrderExtraCharge.findById(e._id).lean();
    expect(row.refund.status).toBe('completed');
    expect((await User.findById(customer._id).lean()).totalSpentPaise).toBe(2900000);
    expect((await Payment.findById(row.payment).lean()).refundAmount).toBe(5000);
    expect(extraTotals(order, [row])).toMatchObject({ extrasPaid: 5000, extrasRefunded: 5000 });
  });
  it('a failed refund can be sent again', async () => {
    const e = await paidExtra();
    razorpayService.refundPayment.mockRejectedValueOnce(new Error('gateway down'));
    await expect(svc.refundExtra(admin, e._id, {}, req)).rejects.toMatchObject({ statusCode: 502 });
    expect((await OrderExtraCharge.findById(e._id).lean()).refund.status).toBe('failed');
    await svc.refundExtra(admin, e._id, {}, req);
    expect(razorpayService.refundPayment).toHaveBeenCalledTimes(2);
  });
  it('a bank-paid extra needs an offline record with a reference', async () => {
    const e = await approved();
    const t = await bank.recordExtraChargeTransfer(seller, e.id, { amount: 5000, reference: 'UTR112233BB', paidOn: new Date().toISOString().slice(0, 10) }, proof, req);
    await bank.confirmBankTransfer(accounts, t.id, req);
    await expect(svc.refundExtra(admin, e.id, {}, req)).rejects.toMatchObject({ statusCode: 422 });
    await expect(svc.refundExtra(admin, e.id, { method: 'offline', offlineMethod: 'bank_transfer', reference: '' }, req)).rejects.toMatchObject({ statusCode: 400 });
    const done = await svc.refundExtra(admin, e.id, { method: 'offline', offlineMethod: 'bank_transfer', reference: 'NEFT998877' }, req);
    expect(done.refund).toMatchObject({ status: 'completed', method: 'offline', reference: 'NEFT998877' });
    expect((await User.findById(customer._id).lean()).totalSpentPaise).toBe(2900000);
  });
  it('whole order cancelled: paid extra is due, unpaid one closed with its link', async () => {
    const paid = await paidExtra(order, 5000);
    const unpaid = await withLink(order, 700);
    const waiting = await ask(order, 300);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    await effects.closeExtrasForOrder(order._id, 'Order cancelled');
    const row = async (id) => OrderExtraCharge.findById(id).lean();
    expect((await row(paid._id)).refund).toMatchObject({ status: 'due', dueReason: 'Order cancelled' });
    expect((await row(unpaid.id)).status).toBe('cancelled');
    expect((await row(waiting.id)).status).toBe('cancelled');
    expect(razorpayService.cancelPaymentLink).toHaveBeenCalledTimes(1);
    const rows = await svc.refundsDue(admin);
    expect(rows.map((r) => r.id)).toEqual([String(paid._id)]);
    await effects.closeExtrasForOrder(order._id, 'Order cancelled');
    expect((await row(paid._id)).history.filter((h) => h.action === 'refund_due')).toHaveLength(1);
  });
  it('the sweep catches an order whose hook failed', async () => {
    const paid = await paidExtra();
    await Order.updateOne({ _id: order._id }, { $set: { status: 'returned' } });
    expect(await effects.sweepExtrasOnClosedOrders()).toBe(1);
    expect((await OrderExtraCharge.findById(paid._id).lean()).refund.status).toBe('due');
  });
  it('the order’s own refund headroom is unaffected', async () => {
    await paidExtra();
    const { remainingRefundable } = await import('../services/refundMathService.js');
    expect(remainingRefundable(await Order.findById(order._id).lean()).capturedRupees).toBe(29000);
  });
});

describe('what the customer sees', () => {
  it('nothing until approved; no staff names; pay link while live', async () => {
    const e = await ask();
    expect((await svc.forCustomer(order)).extras).toEqual([]);
    await svc.approveExtra(accounts, e.id, { note: 'internal note' }, req);
    await svc.sendPaymentLink(seller, e.id, req);
    const { extras: [row] } = await svc.forCustomer(order);
    expect(row).toMatchObject({ amount: 5000, reason: 'Larger screen fitting', statusLabel: 'Waiting for your payment', hasReceipt: false });
    expect(row.payUrl).toBeTruthy();
    expect(JSON.stringify(row)).not.toMatch(/internal note|seller|acc\b/);
  });
  it('rejected and cancelled ones are hidden', async () => {
    const e = await ask();
    await svc.rejectExtra(accounts, e.id, { note: 'nope nope' }, req);
    expect((await svc.forCustomer(order)).extras).toEqual([]);
  });
  it('a receipt only for their own order, once paid', async () => {
    const e = await paidExtra();
    const stranger = await User.create({ name: 'S', email: `s${Date.now()}@x.test`, passwordHash: 'x' });
    await expect(svc.customerReceipt(stranger, order._id, e._id)).rejects.toMatchObject({ statusCode: 404 });
    const { pdf, filename } = await svc.customerReceipt(customer, order._id, e._id);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(filename).toMatch(/pdf$/i);
  });
});

describe('the receipt', () => {
  it('has its own number and its own amount; the same number on every download', async () => {
    const e = await paidExtra();
    const a = await invoice.buildExtraChargeReceipt(e);
    const b = await invoice.buildExtraChargeReceipt(await OrderExtraCharge.findById(e._id).lean());
    expect(a.extra.receiptNo).toBeTruthy();
    expect(b.extra.receiptNo).toBe(a.extra.receiptNo);
    expect((await Order.findById(order._id).lean()).invoiceNo).not.toBe(a.extra.receiptNo);
    const view = invoice.extraChargeReceiptView(a.extra, order);
    expect(view).toMatchObject({ totalAmount: 5000, subtotal: 5000, tax: 762.71, shippingCost: 0 });
    expect(view.items).toHaveLength(1);
  });
  it('is emailed once', async () => {
    const e = await paidExtra();
    const { default: emailHandler } = await import('../services/emailHandler.js');
    const send = jest.spyOn(emailHandler, 'sendExtraChargeReceipt').mockResolvedValue({ success: true });
    await invoice.emailExtraChargeReceipt(e._id);
    await invoice.emailExtraChargeReceipt(e._id);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('a failed send can be retried', async () => {
    const e = await paidExtra();
    const { default: emailHandler } = await import('../services/emailHandler.js');
    const send = jest.spyOn(emailHandler, 'sendExtraChargeReceipt').mockResolvedValueOnce({ success: false, error: 'x' }).mockResolvedValue({ success: true });
    await expect(invoice.emailExtraChargeReceipt(e._id)).rejects.toThrow();
    await invoice.emailExtraChargeReceipt(e._id);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('sales reports', () => {
  it('count on the day paid; refunds and unpaid ones do not count', async () => {
    const e = await paidExtra(order, 5000);
    await withLink(order, 700);
    const day = new Date(Date.now() - 3600000);
    expect(await repo.sumKept(day)).toBe(5000);
    expect(await repo.sumKept(new Date(Date.now() + 3600000))).toBe(0);
    await OrderExtraCharge.updateOne({ _id: e._id }, { $set: { refund: { status: 'due' } } });
    expect(await repo.sumKept(day)).toBe(0);
    await OrderExtraCharge.updateOne({ _id: e._id }, { $set: { refund: { status: 'failed' } } });
    expect(await repo.sumKept(day)).toBe(5000);
  });
  it('merges into a revenue series without adding orders', () => {
    const a = new Date('2026-11-01'); const b = new Date('2026-11-02');
    const out = mergeRevenueSeries([{ bucket: a, revenue: 100, orders: 2, aov: 50 }], [{ _id: a, total: 50 }, { _id: b, total: 25 }]);
    expect(out).toEqual([{ bucket: a, revenue: 150, orders: 2, aov: 75 }, { bucket: b, revenue: 25, orders: 0, aov: 0 }]);
  });
});
