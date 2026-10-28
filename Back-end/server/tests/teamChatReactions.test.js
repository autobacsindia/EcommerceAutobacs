/**
 * Emoji reactions on team-chat messages (services/chatService.js, "reactions").
 *
 * What must hold:
 *   - a retried or double-sent tap is ONE reaction (the request carries the
 *     desired state, not "toggle"), and people reacting at the same moment
 *     never lose each other's taps;
 *   - only people who can read the message can react, and a private message
 *     answers "not found" to everyone else;
 *   - a deleted message takes no reactions and shows none (except to an admin);
 *   - the live stream hears about real changes only.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import { postSystemMessage, MAX_REACTIONS_PER_MESSAGE } from '../services/chatService.js';
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
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}

const staff = (team, isHead = false) => ({ team, isHead, active: true });
const createUser = async ({ name, email, role = 'customer', staff: s }) => User.create({
  name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4),
});
const spaceId = (channels, key) => channels.find((c) => c.key === key)?.id;


describe('Chat message reactions', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, salesMember, salesHead, accounts, customer, company, sales, users;
  beforeEach(async () => {
    users = {
      admin: await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' }),
      head: await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales', true) }),
      sam: await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') }),
      anu: await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts', true) }),
    };
    await createUser({ name: 'Cara', email: 'cara@example.com' });
    admin = await signIn('owner@example.com');
    salesHead = await signIn('sana@example.com');
    salesMember = await signIn('sam@example.com');
    accounts = await signIn('anu@example.com');
    customer = await signIn('cara@example.com');
    const channels = (await admin.get('/chat/channels')).body.channels;
    company = spaceId(channels, 'company');
    sales = spaceId(channels, 'team:sales');
  });

  const send = async (who, channel, body) => {
    const res = await who.post(`/chat/channels/${channel}/messages`, body);
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const react = (who, id, emoji, on) => who.post(`/chat/messages/${id}/reactions`, on === undefined ? { emoji } : { emoji, on });
  const find = async (who, channel, id) =>
    (await who.get(`/chat/channels/${channel}/messages`)).body.messages.find((m) => m.id === id);

  describe('adding and removing', () => {
    it('shows everyone the emoji, how many, and who', async () => {
      const m = await send(salesMember, company, { text: 'Stock arrived' });
      const res = await react(accounts, m.id, '👍');
      expect(res.status).toBe(200);
      expect(res.body.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [String(users.anu._id)] }]);

      await react(admin, m.id, '👍');
      await react(admin, m.id, '🎉');
      const seen = await find(salesMember, company, m.id);
      expect(seen.reactions).toEqual([
        { emoji: '👍', count: 2, userIds: [String(users.anu._id), String(users.admin._id)] },
        { emoji: '🎉', count: 1, userIds: [String(users.admin._id)] },
      ]);
    });

    it('a new message has no reactions', async () => {
      const m = await send(salesMember, company, { text: 'hi' });
      expect(m.reactions).toEqual([]);
    });

    it('the same tap sent twice is one reaction (retry / double click)', async () => {
      const m = await send(salesMember, company, { text: 'hi' });
      await react(accounts, m.id, '👍');
      const again = await react(accounts, m.id, '👍', true);
      expect(again.status).toBe(200);
      expect(again.body.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [String(users.anu._id)] }]);
    });

    it('on: false takes only your own reaction off; the emoji goes when nobody is left', async () => {
      const m = await send(salesMember, company, { text: 'hi' });
      await react(accounts, m.id, '👍');
      await react(admin, m.id, '👍');

      const off = await react(accounts, m.id, '👍', false);
      expect(off.body.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [String(users.admin._id)] }]);
      // Removing again is not an error and changes nothing.
      expect((await react(accounts, m.id, '👍', false)).body.reactions).toHaveLength(1);

      await react(admin, m.id, '👍', false);
      expect((await find(salesMember, company, m.id)).reactions).toEqual([]);
    });

    it('people reacting at the same moment all count', async () => {
      const m = await send(salesMember, company, { text: 'Big order in!' });
      const results = await Promise.all([
        react(admin, m.id, '🎉'), react(salesHead, m.id, '🎉'), react(accounts, m.id, '🎉'),
        react(salesMember, m.id, '🎉'), react(accounts, m.id, '🔥'), react(admin, m.id, '🔥'),
      ]);
      results.forEach((r) => expect(r.status).toBe(200));
      const seen = await find(salesMember, company, m.id);
      expect(seen.reactions.find((r) => r.emoji === '🎉').count).toBe(4);
      expect(seen.reactions.find((r) => r.emoji === '🔥').count).toBe(2);
      expect(seen.reactions).toHaveLength(2);
    });

    it('works on an automatic order update and on a thread reply', async () => {
      const posted = await postSystemMessage('company', 'Order #A1B2 paid');
      expect((await react(salesMember, posted.id, '✅')).status).toBe(200);

      const root = await send(salesMember, company, { text: 'root' });
      const reply = await send(accounts, company, { text: 'reply', threadRoot: root.id });
      expect((await react(salesMember, reply.id, '👀')).status).toBe(200);
      const thread = (await accounts.get(`/chat/messages/${root.id}/thread`)).body;
      expect(thread.replies[0].reactions).toEqual([{ emoji: '👀', count: 1, userIds: [String(users.sam._id)] }]);
    });
  });

  describe('what counts as an emoji', () => {
    it.each(['👍🏽', '🇮🇳', '1️⃣', '👨‍👩‍👧', '❤️'])('accepts %s', async (emoji) => {
      const m = await send(salesMember, company, { text: 'hi' });
      expect((await react(accounts, m.id, emoji)).status).toBe(200);
    });

    it.each(['a', '1', '#', '👍👍', '<script>', '$where', '', 'ok 👍'])('refuses %p', async (emoji) => {
      const m = await send(salesMember, company, { text: 'hi' });
      expect((await react(accounts, m.id, emoji)).status).toBe(400);
      expect((await find(salesMember, company, m.id)).reactions).toEqual([]);
    });

    it('refuses a non-boolean "on"', async () => {
      const m = await send(salesMember, company, { text: 'hi' });
      expect((await react(accounts, m.id, '👍', 'yes')).status).toBe(400);
    });

    it(`caps a message at ${MAX_REACTIONS_PER_MESSAGE} different emoji, but people can still join one`, async () => {
      const m = await send(salesMember, company, { text: 'hi' });
      const pool = [...'😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋'];
      for (const e of pool.slice(0, MAX_REACTIONS_PER_MESSAGE)) {
        expect((await react(accounts, m.id, e)).status).toBe(200);
      }
      const over = await react(accounts, m.id, pool[MAX_REACTIONS_PER_MESSAGE]);
      expect(over.status).toBe(400);
      expect(over.body.message).toMatch(/up to 20/);
      expect((await react(admin, m.id, pool[0])).status).toBe(200);
    });
  });

  describe('who may react', () => {
    it('someone who cannot see the space gets "not found"', async () => {
      const m = await send(salesMember, sales, { text: 'team only' });
      expect((await react(accounts, m.id, '👍')).status).toBe(404);
      expect((await find(salesMember, sales, m.id)).reactions).toEqual([]);
    });

    it('a direct message is private — not even an admin can react', async () => {
      const { body } = await salesMember.post('/chat/dm', { userId: String(users.anu._id) });
      const m = await send(salesMember, body.channel.id, { text: 'just us' });
      expect((await react(admin, m.id, '👍')).status).toBe(404);
      expect((await react(accounts, m.id, '👍')).status).toBe(200);
    });

    it('customers are refused', async () => {
      const m = await send(salesMember, company, { text: 'hi' });
      expect((await react(customer, m.id, '👍')).status).toBe(403);
    });

    it('an unknown or malformed message id is "not found" / invalid', async () => {
      expect((await react(accounts, '64b7f0f0f0f0f0f0f0f0f0f0', '👍')).status).toBe(404);
      expect((await react(accounts, 'nope', '👍')).status).toBe(400);
    });
  });

  describe('deleted messages', () => {
    it('cannot be reacted to', async () => {
      const m = await send(salesMember, company, { text: 'oops' });
      await salesMember.del(`/chat/messages/${m.id}`);
      expect((await react(accounts, m.id, '👍')).status).toBe(409);
    });

    it('show no reactions, except to an admin', async () => {
      const m = await send(salesMember, company, { text: 'oops' });
      await react(accounts, m.id, '👍');
      await salesMember.del(`/chat/messages/${m.id}`);
      expect((await find(accounts, company, m.id)).reactions).toEqual([]);
      expect((await find(admin, company, m.id)).reactions).toHaveLength(1);
    });
  });

  describe('live updates', () => {
    it('announce a change to the room, with what the client needs', async () => {
      const root = await send(salesMember, company, { text: 'root' });
      const reply = await send(accounts, company, { text: 'reply', threadRoot: root.id });
      const events = [];
      const off = onChatEvent((e) => { if (e.type === 'message_reactions') events.push(e); });
      await react(salesMember, reply.id, '👍');
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        channelId: company, messageId: reply.id, threadRoot: root.id,
        reactions: [{ emoji: '👍', count: 1, userIds: [String(users.sam._id)] }],
      });
      expect(events[0].route).toMatchObject({ audience: 'all' });
    });

    it('stay quiet when a retry changes nothing', async () => {
      const m = await send(salesMember, company, { text: 'hi' });
      await react(accounts, m.id, '👍');
      const events = [];
      const off = onChatEvent((e) => { if (e.type === 'message_reactions') events.push(e); });
      await react(accounts, m.id, '👍');
      await react(admin, m.id, '👍', false); // never had one
      off();
      expect(events).toHaveLength(0);
    });
  });
});
