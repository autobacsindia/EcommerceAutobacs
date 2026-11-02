/**
 * The "Mentions" view (GET /chat/mentions): every message that addresses me —
 * by name, my team, or @all — across the conversations I can read, newest
 * first, cursor-paginated.
 *
 * Weighted toward leaks: a mention must never show a message from a
 * conversation the reader cannot read today (a DM they are not in, a team they
 * left, an archived group), and deleted words must not come back through here.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatChannel from '../models/ChatChannel.js';
import ChatMessage from '../models/ChatMessage.js';

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

describe('Mentions view', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, sam, ravi, anu, adminUser, samUser, raviUser, anuUser, company, sales;
  beforeEach(async () => {
    adminUser = await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
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
  const mentions = async (who, query = '') => {
    const res = await who.get(`/chat/mentions${query}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const textsFor = async (who) => (await mentions(who)).messages.map((m) => m.text);
  const id = (u) => String(u._id);

  describe('what counts as a mention of me', () => {
    it('by name: shows for that person only, with where it was said', async () => {
      await send(sam, company, { text: '@Anu please check invoice 88', mentions: [id(anuUser)] });
      const page = await mentions(anu);
      expect(page.messages).toHaveLength(1);
      expect(page.messages[0]).toMatchObject({
        text: '@Anu please check invoice 88', channel: company, channelName: expect.any(String), channelKind: 'space',
      });
      expect(page.nextBefore).toBeNull();
      expect(await textsFor(ravi)).toEqual([]);
    });

    it('by team: everyone in that team, nobody outside it', async () => {
      await send(anu, company, { text: '@sales who has the Hilux order?', mentionTeams: ['sales'] });
      expect(await textsFor(sam)).toEqual(['@sales who has the Hilux order?']);
      expect(await textsFor(ravi)).toEqual(['@sales who has the Hilux order?']);
      expect(await textsFor(anu)).toEqual([]);
      expect(await textsFor(admin)).toEqual([]); // admins have no team
    });

    it('@all: everyone who can read the conversation', async () => {
      await send(admin, company, { text: '@all office closed Friday', mentionAll: true });
      for (const who of [sam, ravi, anu]) expect(await textsFor(who)).toEqual(['@all office closed Friday']);
      await send(sam, sales, { text: '@all target hit', mentionAll: true });
      expect(await textsFor(ravi)).toContain('@all target hit');
      expect(await textsFor(anu)).not.toContain('@all target hit');
    });

    it('my own message is not a mention of me (an @all I sent, my own team)', async () => {
      await send(sam, sales, { text: '@all lunch?', mentionAll: true, mentionTeams: ['sales'] });
      expect(await textsFor(sam)).toEqual([]);
      expect(await textsFor(ravi)).toEqual(['@all lunch?']);
    });

    it('a mention in a thread reply is included, and says which thread', async () => {
      const root = await send(sam, company, { text: 'Winch return?' });
      await send(anu, company, { text: '@Sam approved', mentions: [id(samUser)], threadRoot: root.id });
      const [m] = (await mentions(sam)).messages;
      expect(m).toMatchObject({ text: '@Sam approved', threadRoot: root.id });
    });

    it('an edited message shows its new words', async () => {
      const m = await send(sam, company, { text: '@Anu call me at 5', mentions: [id(anuUser)] });
      await sam.patch(`/chat/messages/${m.id}`, { text: '@Anu call me at 6' });
      expect(await textsFor(anu)).toEqual(['@Anu call me at 6']);
    });
  });

  describe('no leaks', () => {
    it('a deleted message drops out, for everyone including admins', async () => {
      const m = await send(sam, sales, { text: '@all wrong price list', mentionAll: true });
      expect(await textsFor(ravi)).toEqual(['@all wrong price list']);
      await sam.del(`/chat/messages/${m.id}`);
      expect(await textsFor(ravi)).toEqual([]);
      expect(JSON.stringify(await mentions(admin))).not.toContain('price list');
    });

    it('a group DM mention reaches its members, never an admin outside it', async () => {
      const dm = (await sam.post('/chat/dm', { userIds: [id(anuUser), id(raviUser)] })).body.channel.id;
      await send(sam, dm, { text: '@all surprise party for Owner', mentionAll: true });
      expect(await textsFor(anu)).toEqual(['@all surprise party for Owner']);
      expect(JSON.stringify(await mentions(admin))).not.toContain('surprise');
    });

    it('even a stored mention of me in a DM I am not in stays hidden', async () => {
      // resolveMentions refuses this at send time; old or hand-written data must still not leak.
      const dm = (await sam.post('/chat/dm', { userId: id(anuUser) })).body.channel.id;
      const posted = await send(sam, dm, { text: 'private note' });
      await ChatMessage.updateOne({ _id: posted.id }, { $set: { mentions: [adminUser._id, raviUser._id], mentionTeams: ['sales'] } });
      expect(JSON.stringify(await mentions(admin))).not.toContain('private note');
      expect(JSON.stringify(await mentions(ravi))).not.toContain('private note');
    });

    it('someone who moves team stops seeing the old team’s mentions', async () => {
      await send(sam, sales, { text: '@Ravi your lead', mentions: [id(raviUser)] });
      expect(await textsFor(ravi)).toEqual(['@Ravi your lead']);
      await User.updateOne({ _id: raviUser._id }, { $set: { 'staff.team': 'accounts' } });
      const moved = await signIn('ravi@example.com');
      expect(await textsFor(moved)).toEqual([]);
    });

    it('an archived group’s mentions disappear', async () => {
      const created = await admin.post('/chat/channels', { name: 'Launch', memberIds: [id(samUser), id(anuUser)] });
      expect(created.status).toBe(201);
      await send(sam, created.body.channel.id, { text: '@Anu launch slides?', mentions: [id(anuUser)] });
      expect(await textsFor(anu)).toEqual(['@Anu launch slides?']);
      await ChatChannel.updateOne({ _id: created.body.channel.id }, { $set: { archived: true } });
      expect(await textsFor(anu)).toEqual([]);
    });

    it('customers and signed-out callers are turned away', async () => {
      await createUser({ name: 'Cust', email: 'cust@example.com' });
      const cust = await signIn('cust@example.com');
      expect((await cust.get('/chat/mentions')).status).toBe(403);
      expect((await request(app).get(`${BASE}/chat/mentions`)).status).toBe(401);
    });
  });

  describe('paging', () => {
    it('newest first, 25 a page, no repeats or gaps across pages', async () => {
      for (let i = 1; i <= 30; i += 1) await send(sam, company, { text: `@Anu note ${i}`, mentions: [id(anuUser)] });
      // Noise that must not take a slot: other people's mentions.
      await send(sam, company, { text: '@Ravi not yours', mentions: [id(raviUser)] });

      const first = await mentions(anu);
      expect(first.messages.map((m) => m.text)).toEqual(Array.from({ length: 25 }, (_, k) => `@Anu note ${30 - k}`));
      expect(first.nextBefore).toBe(first.messages[24].id);
      const second = await mentions(anu, `?before=${first.nextBefore}`);
      expect(second.messages.map((m) => m.text)).toEqual(['@Anu note 5', '@Anu note 4', '@Anu note 3', '@Anu note 2', '@Anu note 1']);
      expect(second.nextBefore).toBeNull();
    });

    it('a message posted while scrolling never shifts the older page', async () => {
      for (let i = 1; i <= 3; i += 1) await send(sam, company, { text: `@Anu n${i}`, mentions: [id(anuUser)] });
      const first = await mentions(anu, '?limit=2');
      await send(sam, company, { text: '@Anu newest', mentions: [id(anuUser)] });
      const second = await mentions(anu, `?limit=2&before=${first.nextBefore}`);
      expect(second.messages.map((m) => m.text)).toEqual(['@Anu n1']);
    });

    it.each([['?before=nope'], ['?limit=0'], ['?limit=51']])('rejects a bad page request %s', async (q) => {
      expect((await anu.get(`/chat/mentions${q}`)).status).toBe(400);
    });

    it('nothing yet: an empty page, no cursor', async () => {
      expect(await mentions(anu)).toMatchObject({ messages: [], nextBefore: null });
    });
  });
});
