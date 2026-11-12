/**
 * "Above 10%: prior approval mandatory" — GTM quotations
 * (utils/discountApproval.js, services/quotationApprovalService.js, the gates in
 * services/salesQuotationService.js), against a real in-memory Mongo replica set.
 *
 * What must hold:
 *   - 10% or less (line or total, vs the WEBSITE price) works exactly as before
 *   - above 10%: no PDF, no accept until the GTM head / an admin approves
 *   - approval is for exact prices: a price change needs a fresh one; an address
 *     change does not
 *   - only an admin, or a GTM head for their own team (not their own quotation or
 *     request), can decide; a double-click is one decision
 *   - nothing skips it: accept without approval, a forged/stale record, a stale click
 *   - the order records who approved, when and the discount %
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
    createPaymentLink: async () => ({ id: 'plink_1', shortUrl: 'https://rzp.io/i/x' }),
    cancelPaymentLink: async (id) => ({ id, status: 'cancelled' }),
    fetchPaymentLinkStatus: async () => ({ status: 'created' }),
  },
}));
const pushes = [];
jest.unstable_mockModule('../services/pushService.js', () => ({
  sendToUsers: async (recipients, message) => { pushes.push({ to: recipients.map((r) => r.userId), message }); return recipients.length; },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const quotes = await import('../services/salesQuotationService.js');
const approvals = await import('../services/quotationApprovalService.js');
const { discountDepth, priceKeyOf, approvalState } = await import('../utils/discountApproval.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const makeUser = ({ team = 'sales', isHead = false, name, role = 'staff', subRole } = {}) => {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `qa-${team}${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(role === 'staff' && { staff: { team, isHead, active: true, ...(subRole && { subRole }) } }),
  });
};
const makeProduct = (over = {}) => {
  n += 1;
  return Product.create({ name: `Bumper ${n}`, slug: `bumper-qa${n}`, sku: `SKUQA-${n}`, description: 'x'.repeat(30), price: 10000, stock: 'in', isActive: true, ...over });
};
const CUSTOMER = { name: 'Rohit Shah', email: 'rohit.qa@example.com', phone: '9820917286' };
const ADDRESS = { addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' };
const input = (items, extra = {}) => ({ customer: CUSTOMER, shippingAddress: ADDRESS, items, ...extra });
const labour = (price) => ({ custom: true, name: 'Installation', quantity: 1, price });
const pct = (percent) => ({ percent, reason: 'Fleet customer' });
const line = (product, offerPrice, quantity = 1) => ({ product: String(product._id), quantity, ...(offerPrice != null && { offerPrice }) });

let seller; let head; let admin;
beforeEach(async () => {
  pushes.length = 0;
  seller = await makeUser({ name: 'Asha' });
  head = await makeUser({ isHead: true, name: 'Vikram' });
  admin = await makeUser({ role: 'admin', name: 'Owner' });
});

const blocked = (p) => expect(p).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/needs approval/) });

describe('the rule (pure)', () => {
  it('exactly 10% is fine; 10.01% needs approval — on the whole quotation', () => {
    expect(discountDepth({ items: [{ price: 10000, quantity: 1 }], totalAmount: 9000 })).toMatchObject({ totalPercent: 10, needsApproval: false });
    expect(discountDepth({ items: [{ price: 10000, quantity: 1 }], totalAmount: 8999 })).toMatchObject({ needsApproval: true });
  });
  it('a single line more than 10% under its website price needs approval even if the total is not', () => {
    const d = discountDepth({ items: [{ price: 890, listPrice: 1000, quantity: 1 }, { price: 100000, quantity: 1 }], totalAmount: 100890 });
    expect(d).toMatchObject({ maxLinePercent: 11, needsApproval: true });
    expect(d.totalPercent).toBeLessThan(1);
  });
  it('line markdown + % discount add up: 6% then 5% is over 10% in total', () => {
    expect(discountDepth({ items: [{ price: 9400, listPrice: 10000, quantity: 1 }], totalAmount: 8930 })).toMatchObject({ totalPercent: 10.7, needsApproval: true });
  });
  it('the price key follows prices and quantities, not the address', () => {
    const q = { items: [{ product: 'a', price: 900, listPrice: 1000, quantity: 1 }], totalAmount: 900, shippingAddress: { city: 'X' } };
    expect(priceKeyOf({ ...q, shippingAddress: { city: 'Y' } })).toBe(priceKeyOf(q));
    expect(priceKeyOf({ ...q, items: [{ ...q.items[0], quantity: 2 }], totalAmount: 1800 })).not.toBe(priceKeyOf(q));
    expect(priceKeyOf({ ...q, items: [{ ...q.items[0], price: 899 }], totalAmount: 899 })).not.toBe(priceKeyOf(q));
  });
  it('a stored approval for other prices does not count', () => {
    const q = { items: [{ price: 800, listPrice: 1000, quantity: 1 }], totalAmount: 800, discountApproval: { status: 'approved', priceKey: 'other' } };
    expect(approvalState(q).state).toBe('needed');
  });
});

describe('10% or less works exactly as before', () => {
  it('exactly 10% off a catalogue line: PDF, accept, no approval on the order', async () => {
    const p = await makeProduct();
    const q = await quotes.createQuotation(seller, input([line(p, 9000)]), req);
    expect(q.approval).toMatchObject({ state: 'not_needed', percent: 10 });
    await expect(quotes.getQuotationDocument(seller, q.id)).resolves.toHaveProperty('buffer');
    const { orderId } = await quotes.acceptQuotation(seller, q.id, req);
    expect((await Order.findById(orderId).lean()).discountApproval).toBeUndefined();
  });

  it('10% quotation discount on custom items only', async () => {
    const q = await quotes.createQuotation(seller, input([labour(5000)], { discount: pct(10) }), req);
    expect(q.approval.state).toBe('not_needed');
    await expect(quotes.acceptQuotation(seller, q.id, req)).resolves.toHaveProperty('orderId');
  });

  it('measured from the WEBSITE price (sale price), not the old MRP', async () => {
    // On the site at ₹10,000 (was ₹15,000). ₹9,000 is 10% under the site price → fine.
    const p = await makeProduct({ price: 10000, originalPrice: 15000 });
    const q = await quotes.createQuotation(seller, input([line(p, 9000)]), req);
    expect(q.approval).toMatchObject({ state: 'not_needed', percent: 10 });
    // ₹8,999 is just over → needs approval.
    const q2 = await quotes.createQuotation(seller, input([line(p, 8999)]), req);
    expect(q2.approval.state).toBe('needed');
  });

  it('asking for approval at 10% or less is refused (nothing to approve)', async () => {
    const q = await quotes.createQuotation(seller, input([labour(5000)], { discount: pct(10) }), req);
    await expect(approvals.requestApproval(seller, q.id, { reason: 'please' }, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('above 10% needs approval', () => {
  const overTen = async () => {
    const p = await makeProduct();
    return quotes.createQuotation(seller, input([line(p, 9500)], { discount: pct(6) }), req); // 5% + 6% → 10.7%
  };

  it('is blocked from PDF and accept until approved; then the order records the approval', async () => {
    const q = await overTen();
    expect(q.approval).toMatchObject({ state: 'needed', percent: 10.7, maxLinePercent: 5, totalPercent: 10.7 });
    await blocked(quotes.getQuotationDocument(seller, q.id));
    await blocked(quotes.acceptQuotation(seller, q.id, req));

    const asked = await approvals.requestApproval(seller, q.id, { reason: 'Fleet customer, 6 cars' }, req);
    expect(asked.approval).toMatchObject({ state: 'pending', reason: 'Fleet customer, 6 cars', requestedByName: 'Asha' });
    // Approvers notified: the head and the admin, never the seller.
    expect(pushes).toHaveLength(1);
    expect(pushes[0].to).toEqual(expect.arrayContaining([String(head._id), String(admin._id)]));
    expect(pushes[0].to).not.toContain(String(seller._id));
    // Still blocked while pending.
    await blocked(quotes.acceptQuotation(seller, q.id, req));

    const ok = await approvals.decideApproval(head, q.id, { decision: 'approve', note: 'OK for fleet', priceKey: asked.approval.priceKey }, req);
    expect(ok.approval).toMatchObject({ state: 'approved', decidedByName: 'Vikram', note: 'OK for fleet' });
    expect(pushes.at(-1).to).toEqual([String(seller._id)]);

    await expect(quotes.getQuotationDocument(seller, q.id)).resolves.toHaveProperty('buffer');
    const { orderId } = await quotes.acceptQuotation(seller, q.id, req);
    const order = await Order.findById(orderId).lean();
    expect(order.discountApproval).toMatchObject({
      percent: 10.7, approvedByName: 'Vikram', approvedRole: 'head', reason: 'Fleet customer, 6 cars', note: 'OK for fleet', requestedByName: 'Asha',
    });
    expect(String(order.discountApproval.approvedBy)).toBe(String(head._id));
    expect(order.discountApproval.approvedAt).toBeInstanceOf(Date);
    // Money unchanged by approval: server-computed 10,000 → 9,500 → 6% off = 8,930.
    expect(order.totalAmount).toBe(8930);
  });

  it('a single line 11% under the website price needs approval', async () => {
    const p = await makeProduct();
    const q = await quotes.createQuotation(seller, input([line(p, 8900)]), req);
    expect(q.approval).toMatchObject({ state: 'needed', maxLinePercent: 11 });
  });

  it('a double-click is one request and one decision', async () => {
    const q = await overTen();
    const [a, b] = await Promise.all([
      approvals.requestApproval(seller, q.id, { reason: 'Fleet' }, req),
      approvals.requestApproval(seller, q.id, { reason: 'Fleet' }, req),
    ]);
    expect([a.approval.state, b.approval.state]).toEqual(['pending', 'pending']);
    const firstAt = (await SalesQuotation.findById(q.id).lean()).discountApproval.requestedAt;
    await approvals.requestApproval(seller, q.id, { reason: 'Again' }, req);
    expect((await SalesQuotation.findById(q.id).lean()).discountApproval).toMatchObject({ requestedAt: firstAt, reason: 'Fleet' });

    const [x, y] = await Promise.all([
      approvals.decideApproval(admin, q.id, { decision: 'approve' }, req),
      approvals.decideApproval(admin, q.id, { decision: 'approve' }, req),
    ]);
    expect([x.approval.state, y.approval.state]).toEqual(['approved', 'approved']);
    const stored = (await SalesQuotation.findById(q.id).lean()).discountApproval;
    expect(stored).toMatchObject({ status: 'approved', decidedRole: 'admin' });
    // Approve again later: same answer, unchanged record.
    await approvals.decideApproval(admin, q.id, { decision: 'approve' }, req);
    expect((await SalesQuotation.findById(q.id).lean()).discountApproval.decidedAt).toEqual(stored.decidedAt);
    // The opposite decision is refused.
    await expect(approvals.decideApproval(admin, q.id, { decision: 'reject', note: 'changed my mind' }, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('a rejection needs a note, keeps it blocked, and the seller can ask again', async () => {
    const q = await overTen();
    await approvals.requestApproval(seller, q.id, { reason: 'Fleet' }, req);
    await expect(approvals.decideApproval(head, q.id, { decision: 'reject' }, req)).rejects.toMatchObject({ statusCode: 400 });
    const r = await approvals.decideApproval(head, q.id, { decision: 'reject', note: 'Max 8% for this one' }, req);
    expect(r.approval).toMatchObject({ state: 'rejected', note: 'Max 8% for this one' });
    await blocked(quotes.acceptQuotation(seller, q.id, req));
    const again = await approvals.requestApproval(seller, q.id, { reason: 'Customer will order 10 more' }, req);
    expect(again.approval).toMatchObject({ state: 'pending', reason: 'Customer will order 10 more', note: null });
  });
});

describe('a change after approval needs a fresh approval', () => {
  const approved = async () => {
    const q = await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(12) }), req);
    await approvals.requestApproval(seller, q.id, { reason: 'Fleet' }, req);
    return approvals.decideApproval(head, q.id, { decision: 'approve' }, req);
  };

  it('a deeper discount voids the approval', async () => {
    const q = await approved();
    const edited = await quotes.updateQuotation(seller, q.id, input([labour(10000)], { discount: pct(15) }), req);
    expect(edited.approval.state).toBe('needed');
    expect((await SalesQuotation.findById(q.id).lean()).discountApproval).toBeUndefined();
    await blocked(quotes.acceptQuotation(seller, q.id, req));
    await blocked(quotes.getQuotationDocument(seller, q.id));
  });

  it('a different quantity or a smaller discount still over 10% also voids it', async () => {
    const q = await approved();
    const edited = await quotes.updateQuotation(seller, q.id, input([labour(10000)], { discount: pct(11) }), req);
    expect(edited.approval.state).toBe('needed');
  });

  it('dropping to 10% or less needs nothing', async () => {
    const q = await approved();
    const edited = await quotes.updateQuotation(seller, q.id, input([labour(10000)], { discount: pct(10) }), req);
    expect(edited.approval.state).toBe('not_needed');
    await expect(quotes.acceptQuotation(seller, q.id, req)).resolves.toHaveProperty('orderId');
  });

  it('an address-only edit keeps the approval', async () => {
    const q = await approved();
    const edited = await quotes.updateQuotation(seller, q.id, input([labour(10000)], {
      discount: pct(12), shippingAddress: { ...ADDRESS, addressLine2: 'Flat 4B' },
    }), req);
    expect(edited.approval.state).toBe('approved');
    await expect(quotes.acceptQuotation(seller, q.id, req)).resolves.toHaveProperty('orderId');
  });

  it('an edit while a request waits voids the request', async () => {
    const q = await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(12) }), req);
    const asked = await approvals.requestApproval(seller, q.id, { reason: 'Fleet' }, req);
    await quotes.updateQuotation(seller, q.id, input([labour(10000)], { discount: pct(20) }), req);
    // The head clicks "approve" on the 12% they saw: refused, the prices changed.
    await expect(approvals.decideApproval(head, q.id, { decision: 'approve', priceKey: asked.approval.priceKey }, req))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(approvals.decideApproval(head, q.id, { decision: 'approve' }, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('only the right person can approve', () => {
  const pending = async (by = seller) => {
    const q = await quotes.createQuotation(by, input([labour(10000)], { discount: pct(12) }), req);
    await approvals.requestApproval(by, q.id, { reason: 'Fleet' }, req);
    return q;
  };

  it('a GTM lead (not head) cannot', async () => {
    const q = await pending();
    const lead = await makeUser({ name: 'Other lead' });
    // Another seller's quotation is not even visible to a lead (404).
    await expect(approvals.decideApproval(lead, q.id, { decision: 'approve' }, req)).rejects.toMatchObject({ statusCode: 404 });
    expect(approvalState(await SalesQuotation.findById(q.id).lean()).state).toBe('pending');
  });

  it("another team's head cannot", async () => {
    const q = await pending();
    const procHead = await makeUser({ team: 'procurement', isHead: true });
    // A GTM quotation is not even visible to them (404).
    await expect(approvals.decideApproval(procHead, q.id, { decision: 'approve' }, req)).rejects.toMatchObject({ statusCode: 404 });
    expect(approvalState(await SalesQuotation.findById(q.id).lean()).state).toBe('pending');
  });

  it('the seller cannot approve their own request', async () => {
    const q = await pending();
    await expect(approvals.decideApproval(seller, q.id, { decision: 'approve' }, req)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a head cannot approve their own quotation — an admin or another head can", async () => {
    const q = await pending(head);
    await expect(approvals.decideApproval(head, q.id, { decision: 'approve' }, req)).rejects.toMatchObject({ statusCode: 403 });
    const head2 = await makeUser({ isHead: true, name: 'Meera' });
    await expect(approvals.decideApproval(head2, q.id, { decision: 'approve' }, req)).resolves.toMatchObject({ approval: expect.objectContaining({ state: 'approved' }) });
  });

  it('canDecide matches', async () => {
    const q = await pending();
    const raw = await SalesQuotation.findById(q.id).lean();
    expect(await approvals.canDecide(head, raw)).toBe(true);
    expect(await approvals.canDecide(admin, raw)).toBe(true);
    expect(await approvals.canDecide(seller, raw)).toBe(false);
  });

  it('a customer support member cannot even ask', async () => {
    const q = await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(12) }), req);
    const support = await makeUser({ subRole: 'support' });
    await expect(approvals.requestApproval(support, q.id, { reason: 'Fleet' }, req)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('it cannot be bypassed', () => {
  it('a forged "approved" record for other prices is ignored at accept and PDF', async () => {
    const q = await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(12) }), req);
    await SalesQuotation.updateOne({ _id: q.id }, { $set: { discountApproval: {
      status: 'approved', priceKey: 'forged', version: 1, percent: 12, totalAmount: 8800, reason: 'x',
      requestedBy: seller._id, requestedAt: new Date(), decidedBy: seller._id, decidedAt: new Date(),
    } } });
    await blocked(quotes.acceptQuotation(seller, q.id, req));
    await blocked(quotes.getQuotationDocument(seller, q.id));
    expect(await Order.countDocuments({ 'items.name': 'Installation', totalAmount: 8800 })).toBe(0);
  });

  it('approval for 12% does not carry over when prices change between approve and accept', async () => {
    const q = await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(12) }), req);
    await approvals.requestApproval(seller, q.id, { reason: 'Fleet' }, req);
    await approvals.decideApproval(admin, q.id, { decision: 'approve' }, req);
    // Raw write deepening the discount behind the service's back: the key no longer matches.
    await SalesQuotation.updateOne({ _id: q.id }, { $set: { 'discount.percent': 30, 'discount.amount': 3000, totalAmount: 7000 } });
    await expect(quotes.acceptQuotation(seller, q.id, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('decide on an accepted or cancelled quotation is refused', async () => {
    const q = await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(12) }), req);
    await approvals.requestApproval(seller, q.id, { reason: 'Fleet' }, req);
    await quotes.cancelQuotation(seller, q.id, req);
    await expect(approvals.decideApproval(admin, q.id, { decision: 'approve' }, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('the "Needs approval" tab lists only waiting requests', async () => {
    const waiting = await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(12) }), req);
    await approvals.requestApproval(seller, waiting.id, { reason: 'Fleet' }, req);
    await quotes.createQuotation(seller, input([labour(10000)], { discount: pct(13) }), req); // not asked
    const page = await quotes.listQuotations(head, { status: 'approval' });
    expect(page.quotations.map((x) => x.id)).toContain(waiting.id);
    expect(page.quotations.every((x) => x.approval.state === 'pending')).toBe(true);
  });
});
