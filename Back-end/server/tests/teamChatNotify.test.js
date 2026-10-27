/**
 * Per-conversation notification settings — "All", "@mentions only", "Off" —
 * as in Google Chat (chatService.setChannelNotify, pushForMessage, notifyMentions).
 *
 * What must hold:
 *   - the setting is each person's own, per conversation; it never touches
 *     anyone else's, nor their read position;
 *   - "Off": no pop-up and no mention email from that conversation;
 *   - "@mentions only": a pop-up only when they or their team are @mentioned,
 *     and the unread badge counts only those messages;
 *   - only someone who can read a conversation can set it (404 otherwise).
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
const emailHandler = (await import('../services/emailHandler.js')).default;

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
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
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


describe('Conversation notification settings', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => { sent.length = 0; nextError = null; });
  afterEach(async () => { await dbHandler.clearDatabase(); jest.restoreAllMocks(); });

  let priya, pavan, sana, admin, procurement, company;
  beforeEach(async () => {
    priya = await person('Priya', 'staff', staff('procurement'));
    pavan = await person('Pavan', 'staff', staff('procurement'));
    sana = await person('Sana', 'staff', staff('sales'));
    admin = await person('Owner', 'admin');
    for (const [p, i] of [[pavan, 2], [sana, 3], [admin, 4]]) await p.s.post('/push/subscriptions', SUB(i));
    const channels = (await priya.s.get('/chat/channels')).body.channels;
    procurement = channels.find((c) => c.key === 'team:procurement');
    company = channels.find((c) => c.key === 'company');
    sent.length = 0;
  });

  let cid = 0;
  const say = async (who, channel, body) => {
    const res = await who.s.post(`/chat/channels/${channel.id}/messages`, { clientId: `notify-${++cid}-test`, ...body });
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const setNotify = (who, channel, notify) => who.s.put(`/chat/channels/${channel.id}/notify`, { notify });
  const channelFor = async (who, channel) => (await who.s.get('/chat/channels')).body.channels.find((c) => c.id === channel.id);
  const poppedFor = () => sent.map((x) => x.endpoint);

  describe('the setting', () => {
    it('is "all" until changed, and is each person’s own', async () => {
      expect((await channelFor(pavan, procurement)).notify).toBe('all');
      const res = await setNotify(pavan, procurement, 'off');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ channelId: procurement.id, notify: 'off' });
      expect((await channelFor(pavan, procurement)).notify).toBe('off');
      expect((await channelFor(priya, procurement)).notify).toBe('all');
      expect((await channelFor(pavan, company)).notify).toBe('all');
    });

    it('does not touch what has been read', async () => {
      await say(priya, procurement, { text: 'one' });
      await say(priya, procurement, { text: 'two' });
      await setNotify(pavan, procurement, 'mentions');
      await setNotify(pavan, procurement, 'all');
      expect((await channelFor(pavan, procurement)).unread).toBe(2);

      const { lastMessageSeq } = await channelFor(pavan, procurement);
      await pavan.s.post(`/chat/channels/${procurement.id}/read`, { seq: lastMessageSeq });
      await setNotify(pavan, procurement, 'off');
      expect((await channelFor(pavan, procurement)).unread).toBe(0);
    });

    it.each([['loud'], [''], [null]])('refuses %p', async (notify) => {
      expect((await setNotify(pavan, procurement, notify)).status).toBe(400);
    });

    it('cannot be set on a conversation you cannot read', async () => {
      expect((await setNotify(sana, procurement, 'off')).status).toBe(404);
    });

    it('customers are refused', async () => {
      const cara = await person('Cara', 'customer');
      expect((await setNotify(cara, company, 'off')).status).toBe(403);
    });
  });

  describe('pop-ups', () => {
    it('"Off" stops them from that conversation only', async () => {
      await setNotify(pavan, procurement, 'off');
      await say(priya, procurement, { text: 'Supplier called back' });
      await settle();
      expect(poppedFor()).toEqual([SUB(4).endpoint]); // the admin still hears; Pavan does not

      sent.length = 0;
      await say(priya, company, { text: 'Lunch at 1' });
      await settle();
      expect(poppedFor()).toContain(SUB(2).endpoint);
    });

    it('"Off" also silences an @mention', async () => {
      await setNotify(pavan, procurement, 'off');
      await say(priya, procurement, { text: '@Pavan please check', mentions: [String(pavan.user._id)] });
      await settle();
      expect(poppedFor()).not.toContain(SUB(2).endpoint);
    });

    it('"@mentions only" pops up for a mention of you or your team, and nothing else', async () => {
      await setNotify(pavan, procurement, 'mentions');
      await say(priya, procurement, { text: 'just chatting' });
      await settle();
      expect(poppedFor()).not.toContain(SUB(2).endpoint);

      sent.length = 0;
      await say(priya, procurement, { text: '@Pavan stock?', mentions: [String(pavan.user._id)] });
      await settle();
      expect(poppedFor()).toContain(SUB(2).endpoint);

      sent.length = 0;
      await say(priya, procurement, { text: '@procurement meeting', mentionTeams: ['procurement'] });
      await settle();
      expect(poppedFor()).toContain(SUB(2).endpoint);
    });

    it('"@mentions only" keeps automatic order updates quiet too', async () => {
      await setNotify(pavan, procurement, 'mentions');
      await postSystemMessage('team:procurement', 'New paid order #AB12', { key: 'k-quiet' });
      await settle();
      expect(poppedFor()).toEqual([SUB(4).endpoint]);
    });

    it('applies in a direct message too', async () => {
      const dm = (await priya.s.post('/chat/dm', { userId: String(pavan.user._id) })).body.channel;
      await setNotify(pavan, dm, 'off');
      await say(priya, dm, { text: 'ping' });
      await settle();
      expect(poppedFor()).toEqual([]);
    });
  });

  describe('mention emails', () => {
    it('"Off" means no email; "@mentions only" still emails a mention', async () => {
      const mail = jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
      await setNotify(pavan, procurement, 'off');
      await say(priya, procurement, { text: '@Pavan hi', mentions: [String(pavan.user._id)] });
      await new Promise((r) => setTimeout(r, 300));
      expect(mail).not.toHaveBeenCalled();

      await setNotify(pavan, procurement, 'mentions');
      await say(priya, procurement, { text: '@Pavan hi again', mentions: [String(pavan.user._id)] });
      for (let i = 0; i < 40 && !mail.mock.calls.length; i += 1) await new Promise((r) => setTimeout(r, 25));
      expect(mail).toHaveBeenCalledTimes(1);
      expect(mail.mock.calls[0][0].to).toBe(pavan.user.email);
    });
  });

  describe('unread on "@mentions only"', () => {
    it('counts only what addresses you or your team, in both tabs', async () => {
      await setNotify(pavan, procurement, 'mentions');
      await say(priya, procurement, { text: 'chatter' });
      await say(priya, procurement, { text: '@Pavan look', mentions: [String(pavan.user._id)] });
      await say(priya, procurement, { text: '@procurement all', mentionTeams: ['procurement'] });
      await postSystemMessage('team:procurement', 'Order #CD34 paid', { key: 'k-u1' });
      await postSystemMessage('team:procurement', 'Order #EF56 needs @Pavan', { key: 'k-u2', mentions: [String(pavan.user._id)] });

      const c = await channelFor(pavan, procurement);
      expect(c.unread).toBe(5);
      expect(c.unreadMentions).toBe(3);

      await pavan.s.post(`/chat/channels/${procurement.id}/read`, { seq: c.lastMessageSeq, part: 'chat' });
      expect((await channelFor(pavan, procurement)).unreadMentions).toBe(1); // the order update still waits
    });

    it('is 0 for a conversation set to "all"', async () => {
      await say(priya, procurement, { text: '@Pavan look', mentions: [String(pavan.user._id)] });
      expect((await channelFor(pavan, procurement)).unreadMentions).toBe(0);
    });
  });
});
