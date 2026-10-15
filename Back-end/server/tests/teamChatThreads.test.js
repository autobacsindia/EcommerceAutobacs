/**
 * Team chat threads: replies hang under a top-level message, the timeline
 * shows top-level messages ordered by their latest activity (so a thread that
 * moves comes back to the bottom), and each order's automatic updates in a
 * space form one thread.
 *
 * What must hold:
 *   - a reply never appears in the timeline; its root shows the count and the
 *     newest reply, and moves to the bottom
 *   - paging the timeline while threads move never skips or repeats a message
 *   - a reply obeys the channel's access rules; no replies to replies; no
 *     replies across channels
 *   - a retried reply is one reply, counted once
 *   - replies count as unread until read past the thread's activity
 *   - one thread per order per space, even when two first updates race
 */
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatMessage from '../models/ChatMessage.js';
import { postSystemMessage, canAccess } from '../services/chatService.js';
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
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}

const staff = (team, isHead = false) => ({ team, isHead, active: true });

async function createUser({ name, email, role = 'customer', staff: s }) {
  return User.create({
    name, email, role, staff: s, phone: '9876543210',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
}

const spaceId = (channels, key) => channels.find((c) => c.key === key)?.id;
let seqCounter = 0;
const clientId = () => `test-client-${Date.now()}-${++seqCounter}`;


describe('Team chat threads', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let users, admin, salesMember, accounts, company, sales;
  beforeEach(async () => {
    users = {
      admin: await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' }),
      salesMember: await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') }),
      accounts: await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts', true) }),
    };
    admin = await signIn('owner@example.com');
    salesMember = await signIn('sam@example.com');
    accounts = await signIn('anu@example.com');
    const channels = (await admin.get('/chat/channels')).body.channels;
    company = spaceId(channels, 'company');
    sales = spaceId(channels, 'team:sales');
  });

  const say = (who, channel, text, extra = {}) => who.post(`/chat/channels/${channel}/messages`, { text, ...extra });
  const timeline = async (who, channel, q = '') => (await who.get(`/chat/channels/${channel}/messages${q}`)).body;

  describe('replying', () => {
    it('keeps the reply out of the timeline and summarises it on the root', async () => {
      const root = (await say(admin, company, 'Who can pick up the Hilux parts?')).body.message;
      const reply = await say(salesMember, company, 'On it @Owner', { threadRoot: root.id, mentions: [String(users.admin._id)] });
      expect(reply.status).toBe(201);
      expect(reply.body.message.threadRoot).toBe(root.id);

      const { messages } = await timeline(accounts, company);
      expect(messages.map((m) => m.text)).toEqual(['Who can pick up the Hilux parts?']);
      expect(messages[0]).toMatchObject({
        replyCount: 1,
        activitySeq: reply.body.message.seq,
        lastReply: { by: 'Sam', preview: 'On it @Owner', mentions: [String(users.admin._id)] },
      });
    });

    it('a thread that gets a reply comes back to the bottom', async () => {
      const first = (await say(admin, company, 'first')).body.message;
      await say(admin, company, 'second');
      await say(salesMember, company, 'reply to first', { threadRoot: first.id });
      expect((await timeline(admin, company)).messages.map((m) => m.text)).toEqual(['second', 'first']);
    });

    it('the thread lists the root and its replies in order', async () => {
      const root = (await say(admin, company, 'root')).body.message;
      await say(salesMember, company, 'r1', { threadRoot: root.id });
      await say(accounts, company, 'r2', { threadRoot: root.id });
      const { body } = await accounts.get(`/chat/messages/${root.id}/thread`);
      expect(body.root).toMatchObject({ id: root.id, replyCount: 2 });
      expect(body.replies.map((m) => m.text)).toEqual(['r1', 'r2']);
      expect(body.replies[0].sender).toMatchObject({ name: 'Sam' });
    });

    it('pages a thread forward with the after cursor', async () => {
      const root = (await say(admin, company, 'root')).body.message;
      const r1 = (await say(admin, company, 'r1', { threadRoot: root.id })).body.message;
      await say(admin, company, 'r2', { threadRoot: root.id });
      await say(admin, company, 'r3', { threadRoot: root.id });
      const first = (await admin.get(`/chat/messages/${root.id}/thread?limit=2`)).body;
      expect(first.replies.map((m) => m.text)).toEqual(['r1', 'r2']);
      const next = (await admin.get(`/chat/messages/${root.id}/thread?after=${first.nextAfter}`)).body;
      expect(next.replies.map((m) => m.text)).toEqual(['r3']);
      expect(next.nextAfter).toBeNull();
      expect((await admin.get(`/chat/messages/${root.id}/thread?after=${r1.seq}`)).body.replies.map((m) => m.text)).toEqual(['r2', 'r3']);
    });

    it('a retried reply is one reply, counted once', async () => {
      const root = (await say(admin, company, 'root')).body.message;
      const id = clientId();
      await say(salesMember, company, 'once', { threadRoot: root.id, clientId: id });
      const again = await say(salesMember, company, 'once', { threadRoot: root.id, clientId: id });
      expect(again.status).toBe(200);
      expect((await timeline(admin, company)).messages[0].replyCount).toBe(1);
      expect((await admin.get(`/chat/messages/${root.id}/thread`)).body.replies).toHaveLength(1);
    });
  });

  describe('rules', () => {
    it('no replies to a reply, and no replies across channels', async () => {
      const root = (await say(admin, company, 'root')).body.message;
      const reply = (await say(admin, company, 'r', { threadRoot: root.id })).body.message;
      expect((await say(admin, company, 'nested', { threadRoot: reply.id })).status).toBe(400);
      expect((await say(salesMember, sales, 'elsewhere', { threadRoot: root.id })).status).toBe(404);
      expect((await say(admin, company, 'ghost', { threadRoot: '0'.repeat(24) })).status).toBe(404);
      expect((await say(admin, company, 'bad', { threadRoot: 'nope' })).status).toBe(400);
    });

    it('a thread in a team space is invisible to other teams (404), as is replying to it', async () => {
      const root = (await say(salesMember, sales, 'sales only')).body.message;
      expect((await accounts.get(`/chat/messages/${root.id}/thread`)).status).toBe(404);
      expect((await say(accounts, sales, 'x', { threadRoot: root.id })).status).toBe(404);
      expect((await admin.get(`/chat/messages/${root.id}/thread`)).status).toBe(200);
    });

    it('a reply id is not a thread', async () => {
      const root = (await say(admin, company, 'root')).body.message;
      const reply = (await say(admin, company, 'r', { threadRoot: root.id })).body.message;
      expect((await admin.get(`/chat/messages/${reply.id}/thread`)).status).toBe(404);
    });
  });

  describe('paging and unread', () => {
    it('paging while a thread moves never skips or repeats a message', async () => {
      const posted = [];
      for (let i = 1; i <= 6; i += 1) posted.push((await say(admin, company, `m${i}`)).body.message);
      const first = await timeline(admin, company, '?limit=2');
      // m2 gets a reply between page loads: it moves to the newest end.
      await say(salesMember, company, 'bump', { threadRoot: posted[1].id });
      const seen = [...first.messages.map((m) => m.text)];
      let cursor = first.nextBefore;
      while (cursor) {
        const page = await timeline(admin, company, `?limit=2&before=${cursor}`);
        seen.push(...page.messages.map((m) => m.text));
        cursor = page.nextBefore;
      }
      const latest = await timeline(admin, company, '?limit=10');
      expect(latest.messages.map((m) => m.text)).toEqual(['m1', 'm3', 'm4', 'm5', 'm6', 'm2']);
      // Every message reached once while paging down from the first load
      // (m2 had already moved above the cursor, and is in the fresh first page).
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.sort()).toEqual(['m1', 'm3', 'm4', 'm5', 'm6'].sort());
    });

    it('replies count as unread, and reading the thread\'s activity clears them', async () => {
      const root = (await say(admin, company, 'root')).body.message;
      const ch = (await salesMember.get('/chat/channels')).body.channels.find((c) => c.id === company);
      await salesMember.post(`/chat/channels/${company}/read`, { seq: ch.lastMessageSeq });
      await say(accounts, company, 'r', { threadRoot: root.id });

      const before = (await salesMember.get('/chat/channels')).body.channels.find((c) => c.id === company);
      expect(before.unread).toBe(1);
      const { messages } = await timeline(salesMember, company);
      await salesMember.post(`/chat/channels/${company}/read`, { seq: messages[0].activitySeq });
      const after = (await salesMember.get('/chat/channels')).body.channels.find((c) => c.id === company);
      expect(after.unread).toBe(0);
    });

    it('a live reply event carries the moved root', async () => {
      const root = (await say(admin, company, 'root')).body.message;
      const events = [];
      const off = onChatEvent((e) => events.push(e));
      try {
        await say(salesMember, company, 'live', { threadRoot: root.id });
      } finally { off(); }
      const event = events.find((e) => e.type === 'message');
      expect(event.message.threadRoot).toBe(root.id);
      expect(event.thread).toMatchObject({ id: root.id, replyCount: 1, lastReply: { preview: 'live', by: 'Sam' } });
    });
  });

  describe('order threads', () => {
    const orderId = () => String(new mongoose.Types.ObjectId());

    it('a second update about the same order in the same space replies to the first', async () => {
      const id = orderId();
      await postSystemMessage('team:sales', 'Out of stock', { key: 'k1', threadOrder: id });
      await postSystemMessage('team:sales', 'Another order', { key: 'k3', threadOrder: orderId() });
      await postSystemMessage('team:sales', 'Ordered from supplier', { key: 'k2', threadOrder: id });

      const { messages } = await timeline(admin, sales);
      // The thread moved when its second update arrived, so it is now the newest.
      expect(messages.map((m) => m.text)).toEqual(['Another order', 'Out of stock']);
      const root = messages.find((m) => m.text === 'Out of stock');
      expect(root).toMatchObject({ replyCount: 1, lastReply: { by: 'Roavion updates', preview: 'Ordered from supplier' } });
    });

    it('the same order in another space is its own thread', async () => {
      const id = orderId();
      await postSystemMessage('team:sales', 'in sales', { key: 'a', threadOrder: id });
      await postSystemMessage('team:accounts', 'in accounts', { key: 'b', threadOrder: id });
      expect(await ChatMessage.countDocuments({ threadRoot: { $type: 'objectId' } })).toBe(0);
    });

    it('two first updates racing make one thread, not two', async () => {
      const id = orderId();
      await Promise.all([
        postSystemMessage('team:sales', 'one', { key: 'r1', threadOrder: id }),
        postSystemMessage('team:sales', 'two', { key: 'r2', threadOrder: id }),
      ]);
      const roots = await ChatMessage.find({ threadOrder: id }).lean();
      expect(roots).toHaveLength(1);
      expect(await ChatMessage.countDocuments({ threadRoot: roots[0]._id })).toBe(1);
    });

    it('a retried update is still one post', async () => {
      const id = orderId();
      await postSystemMessage('team:sales', 'once', { key: 'same', threadOrder: id });
      await postSystemMessage('team:sales', 'once', { key: 'same', threadOrder: id });
      expect(await ChatMessage.countDocuments({})).toBe(1);
    });
  });
});
