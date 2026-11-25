/** "Ship before payment" over HTTP: real auth, CSRF and validation. The rules are in payLater.test.js. */
import bcrypt from 'bcryptjs';
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
  };
}
let n = 0;
const make = async (role, staff) => {
  n += 1;
  const email = `p${n}@autobacs.test`;
  const user = await User.create({ name: `P${n}`, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};

describe('Ship before payment routes', () => {
  beforeAll(async () => { await dbHandler.connect(); });
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
      items: [{ custom: true, name: 'Seat covers', price: 8000, quantity: 1 }], subtotal: 8000, totalAmount: 8000,
      shippingAddress: { fullName: 'R', phone: '9', addressLine1: '1', city: 'P', state: 'MH', postalCode: '411001' },
      status: 'awaiting_payment', paymentStatus: 'pending',
    });
  });
  const url = () => `/staff/orders/${order._id}/pay-later`;

  it('401 without a login', async () => {
    expect((await request(app).get(`${BASE}${url()}`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/staff/pay-later`)).status).toBe(401);
  });

  it('403 for anyone but the admin on approve; the order is untouched', async () => {
    for (const who of [seller, accounts]) {
      const r = await who.session.post(url(), { reason: 'Pays after tracking' });
      expect(r.status).toBe(403);
    }
    expect((await Order.findById(order._id).lean()).status).toBe('awaiting_payment');
  });

  it('400 without a reason; 400 on a bad id', async () => {
    const admin = await make('admin', undefined);
    expect((await admin.session.post(url(), {})).status).toBe(400);
    expect((await admin.session.post('/staff/orders/nope/pay-later', { reason: 'abc' })).status).toBe(400);
  });

  it('admin approves; accounts lists it; a seller cannot list', async () => {
    const admin = await make('admin', undefined);
    const opt = await admin.session.get(url());
    expect(opt.status).toBe(200);
    expect(opt.body.canApprove).toBe(true);
    const r = await admin.session.post(url(), { reason: 'Regular dealer' });
    expect(r.status).toBe(200);
    expect(r.body.order.payLater.reason).toBe('Regular dealer');
    const saved = await Order.findById(order._id).lean();
    expect(saved).toMatchObject({ status: 'processing', paymentStatus: 'pending' });

    const list = await accounts.session.get('/staff/pay-later?view=due');
    expect(list.status).toBe(200);
    expect(list.body.orders).toHaveLength(1);
    expect(list.body.summary.owed).toBe(8000);
    expect((await seller.session.get('/staff/pay-later')).status).toBe(403);
    expect((await accounts.session.get('/staff/pay-later?view=nope')).status).toBe(400);
  });
});
