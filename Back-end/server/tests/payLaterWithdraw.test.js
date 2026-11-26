/**
 * Taking "Ship before payment" back (owner 2026-11-26) — real in-memory Mongo.
 *
 * What must hold:
 *   - admin and accounts only, with a reason
 *   - only while unpaid and nothing has been sent; the order waits for payment again
 *     (the shipping gate isPayLaterDue is false), the team workflow is kept
 *   - the old permission is kept in the status history; the order page shows it
 *   - a second click changes nothing; a parcel or payment landing meanwhile → 409
 *   - it can be let ship before payment again afterwards (a new approval)
 *   - teams + admin are emailed
 */
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
const enqueueNotification = jest.fn();
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification,
  closeQueues: () => Promise.resolve(),
}));
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async () => ({ id: `plink_${Date.now()}`, shortUrl: 'https://rzp.io/i/x' }),
    cancelPaymentLink: async (id) => ({ id, status: 'cancelled' }),
    fetchPaymentLinkStatus: async () => ({ status: 'created' }),
  },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const quotes = await import('../services/salesQuotationService.js');
const salesType = await import('../services/salesTypeService.js');
const payLater = await import('../services/payLaterService.js');
const util = await import('../utils/salesType.js');
const { isPayLaterDue } = await import('../config/payLater.js');

