/**
 * The "Threads" list (GET /chat/threads): threads I started or replied to,
 * newest activity first, with how many replies I have not seen.
 *
 * What must hold:
 *   - starting a thread that gets a reply, or replying, puts it in my list;
 *     being in the conversation alone does not;
 *   - unread counts other people's replies past what I have opened, ignores
 *     deleted replies, and clears when I open the thread;
 *   - a retried reply (same clientId) is one reply and one row;
 *   - a thread in a conversation I can no longer read disappears;
 *   - paging is stable and bounded.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatThreadFollow from '../models/ChatThreadFollow.js';
import { postSystemMessage } from '../services/chatService.js';
import { backfillThreadFollows } from '../scripts/backfill-chat-thread-follows.js';

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

describe('Threads I’m in', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, sam, ravi, anu, samUser, raviUser, anuUser, company, sales;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    samUser = await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') });
    raviUser = await createUser({ name: 'Ravi', email: 'ravi@example.com', role: 'staff', staff: staff('sales') });
    anuUser = await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts') });
    admin = await signIn('owner@example.com');
    sam = await signIn('sam@example.com');
    ravi = await signIn('ravi@example.com');
    anu = await signIn('anu@example.com');
    const channels = (await admin.get('/chat/channels')).body.channels;
    company = channels.find((c) => c.key === 'company').id;
    sales = channels.find((c) => c.key === 'team:sales').id;
  });

  const send = async (who, channel, body) => {
    const res = await who.post(`/chat/channels/${channel}/messages`, body);
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const threads = async (who, query = '') => {
    const res = await who.get(`/chat/threads${query}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const summary = async (who) => (await threads(who)).threads.map((t) => [t.root.text, t.unread]);
  const open = async (who, rootId) => expect((await who.get(`/chat/messages/${rootId}/thread`)).status).toBe(200);

  describe('who is in a thread', () => {
    it('the starter (once someone replies) and every replier — not everyone in the conversation', async () => {
      const root = await send(sam, company, { text: 'Winch return?' });
      expect(await summary(sam)).toEqual([]); // no replies yet: not a thread
      await send(anu, company, { text: 'Approved', threadRoot: root.id });

      expect(await summary(sam)).toEqual([['Winch return?', 1]]);
      expect(await summary(anu)).toEqual([['Winch return?', 0]]); // my own reply is read
      expect(await summary(ravi)).toEqual([]);
      expect(await summary(admin)).toEqual([]);
    });

    it('says where the thread is, and carries the root’s reply summary', async () => {
      const root = await send(sam, company, { text: 'Winch return?' });
      await send(anu, company, { text: 'Approved', threadRoot: root.id });
      const [t] = (await threads(sam)).threads;
      expect(t).toMatchObject({
        channel: company, channelKind: 'space', channelName: expect.any(String), unread: 1,
        root: { id: root.id, replyCount: 1, lastReply: { by: 'Anu', preview: 'Approved' } },
      });
    });

    it('automatic order updates in a thread move it and count as unread, but make nobody a member', async () => {
      const first = await postSystemMessage('company', 'Order #A1B2 paid', { key: 'o-paid-0001', threadOrder: '64b000000000000000000001' });
      await send(sam, company, { text: 'Packing it now', threadRoot: first.id });
      expect(await summary(sam)).toEqual([['Order #A1B2 paid', 0]]);
      await postSystemMessage('company', 'Order #A1B2 shipped', { key: 'o-ship-0001', threadOrder: '64b000000000000000000001' });
      expect(await summary(sam)).toEqual([['Order #A1B2 paid', 1]]);
      expect(await ChatThreadFollow.countDocuments({})).toBe(1);
    });
  });

  describe('unread', () => {
    it('counts other people’s replies past what I opened, and clears when I open the thread', async () => {
      const root = await send(sam, company, { text: 'Price for Hilux mats?' });
      await send(anu, company, { text: '₹2,400', threadRoot: root.id });
      await send(ravi, company, { text: 'Stock is low', threadRoot: root.id });
      expect(await summary(sam)).toEqual([['Price for Hilux mats?', 2]]);
      expect(await summary(anu)).toEqual([['Price for Hilux mats?', 1]]);

      await open(sam, root.id);
      expect(await summary(sam)).toEqual([['Price for Hilux mats?', 0]]);
      // Opening again changes nothing; a new reply is unread again.
      await open(sam, root.id);
      await send(anu, company, { text: 'Ordering 10', threadRoot: root.id });
      expect(await summary(sam)).toEqual([['Price for Hilux mats?', 1]]);
    });

    it('opening a thread I am not in leaves no trace', async () => {
      const root = await send(sam, company, { text: 'Q' });
      await send(anu, company, { text: 'A', threadRoot: root.id });
      await open(ravi, root.id);
      expect(await summary(ravi)).toEqual([]);
      expect(await ChatThreadFollow.countDocuments({ user: raviUser._id })).toBe(0);
    });

    it('a deleted reply no longer counts', async () => {
      const root = await send(sam, company, { text: 'Q' });
      const r = await send(anu, company, { text: 'oops wrong thread', threadRoot: root.id });
      expect(await summary(sam)).toEqual([['Q', 1]]);
      await anu.del(`/chat/messages/${r.id}`);
      expect(await summary(sam)).toEqual([['Q', 0]]);
    });

    it('an edited reply does not count twice', async () => {
      const root = await send(sam, company, { text: 'Q' });
      const r = await send(anu, company, { text: 'tuesdy', threadRoot: root.id });
      await anu.patch(`/chat/messages/${r.id}`, { text: 'tuesday' });
      expect(await summary(sam)).toEqual([['Q', 1]]);
    });
  });

  describe('retries', () => {
    it('a retried reply (same clientId) is one reply, one row, one unread', async () => {
      const root = await send(sam, company, { text: 'Q' });
      await send(anu, company, { text: 'A', threadRoot: root.id, clientId: 'reply-0001' });
      const again = await anu.post(`/chat/channels/${company}/messages`, { text: 'A', threadRoot: root.id, clientId: 'reply-0001' });
      expect(again.status).toBeLessThan(300);
      expect(await summary(sam)).toEqual([['Q', 1]]);
      expect(await ChatThreadFollow.countDocuments({ root: root.id })).toBe(2);
    });

    it('many replies at once leave exactly one row per person', async () => {
      const root = await send(sam, company, { text: 'Q' });
      await Promise.all([1, 2, 3, 4].map((i) => anu.post(`/chat/channels/${company}/messages`, { text: `A${i}`, threadRoot: root.id })));
      expect(await ChatThreadFollow.countDocuments({ root: root.id, user: anuUser._id })).toBe(1);
      expect(await ChatThreadFollow.countDocuments({ root: root.id, user: samUser._id })).toBe(1);
      expect(await summary(sam)).toEqual([['Q', 4]]);
    });
  });

  describe('no leaks', () => {
    it('someone who leaves a team stops seeing its threads', async () => {
      const root = await send(sam, sales, { text: 'Sales-only plan' });
      await send(ravi, sales, { text: 'Agreed', threadRoot: root.id });
      expect(await summary(ravi)).toEqual([['Sales-only plan', 0]]);
      await User.updateOne({ _id: raviUser._id }, { $set: { 'staff.team': 'accounts' } });
      const moved = await signIn('ravi@example.com');
      expect(JSON.stringify(await threads(moved))).not.toContain('Sales-only');
    });

    it('a DM thread is listed only for its two people', async () => {
      const dm = (await sam.post('/chat/dm', { userId: String(anuUser._id) })).body.channel.id;
      const root = await send(sam, dm, { text: 'about my appraisal' });
      await send(anu, dm, { text: 'tomorrow', threadRoot: root.id });
      expect(await summary(sam)).toEqual([['about my appraisal', 1]]);
      for (const outsider of [admin, ravi]) expect(JSON.stringify(await threads(outsider))).not.toContain('appraisal');
    });

    it('a deleted root shows as deleted, without its words', async () => {
      const root = await send(sam, company, { text: 'secret plan' });
      await send(anu, company, { text: 'ok', threadRoot: root.id });
      await sam.del(`/chat/messages/${root.id}`);
      const [t] = (await threads(anu)).threads;
      expect(t.root).toMatchObject({ deleted: true, text: '' });
      expect(JSON.stringify(t)).not.toContain('secret');
    });

    it('customers and signed-out callers are turned away', async () => {
      await createUser({ name: 'Cust', email: 'cust@example.com' });
      const cust = await signIn('cust@example.com');
      expect((await cust.get('/chat/threads')).status).toBe(403);
      expect((await request(app).get(`${BASE}/chat/threads`)).status).toBe(401);
    });
  });

  describe('order and paging', () => {
    it('the thread that moved last comes first', async () => {
      const a = await send(sam, company, { text: 'A' });
      const b = await send(sam, company, { text: 'B' });
      await send(anu, company, { text: 'a1', threadRoot: a.id });
      await send(anu, company, { text: 'b1', threadRoot: b.id });
      expect((await summary(sam)).map(([t]) => t)).toEqual(['B', 'A']);
      await send(ravi, company, { text: 'a2', threadRoot: a.id });
      expect((await summary(sam)).map(([t]) => t)).toEqual(['A', 'B']);
    });

    it('pages without repeats or gaps', async () => {
      const roots = [];
      for (let i = 1; i <= 5; i += 1) {
        const r = await send(sam, company, { text: `T${i}` });
        await send(anu, company, { text: 'x', threadRoot: r.id });
        roots.push(r);
      }
      const first = await threads(sam, '?limit=2');
      expect(first.threads.map((t) => t.root.text)).toEqual(['T5', 'T4']);
      const second = await threads(sam, `?limit=2&before=${first.nextBefore}`);
      expect(second.threads.map((t) => t.root.text)).toEqual(['T3', 'T2']);
      const third = await threads(sam, `?limit=2&before=${second.nextBefore}`);
      expect(third.threads.map((t) => t.root.text)).toEqual(['T1']);
      expect(third.nextBefore).toBeNull();
    });

    it.each([['?before=nope'], ['?before=123_zz'], ['?limit=0'], ['?limit=51']])('rejects a bad page request %s', async (q) => {
      expect((await sam.get(`/chat/threads${q}`)).status).toBe(400);
    });
  });

  describe('backfill of threads from before the list existed', () => {
    const quiet = () => {};
    const seed = async () => {
      const root = await send(sam, company, { text: 'Old thread' });
      await send(anu, company, { text: 'old reply', threadRoot: root.id });
      await send(ravi, company, { text: 'another', threadRoot: root.id });
      await ChatThreadFollow.deleteMany({}); // as if written before this feature
      return root;
    };

    it('a dry run writes nothing', async () => {
      await seed();
      const res = await backfillThreadFollows({ log: quiet });
      expect(res).toMatchObject({ threads: 1, rows: 3, inserted: 0 });
      expect(await ChatThreadFollow.countDocuments({})).toBe(0);
    });

    it('--apply lists the thread for its starter and repliers, all read, marked for rollback', async () => {
      await seed();
      expect(await backfillThreadFollows({ apply: true, log: quiet })).toMatchObject({ rows: 3, inserted: 3 });
      expect(await summary(sam)).toEqual([['Old thread', 0]]);
      expect(await summary(anu)).toEqual([['Old thread', 0]]);
      expect(await summary(admin)).toEqual([]);
      expect(await ChatThreadFollow.collection.countDocuments({ backfilled: true })).toBe(3);
    });

    it('is safe to run twice, and never overwrites a row the live app wrote', async () => {
      const root = await seed();
      await send(anu, company, { text: 'new after deploy', threadRoot: root.id }); // live rows for anu + sam (sam unread)
      await backfillThreadFollows({ apply: true, log: quiet });
      const again = await backfillThreadFollows({ apply: true, log: quiet });
      expect(again.inserted).toBe(0);
      expect(await ChatThreadFollow.countDocuments({ root: root.id })).toBe(3);
      // Sam's live row (written by the reply, before the backfill) counts all
      // three replies as unread; the backfill must not reset it to "read".
      expect(await summary(sam)).toEqual([['Old thread', 3]]);
    });

    it('refuses to apply without the unique index', async () => {
      await seed();
      await ChatThreadFollow.collection.dropIndex('root_1_user_1');
      try {
        await expect(backfillThreadFollows({ apply: true, log: quiet })).rejects.toThrow(/unique/);
      } finally {
        await ChatThreadFollow.syncIndexes();
      }
    });
  });
});
