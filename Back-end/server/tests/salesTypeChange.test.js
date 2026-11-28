/**
 * Changing a GTM order B2B ↔ B2C after accounts' check (owner 2026-11-26) — real
 * in-memory Mongo; Razorpay and the queue are doubles.
 *
 * What must hold (on the SERVER, whatever the browser sends):
 *   - only accounts and the admin can change it, and only with a reason
 *   - every change is kept (who, when, from → to, why, the replaced buyer block);
 *     nothing is overwritten silently; the order view shows it newest first
 *   - a double click records ONE change
 *   - B2C → B2B needs a valid GSTIN, and is refused when the order was sold with a % discount on the total
 *   - no change once the receipt was emailed (invoiceNo), or on a cancelled order
 *   - B2B → B2C with "ship before payment" on:
 *       unpaid, not shipped → taken back (awaiting_payment again, payLater removed)
 *       shipped unpaid      → left running, admin told, order shows a red alert
 *   - the lists follow: b2b_unpaid drops a B2C order; "approved" lists it
 *   - money is never touched
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
    name: name || `${team} ${n}`, email: `stc-${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role, ...(role === 'staff' && { staff: { team, isHead, active: true, ...(gtmRole && { gtmRole }) } }),
  });
};
const makeProduct = () => {
  n += 1;
  return Product.create({ name: `Dash cam ${n}`, slug: `dash-stc${n}`, sku: `SKUSTC-${n}`, description: 'x'.repeat(30), price: 5000, stock: 'in', isActive: true });
};
const CUSTOMER = { name: 'Rohit Shah', email: 'rohit.stc@example.com', phone: '9820917286' };
const ADDRESS = { houseNumber: 'Flat 4B', addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' };
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

describe('the rules (pure)', () => {
  it('pay-later effect of going to B2C', () => {
    const on = { payLater: { approvedAt: new Date() }, paymentStatus: 'pending' };
    expect(util.payLaterEffectOf({ paymentStatus: 'pending' })).toBe('none');
    expect(util.payLaterEffectOf({ ...on, status: 'processing' })).toBe('withdrawn');
    expect(util.payLaterEffectOf({ ...on, status: 'processing', shipments: [{ status: 'packed' }] })).toBe('withdrawn');
    expect(util.payLaterEffectOf({ ...on, status: 'processing', shipments: [{ status: 'shipped' }] })).toBe('kept_shipped_unpaid');
    expect(util.payLaterEffectOf({ ...on, status: 'shipped' })).toBe('kept_shipped_unpaid');
    expect(util.payLaterEffectOf({ ...on, status: 'delivered', paymentStatus: 'paid' })).toBe('none');
  });
  it('why a change is refused', () => {
    const base = { buyerTypeCheck: { status: 'approved' }, status: 'awaiting_payment', items: [] };
    expect(util.typeChangeProblem({ status: 'awaiting_payment' }, 'b2b')).toMatch(/sales panel/);
    expect(util.typeChangeProblem(base, 'b2b')).toBeNull();
    expect(util.typeChangeProblem({ ...base, invoiceNo: 12 }, 'b2b')).toMatch(/receipt has already been emailed/);
    expect(util.typeChangeProblem({ ...base, status: 'cancelled' }, 'b2b')).toMatch(/cancelled/);
    expect(util.typeChangeProblem({ ...base, salesDiscount: { percent: 10 } }, 'b2b')).toMatch(/sold with a discount on the total/);
    // A B2B item price (below list) is not a discount on the total: allowed (owner 2026-11-28).
    expect(util.typeChangeProblem({ ...base, items: [{ price: 4500, listPrice: 5000 }] }, 'b2b')).toBeNull();
    expect(util.typeChangeProblem({ ...base, buyerTypeCheck: { status: 'approved', changeCount: util.TYPE_CHANGE_MAX } }, 'b2b')).toMatch(/too many/);
  });
});

describe('B2B → B2C after approval', () => {
  it('needs a reason; keeps the history; drops the GSTIN; lists follow', async () => {
    const id = await approvedB2B();
    await expectFail(change(accounts, id, { to: 'b2c', reason: ' ' }), 400, /Write why/);
    await expectFail(change(accounts, id, { to: 'x', reason: 'Customer is retail' }), 400);

    const r = await change(accounts, id, { to: 'b2c', reason: 'Customer is not a business' });
    expect(r).toMatchObject({ unchanged: false, payLaterEffect: 'none' });
    expect(r.order.salesType).toMatchObject({ type: 'b2c', company: null, alert: null });
    expect(r.order.salesType.check).toMatchObject({ status: 'approved', type: 'b2c', note: 'GSTIN checked' });
    expect(r.order.salesType.check.changes).toEqual([expect.objectContaining({
      from: 'b2b', to: 'b2c', fromLabel: 'B2B', toLabel: 'B2C', byName: 'Meera', role: 'accounts', reason: 'Customer is not a business', payLaterEffect: 'none',
    })]);

    const saved = await load(id);
    expect(saved.buyer).toEqual({ type: 'individual' });
    expect(saved.buyerTypeCheck.changeCount).toBe(1);
    expect(saved.buyerTypeCheck.changes[0].previousBuyer).toMatchObject({ type: 'enterprise', gstin: GSTIN, legalName: 'ABC Motors Pvt Ltd' });
    // Money untouched.
    expect(saved.totalAmount).toBe(5000);
    expect(alerts()).toHaveLength(0);

    expect((await salesType.listSalesTypeChecks(accounts, { view: 'b2b_unpaid' })).orders).toHaveLength(0);
    const approved = await salesType.listSalesTypeChecks(accounts, { view: 'approved' });
    expect(approved.orders.map((o) => o.id)).toEqual([id]);
    expect(approved.orders[0].typeChange).toMatchObject({ to: 'b2b', allowed: true });
    // B2C now: ship before payment is not available.
    expect((await payLater.payLaterOptionFor(admin, id)).why).toMatch(/retail \(B2C\)/);
    await expectFail(payLater.approvePayLater(admin, id, { reason: 'Regular dealer' }, req), 409, /retail \(B2C\)/);
  });

  it('who: accounts and admin change it; seller and GTM head cannot', async () => {
    const id = await approvedB2B();
    await expectFail(change(rep, id, { to: 'b2c', reason: 'Customer is retail' }), 403);
    await expectFail(change(head, id, { to: 'b2c', reason: 'Customer is retail' }), 403);
    expect((await load(id)).buyer.type).toBe('enterprise');
    const r = await change(admin, id, { to: 'b2c', reason: 'Customer is retail' });
    expect(r.order.salesType.check.changes[0]).toMatchObject({ role: 'admin', byName: 'Owner' });
  });

  it('a double click records one change', async () => {
    const id = await approvedB2B();
    const results = await Promise.allSettled([
      change(accounts, id, { to: 'b2c', reason: 'Retail customer' }),
      change(accounts, id, { to: 'b2c', reason: 'Retail customer' }),
    ]);
    // One changes it; the other either sees it done (unchanged) or lost the race (409).
    expect(results.filter((x) => x.status === 'fulfilled' && !x.value.unchanged)).toHaveLength(1);
    for (const x of results) if (x.status === 'rejected') expect(x.reason.statusCode).toBe(409);
    const again = await change(accounts, id, { to: 'b2c', reason: 'Retail customer' });
    expect(again.unchanged).toBe(true);
    expect((await load(id)).buyerTypeCheck.changes).toHaveLength(1);
  });

  it('refused once the receipt was emailed, and on a cancelled order', async () => {
    const id = await approvedB2B();
    await Order.updateOne({ _id: id }, { $set: { invoiceNo: 101 } });
    await expectFail(change(accounts, id, { to: 'b2c', reason: 'Retail customer' }), 409, /receipt has already been emailed/);
    await Order.updateOne({ _id: id }, { $unset: { invoiceNo: '' }, $set: { status: 'cancelled' } });
    await expectFail(change(accounts, id, { to: 'b2c', reason: 'Retail customer' }), 409, /cancelled/);
    expect((await load(id)).buyer.type).toBe('enterprise');
  });

  it('an older order with no check cannot be changed', async () => {
    const id = await approvedB2B();
    await Order.updateOne({ _id: id }, { $unset: { buyerTypeCheck: '' } });
    await expectFail(change(accounts, id, { to: 'b2c', reason: 'Retail customer' }), 409, /sales panel/);
  });
});

describe('B2C → B2B', () => {
  it('needs company + valid GSTIN; then ship before payment becomes possible', async () => {
    const id = await acceptedOrder({});
    await salesType.approveSalesType(accounts, id, { note: 'Retail, no offer' }, req);
    await expectFail(change(accounts, id, { to: 'b2b', reason: 'It is a dealer' }), 400);
    await expectFail(change(accounts, id, { to: 'b2b', reason: 'It is a dealer', buyer: { ...COMPANY, gstin: '27AAPFU0939F1ZX' } }), 400);
    expect((await load(id)).buyerTypeCheck.changes).toBeUndefined();

    const r = await change(accounts, id, { to: 'b2b', reason: 'It is a dealer', buyer: { ...COMPANY, type: 'individual' } });
    expect(r.order.salesType).toMatchObject({ type: 'b2b', company: { legalName: 'ABC Motors Pvt Ltd', gstin: GSTIN }, shipBeforePayment: 'allowed' });
    expect((await load(id)).buyer).toMatchObject({ type: 'enterprise', stateCode: '27', billingAddress: { state: 'Maharashtra' } });
    expect((await salesType.listSalesTypeChecks(accounts, { view: 'b2b_unpaid' })).orders.map((o) => o.id)).toEqual([id]);
    expect((await payLater.payLaterOptionFor(admin, id)).canApprove).toBe(true);
  });

  it('refused when the order was sold with offers (money is never repriced)', async () => {
    const id = await acceptedOrder({ discount: { percent: 10, reason: 'Black Friday' } });
    await salesType.approveSalesType(accounts, id, { note: 'BF ok' }, req);
    await expectFail(change(accounts, id, { to: 'b2b', reason: 'It is a dealer', buyer: COMPANY }), 409, /sold with a discount on the total/);
    const opt = await payLater.payLaterOptionFor(accounts, id);
    expect(opt.typeChange).toMatchObject({ to: 'b2b', allowed: false, why: expect.stringMatching(/sold with a discount on the total/) });
    expect((await load(id)).totalAmount).toBe(4500);
  });

  it('a pending order: changing it also approves it', async () => {
    const id = await acceptedOrder({});
    const r = await change(accounts, id, { to: 'b2b', reason: 'Dealer, GSTIN given', buyer: COMPANY });
    expect(r.order.salesType.check).toMatchObject({ status: 'approved', type: 'b2b', byName: 'Meera', note: 'Dealer, GSTIN given' });
    await expectFail(salesType.approveSalesType(admin, id, { note: 'again' }, req), 409);
  });

  it('switching back and forth keeps every step, newest first', async () => {
    const id = await approvedB2B();
    await change(accounts, id, { to: 'b2c', reason: 'First: retail' });
    const r = await change(admin, id, { to: 'b2b', reason: 'Back: it is a dealer', buyer: COMPANY });
    expect(r.order.salesType.check.changes.map((c) => `${c.fromLabel}→${c.toLabel}: ${c.reason}`))
      .toEqual(['B2C→B2B: Back: it is a dealer', 'B2B→B2C: First: retail']);
  });
});

describe('B2B → B2C with ship before payment on', () => {
  async function payLaterOrder() {
    const id = await approvedB2B();
    await payLater.approvePayLater(accounts, id, { reason: 'Regular dealer' }, req);
    enqueueNotification.mockClear();
    return id;
  }

  it('not shipped yet: the permission is taken back; it waits for payment again', async () => {
    const id = await payLaterOrder();
    const opt = await payLater.payLaterOptionFor(accounts, id);
    expect(opt.typeChange).toMatchObject({ to: 'b2c', allowed: true, payLaterEffect: 'withdrawn' });

    const r = await change(accounts, id, { to: 'b2c', reason: 'Not a business after all' });
    expect(r.payLaterEffect).toBe('withdrawn');
    const saved = await load(id);
    expect(saved).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending' });
    expect(saved.payLater).toBeUndefined();
    expect(isPayLaterDue(saved)).toBe(false);
    expect(saved.statusHistory.at(-1)).toMatchObject({ status: 'awaiting_payment', reason: 'pay_later_withdrawn' });
    expect(saved.buyerTypeCheck.changes[0].payLaterEffect).toBe('withdrawn');
    expect(r.order.salesType.check.changes[0].payLaterNote).toMatch(/taken back/);
    // The team workflow is kept, so it carries on once paid.
    expect(saved.workflow?.enteredAt).toBeInstanceOf(Date);
    expect(alerts()).toEqual([['send-staff-sales-type-changed-alert', { orderId: id }]]);
  });

  it('already shipped unpaid: left running, flagged, admin told', async () => {
    const id = await payLaterOrder();
    const now = new Date();
    await Order.updateOne({ _id: id }, { $set: { status: 'shipped', 'payLater.dispatchedAt': now, 'payLater.dueAt': new Date(now.getTime() + 3 * 864e5) } });

    const r = await change(accounts, id, { to: 'b2c', reason: 'Not a business after all' });
    expect(r.payLaterEffect).toBe('kept_shipped_unpaid');
    const saved = await load(id);
    expect(saved).toMatchObject({ status: 'shipped', paymentStatus: 'pending', payLater: { reason: 'Regular dealer' } });
    expect(isPayLaterDue(saved)).toBe(true);
    expect(r.order.salesType.alert).toMatch(/shipped without payment/);
    expect(alerts()).toHaveLength(1);
    // Once paid, the red alert goes.
    await Order.updateOne({ _id: id }, { $set: { paymentStatus: 'paid' } });
    expect(util.shapeSalesType(await load(id)).alert).toBeNull();
  });

  it('a parcel dispatched between reading and writing → 409, nothing half-done', async () => {
    const id = await payLaterOrder();
    // What the service read: still unshipped.
    const stale = await load(id);
    // Then the parcel leaves before our write lands.
    await Order.updateOne({ _id: id }, { $set: { status: 'shipped', 'payLater.dispatchedAt': new Date() } });
    const spy = jest.spyOn(Order, 'findById').mockReturnValueOnce({ select: () => ({ lean: async () => stale }) });
    try {
      await expectFail(change(accounts, id, { to: 'b2c', reason: 'Not a business after all' }), 409, /changed just now/);
    } finally {
      spy.mockRestore();
    }
    const saved = await load(id);
    expect(saved).toMatchObject({ status: 'shipped', buyer: { type: 'enterprise' }, payLater: { reason: 'Regular dealer' } });
    expect(saved.buyerTypeCheck.changes).toBeUndefined();
    expect(alerts()).toHaveLength(0);
  });

  it('accounts changes it to B2C just before ship-before-payment is approved → refused', async () => {
    const id = await approvedB2B();
    const stale = await Order.findById(id);
    await change(accounts, id, { to: 'b2c', reason: 'Retail customer' });
    const { default: orderRepository } = await import('../repositories/orderRepository.js');
    const spy = jest.spyOn(orderRepository, 'findById').mockResolvedValueOnce(stale);
    try {
      await expectFail(payLater.approvePayLater(admin, id, { reason: 'Regular dealer' }, req), 409, /changed just now/);
    } finally {
      spy.mockRestore();
    }
    const saved = await load(id);
    expect(saved.payLater).toBeUndefined();
    expect(saved.status).toBe('awaiting_payment');
  });

  it('paid: nothing to take back', async () => {
    const id = await payLaterOrder();
    await Order.updateOne({ _id: id }, { $set: { paymentStatus: 'paid', status: 'delivered' } });
    const r = await change(accounts, id, { to: 'b2c', reason: 'Not a business after all' });
    expect(r.payLaterEffect).toBe('none');
    expect(alerts()).toHaveLength(0);
  });
});
