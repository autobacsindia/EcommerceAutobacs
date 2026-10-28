/**
 * Online dots and status (chatService.listOnline / setMyStatus / listPeople).
 *
 * What must hold:
 *   - "online" is exactly "has team chat open" (the stream heartbeat);
 *   - a status is the person's own, everyone who can chat sees it, and it
 *     clears itself at "until" without anything having to run;
 *   - bad input (empty, too long, a past or far-future "until") is refused;
 *   - customers reach none of it.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatStatus from '../models/ChatStatus.js';
import { markOnline, markOffline } from '../services/chatPresence.js';
import { onChatEvent } from '../services/chatEvents.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';
const csrfFrom = (res) => {
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}
const staff = (team) => ({ team, isHead: false, active: true });
const createUser = async ({ name, email, role = 'customer', staff: s }) => User.create({
  name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4),
});

describe('Online and status', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let pavan, priya, cara, users;
  beforeEach(async () => {
    users = {
      pavan: await createUser({ name: 'Pavan', email: 'pavan@example.com', role: 'staff', staff: staff('procurement') }),
      priya: await createUser({ name: 'Priya', email: 'priya@example.com', role: 'staff', staff: staff('sales') }),
    };
    await createUser({ name: 'Cara', email: 'cara@example.com' });
    pavan = await signIn('pavan@example.com');
    priya = await signIn('priya@example.com');
    cara = await signIn('cara@example.com');
  });
  afterEach(async () => { await markOffline(users.pavan._id); await markOffline(users.priya._id); });

  const statusOf = async (who, user) =>
    (await who.get('/chat/people')).body.people.find((p) => p.id === String(user._id)).status;

  describe('online', () => {
    it('lists who has team chat open', async () => {
      expect((await priya.get('/chat/presence')).body.online).toEqual([]);
      await markOnline(users.pavan._id);
      expect((await priya.get('/chat/presence')).body.online).toEqual([String(users.pavan._id)]);
      await markOffline(users.pavan._id);
      expect((await priya.get('/chat/presence')).body.online).toEqual([]);
    });

    it('customers are refused', async () => {
      expect((await cara.get('/chat/presence')).status).toBe(403);
    });
  });

  describe('status', () => {
    it('is set by the person and seen by everyone who can chat', async () => {
      const res = await pavan.put('/chat/status', { text: '  🌴 On leave   till Friday ' });
      expect(res.status).toBe(200);
      expect(res.body.status).toEqual({ text: '🌴 On leave till Friday', until: null });
      expect(await statusOf(priya, users.pavan)).toEqual({ text: '🌴 On leave till Friday', until: null });
      expect(await statusOf(priya, users.priya)).toBeNull();
    });

    it('setting again replaces it; clearing removes it (twice is fine)', async () => {
      await pavan.put('/chat/status', { text: 'In a meeting' });
      await pavan.put('/chat/status', { text: 'On a call' });
      expect(await ChatStatus.countDocuments()).toBe(1);
      expect((await statusOf(priya, users.pavan)).text).toBe('On a call');
      expect((await pavan.del('/chat/status')).status).toBe(200);
      expect((await pavan.del('/chat/status')).status).toBe(200);
      expect(await statusOf(priya, users.pavan)).toBeNull();
    });

    it('clears itself at "until"', async () => {
      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      expect((await pavan.put('/chat/status', { text: 'In a meeting', until })).body.status.until).toBe(until);
      expect((await statusOf(priya, users.pavan)).text).toBe('In a meeting');
      // Time passes: the row is still there, but it no longer shows.
      await ChatStatus.updateOne({ user: users.pavan._id }, { until: new Date(Date.now() - 1000) });
      expect(await statusOf(priya, users.pavan)).toBeNull();
    });

    it.each([
      ['empty', { text: '   ' }],
      ['too long', { text: 'x'.repeat(81) }],
      ['not text', { text: 42 }],
      ['until in the past', { text: 'Away', until: new Date(Date.now() - 1000).toISOString() }],
      ['until over a year away', { text: 'Away', until: new Date(Date.now() + 400 * 86_400_000).toISOString() }],
      ['until not a date', { text: 'Away', until: 'tomorrow' }],
    ])('refuses %s', async (_l, body) => {
      expect((await pavan.put('/chat/status', body)).status).toBe(400);
      expect(await ChatStatus.countDocuments()).toBe(0);
    });

    it('tells everyone live that it changed', async () => {
      const events = [];
      const off = onChatEvent((e) => { if (e.type === 'status') events.push(e); });
      await pavan.put('/chat/status', { text: 'Back at 3' });
      await pavan.del('/chat/status');
      off();
      expect(events.map((e) => e.userId)).toEqual([String(users.pavan._id), String(users.pavan._id)]);
      expect(events[0].route).toMatchObject({ audience: 'all' });
    });

    it('customers are refused', async () => {
      expect((await cara.put('/chat/status', { text: 'hi' })).status).toBe(403);
    });
  });
});
