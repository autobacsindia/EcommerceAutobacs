/** Extra charges over HTTP: real auth, CSRF and validation. The rules are in orderExtraCharge.test.js. */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: OrderExtraCharge } = await import('../models/OrderExtraCharge.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const csrfFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='))?.split(';')[0].split('=')[1] || '';
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}
let n = 0;
const make = async (role, staff) => {
  n += 1;
  const email = `u${n}@autobacs.test`;
  const user = await User.create({ name: `U${n}`, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const key = () => new mongoose.Types.ObjectId().toString();

describe('Extra charge routes', () => {
  beforeAll(async () => { await dbHandler.connect(); await OrderExtraCharge.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(() => dbHandler.clearDatabase());

  let seller; let accounts; let customer; let order;
  beforeEach(async () => {
    seller = await make('staff', { team: 'sales', isHead: false, active: true, gtmRole: 'lead' });
    accounts = await make('staff', { team: 'accounts', isHead: false, active: true });
    customer = await make('customer', undefined);
    order = await Order.create({
      user: customer.user._id, source: 'offline', salesUser: seller.user._id,
      items: [{ custom: true, name: 'Kit', price: 29000, quantity: 1 }], subtotal: 29000, totalAmount: 29000,
      shippingAddress: { fullName: 'A', phone: '9', addressLine1: '1', city: 'K', state: 'KL', postalCode: '682001' },
      status: 'processing', paymentStatus: 'paid',
    });
  });
  const body = (over = {}) => ({ amount: 5000, reason: 'Larger screen fitting', customerConfirmed: true, clientKey: key(), ...over });

  it('401 without a login', async () => {
    const r = await request(app).get(`${BASE}/staff/orders/${order._id}/extra-charges`);
    expect(r.status).toBe(401);
    expect((await request(app).get(`${BASE}/staff/extra-charges`)).status).toBe(401);
  });
  it('403 for a customer, on every staff route', async () => {
    const created = await seller.session.post(`/staff/orders/${order._id}/extra-charges`, body());
    const { id } = created.body.extra;
    expect((await customer.session.get(`/staff/orders/${order._id}/extra-charges`)).status).toBe(403);
    expect((await customer.session.post(`/staff/orders/${order._id}/extra-charges`, body())).status).toBe(403);
    expect((await customer.session.post(`/staff/extra-charges/${id}/approve`)).status).toBe(403);
    expect((await customer.session.post(`/staff/extra-charges/${id}/refund`)).status).toBe(403);
  });
  it('a seller cannot approve; Accounts can; the amount cannot be sent with approval', async () => {
    const created = await seller.session.post(`/staff/orders/${order._id}/extra-charges`, body());
    expect(created.status).toBe(201);
    const { id } = created.body.extra;
    expect((await seller.session.post(`/staff/extra-charges/${id}/approve`)).status).toBe(403);
    const ok = await accounts.session.post(`/staff/extra-charges/${id}/approve`, { amount: 1, note: 'fine' });
    expect(ok.status).toBe(200);
    expect(ok.body.extra.amount).toBe(5000);
  });
  it('ignores fields the client has no business sending', async () => {
    const r = await seller.session.post(`/staff/orders/${order._id}/extra-charges`, body({ status: 'paid', paidAt: new Date(), sequence: 99, order: new mongoose.Types.ObjectId() }));
    expect(r.status).toBe(201);
    expect(r.body.extra).toMatchObject({ status: 'awaiting_accounts', sequence: 1, orderId: String(order._id) });
    const totals = await seller.session.get(`/staff/orders/${order._id}/extra-charges`);
    expect(totals.body.totals).toMatchObject({ extrasPaid: 0, finalAmount: 29000 });
  });
  it('400 on a bad amount; 400 on a bad id', async () => {
    expect((await seller.session.post(`/staff/orders/${order._id}/extra-charges`, body({ amount: -1 }))).status).toBe(400);
    expect((await seller.session.post('/staff/extra-charges/nope/approve')).status).toBe(400);
  });
  it('the customer order page carries only their visible extras', async () => {
    const created = await seller.session.post(`/staff/orders/${order._id}/extra-charges`, body());
    let page = await customer.session.get(`/orders/${order._id}`);
    expect(page.body.order.extraCharges).toEqual([]);
    expect(page.body.order.extraChargeTotals).toMatchObject({ extrasPaid: 0, finalAmount: 29000 });
    await accounts.session.post(`/staff/extra-charges/${created.body.extra.id}/approve`);
    page = await customer.session.get(`/orders/${order._id}`);
    expect(page.body.order.extraCharges).toHaveLength(1);
    expect(page.body.order.totalAmount).toBe(29000);
  });
});
