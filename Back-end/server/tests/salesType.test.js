/**
 * B2B / B2C on GTM orders (owner 2026-11-25) — real in-memory Mongo; Razorpay is a double.
 *
 * What must hold (on the SERVER, whatever the browser sends):
 *   - B2B = the enterprise buyer: company name + checksum-valid GSTIN, else refused
 *   - B2B gets no % discount on the total: refused when the quotation is saved AND
 *     again when it is accepted
 *   - B2B item prices (owner 2026-11-28): staff may set a price at or below the
 *     catalogue price on each line; it is validated, survives edit/reopen, needs
 *     approval above 10% off, and is what the order (and so the invoice) bills
 *   - B2C keeps its offers as today
 *   - accept snapshots the type onto the order and opens accounts' check (`pending`)
 *   - accounts / the admin approve the type with a note, once; nobody else can
 *   - ship before payment: refused on B2C ("not available — retail (B2C) order"),
 *     refused on B2B until accounts approved, then allowed — for admin AND accounts
 *   - the badge reason says why: "offer applied: 10% off (Black Friday)" / "B2B price on 1 item"
 */
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
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
const approvals = await import('../services/quotationApprovalService.js');
const { listSalesOrders } = await import('../services/salesOrderService.js');

jest.setTimeout(60000);

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const GSTIN = '27AAPFU0939F1ZV';
let n = 0;
const makeStaff = (team, { isHead = false, name, role = 'staff', gtmRole } = {}) => {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `st-${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role, ...(role === 'staff' && { staff: { team, isHead, active: true, ...(gtmRole && { gtmRole }) } }),
  });
};
const makeProduct = () => {
  n += 1;
  return Product.create({ name: `Dash cam ${n}`, slug: `dash-st${n}`, sku: `SKUST-${n}`, description: 'x'.repeat(30), price: 5000, stock: 'in', isActive: true });
};
const CUSTOMER = { name: 'Rohit Shah', email: 'rohit.st@example.com', phone: '9820917286' };
const ADDRESS = { houseNumber: 'Flat 4B', addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' };
const B2B_BUYER = { type: 'enterprise', legalName: 'ABC Motors Pvt Ltd', gstin: GSTIN, billingAddress: { addressLine1: 'Suman Heights', city: 'Navi Mumbai', postalCode: '400706' } };
const input = (items, extra = {}) => ({ customer: CUSTOMER, shippingAddress: ADDRESS, items, ...extra });
const BLACK_FRIDAY = { percent: 10, reason: 'Black Friday' };

let rep; let accounts; let admin; let head; let product;
beforeEach(async () => {
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
  return Order.findById(orderId).lean();
}
const expectFail = (p, status, msg) => expect(p).rejects.toMatchObject({ statusCode: status, ...(msg && { message: expect.stringMatching(msg) }) });

describe('the rules (pure)', () => {
  it('B2C reason names the offer; B2B reason names its item prices', () => {
    expect(util.shapeSalesType({ salesDiscount: { percent: 10, reason: 'Black Friday' }, items: [] }))
      .toMatchObject({ type: 'b2c', label: 'B2C', reason: 'Retail order — offer applied: 10% off (Black Friday).', shipBeforePayment: 'not_b2c' });
    expect(util.shapeSalesType({ items: [{ price: 4500, listPrice: 5000 }] }).reason).toBe('Retail order — offer applied: offer price on 1 item.');
    expect(util.shapeSalesType({ items: [{ price: 5000, listPrice: null }] }).reason).toBe('Retail order — no offer applied.');
    expect(util.shapeSalesType({ buyer: { type: 'enterprise', legalName: 'ABC', gstin: GSTIN }, buyerTypeCheck: { status: 'pending' } }))
      .toMatchObject({ type: 'b2b', shipBeforePayment: 'needs_check', company: { legalName: 'ABC', gstin: GSTIN } });
    expect(util.shapeSalesType({ buyer: { type: 'enterprise' }, items: [{ price: 4500, listPrice: 5000 }] }).reason)
      .toBe('Business order — B2B price on 1 item, no discount on the total. Ship before payment allowed.');
    expect(util.b2bOfferProblem({ discount: null, lines: [{ price: 4500, listPrice: 5000 }] })).toBeNull();
    expect(util.b2bOfferProblem({ discount: { percent: 5 } })).toMatch(/no discount on the total/);
  });
  it('ship before payment by type', () => {
    expect(util.payLaterTypeProblem({})).toBe('Ship before payment: not available — retail (B2C) order.');
    expect(util.payLaterTypeProblem({ buyer: { type: 'individual' }, buyerTypeCheck: { status: 'approved' } })).toMatch(/retail \(B2C\)/);
    expect(util.payLaterTypeProblem({ buyer: { type: 'enterprise' }, buyerTypeCheck: { status: 'pending' } })).toMatch(/Accounts must first approve/);
    expect(util.payLaterTypeProblem({ buyer: { type: 'enterprise' }, buyerTypeCheck: { status: 'approved' } })).toBeNull();
  });
});

describe('B2B quotations: no discount on the total, refused on the server', () => {
  it('a discount on the total is refused', async () => {
    await expectFail(quotes.createQuotation(rep, input([line()], { buyer: B2B_BUYER, discount: BLACK_FRIDAY }), req), 400, /B2B orders get no discount on the total/);
    expect(await SalesQuotation.countDocuments()).toBe(0);
  });
  it('needs a valid GSTIN and a company name', async () => {
    await expectFail(quotes.createQuotation(rep, input([line()], { buyer: { ...B2B_BUYER, gstin: '27AAPFU0939F1ZX' } }), req), 400);
    await expectFail(quotes.createQuotation(rep, input([line()], { buyer: { ...B2B_BUYER, legalName: '' } }), req), 400, /legal name/);
  });
  it('at the catalogue price it is saved as B2B, and editing in a discount later is refused too', async () => {
    const q = await quotes.createQuotation(rep, input([line(), { custom: true, name: 'Fitting', quantity: 1, price: 700 }], { buyer: B2B_BUYER }), req);
    expect(q.salesType).toMatchObject({ type: 'b2b', company: { legalName: 'ABC Motors Pvt Ltd', gstin: GSTIN } });
    expect(q.totalAmount).toBe(5700);
    await expectFail(quotes.updateQuotation(rep, q.id, input([line()], { buyer: B2B_BUYER, discount: BLACK_FRIDAY }), req), 400, /no discount on the total/);
    expect((await SalesQuotation.findById(q.id).lean()).version).toBe(1);
  });
  it('a B2B quotation that somehow holds a discount cannot be accepted', async () => {
    const q = await quotes.createQuotation(rep, input([line()], { buyer: B2B_BUYER }), req);
    await SalesQuotation.updateOne({ _id: q.id }, { $set: { discount: { percent: 5, amount: 250, reason: 'x', by: rep._id, at: new Date() }, totalAmount: 4750 } });
    await expectFail(quotes.acceptQuotation(rep, q.id, req), 409, /no discount on the total/);
    expect(await Order.countDocuments()).toBe(0);
    expect((await SalesQuotation.findById(q.id).lean()).status).toBe('open');
  });
});

describe('B2B item prices set by staff (owner 2026-11-28)', () => {
  const b2b = (items, extra = {}) => input(items, { buyer: B2B_BUYER, ...extra });

  it('list ₹5,000 → staff sets ₹4,600: saved, totals by the server, client totals ignored', async () => {
    const q = await quotes.createQuotation(rep, b2b([line({ offerPrice: 4600, quantity: 2 })], {
      // Tampered client money: none of it may be used.
      totalAmount: 1, subtotal: 1, items_total: 1,
    }), req);
    expect(q.items[0]).toMatchObject({ price: 4600, listPrice: 5000, quantity: 2 });
    expect(q.subtotal).toBe(9200);
    expect(q.totalAmount).toBe(9200);
    expect(q.salesType.reason).toMatch(/B2B price on 1 item/);
    const stored = await SalesQuotation.findById(q.id).lean();
    expect(stored.items[0].price).toBe(4600);
    expect(stored.totalAmount).toBe(9200);
  });

  it('a client-sent line price on a catalogue line is ignored; only offerPrice counts', async () => {
    const q = await quotes.createQuotation(rep, b2b([line({ price: 1, listPrice: 1 })]), req);
    expect(q.items[0]).toMatchObject({ price: 5000, listPrice: null });
    expect(q.totalAmount).toBe(5000);
  });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['not a number', 'abc'],
    ['under ₹1', 0.5],
  ])('a %s B2B price is refused and nothing is saved', async (_label, bad) => {
    await expectFail(quotes.createQuotation(rep, b2b([line({ offerPrice: bad })]), req), 400, /valid offer price/);
    expect(await SalesQuotation.countDocuments()).toBe(0);
  });

  it('a B2B price above the catalogue price is refused', async () => {
    await expectFail(quotes.createQuotation(rep, b2b([line({ offerPrice: 5001 })]), req), 400, /can't be higher than its price/);
  });

  it('survives reopen and edit: the edit re-prices on the server and keeps the old version with the staff name', async () => {
    const q = await quotes.createQuotation(rep, b2b([line({ offerPrice: 4600 })]), req);
    const reopened = await quotes.getQuotation(rep, q.id);
    const got = reopened.quotation || reopened;
    expect(got.items[0]).toMatchObject({ price: 4600, listPrice: 5000 });

    const edited = await quotes.updateQuotation(rep, q.id, b2b([line({ offerPrice: 4700, quantity: 3 })]), req);
    expect(edited.version).toBe(2);
    expect(edited.items[0]).toMatchObject({ price: 4700, quantity: 3 });
    expect(edited.totalAmount).toBe(14100);
    const stored = await SalesQuotation.findById(q.id).lean();
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]).toMatchObject({ version: 1, totalAmount: 4600, savedByName: 'Asha' });
    expect(stored.revisions[0].items[0].price).toBe(4600);
  });

  it('accept: the order bills exactly the B2B price, snapshotted with the list price', async () => {
    const q = await quotes.createQuotation(rep, b2b([line({ offerPrice: 4600, quantity: 2 }), { custom: true, name: 'Fitting', quantity: 1, price: 700 }]), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    const order = await Order.findById(orderId).lean();
    expect(order.buyer).toMatchObject({ type: 'enterprise', gstin: GSTIN });
    expect(order.items[0]).toMatchObject({ price: 4600, listPrice: 5000, quantity: 2 });
    expect(order.totalAmount).toBe(9900);
    // A later catalogue price change does not touch the order.
    await Product.updateOne({ _id: product._id }, { $set: { price: 9999 } });
    expect((await Order.findById(orderId).lean()).items[0].price).toBe(4600);
  });

  it('more than 10% below the website price needs approval before sharing or accepting (B2B too)', async () => {
    const q = await quotes.createQuotation(rep, b2b([line({ offerPrice: 4250 })]), req); // 15% off
    expect(q.approval).toMatchObject({ state: 'needed' });
    await expectFail(quotes.getQuotationDocument(rep, q.id), 409, /needs approval/);
    await expectFail(quotes.acceptQuotation(rep, q.id, req), 409, /needs approval/);
    expect(await Order.countDocuments()).toBe(0);

    const asked = await approvals.requestApproval(rep, q.id, { reason: 'Dealer, 20 cars a year' }, req);
    await approvals.decideApproval(head, q.id, { decision: 'approve', note: 'OK for dealer', priceKey: asked.approval.priceKey }, req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    expect((await Order.findById(orderId).lean()).items[0].price).toBe(4250);
  });

  it('10% or less off needs no approval', async () => {
    const q = await quotes.createQuotation(rep, b2b([line({ offerPrice: 4500 })]), req); // exactly 10%
    expect(q.approval).toMatchObject({ state: 'not_needed' });
    await expect(quotes.acceptQuotation(rep, q.id, req)).resolves.toHaveProperty('orderId');
  });
});

describe('B2C quotations keep their offers', () => {
  it('offer price and Black Friday discount are allowed; the order says why', async () => {
    const order = await acceptedOrder({ buyer: { type: 'individual' }, discount: BLACK_FRIDAY });
    // A retail buyer stores no buyer block (offlineOrderService), so it reads as B2C.
    expect(order.buyer?.type).toBeUndefined();
    expect(order.buyerTypeCheck).toMatchObject({ status: 'pending', type: 'b2c' });
    expect(util.shapeSalesType(order).reason).toBe('Retail order — offer applied: 10% off (Black Friday).');
  });
  it('no type sent (older screens) = B2C, as before', async () => {
    const order = await acceptedOrder({});
    expect(util.salesTypeOf(order)).toBe('b2c');
    expect(order.buyerTypeCheck.type).toBe('b2c');
  });
});

describe('accounts approves the type with a note', () => {
  it('B2B snapshot on the order; accounts approves once; list moves it', async () => {
    const order = await acceptedOrder({ buyer: B2B_BUYER });
    expect(order.buyer).toMatchObject({ type: 'enterprise', legalName: 'ABC Motors Pvt Ltd', gstin: GSTIN, stateCode: '27' });
    expect(order.buyerTypeCheck).toMatchObject({ status: 'pending', type: 'b2b' });

    const before = await salesType.listSalesTypeChecks(accounts, { view: 'check' });
    expect(before.orders.map((o) => o.id)).toEqual([String(order._id)]);
    expect(before.canCheck).toBe(true);

    await expectFail(salesType.approveSalesType(accounts, String(order._id), { note: ' ' }, req), 400);
    const r = await salesType.approveSalesType(accounts, String(order._id), { note: 'GSTIN checked, regular dealer' }, req);
    expect(r.order.salesType.check).toMatchObject({ status: 'approved', type: 'b2b', byName: 'Meera', role: 'accounts', note: 'GSTIN checked, regular dealer' });
    await expectFail(salesType.approveSalesType(admin, String(order._id), { note: 'again' }, req), 409, /Already approved/);

    expect((await salesType.listSalesTypeChecks(accounts, { view: 'check' })).orders).toHaveLength(0);
    expect((await salesType.listSalesTypeChecks(accounts, { view: 'b2b_unpaid' })).orders.map((o) => o.id)).toEqual([String(order._id)]);
  });

  it('the GTM order list carries the badge (its projection includes the type fields)', async () => {
    const order = await acceptedOrder({ buyer: B2B_BUYER });
    const page = await listSalesOrders(rep, {});
    const row = page.orders.find((o) => o.id === String(order._id));
    expect(row.salesType).toMatchObject({ type: 'b2b', label: 'B2B', check: { status: 'pending' } });
  });

  it('who: accounts and admin approve; GTM head only reads; seller cannot', async () => {
    const order = await acceptedOrder({});
    await expectFail(salesType.approveSalesType(rep, String(order._id), { note: 'ok fine' }, req), 403);
    await expectFail(salesType.approveSalesType(head, String(order._id), { note: 'ok fine' }, req), 403);
    await expectFail(salesType.listSalesTypeChecks(rep, {}), 403);
    expect((await salesType.listSalesTypeChecks(head, {})).canCheck).toBe(false);
    const r = await salesType.approveSalesType(admin, String(order._id), { note: 'Black Friday offer ok' }, req);
    expect(r.order.salesType.check).toMatchObject({ role: 'admin', type: 'b2c' });
  });

  it('two clicks at once record one approval', async () => {
    const order = await acceptedOrder({});
    const results = await Promise.allSettled([
      salesType.approveSalesType(accounts, String(order._id), { note: 'first' }, req),
      salesType.approveSalesType(admin, String(order._id), { note: 'second' }, req),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')[0].reason.statusCode).toBe(409);
  });

  it('an older order (no check) is not listed and cannot be "approved"', async () => {
    const order = await acceptedOrder({});
    await Order.updateOne({ _id: order._id }, { $unset: { buyerTypeCheck: '' } });
    expect((await salesType.listSalesTypeChecks(accounts, { view: 'check' })).orders).toHaveLength(0);
    await expectFail(salesType.approveSalesType(accounts, String(order._id), { note: 'abc' }, req), 409);
  });
});

describe('ship before payment follows the type', () => {
  it('B2C: refused, with the reason shown to admin and accounts', async () => {
    const order = await acceptedOrder({ discount: BLACK_FRIDAY });
    await salesType.approveSalesType(accounts, String(order._id), { note: 'BF ok' }, req);
    const opt = await payLater.payLaterOptionFor(admin, String(order._id));
    expect(opt).toMatchObject({ canApprove: false, why: 'Ship before payment: not available — retail (B2C) order.' });
    expect(opt.salesType).toMatchObject({ type: 'b2c', reason: expect.stringMatching(/Black Friday/) });
    await expectFail(payLater.approvePayLater(admin, String(order._id), { reason: 'Pays after tracking' }, req), 409, /retail \(B2C\)/);
    expect((await Order.findById(order._id).lean()).payLater).toBeUndefined();
  });

  it('B2B: refused until accounts approves, then accounts can turn it on', async () => {
    const order = await acceptedOrder({ buyer: B2B_BUYER });
    await expectFail(payLater.approvePayLater(admin, String(order._id), { reason: 'Regular dealer' }, req), 409, /Accounts must first approve/);
    expect((await payLater.payLaterOptionFor(accounts, String(order._id))).why).toMatch(/Accounts must first approve/);

    await salesType.approveSalesType(accounts, String(order._id), { note: 'GSTIN checked' }, req);
    expect(await payLater.payLaterOptionFor(accounts, String(order._id))).toMatchObject({ canApprove: true, salesType: { shipBeforePayment: 'allowed' } });
    const r = await payLater.approvePayLater(accounts, String(order._id), { reason: 'Regular dealer' }, req);
    expect(r.alreadyApproved).toBe(false);
    const saved = await Order.findById(order._id).lean();
    expect(saved).toMatchObject({ status: 'processing', paymentStatus: 'pending', payLater: { reason: 'Regular dealer', approvedByName: 'Meera' } });
    // It leaves the "B2B not paid — ship before payment" list.
    expect((await salesType.listSalesTypeChecks(accounts, { view: 'b2b_unpaid' })).orders).toHaveLength(0);
  });

  it('an older unpaid sales order with no type stays retail: no ship before payment', async () => {
    const order = await acceptedOrder({});
    await Order.updateOne({ _id: order._id }, { $unset: { buyerTypeCheck: '', buyer: '' } });
    await expectFail(payLater.approvePayLater(admin, String(order._id), { reason: 'Regular dealer' }, req), 409, /retail \(B2C\)/);
  });
});
