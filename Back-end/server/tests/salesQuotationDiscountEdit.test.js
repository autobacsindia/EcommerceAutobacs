/**
 * Quotation % discount + editing a quotation after the customer accepted it
 * (services/salesQuotationService.js), against a real in-memory Mongo replica set.
 * Razorpay is a double that records links made / cancelled.
 *
 * What must hold:
 *   - the server computes the discount and the total from the lines and the percent;
 *     an amount or total sent by the browser is ignored
 *   - the discount is snapshotted onto the order at accept; payment parts must add up
 *     to the DISCOUNTED total
 *   - editing an accepted, unpaid quotation cancels every waiting link at Razorpay,
 *     cancels the old order quietly, and re-opens the quotation as the next version
 *   - it is refused once anything is paid or a bank transfer is waiting; nothing changes
 *   - two edits at once: exactly one wins, one order is cancelled, one new version
 *   - who gave the discount and every version are recorded
 */
import { jest } from '@jest/globals';

const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

// cancelRefusal: the error Razorpay gives on cancel; remoteStatus: what a fetch then says.
// onCancel: runs during the cancel call (to simulate something landing meanwhile).
const rz = { created: [], cancelled: [], cancelRefusal: null, remoteStatus: 'created', onCancel: null, seq: 0 };
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async (order, customer, opts = {}) => {
      rz.seq += 1;
      const link = { id: `plink_${rz.seq}`, shortUrl: `https://rzp.io/i/l${rz.seq}` };
      rz.created.push({ amount: opts.part ? opts.part.amount : order.totalAmount, link });
      return link;
    },
    cancelPaymentLink: async (id) => {
      if (rz.onCancel) await rz.onCancel(id);
      if (rz.cancelRefusal) throw new Error(rz.cancelRefusal);
      rz.cancelled.push(id);
      return { id, status: 'cancelled' };
    },
    fetchPaymentLinkStatus: async () => ({ status: rz.remoteStatus }),
  },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const quotes = await import('../services/salesQuotationService.js');
