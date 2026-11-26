/**
 * Supplier parts over HTTP (routes/staff.js → services/supplierPartsService.js),
 * with real payment requests. Real case: "Jerry Can 20L — with locking mount" is
 * one product on the website but two things to buy.
 *
 * What must hold:
 *   - an order line can be split across suppliers; each part has its own payment
 *     (PR) and status; a split line ships only once EVERY active part is paid
 *   - changing a supplier needs a reason; the old supplier stays as history (never
 *     deleted), with who / when / why, in the order history and the audit log
 *   - a waiting PR on the old supplier is cancelled the normal way; an approved one
 *     blocks the change; a paid one stays paid and "Supplier must refund" opens on it
 *   - lines never split work exactly as before (no migration)
 *   - only procurement (and admin) change suppliers; two changes at once → one wins
 *   - the customer's order (status, totals) is untouched
 */

import { withoutMinimumMargin } from './helpers/marginRule.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const { default: orderRepository } = await import('../repositories/orderRepository.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    form: (url, fields = {}, files = []) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      for (const f of files) r = r.attach(f.field, f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s+/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const staff = (team, isHead = false) => ({ team, isHead, active: true });
const bank = (name) => ({ name, method: 'bank', accountName: `${name} Pvt Ltd`, accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' });

async function paidOrder() {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Jerry Can 20L', variantLabel: 'jerry can with locking mount', price: 4500, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 4500, totalAmount: 4500, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

describe('Supplier parts', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, procurement, sales, order, id, item;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    procurement = await makeUser('Aromal S', 'staff', staff('procurement'));
    sales = await makeUser('Sam', 'staff', staff('sales', true));
    order = await paidOrder();
    id = String(order._id);
    item = String(order.items[0]._id);
  });

  const lineUrl = () => `/staff/work/orders/${id}/lines/${item}`;
  const view = async () => (await procurement.session.get(`/staff/work/orders/${id}`)).body.order;
  const lineOf = async () => (await view()).lines[0];
  const addPart = (supplierName, what, s = procurement.session) => s.post(`${lineUrl()}/parts`, { supplierName, what });
  const change = (partId, body, s = procurement.session) => s.post(`${lineUrl()}/parts/${partId}/change`, body);
  const raise = (fields) => procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [item], amount: 1000, ...fields });
  const approve = (prId) => accounts.session.post(`/payment-requests/${prId}/approve`);
  const pay = (prId) => admin.session.form(`/payment-requests/${prId}/pay`, { method: 'bank', reference: 'UTR12345' });
  const ship = () => procurement.session.form(`/staff/work/orders/${id}/ship`, { itemIds: [item] }, [{ field: 'photo', buffer: JPEG, name: 'p.jpg', type: 'image/jpeg' }]);
  const activeParts = (line) => line.supplierParts.filter((p) => p.status === 'active');

  it('an order with no supplier yet: nothing to change; adding parts splits the line', async () => {
    let line = await lineOf();
    expect(line).toMatchObject({ split: false, supplierParts: [], stage: 'stock_check' });
    expect(line.actions).toContain('supplier_parts');
    expect((await change('main', { supplierName: 'X', reasonCode: 'late' })).status).toBe(404);

    expect((await addPart('Trek N Trade', 'Jerry can')).status).toBe(200);
    const res = await addPart('Mount Co', 'Locking mount');
    expect(res.status).toBe(200);
    line = res.body.order.lines[0];
    expect(line).toMatchObject({ split: true, stage: 'to_ship', stageLabel: 'In Stock (0 of 2 parts ordered)' });
    expect(line.supplierParts.map((p) => [p.what, p.supplierName, p.state])).toEqual([
      ['Jerry can', 'Trek N Trade', 'to_order'], ['Locking mount', 'Mount Co', 'to_order'],
    ]);
    // No manual "ordered" / ship until the parts are paid.
    expect(line.actions).not.toContain('ship');
    expect(line.actions).not.toContain('ordered');
    expect(line.partsWaiting).toMatch(/Jerry can from Trek N Trade.*Locking mount from Mount Co/);
    expect(res.body.order.history.some((h) => h.code === 'part_added' && h.by === 'Aromal S')).toBe(true);
  });

  it('split across 2 suppliers: each part has its own PR and status; dispatch waits for every part', async () => {
    await addPart('Trek N Trade', 'Jerry can');
    const [can, mount] = (await addPart('Mount Co', 'Locking mount')).body.order.lines[0].supplierParts;

    // A split item is paid one part at a time — the part must be named.
    expect((await raise({ payee: bank('Trek N Trade') })).status).toBe(400);
    const prCan = await raise({ partId: can.id, payee: bank('Trek N Trade') });
    expect(prCan.status).toBe(201);
    expect(prCan.body.request.itemNames[0]).toMatch(/part: Jerry can$/);
    // Same part twice → refused; the other part can still be paid while the first waits.
    expect((await raise({ partId: can.id, payee: bank('Trek N Trade') })).status).toBe(409);
    const prMount = await raise({ partId: mount.id, payee: bank('Mount Co'), amount: 500 });
    expect(prMount.status).toBe(201);

    let line = await lineOf();
    expect(line.stage).toBe('payment_pending');
    expect(line.supplierParts.map((p) => [p.state, p.paymentRef])).toEqual([
      ['payment_pending', prCan.body.request.number], ['payment_pending', prMount.body.request.number],
    ]);
    // PRs carry their part, for the panel.
    const forOrder = (await procurement.session.get(`/payment-requests/order/${id}`)).body.requests;
    expect(forOrder.map((r) => r.partId).sort()).toEqual([can.id, mount.id].sort());

    await approve(prCan.body.request.id);
    expect((await pay(prCan.body.request.id)).status).toBe(200);
    line = await lineOf();
    expect(line.stage).toBe('payment_pending'); // the mount still waits
    expect(line.supplierParts.map((p) => p.state)).toEqual(['ordered', 'payment_pending']);
    expect((await ship()).status).toBe(409);

    await approve(prMount.body.request.id);
    await pay(prMount.body.request.id);
    line = await lineOf();
    expect(line).toMatchObject({ stage: 'with_supplier', partsWaiting: '' });
    expect(line.actions).toContain('ship');
    expect((await ship()).status).toBe(200);
    expect((await lineOf()).stage).toBe('shipped');
  });

  it('change after a PAID supplier refunded: old kept as history, PR stays paid, "Supplier must refund" opens', async () => {
    // Today's single-supplier flow, untouched: PR raised and paid → Ordered From Supplier.
    const pr = await raise({ payee: bank('G S Enterprises'), amount: 2065, saveSupplier: 'true' });
    expect(pr.status).toBe(201);
    await approve(pr.body.request.id);
    await pay(pr.body.request.id);
    let line = await lineOf();
    expect(line).toMatchObject({ stage: 'with_supplier', split: false, supplierName: 'G S Enterprises' });
    expect(line.supplierParts).toEqual([expect.objectContaining({ id: 'main', supplierName: 'G S Enterprises', state: 'ordered' })]);

    // Missing / wrong reason → refused, nothing written.
    expect((await change('main', { supplierName: 'Trek N Trade' })).status).toBe(400);
    expect((await change('main', { supplierName: 'Trek N Trade', reasonCode: 'other' })).status).toBe(400);
    expect((await change('main', { supplierName: 'g s enterprises', reasonCode: 'late' })).status).toBe(400);
    expect((await Order.findById(id).lean()).workflow.lines[0].parts).toBeUndefined();

    const res = await change('main', { supplierName: 'Trek N Trade', reasonCode: 'supplier_refunded', reasonNote: 'out of stock' });
    expect(res.status).toBe(200);
    line = res.body.order.lines[0];
    expect(line).toMatchObject({ split: true, stage: 'to_ship', supplierName: 'Trek N Trade' });
    const [was, now] = line.supplierParts;
    expect(was).toMatchObject({ supplierName: 'G S Enterprises', status: 'replaced', replacedByName: 'Aromal S', reason: 'Supplier refunded — out of stock', replacedWith: now.id });
    expect(now).toMatchObject({ supplierName: 'Trek N Trade', status: 'active', state: 'to_order', replaces: was.id });
    const h = res.body.order.history.find((x) => x.code === 'supplier_changed');
    expect(h).toMatchObject({ by: 'Aromal S', action: 'Supplier changed' });
    expect(h.note).toContain('G S Enterprises → Trek N Trade');
    expect(h.note).toContain('Supplier refunded — out of stock');
    expect(h.note).toContain(`${pr.body.request.number} paid — refund due from G S Enterprises`);
    const audit = await AuditLog.findOne({ 'details.change': 'supplier_changed' }).lean();
    expect(audit?.details).toMatchObject({ from: 'G S Enterprises', to: 'Trek N Trade', reasonCode: 'supplier_refunded', paid: [pr.body.request.number] });

    // The money trail: the PR stays paid, linked, and now offers "Supplier must refund".
    expect((await PaymentRequest.findById(pr.body.request.id).lean()).status).toBe('paid');
    const row = (await procurement.session.get(`/payment-requests/order/${id}`)).body.requests.find((r) => r.id === pr.body.request.id);
    expect(row.supplierRefund).toMatchObject({ canClaim: true, savedSupplier: true, why: 'supplier_changed' });
    // One read of the order works out both "cancelled?" and "part replaced?" (was two).
    const reads = jest.spyOn(orderRepository, 'findForWorkflow');
    expect((await procurement.session.get(`/payment-requests/${pr.body.request.id}`)).body.request.supplierRefund).toMatchObject({ why: 'supplier_changed' });
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockRestore();
    const claim = await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: pr.body.request.id, note: 'Refund for jerry can' });
    expect(claim.status).toBe(201);
    expect(claim.body.entry).toMatchObject({ kind: 'refund_due', status: 'pending' });

    // The new supplier is paid on its own part; the old PR is not counted again.
    const next = await raise({ partId: now.id, payee: bank('Trek N Trade') });
    expect(next.status).toBe(201);
    await approve(next.body.request.id);
    await pay(next.body.request.id);
    expect((await lineOf()).stage).toBe('with_supplier');

    // The customer's order is untouched.
    const o = await Order.findById(id).lean();
    expect(o).toMatchObject({ totalAmount: 4500, status: 'processing', paymentStatus: 'paid' });
  });

  it('change twice (A → B → C): every supplier stays, chained, in order', async () => {
    const [a] = (await addPart('Alpha', 'Jerry can')).body.order.lines[0].supplierParts;
    const b = (await change(a.id, { supplierName: 'Bravo', reasonCode: 'late' })).body.order.lines[0].supplierParts[1];
    const res = await change(b.id, { supplierName: 'Charlie', reasonCode: 'price_changed', reasonNote: 'asked ₹600 more' });
    const parts = res.body.order.lines[0].supplierParts;
    expect(parts.map((p) => [p.supplierName, p.status, p.what])).toEqual([
      ['Alpha', 'replaced', 'Jerry can'], ['Bravo', 'replaced', 'Jerry can'], ['Charlie', 'active', 'Jerry can'],
    ]);
    expect(parts[0].replacedWith).toBe(parts[1].id);
    expect(parts[1].replacedWith).toBe(parts[2].id);
    expect(parts[1].reason).toBe('Supplier changed the price — asked ₹600 more');
    // The old one cannot be changed again.
    expect((await change(a.id, { supplierName: 'Delta', reasonCode: 'late' })).status).toBe(409);
    expect(res.body.order.history.filter((h) => h.code === 'supplier_changed')).toHaveLength(2);
  });

  it('a PR still waiting on the old supplier is cancelled the normal way; an APPROVED one blocks the change', async () => {
    const pr = await raise({ payee: bank('G S Enterprises') });
    expect((await lineOf()).stage).toBe('payment_pending');
    const res = await change('main', { supplierName: 'Trek N Trade', reasonCode: 'out_of_stock' });
    expect(res.status).toBe(200);
    const doc = await PaymentRequest.findById(pr.body.request.id).lean();
    expect(doc.status).toBe('cancelled');
    expect(doc.history.at(-1).note).toMatch(/Supplier changed/);
    expect(res.body.order.lines[0]).toMatchObject({ stage: 'to_ship' });
    expect(res.body.order.history.find((h) => h.code === 'supplier_changed').note).toContain(`${pr.body.request.number} cancelled`);

    // Approved: accounts' call — refused, nothing changes.
    const [, trek] = res.body.order.lines[0].supplierParts;
    const pr2 = await raise({ partId: trek.id, payee: bank('Trek N Trade') });
    await approve(pr2.body.request.id);
    const before = (await Order.findById(id).lean()).workflow.lines[0].parts;
    const refused = await change(trek.id, { supplierName: 'Third Co', reasonCode: 'late' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/approved by accounts.*put it on hold and decline it/);
    expect((await PaymentRequest.findById(pr2.body.request.id).lean()).status).toBe('approved');
    expect((await Order.findById(id).lean()).workflow.lines[0].parts).toEqual(before);

    // Accounts hold and decline it (never paid) → the part can change.
    await accounts.session.post(`/payment-requests/${pr2.body.request.id}/hold`, { note: 'Supplier backed out' });
    expect((await change(trek.id, { supplierName: 'Third Co', reasonCode: 'late' })).body.message).toMatch(/decline it first/);
    expect((await accounts.session.post(`/payment-requests/${pr2.body.request.id}/decline`, { note: 'Supplier backed out' })).status).toBe(200);
    expect((await lineOf()).supplierParts[1].state).toBe('to_order');
    expect((await change(trek.id, { supplierName: 'Third Co', reasonCode: 'late' })).status).toBe(200);
  });

  it('only procurement and admin change suppliers; accounts read the history', async () => {
    await raise({ payee: bank('G S Enterprises') });
    expect((await addPart('X', '', accounts.session)).status).toBe(403);
    expect((await change('main', { supplierName: 'X', reasonCode: 'late' }, sales.session)).status).toBe(403);
    expect((await change('main', { supplierName: 'X', reasonCode: 'late' }, accounts.session)).status).toBe(403);
    expect((await addPart('Admin Co', 'mount', admin.session)).status).toBe(200);
    const asAccounts = (await accounts.session.get(`/staff/work/orders/${id}`)).body.order.lines[0];
    expect(asAccounts.supplierParts).toHaveLength(2);
    expect(asAccounts.actions).not.toContain('supplier_parts');
  });

  it('two changes at the same moment: exactly one lands', async () => {
    const [a] = (await addPart('Alpha', 'Jerry can')).body.order.lines[0].supplierParts;
    const results = await Promise.all([
      change(a.id, { supplierName: 'Bravo', reasonCode: 'late' }),
      change(a.id, { supplierName: 'Charlie', reasonCode: 'late' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const parts = (await Order.findById(id).lean()).workflow.lines[0].parts;
    expect(parts.filter((p) => p.status === 'active')).toHaveLength(1);
    expect(parts).toHaveLength(2);
  });

  it('remove a part added by mistake (never paid), kept as history; not one with a payment', async () => {
    await addPart('Alpha', 'Jerry can');
    const [a, b] = (await addPart('Typo Co', 'mount')).body.order.lines[0].supplierParts;
    expect((await procurement.session.patch(`${lineUrl()}/parts/${b.id}`, { supplierName: 'Mount Co', what: 'Locking mount' })).status).toBe(200);
    const pr = await raise({ partId: a.id, payee: bank('Alpha') });
    expect((await procurement.session.post(`${lineUrl()}/parts/${a.id}/remove`, {})).status).toBe(409);
    expect((await procurement.session.patch(`${lineUrl()}/parts/${a.id}`, { supplierName: 'Other' })).status).toBe(409);
    const removed = await procurement.session.post(`${lineUrl()}/parts/${b.id}/remove`, { note: 'not needed' });
    expect(removed.status).toBe(200);
    const parts = removed.body.order.lines[0].supplierParts;
    expect(parts.map((p) => [p.supplierName, p.status])).toEqual([['Alpha', 'active'], ['Mount Co', 'removed']]);
    expect(activeParts(removed.body.order.lines[0])).toHaveLength(1);
    expect(pr.status).toBe(201);
  });

  it('a split line with a paid part cannot be sent from our warehouse; deals are refused on split lines', async () => {
    const [a] = (await addPart('Alpha', 'Jerry can')).body.order.lines[0].supplierParts;
    await addPart('Bravo', 'mount');
    const pr = await raise({ partId: a.id, payee: bank('Alpha') });
    await approve(pr.body.request.id);
    await pay(pr.body.request.id);
    expect((await lineOf()).actions).not.toContain('own_stock');
    expect((await procurement.session.post(`${lineUrl()}/stock`, { stock: 'own_stock' })).status).toBe(409);
    const deal = await procurement.session.form('/payment-requests/deals', {
      orderId: id, itemIds: [item], currency: 'INR', agreedTotal: 5000, advance: 1000, completionDate: '2027-01-10', payee: bank('Alpha'),
    });
    expect(deal.status).toBe(409);
  });

  it('a payment event after the line was split lands on the right part (legacy PR raised before the split)', async () => {
    const pr = await raise({ payee: bank('G S Enterprises') });
    // Split while the original PR waits: it moves onto the first part.
    const res = await addPart('Mount Co', 'Locking mount');
    expect(res.body.order.lines[0].supplierParts.map((p) => [p.supplierName, p.state])).toEqual([
      ['G S Enterprises', 'payment_pending'], ['Mount Co', 'to_order'],
    ]);
    expect((await Order.findById(id).lean()).workflow.lines[0].supplierPaymentAt).toBeUndefined();
    await approve(pr.body.request.id);
    await pay(pr.body.request.id);
    expect((await lineOf()).supplierParts.map((p) => p.state)).toEqual(['ordered', 'to_order']);
    // Same event again (a retry) changes nothing.
    await wf.markPaidOrdered(admin.user, id, [item], 'G S Enterprises', { ref: pr.body.request.number });
    expect((await lineOf()).supplierParts.map((p) => p.state)).toEqual(['ordered', 'to_order']);
    expect(req).toBeDefined();
  });
});

// Older payment cases are not about the 30% minimum (tests/supplierMargin.test.js is).
withoutMinimumMargin();
