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
 *   - "send me a test" from a browser reaches THAT browser only, and says what happened
 *   - a device refused 3 times in a row is removed; a delivery resets the count;
 *     the push service's own trouble (5xx) is not counted
 *   - the daily clean-up removes devices not seen for 60 days, nothing else
 *   - the admin sees everyone's devices (and who has none); staff cannot
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
    // An order update opens the Order updates tab, with its own pop-up tag.
    expect(toAdmin.url).toMatch(/^\/admin\/chat\?c=[a-f0-9]{24}&t=updates$/);
    expect(toAdmin.tag).toMatch(/^chat-[a-f0-9]{24}-updates$/);
    expect(sent.find((x) => x.endpoint === SUB(2).endpoint).payload.url).toMatch(/^\/team\/chat\?c=[a-f0-9]{24}&t=updates$/);
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

  it('a test from this browser goes to this browser only, with its test id', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    await a.s.post('/push/subscriptions', SUB(1)); // the office PC
    await a.s.post('/push/subscriptions', SUB(2)); // the phone
    const res = await a.s.post('/push/test', { endpoint: SUB(1).endpoint, testId: 'test-12345678' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, result: 'sent' });
    expect(sent.map((x) => x.endpoint)).toEqual([SUB(1).endpoint]);
    expect(sent[0].payload).toMatchObject({ tag: 'push-test', testId: 'test-12345678', url: '/team/chat' });
    // A malformed test id is dropped, not echoed.
    sent.length = 0;
    await a.s.post('/push/test', { endpoint: SUB(1).endpoint, testId: '<script>' });
    expect(sent[0].payload.testId).toBeUndefined();
  });

  it('a test from a browser the server does not hold (or holds for someone else) asks it to re-save', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    const b = await person('Pavan', 'staff', staff('procurement'));
    await b.s.post('/push/subscriptions', SUB(1));
    expect((await a.s.post('/push/test', { endpoint: SUB(9).endpoint })).status).toBe(409);
    expect((await a.s.post('/push/test', { endpoint: SUB(1).endpoint })).status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it('a test to a device that is gone says so and removes it', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    await a.s.post('/push/subscriptions', SUB(1));
    nextError = Object.assign(new Error('Gone'), { statusCode: 410 });
    const res = await a.s.post('/push/test', { endpoint: SUB(1).endpoint });
    expect(res.body).toMatchObject({ sent: 0, result: 'gone', status: 410 });
    expect(await PushSubscription.countDocuments()).toBe(0);
  });

  it('three refusals in a row remove a device; a delivery in between resets the count; 5xx is not counted', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    await a.s.post('/push/subscriptions', SUB(1));
    const test = () => a.s.post('/push/test', { endpoint: SUB(1).endpoint });
    const refuse = () => { nextError = Object.assign(new Error('Forbidden'), { statusCode: 403, body: 'the VAPID credentials do not match' }); };
    refuse(); expect((await test()).body.result).toBe('refused');
    refuse(); await test();
    let row = await PushSubscription.findOne().lean();
    expect(row).toMatchObject({ failures: 2 });
    expect(row.lastError).toMatch(/^403 the VAPID credentials/);
    expect((await test()).body.result).toBe('sent');
    row = await PushSubscription.findOne().lean();
    expect(row).toMatchObject({ failures: 0, lastError: '' });
    expect(row.lastSentAt).toBeTruthy();
    // The push service's own trouble: never this device's fault.
    for (let i = 0; i < 4; i += 1) {
      nextError = Object.assign(new Error('Unavailable'), { statusCode: 503 });
      expect((await test()).body.result).toBe('failed');
    }
    expect((await PushSubscription.findOne().lean()).failures).toBe(0);
    for (let i = 0; i < 3; i += 1) { refuse(); await test(); }
    expect(await PushSubscription.countDocuments()).toBe(0);
  });

  it('the daily clean-up removes devices not seen for 60 days, and only those', async () => {
    const a = await person('Priya', 'staff', staff('procurement'));
    await a.s.post('/push/subscriptions', SUB(1));
    await a.s.post('/push/subscriptions', SUB(2));
    const old = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
    await PushSubscription.collection.updateOne({ endpoint: SUB(1).endpoint }, { $set: { updatedAt: old } });
    const { removeStaleDevices } = await import('../services/pushService.js');
    expect(await removeStaleDevices()).toEqual({ removed: 1 });
    expect((await PushSubscription.find().lean()).map((r) => r.endpoint)).toEqual([SUB(2).endpoint]);
    expect(await removeStaleDevices()).toEqual({ removed: 0 });
    // Re-saving (the panel opening on that browser) is what keeps a device "seen".
    await PushSubscription.collection.updateOne({ endpoint: SUB(2).endpoint }, { $set: { updatedAt: old } });
    await a.s.post('/push/subscriptions', SUB(2));
    expect(await removeStaleDevices()).toEqual({ removed: 0 });
  });

  it('the clean-up is scheduled daily', async () => {
    const before = cronService.scheduledTasks.length;
    cronService.schedulePushCleanup();
    const job = cronService.scheduledTasks.find((t) => t.name === 'pushCleanup');
    expect(job.schedule).toBe('20 4 * * *');
    job.task.stop();
    cronService.scheduledTasks.length = before;
  });

  it('the admin sees every person, their devices and whether they work; staff cannot', async () => {
    const a = await person('Priya', 'staff', { team: 'procurement', isHead: true, active: true });
    const b = await person('Pavan', 'staff', staff('procurement'));
    const owner = await person('Owner', 'admin');
    await a.s.post('/push/subscriptions', SUB(1));
    await a.s.post('/push/test', { endpoint: SUB(1).endpoint });
    expect((await b.s.get('/push/devices')).status).toBe(403);
    const res = await owner.s.get('/push/devices');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const byName = Object.fromEntries(res.body.people.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['Owner', 'Pavan', 'Priya']);
    expect(byName.Priya).toMatchObject({ team: 'Procurement', isHead: true });
    expect(byName.Priya.devices).toHaveLength(1);
    expect(byName.Priya.devices[0]).toMatchObject({ health: 'working', failures: 0 });
    expect(byName.Pavan.devices).toEqual([]);
    // Never the endpoint or keys: they are what a push is sent with.
    expect(JSON.stringify(res.body)).not.toContain('fcm.googleapis.com');
  });

  it('names the browser and computer from the user agent', async () => {
    const { describeBrowser } = await import('../services/pushService.js');
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome on Mac');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge on Windows');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on Windows');
    expect(describeBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone/iPad');
    expect(describeBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(describeBrowser('')).toBe('Browser');
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