jest.setTimeout(60000);

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const GSTIN = '27AAPFU0939F1ZV';
let n = 0;
const makeStaff = (team, { isHead = false, name, role = 'staff', gtmRole } = {}) => {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `plw-${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role, ...(role === 'staff' && { staff: { team, isHead, active: true, ...(gtmRole && { gtmRole }) } }),
  });
};
const makeProduct = () => {
  n += 1;
  return Product.create({ name: `Dash cam ${n}`, slug: `dash-plw${n}`, sku: `SKUPLW-${n}`, description: 'x'.repeat(30), price: 5000, stock: 'in', isActive: true });
};
const CUSTOMER = { name: 'Rohit Shah', email: 'rohit.plw@example.com', phone: '9820917286' };
const ADDRESS = { addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' };
const COMPANY = { legalName: 'ABC Motors Pvt Ltd', gstin: GSTIN, billingAddress: { addressLine1: 'Suman Heights', city: 'Navi Mumbai', postalCode: '400706' } };
const B2B_BUYER = { type: 'enterprise', ...COMPANY };
const input = (items, extra = {}) => ({ customer: CUSTOMER, shippingAddress: ADDRESS, items, ...extra });

let rep; let accounts; let admin; let head; let product;
beforeEach(async () => {
  enqueueNotification.mockClear();
  rep = await makeStaff('sales', { name: 'Asha', gtmRole: 'lead' });
  head = await makeStaff('sales', { isHead: true });
  accounts = await makeStaff('accounts', { name: 'Meera' });
  admin = await makeStaff(null, { role: 'admin', name: 'Owner' });
  product = await makeProduct();
});
afterEach(async () => {
  await Promise.all([Order, SalesQuotation, User, Product].map((m) => m.deleteMany({})));
});

const line = (over = {}) => ({ product: String(product._id), quantity: 1, ...over });
async function acceptedOrder(extra) {
  const q = await quotes.createQuotation(rep, input([line()], extra), req);
  const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
  return String(orderId);
}
async function approvedB2B() {
  const id = await acceptedOrder({ buyer: B2B_BUYER });
  await salesType.approveSalesType(accounts, id, { note: 'GSTIN checked' }, req);
  return id;
}
const change = (actor, id, body) => salesType.changeSalesType(actor, id, body, req);
const load = (id) => Order.findById(id).lean();
const expectFail = (p, status, msg) => expect(p).rejects.toMatchObject({ statusCode: status, ...(msg && { message: expect.stringMatching(msg) }) });
const alerts = () => enqueueNotification.mock.calls.filter(([job]) => job === 'send-staff-sales-type-changed-alert');


async function payLaterOrder() {
  const id = await approvedB2B();
  await payLater.approvePayLater(accounts, id, { reason: 'Regular dealer' }, req);
  enqueueNotification.mockClear();
  return id;
}
const withdraw = (actor, id, reason = 'Customer agreed to pay first') => payLater.withdrawPayLater(actor, id, { reason }, req);
const withdrawAlerts = () => enqueueNotification.mock.calls.filter(([job]) => job === 'send-staff-pay-later-withdrawn-alert');

describe('take back ship before payment', () => {
  it('accounts takes it back with a reason; it waits for payment; history kept; teams told', async () => {
    const id = await payLaterOrder();
    expect(await payLater.payLaterOptionFor(accounts, id)).toMatchObject({ canWithdraw: true });
    await expectFail(withdraw(accounts, id, ' '), 400, /Write why/);

    const r = await withdraw(accounts, id);
    expect(r).toMatchObject({ alreadyOff: false, withdrawn: { notes: 'Ship before payment taken back by Meera: Customer agreed to pay first' } });
    const saved = await load(id);
    expect(saved).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending' });
    expect(saved.payLater).toBeUndefined();
    expect(isPayLaterDue(saved)).toBe(false);
    expect(saved.workflow?.enteredAt).toBeInstanceOf(Date);
    expect(saved.statusHistory.at(-1)).toMatchObject({
      status: 'awaiting_payment', reason: 'pay_later_withdrawn',
      metadata: { payLater: { approvedByName: 'Meera', reason: 'Regular dealer' } },
    });
    expect(withdrawAlerts()).toEqual([['send-staff-pay-later-withdrawn-alert', { orderId: id }]]);

    // The order page says what happened, and it may be turned on again.
    const opt = await payLater.payLaterOptionFor(admin, id);
    expect(opt).toMatchObject({ canApprove: true, withdrawn: { notes: expect.stringMatching(/taken back by Meera/) } });
    await payLater.approvePayLater(admin, id, { reason: 'Paid deposit, ok again' }, req);
    expect((await load(id))).toMatchObject({ status: 'processing', payLater: { reason: 'Paid deposit, ok again' } });
  });

  it('second click: nothing more happens', async () => {
    const id = await payLaterOrder();
    await withdraw(admin, id);
    const again = await withdraw(admin, id);
    expect(again.alreadyOff).toBe(true);
    expect((await load(id)).statusHistory.filter((h) => h.reason === 'pay_later_withdrawn')).toHaveLength(1);
    expect(withdrawAlerts()).toHaveLength(1);
  });

  it('seller and GTM head cannot', async () => {
    const id = await payLaterOrder();
    await expectFail(withdraw(rep, id), 403);
    await expectFail(withdraw(head, id), 403);
    expect((await load(id)).payLater).toBeDefined();
  });

  it('refused once a parcel has left, or once paid', async () => {
    const id = await payLaterOrder();
    await Order.updateOne({ _id: id }, { $set: { status: 'shipped', 'payLater.dispatchedAt': new Date() } });
    expect((await payLater.payLaterOptionFor(accounts, id)).canWithdraw).toBe(false);
    await expectFail(withdraw(accounts, id), 409, /already been sent/);
    await Order.updateOne({ _id: id }, { $set: { status: 'processing', paymentStatus: 'paid' }, $unset: { 'payLater.dispatchedAt': '' } });
    await expectFail(withdraw(accounts, id), 409, /already paid/);
    expect((await load(id)).payLater).toBeDefined();
  });

  it('a parcel sent between reading and writing → 409, nothing changed', async () => {
    const id = await payLaterOrder();
    const stale = await load(id);
    await Order.updateOne({ _id: id }, { $push: { shipments: { status: 'shipped', items: [] } } }, { strict: false });
    const spy = jest.spyOn(Order, 'findById').mockReturnValueOnce({ select: () => ({ lean: async () => stale }) });
    try {
      await expectFail(withdraw(accounts, id), 409, /paid or sent just now/);
    } finally {
      spy.mockRestore();
    }
    expect((await load(id)).payLater).toBeDefined();
    expect(withdrawAlerts()).toHaveLength(0);
  });

  it('the accounts list says who may take it back', async () => {
    await payLaterOrder();
    expect((await payLater.listPayLater(accounts, { view: 'due' })).canWithdraw).toBe(true);
    expect((await payLater.listPayLater(head, { view: 'due' })).canWithdraw).toBe(false);
  });
});
