/**
 * Push notifications (services/pushService.js, routes/push.js, chatService push hook).
 *
 * What must hold:
 *   - only real push services are accepted as endpoints (the server POSTs there: no SSRF)
 *   - a device belongs to whoever subscribed last on it; logging out removes it
 *   - a chat message pops up for everyone who can read it, never the sender, never
 *     another team; admins get every team's messages too, but never other people's DMs
 *   - a device the push service says is gone (410) is removed; nothing ever throws
 *   - without VAPID keys push is simply off
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

process.env.VAPID_PUBLIC_KEY = 'BPub-test-key';
process.env.VAPID_PRIVATE_KEY = 'priv-test-key';

const sent = [];
let nextError = null;
jest.unstable_mockModule('web-push', () => {
  const api = {
    setVapidDetails: () => {},
    sendNotification: async (sub, payload) => {
      if (nextError) { const e = nextError; nextError = null; throw e; }
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    },
  };
  return { ...api, default: api };
});
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
const { default: PushSubscription } = await import('../models/PushSubscription.js');
const { postSystemMessage } = await import('../services/chatService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
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
    del: (url, body = {}) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}
let n = 0;
const person = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@example.com`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
};
const staff = (team) => ({ team, isHead: false, active: true });
const SUB = (i) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const settle = async () => { for (let i = 0; i < 40 && !sent.length; i += 1) await new Promise((r) => setTimeout(r, 25)); await new Promise((r) => setTimeout(r, 50)); };

describe('Push notifications', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => { sent.length = 0; nextError = null; });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  it('gives the public key, and accepts only real push services', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    expect((await a.s.get('/push/public-key')).body.publicKey).toBe('BPub-test-key');
    expect((await a.s.post('/push/subscriptions', { ...SUB(1), endpoint: 'https://evil.example.com/x' })).status).toBe(400);
    expect((await a.s.post('/push/subscriptions', { ...SUB(1), endpoint: 'http://fcm.googleapis.com/x' })).status).toBe(400);
    expect((await a.s.post('/push/subscriptions', { ...SUB(1), keys: { p256dh: 'x', auth: 'y' } })).status).toBe(400);
    expect((await a.s.post('/push/subscriptions', SUB(1))).status).toBe(201);
    expect(await PushSubscription.countDocuments()).toBe(1);
    expect([401, 403]).toContain((await request(app).post(`${BASE}/push/subscriptions`).send(SUB(2))).status);
  });

  it('a shared device moves to whoever subscribed last; unsubscribing removes it', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    const b = await person('Pavan', 'staff', staff('procurement'));
    await a.s.post('/push/subscriptions', SUB(1));
    await b.s.post('/push/subscriptions', SUB(1));
    const rows = await PushSubscription.find().lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].user)).toBe(String(b.user._id));
    await b.s.post('/push/unsubscribe', { endpoint: SUB(1).endpoint });
    expect(await PushSubscription.countDocuments()).toBe(0);
  });

  it('a team chat message pops up for teammates and the admin — not the sender, not another team', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    const b = await person('Pavan', 'staff', staff('procurement'));
    const c = await person('Sana', 'staff', staff('sales'));
    const admin = await person('Owner', 'admin');
    for (const [p, i] of [[a, 1], [b, 2], [c, 3], [admin, 4]]) await p.s.post('/push/subscriptions', SUB(i));
    const team = (await a.s.get('/chat/channels')).body.channels.find((ch) => ch.key === 'team:procurement');
    await a.s.post(`/chat/channels/${team.id}/messages`, { text: 'Supplier called back', clientId: '1e777eb2-3395-4f4d-9723-532ee8e65fd6' });
    await settle();
    expect(sent.map((x) => x.endpoint).sort()).toEqual([SUB(2).endpoint, SUB(4).endpoint].sort());
    const toTeammate = sent.find((x) => x.endpoint === SUB(2).endpoint).payload;
    expect(toTeammate).toMatchObject({ title: 'Priya · Procurement', body: 'Supplier called back', url: `/team/chat?c=${team.id}`, tag: `chat-${team.id}` });
    expect(sent.find((x) => x.endpoint === SUB(4).endpoint).payload.url).toBe(`/admin/chat?c=${team.id}`);
  });

  it('a direct message pops up only for the other person — never the admin', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    const b = await person('Pavan', 'staff', staff('procurement'));
    const admin = await person('Owner', 'admin');
    for (const [p, i] of [[a, 1], [b, 2], [admin, 4]]) await p.s.post('/push/subscriptions', SUB(i));
    const dm = await a.s.post('/chat/dm', { userId: String(b.user._id) });
    expect(dm.status).toBeLessThan(300);
    const id = dm.body.channel?.id;
    expect(id).toBeTruthy();
    await a.s.post(`/chat/channels/${id}/messages`, { text: 'Lunch?', clientId: '2e777eb2-3395-4f4d-9723-532ee8e65fd6' });
    await settle();
    expect(sent.map((x) => x.endpoint)).toEqual([SUB(2).endpoint]);
  });

  it('an automatic work update reaches the team AND the admin (admin link goes to the admin chat)', async () => {
    const b = await person('Pavan', 'staff', staff('procurement'));
    const admin = await person('Owner', 'admin');
    await b.s.post('/push/subscriptions', SUB(2));
    await admin.s.post('/push/subscriptions', SUB(4));
    await postSystemMessage('team:procurement', 'New paid order #AB12 — stock check please', { key: 'k-1' });
    await settle();
    expect(sent.map((x) => x.endpoint).sort()).toEqual([SUB(2).endpoint, SUB(4).endpoint].sort());
    const toAdmin = sent.find((x) => x.endpoint === SUB(4).endpoint).payload;
    expect(toAdmin.title).toBe('Roavion update · Procurement');
    expect(toAdmin.url).toMatch(/^\/admin\/chat\?c=/);
  });

  it('a device the push service says is gone is removed', async () => {
    const b = await person('Pavan', 'staff', staff('procurement'));
    await b.s.post('/push/subscriptions', SUB(2));
    nextError = Object.assign(new Error('Gone'), { statusCode: 410 });
    await postSystemMessage('team:procurement', 'Update', { key: 'k-2' });
    for (let i = 0; i < 40 && (await PushSubscription.countDocuments()); i += 1) await new Promise((r) => setTimeout(r, 25));
    expect(await PushSubscription.countDocuments()).toBe(0);
  });

  it('"send me a test" needs this device turned on first', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    expect((await a.s.post('/push/test')).status).toBe(409);
    await a.s.post('/push/subscriptions', SUB(1));
    const res = await a.s.post('/push/test');
    expect(res.status).toBe(200);
    expect(sent[0].payload).toMatchObject({ title: 'Roavion notifications are on', url: '/team/chat' });
  });

  it('without VAPID keys push is off: no key, subscribing is refused', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    const keep = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      expect((await a.s.get('/push/public-key')).body.publicKey).toBeNull();
      expect((await a.s.post('/push/subscriptions', SUB(1))).status).toBe(503);
    } finally {
      process.env.VAPID_PRIVATE_KEY = keep;
    }
  });
});