const payments = await import('../services/salesPaymentService.js');
const sales = await import('../services/salesOrderService.js');
const { buildQuotation } = await import('../services/quotationService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const makeStaff = (team, { isHead = false, name, role = 'staff' } = {}) => {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `qd-${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role, ...(role === 'staff' && { staff: { team, isHead, active: true } }),
  });
};
const makeProduct = (over = {}) => {
  n += 1;
  return Product.create({ name: `Bumper ${n}`, slug: `bumper-qd${n}`, sku: `SKUQD-${n}`, description: 'x'.repeat(30), price: 11800, stock: 'in', isActive: true, ...over });
};
const CUSTOMER = { name: 'Rohit Shah', email: 'rohit.qd@example.com', phone: '9820917286' };
const ADDRESS = { addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' };
const input = (items, extra = {}) => ({ customer: CUSTOMER, shippingAddress: ADDRESS, items, ...extra });
const labour = (price, quantity = 1) => ({ custom: true, name: 'Installation', quantity, price });
const FIVE = { percent: 5, reason: 'Repeat customer' };

// What the status service was asked to send (Redis is off in tests, so the real
// methods would no-op either way — record the intent instead).
const statusCalls = [];
const original = {
  status: orderStatusService._enqueueStatusNotification,
  alert: orderStatusService._enqueueAdminOrderAlert,
};
beforeAll(() => {
  orderStatusService._enqueueStatusNotification = (orderId, status, opts) => { statusCalls.push({ kind: 'status', orderId, status, opts }); };
  orderStatusService._enqueueAdminOrderAlert = (order, status) => { statusCalls.push({ kind: 'alert', cancelledBy: order.cancelledBy, status }); };
});
afterAll(() => {
  orderStatusService._enqueueStatusNotification = original.status;
  orderStatusService._enqueueAdminOrderAlert = original.alert;
});

beforeEach(() => {
  enqueued.length = 0;
  statusCalls.length = 0;
  rz.created.length = 0;
  rz.cancelled.length = 0;
  rz.cancelRefusal = null;
  rz.remoteStatus = 'created';
  rz.onCancel = null;
});

describe('the discount is computed on the server', () => {
  it('5% of ₹11,800 is ₹590 off → ₹11,210, credited to the seller', async () => {
    const rep = await makeStaff('sales', { name: 'Asha' });
    const product = await makeProduct();
    const q = await quotes.createQuotation(rep, input([{ product: String(product._id), quantity: 1 }], { discount: FIVE }), req);
    expect(q).toMatchObject({ subtotal: 11800, totalAmount: 11210 });
    expect(q.discount).toMatchObject({ percent: 5, amount: 590, reason: 'Repeat customer', byName: 'Asha' });
  });

  it('ignores a total, an amount or a subtotal sent by the browser', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, input([labour(10000)], {
      totalAmount: 1, subtotal: 2, discount: { ...FIVE, amount: 9999 },
    }), req);
    expect(q).toMatchObject({ subtotal: 10000, totalAmount: 9500, discount: expect.objectContaining({ amount: 500 }) });
    const stored = await SalesQuotation.findById(q.id).lean();
    expect(stored).toMatchObject({ subtotal: 10000, totalAmount: 9500, discount: expect.objectContaining({ amount: 500 }) });
  });

  it('rounds to whole rupees: 5% of ₹11,799 → ₹590 off', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, input([labour(11799)], { discount: FIVE }), req);
    expect(q).toMatchObject({ subtotal: 11799, totalAmount: 11209, discount: expect.objectContaining({ amount: 590 }) });
  });

  it('no discount when the box is empty or 0', async () => {
    const rep = await makeStaff('sales');
    const a = await quotes.createQuotation(rep, input([labour(1000)], { discount: { percent: '', reason: '' } }), req);
    const b = await quotes.createQuotation(rep, input([labour(1000)], { discount: { percent: 0 } }), req);
    for (const q of [a, b]) expect(q).toMatchObject({ subtotal: 1000, totalAmount: 1000, discount: null });
  });

  it('refuses a discount with no reason, 100%, or one leaving nothing to pay — and saves nothing', async () => {
    const rep = await makeStaff('sales');
    const before = await SalesQuotation.countDocuments({});
    await expect(quotes.createQuotation(rep, input([labour(1000)], { discount: { percent: 5 } }), req)).rejects.toThrow(/reason/);
    await expect(quotes.createQuotation(rep, input([labour(1000)], { discount: { percent: 100, reason: 'free unit' } }), req)).rejects.toThrow(/less than 100%/);
    await expect(quotes.createQuotation(rep, input([labour(10)], { discount: { percent: 99.99, reason: 'free unit' } }), req)).rejects.toThrow(/nothing to pay/);
    expect(await SalesQuotation.countDocuments({})).toBe(before);
  });

  it('follows the lines on an edit, keeps the giver while unchanged, and credits whoever changes it', async () => {
    const rep = await makeStaff('sales', { name: 'Asha' });
    const head = await makeStaff('sales', { isHead: true, name: 'Vikram' });
    const q1 = await quotes.createQuotation(rep, input([labour(10000)], { discount: FIVE }), req);
    // Lines change, discount the same → amount re-derived, still Asha's.
    const q2 = await quotes.updateQuotation(rep, q1.id, input([labour(8000)], { discount: FIVE }), req);
    expect(q2).toMatchObject({ subtotal: 8000, totalAmount: 7600, discount: expect.objectContaining({ amount: 400, byName: 'Asha' }) });
    // The head raises it → credited to the head.
    const q3 = await quotes.updateQuotation(head, q1.id, input([labour(8000)], { discount: { percent: 12, reason: 'Fleet deal' } }), req);
    expect(q3).toMatchObject({ totalAmount: 7040, discount: expect.objectContaining({ percent: 12, amount: 960, byName: 'Vikram', reason: 'Fleet deal' }) });
    // Removed → back to the subtotal, and the field is gone.
    const q4 = await quotes.updateQuotation(rep, q1.id, input([labour(8000)]), req);
    expect(q4).toMatchObject({ totalAmount: 8000, discount: null });
    expect((await SalesQuotation.findById(q1.id).lean()).discount).toBeUndefined();
    // Every version kept, with its discount and who replaced it.
    expect(q4.revisions.map((r) => [r.version, r.totalAmount, r.discount?.percent ?? 0])).toEqual([[1, 9500, 5], [2, 7600, 5], [3, 7040, 12]]);
    expect(q4.revisions.map((r) => r.savedByName)).toEqual(['Asha', 'Vikram', 'Asha']);
  });
});

