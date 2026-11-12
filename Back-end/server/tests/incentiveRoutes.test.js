/**
 * Roav Points over HTTP (routes/incentives.js): who sees whose figures.
 *   salesperson → own only; GTM head → their team; admin → all + close/rules/CSV;
 *   customers and other teams' heads → no team view.
 * Auth, CSRF and the real routers run; the queue is a double.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);
process.env.INCENTIVES_START_MONTH = '2020-01';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, enqueueMetaLeadSheetWrite: () => Promise.resolve(), closeQueues: () => Promise.resolve(),
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: IncentiveLedgerEntry } = await import('../models/IncentiveLedgerEntry.js');
const { default: IncentiveMonth } = await import('../models/IncentiveMonth.js');
const { default: IncentiveOrderFlag } = await import('../models/IncentiveOrderFlag.js');
const { default: IncentiveRuleSet } = await import('../models/IncentiveRuleSet.js');
const { monthOf } = await import('../services/incentives/months.js');

const BASE = '/api/v1/incentives';
const PW = 'SecurePass123!';
const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}
let n = 0;
async function makeUser(name, role, staff) {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
}

const month = monthOf(new Date());
const row = (user, centi, extra = {}) => ({
  key: `k:${new mongoose.Types.ObjectId()}`, type: 'earn', month, earnerKey: `u:${user._id}`, earnerUser: user._id,
  earnerName: user.name, share: 1, order: new mongoose.Types.ObjectId(), orderNumber: '#ABC', component: 'order',
  centi, flatCenti: centi, rulesVersion: 1, eventAt: new Date(), ...extra,
});

describe('Roav Points routes — access', () => {
  let admin; let head; let asha; let bilal; let shopper; let mktHead;
  beforeAll(async () => {
    await dbHandler.connect();
    await Promise.all([IncentiveLedgerEntry.init(), IncentiveMonth.init(), IncentiveOrderFlag.init(), IncentiveRuleSet.init()]);
  });
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    head = await makeUser('Gtm Head', 'staff', { team: 'sales', isHead: true, active: true });
    asha = await makeUser('Asha', 'staff', { team: 'sales', subRole: 'lead', active: true });
    bilal = await makeUser('Bilal', 'staff', { team: 'sales', subRole: 'lead', active: true });
    mktHead = await makeUser('Mkt Head', 'staff', { team: 'marketing', isHead: true, active: true });
    shopper = await makeUser('Shopper', 'customer');
    await IncentiveLedgerEntry.insertMany([row(asha.user, 6729900), row(bilal.user, 6730000)]);
  });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  test('a salesperson sees their own month, slab and points to the next slab', async () => {
    const res = await asha.s.get('/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ points: 67299, slab: 'Turbo', next: { name: 'Nitro', pointsToGo: 1 } });
    expect(res.body.payout).toBeCloseTo(67299 * 0.55, 2);
    const b = await bilal.s.get('/me');
    expect(b.body).toMatchObject({ points: 67300, slab: 'Nitro' });
  });

  test('a salesperson cannot see the team or another person', async () => {
    expect((await asha.s.get('/team')).status).toBe(403);
    expect((await asha.s.get(`/people/u:${bilal.user._id}`)).status).toBe(403);
    expect((await asha.s.get(`/people/u:${bilal.user._id}/rows`)).status).toBe(403);
    expect((await asha.s.get('/rules')).status).toBe(403);
    expect((await asha.s.get(`/months/${month}`)).status).toBe(403);
  });

  test('the GTM head sees the team ranked; another team\'s head does not', async () => {
    const res = await head.s.get('/team');
    expect(res.status).toBe(200);
    expect(res.body.people.map((p) => p.name)).toEqual(['Bilal', 'Asha']);
    expect((await head.s.get(`/people/u:${asha.user._id}/rows`)).status).toBe(200);
    expect((await mktHead.s.get('/team')).status).toBe(403);
  });

  test('a customer gets nothing', async () => {
    expect((await shopper.s.get('/me')).status).toBe(403);
  });

  test('admin: everyone, rules, month list, flag toggle', async () => {
    expect((await admin.s.get('/team')).body.people).toHaveLength(2);
    const rules = await admin.s.get('/rules');
    expect(rules.status).toBe(200);
    expect(rules.body.current.rules.slabs).toHaveLength(6);
    const bad = await admin.s.post('/rules', { rules: { ...rules.body.current.rules, perOrderBonus: -5 } });
    expect(bad.status).toBe(400);
    const ok = await admin.s.post('/rules', { rules: rules.body.current.rules, note: 'same' });
    expect(ok.status).toBe(201);
    expect((await admin.s.get('/months')).status).toBe(200);
    const flag = await admin.s.put(`/orders/${new mongoose.Types.ObjectId()}/flag`, { specialSourcing: true });
    expect(flag.status).toBe(200);
    expect(flag.body.changed).toBe(true);
  });

  test('locking the current month is refused; the CSV needs an approved month', async () => {
    expect((await admin.s.post(`/months/${month}/lock`)).status).toBe(400);
    expect((await admin.s.get(`/months/${month}/export.csv`)).status).toBe(409);
  });

  test('champion is readable by any staff member', async () => {
    const res = await asha.s.get('/champion');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('champion');
  });
});
