/**
 * GET /orders/:id for an order made from a discounted quotation: the customer sees
 * the percent and the amount; the reason and the salesman's name are staff-only.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

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
const signIn = async (email) => {
  const agent = request.agent(app);
  expect((await agent.post(`${BASE}/auth/login`).send({ email, password: PW })).status).toBe(200);
  return agent;
};

describe('a quotation discount on the order page', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  it('customer: percent + amount only; admin: who gave it and why', async () => {
    const hash = await bcrypt.hash(PW, 4);
    const customer = await User.create({ name: 'Rohit', email: 'rohit.view@example.com', phone: '9876543210', passwordHash: hash });
    await User.create({ name: 'Owner', email: 'owner.view@autobacs.test', phone: '9876543211', role: 'admin', passwordHash: hash });
    const order = await Order.create({
      user: customer._id, source: 'offline', salesUser: new mongoose.Types.ObjectId(),
      items: [{ custom: true, name: 'Installation', price: 10000, quantity: 1 }],
      shippingAddress: { fullName: 'Rohit', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 10000, discount: 500, totalAmount: 9500, status: 'awaiting_payment', paymentStatus: 'pending',
      salesDiscount: { percent: 5, amount: 500, reason: 'Repeat customer', by: new mongoose.Types.ObjectId(), byName: 'Asha', at: new Date() },
    });

    const mine = await (await signIn('rohit.view@example.com')).get(`${BASE}/orders/${order._id}`);
    expect(mine.status).toBe(200);
    const body = JSON.stringify(mine.body);
    expect(body).not.toContain('Repeat customer');
    expect(body).not.toContain('Asha');
    const seen = mine.body.order ?? mine.body.data ?? mine.body;
    expect(seen.salesDiscount).toEqual({ percent: 5, amount: 500 });
    expect(seen.discount).toBe(500);

    const adminView = await (await signIn('owner.view@autobacs.test')).get(`${BASE}/orders/${order._id}`);
    const a = adminView.body.order ?? adminView.body.data ?? adminView.body;
    expect(a.salesDiscount).toMatchObject({ percent: 5, amount: 500, reason: 'Repeat customer', byName: 'Asha' });
  });
});