describe('accepting a discounted quotation', () => {
  it('snapshots the discount onto the order; payment must add up to the discounted total', async () => {
    const rep = await makeStaff('sales', { name: 'Asha' });
    const q = await quotes.createQuotation(rep, input([labour(10000)], { discount: FIVE }), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    const order = await Order.findById(orderId).lean();
    expect(order).toMatchObject({ subtotal: 10000, discount: 500, totalAmount: 9500 });
    expect(order.salesDiscount).toMatchObject({ percent: 5, amount: 500, reason: 'Repeat customer', byName: 'Asha' });

    await expect(payments.requestPayment(rep, orderId, [10000], req)).rejects.toThrow(/₹9,500/);
    const summary = await payments.requestPayment(rep, orderId, [5000, 4500], req);
    expect(summary.amountToRequest).toBe(0);
    expect(rz.created.map((c) => c.amount)).toEqual([5000, 4500]);

    const shaped = await sales.getSalesOrder(rep, orderId);
    expect(shaped).toMatchObject({ subtotal: 10000, totalAmount: 9500, discount: expect.objectContaining({ percent: 5, amount: 500, byName: 'Asha' }) });
    // The order page links back to the quotation it came from.
    expect(shaped.quotation).toEqual({ id: q.id, number: q.number });
  });

  it('refuses when the stored total no longer matches the lines and percent (tampered row)', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, input([labour(10000)], { discount: FIVE }), req);
    await SalesQuotation.updateOne({ _id: q.id }, { $set: { totalAmount: 100 } });
    await expect(quotes.acceptQuotation(rep, q.id, req)).rejects.toMatchObject({ statusCode: 409 });
    expect(await Order.countDocuments({ 'items.name': 'Installation', totalAmount: 100 })).toBe(0);
  });

  it('the quotation PDF prints the discount and its rows add up to the charge', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, input([labour(10000)], { discount: FIVE }), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    const built = buildQuotation(await Order.findById(orderId).lean());
    expect(built).toMatchObject({ total: 9500, consistent: true, extraDiscount: { label: 'Discount (5%)', amount: 500 } });
    expect(JSON.stringify(built)).not.toMatch(/Repeat customer/);
    const { buffer } = await quotes.getQuotationDocument(rep, q.id);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('editing after the customer accepted', () => {
  const acceptedWithParts = async (rep, { parts = [6000, 4000], items = [labour(10000)] } = {}) => {
    const q = await quotes.createQuotation(rep, input(items), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    if (parts) await payments.requestPayment(rep, orderId, parts, req);
    return { q, orderId };
  };

  it('cancels the waiting links and the old order quietly, and re-opens the next version', async () => {
    const rep = await makeStaff('sales', { name: 'Asha' });
    const { q, orderId } = await acceptedWithParts(rep);
    const links = rz.created.map((c) => c.link.id);

    const edited = await quotes.updateQuotation(rep, q.id, input([labour(9000)], { discount: FIVE }), req);
    expect(edited).toMatchObject({ status: 'open', version: 2, orderId: null, number: `${q.number}-v2`, totalAmount: 8550 });
    expect(edited.revisions).toEqual([expect.objectContaining({ version: 1, totalAmount: 10000, wasAccepted: true, savedByName: 'Asha' })]);

    // Old amount can no longer be paid.
    expect(rz.cancelled.sort()).toEqual(links.sort());
    const old = await Order.findById(orderId).lean();
    expect(old.status).toBe('cancelled');
    expect(old.cancelledBy).toBe('system');
    expect(old.paymentParts.map((p) => p.status)).toEqual(['cancelled', 'cancelled']);
    expect(old.statusHistory.at(-1).notes).toMatch(new RegExp(`${q.number}-v2`));
    // No customer email, no support alert.
    expect(statusCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'status', orderId, status: 'cancelled', opts: { suppressStatusEmail: true } }),
    ]));
    expect(statusCalls.filter((c) => c.kind === 'alert' && ['admin', 'customer'].includes(c.cancelledBy))).toEqual([]);

    // The customer accepts the new version → one new order at the new price.
    const again = await quotes.acceptQuotation(rep, q.id, req);
    expect(again.orderId).not.toBe(orderId);
    expect(await Order.findById(again.orderId).lean()).toMatchObject({ status: 'awaiting_payment', totalAmount: 8550, discount: 450 });
    expect(await Order.countDocuments({ _id: { $in: [orderId, again.orderId] } })).toBe(2);
  });

  it('works before any payment was requested, and says so in getQuotation', async () => {
    const rep = await makeStaff('sales');
    const { q } = await acceptedWithParts(rep, { parts: null });
    expect((await quotes.getQuotation(rep, q.id)).editAfterAccept).toEqual({ allowed: true, reason: null, payDetailsShared: false });
    const edited = await quotes.updateQuotation(rep, q.id, input([labour(7000)]), req);
    expect(edited).toMatchObject({ status: 'open', version: 2, totalAmount: 7000 });
    expect(rz.cancelled).toEqual([]);
  });

  it('is refused once a part is paid — nothing changes', async () => {
    const rep = await makeStaff('sales');
    const { q, orderId } = await acceptedWithParts(rep);
    await Order.updateOne({ _id: orderId }, { $set: { 'paymentParts.0.status': 'paid' } });
    expect((await quotes.getQuotation(rep, q.id)).editAfterAccept).toMatchObject({ allowed: false, reason: expect.stringMatching(/already paid/) });
    await expect(quotes.updateQuotation(rep, q.id, input([labour(1)]), req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already paid/) });
    expect(rz.cancelled).toEqual([]);
    expect((await SalesQuotation.findById(q.id).lean()).status).toBe('accepted');
    expect((await Order.findById(orderId).lean()).status).toBe('awaiting_payment');
  });

  it('is refused on a fully paid order and while a bank transfer waits for accounts', async () => {
    const rep = await makeStaff('sales');
    const a = await acceptedWithParts(rep, { parts: null });
    await Order.updateOne({ _id: a.orderId }, { $set: { paymentStatus: 'paid', status: 'processing' } });
    await expect(quotes.updateQuotation(rep, a.q.id, input([labour(1)]), req)).rejects.toThrow(/already paid or closed/);

    const b = await acceptedWithParts(rep, { parts: null });
    await Order.updateOne({ _id: b.orderId }, { $set: { bankTransferPendingAt: new Date() } });
    await expect(quotes.updateQuotation(rep, b.q.id, input([labour(1)]), req)).rejects.toThrow(/bank transfer is waiting/);
    expect((await SalesQuotation.findById(b.q.id).lean()).status).toBe('accepted');
  });

  it('needs "checked they have not paid" when the customer has bank / QR details', async () => {
    const rep = await makeStaff('sales');
    const { q, orderId } = await acceptedWithParts(rep, { parts: null });
    await Order.updateOne({ _id: orderId }, { $set: { salesPayDetails: { method: 'other', note: 'Cash at the store' } } });
    expect((await quotes.getQuotation(rep, q.id)).editAfterAccept).toMatchObject({ allowed: true, payDetailsShared: true });
    await expect(quotes.updateQuotation(rep, q.id, input([labour(500)]), req)).rejects.toThrow(/tick the box/);
    expect((await SalesQuotation.findById(q.id).lean()).status).toBe('accepted');
    const edited = await quotes.updateQuotation(rep, q.id, input([labour(500)], { confirmNotPaid: true }), req);
    expect(edited.status).toBe('open');
  });

  it('stops — changing nothing — when Razorpay will not cancel a link that was just paid', async () => {
    const rep = await makeStaff('sales');
    const { q, orderId } = await acceptedWithParts(rep);
    rz.cancelRefusal = 'Failed to cancel payment link: paid';
    rz.remoteStatus = 'paid';
    await expect(quotes.updateQuotation(rep, q.id, input([labour(1)]), req)).rejects.toMatchObject({ statusCode: 409 });
    expect((await SalesQuotation.findById(q.id).lean()).status).toBe('accepted');
    const order = await Order.findById(orderId).lean();
    expect(order.status).toBe('awaiting_payment');
    expect(order.paymentParts.map((p) => p.status)).toEqual(['pending', 'pending']);
  });

  it('carries on when a link Razorpay refuses to cancel is already dead', async () => {
    const rep = await makeStaff('sales');
    const { q } = await acceptedWithParts(rep);
    rz.cancelRefusal = 'Failed to cancel payment link: already cancelled';
    rz.remoteStatus = 'cancelled';
    expect((await quotes.updateQuotation(rep, q.id, input([labour(1000)]), req)).status).toBe('open');
  });

  it('a bank transfer recorded while the links are being cancelled aborts the edit', async () => {
    const rep = await makeStaff('sales');
    const { q, orderId } = await acceptedWithParts(rep, { parts: [10000] });
    rz.onCancel = () => Order.updateOne({ _id: orderId }, { $set: { bankTransferPendingAt: new Date() } });
    await expect(quotes.updateQuotation(rep, q.id, input([labour(1000)]), req)).rejects.toThrow(/payment was recorded/);
    expect((await SalesQuotation.findById(q.id).lean())).toMatchObject({ status: 'accepted', version: 1 });
    const order = await Order.findById(orderId).lean();
    expect(order.status).toBe('awaiting_payment');
    // The link is dead at Razorpay, and the order says so (it can be re-requested).
    expect(order.paymentParts.map((p) => p.status)).toEqual(['cancelled']);
  });

  it('two edits at once: one wins, one order cancelled, one new version', async () => {
    const rep = await makeStaff('sales');
    const head = await makeStaff('sales', { isHead: true });
    const { q, orderId } = await acceptedWithParts(rep);
    const results = await Promise.allSettled([
      quotes.updateQuotation(rep, q.id, input([labour(9000)]), req),
      quotes.updateQuotation(head, q.id, input([labour(8000)]), req),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.statusCode).toBe(409);
    const stored = await SalesQuotation.findById(q.id).lean();
    expect(stored).toMatchObject({ status: 'open', version: 2 });
    expect(stored.revisions).toHaveLength(1);
    expect((await Order.findById(orderId).lean()).status).toBe('cancelled');
  });

  it('only the seller and the GTM head may edit; another seller and an admin may not', async () => {
    const rep = await makeStaff('sales');
    const other = await makeStaff('sales');
    const admin = await makeStaff('admin', { role: 'admin' });
    const head = await makeStaff('sales', { isHead: true });
    const { q } = await acceptedWithParts(rep, { parts: null });
    await expect(quotes.updateQuotation(other, q.id, input([labour(1)]), req)).rejects.toMatchObject({ statusCode: 404 });
    await expect(quotes.updateQuotation(admin, q.id, input([labour(1)]), req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await quotes.getQuotation(admin, q.id)).editAfterAccept).toMatchObject({ allowed: false });
    expect((await quotes.updateQuotation(head, q.id, input([labour(1000)]), req)).status).toBe('open');
  });

  it('a bad edit (invalid discount) is refused before any link is touched', async () => {
    const rep = await makeStaff('sales');
    const { q, orderId } = await acceptedWithParts(rep);
    await expect(quotes.updateQuotation(rep, q.id, input([labour(1000)], { discount: { percent: 5 } }), req)).rejects.toThrow(/reason/);
    expect(rz.cancelled).toEqual([]);
    expect((await Order.findById(orderId).lean()).status).toBe('awaiting_payment');
  });
});

describe('finding the quotation an order came from', () => {
  it('uses the partial index quotation_order, not a collection scan', async () => {
    const { byOrderFilter } = await import('../repositories/salesQuotationRepository.js');
    await SalesQuotation.createIndexes();
    const plan = await SalesQuotation.collection
      .find(byOrderFilter(new (await import('mongoose')).default.Types.ObjectId()))
      .limit(1)
      .explain('queryPlanner');
    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(winning).toContain('"indexName":"quotation_order"');
    expect(winning).not.toContain('COLLSCAN');
  });
});
