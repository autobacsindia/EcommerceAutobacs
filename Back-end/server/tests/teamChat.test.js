/**
 * Team chat over HTTP — the access boundaries a click-through misses: customers
 * locked out entirely, a team space invisible to other teams, DMs private even
 * from admins, a retried send creating one message, and a removed staff member
 * losing chat the moment they are deactivated.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatMessage from '../models/ChatMessage.js';
import { postSystemMessage, canAccess } from '../services/chatService.js';
import { onChatEvent } from '../services/chatEvents.js';
import { STAFF_TEAM_VALUES } from '../config/staff.js';

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

describe('Team chat', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, salesHead, salesMember, accounts, customer;
  let users;
  beforeEach(async () => {
    users = {
      admin: await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' }),
      salesHead: await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales', true) }),
      salesMember: await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') }),
      accounts: await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts', true) }),
      customer: await createUser({ name: 'Cust', email: 'cust@example.com' }),
    };
    admin = await signIn('owner@example.com');
    salesHead = await signIn('sana@example.com');
    salesMember = await signIn('sam@example.com');
    accounts = await signIn('anu@example.com');
    customer = await signIn('cust@example.com');
  });

  describe('who can see what', () => {
    it('customers cannot reach any chat endpoint', async () => {
      expect((await customer.get('/chat/channels')).status).toBe(403);
      expect((await customer.get('/chat/people')).status).toBe(403);
      expect((await customer.get('/chat/stream')).status).toBe(403);
    });

    it('signed-out visitors are rejected, not served an empty list', async () => {
      const res = await request(app).get(`${BASE}/chat/channels`);
      expect(res.status).toBe(401);
    });

    it('admins see #company, every team space and every team-to-team conversation', async () => {
      const { body } = await admin.get('/chat/channels');
      const keys = body.channels.map((c) => c.key);
      // #company first, then one space per team, in config order.
      expect(keys.slice(0, STAFF_TEAM_VALUES.length + 1)).toEqual([
        'company', ...STAFF_TEAM_VALUES.map((t) => `team:${t}`),
      ]);
      /*
        n teams → n(n-1)/2 pairs, each exactly once. Derived rather than written
        out: this read "5 teams → 10 pairs" and broke the day a sixth team was
        added, which is noise — the rule being tested is the pairing, not how
        many teams the company happens to have today.
      */
      const n = STAFF_TEAM_VALUES.length;
      expect(keys.filter((k) => k.startsWith('pair:'))).toHaveLength((n * (n - 1)) / 2);
      const pair = body.channels.find((c) => c.key === 'pair:accounts:procurement');
      expect(pair).toMatchObject({ audience: 'teams', name: 'Accounts ↔ Procurement', withTeam: null });
    });

    it('staff see #company, their own team space and their team\'s conversations with each other team', async () => {
      const { body } = await salesMember.get('/chat/channels');
      // Their own space, #company, and one conversation per OTHER team — built
      // from the team list so adding a team does not rewrite this expectation.
      const others = STAFF_TEAM_VALUES.filter((t) => t !== 'sales');
      expect(body.channels.map((c) => c.key).sort()).toEqual([
        'company',
        ...others.map((t) => `pair:${[t, 'sales'].sort().join(':')}`),
        'team:sales',
      ].sort());
      // Named after the OTHER team, from where the reader sits.
      expect(body.channels.find((c) => c.key === 'pair:accounts:sales')).toMatchObject({ name: 'Accounts', withTeam: 'accounts' });
      const fromAccounts = (await accounts.get('/chat/channels')).body.channels.find((c) => c.key === 'pair:accounts:sales');
      expect(fromAccounts).toMatchObject({ name: 'GTM', withTeam: 'sales' });
    });

    it('another team cannot read or post in a team space (404, not 403)', async () => {
      const { body } = await admin.get('/chat/channels');
      const salesSpace = spaceId(body.channels, 'team:sales');
      expect((await accounts.get(`/chat/channels/${salesSpace}/messages`)).status).toBe(404);
      expect((await accounts.post(`/chat/channels/${salesSpace}/messages`, { text: 'hi' })).status).toBe(404);
    });

    it('people directory lists admins and active staff only — never customers', async () => {
      const { body } = await salesMember.get('/chat/people');
      const names = body.people.map((p) => p.name).sort();
      expect(names).toEqual(['Anu', 'Owner', 'Sam', 'Sana']);
      expect(JSON.stringify(body)).not.toMatch(/@example\.com/); // no emails leaked
    });
  });

  describe('messages', () => {
    let company;
    beforeEach(async () => {
      company = spaceId((await admin.get('/chat/channels')).body.channels, 'company');
    });

    it('posts and lists in order, oldest first', async () => {
      await admin.post(`/chat/channels/${company}/messages`, { text: 'first' });
      await salesMember.post(`/chat/channels/${company}/messages`, { text: 'second' });
      const { body } = await accounts.get(`/chat/channels/${company}/messages`);
      expect(body.messages.map((m) => m.text)).toEqual(['first', 'second']);
      expect(body.messages[1].sender).toMatchObject({ name: 'Sam', team: 'sales' });
    });

    it('a retried send with the same clientId creates exactly one message', async () => {
      const id = clientId();
      const a = await salesMember.post(`/chat/channels/${company}/messages`, { text: 'once', clientId: id });
      const b = await salesMember.post(`/chat/channels/${company}/messages`, { text: 'once', clientId: id });
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect(b.body.message.id).toBe(a.body.message.id);
      expect(await ChatMessage.countDocuments({})).toBe(1);
    });

    it('rejects empty and over-long messages', async () => {
      expect((await admin.post(`/chat/channels/${company}/messages`, { text: '   ' })).status).toBe(400);
      expect((await admin.post(`/chat/channels/${company}/messages`, { text: 'x'.repeat(4001) })).status).toBe(400);
    });

    it('stores text as plain text (markup is not interpreted server-side)', async () => {
      const res = await admin.post(`/chat/channels/${company}/messages`, { text: '<b>hi</b>\u0007' });
      expect(res.body.message.text).toBe('<b>hi</b>'); // control char stripped, tags kept as text
    });

    it('pages older history with the before cursor', async () => {
      for (let i = 1; i <= 5; i++) await admin.post(`/chat/channels/${company}/messages`, { text: `m${i}` });
      const latest = await admin.get(`/chat/channels/${company}/messages?limit=2`);
      expect(latest.body.messages.map((m) => m.text)).toEqual(['m4', 'm5']);
      const older = await admin.get(`/chat/channels/${company}/messages?limit=2&before=${latest.body.nextBefore}`);
      expect(older.body.messages.map((m) => m.text)).toEqual(['m2', 'm3']);
      const catchUp = await admin.get(`/chat/channels/${company}/messages?after=3`);
      expect(catchUp.body.messages.map((m) => m.text)).toEqual(['m4', 'm5']);
    });

    it('counts unread for others, not for the sender, and clears on read', async () => {
      await admin.post(`/chat/channels/${company}/messages`, { text: 'a' });
      await admin.post(`/chat/channels/${company}/messages`, { text: 'b' });
      const mine = (await admin.get('/chat/channels')).body.channels.find((c) => c.id === company);
      expect(mine.unread).toBe(0);
      const theirs = (await salesMember.get('/chat/channels')).body.channels.find((c) => c.id === company);
      expect(theirs.unread).toBe(2);
      await salesMember.post(`/chat/channels/${company}/read`, { seq: theirs.lastMessageSeq });
      const after = (await salesMember.get('/chat/channels')).body.channels.find((c) => c.id === company);
      expect(after.unread).toBe(0);
    });

    it('no one can delete a message — not staff, not their own, not even an admin', async () => {
      const mine = (await salesMember.post(`/chat/channels/${company}/messages`, { text: 'oops' })).body.message;
      const other = (await accounts.post(`/chat/channels/${company}/messages`, { text: 'not yours' })).body.message;
      expect((await salesMember.del(`/chat/messages/${other.id}`)).status).toBe(403);
      expect((await salesMember.del(`/chat/messages/${mine.id}`)).status).toBe(403);
      expect((await salesHead.del(`/chat/messages/${mine.id}`)).status).toBe(403);
      expect((await admin.del(`/chat/messages/${mine.id}`)).status).toBe(403);
      expect((await admin.del(`/chat/messages/${other.id}`)).status).toBe(403);
      const { body } = await accounts.get(`/chat/channels/${company}/messages`);
      expect(body.messages.map((m) => [m.text, m.deleted])).toEqual([['oops', false], ['not yours', false]]);
      expect(await ChatMessage.countDocuments({ deletedAt: { $ne: null } })).toBe(0);
    });

    it('a message hidden before the no-delete rule stays hidden', async () => {
      const msg = (await accounts.post(`/chat/channels/${company}/messages`, { text: 'old secret' })).body.message;
      await ChatMessage.updateOne({ _id: msg.id }, { $set: { deletedAt: new Date() } });
      const { body } = await salesMember.get(`/chat/channels/${company}/messages`);
      expect(body.messages[0]).toMatchObject({ deleted: true, text: '' });
    });
  });

  describe('team-to-team conversations', () => {
    let procurement, pairs;
    beforeEach(async () => {
      await createUser({ name: 'Priya', email: 'priya@example.com', role: 'staff', staff: staff('procurement') });
      procurement = await signIn('priya@example.com');
      const all = (await admin.get('/chat/channels')).body.channels;
      pairs = Object.fromEntries(all.filter((c) => c.key?.startsWith('pair:')).map((c) => [c.key, c.id]));
    });

    it('both whole teams read and post; a third team gets 404; admin reads everything', async () => {
      const pa = pairs['pair:accounts:procurement'];
      await procurement.post(`/chat/channels/${pa}/messages`, { text: 'Supplier invoice for #A12 attached' });
      expect((await accounts.post(`/chat/channels/${pa}/messages`, { text: 'Approved' })).status).toBe(201);
      expect((await admin.get(`/chat/channels/${pa}/messages`)).body.messages.map((m) => m.text))
        .toEqual(['Supplier invoice for #A12 attached', 'Approved']);
      // GTM is not part of Procurement ↔ Accounts: it cannot read, post, or learn it exists.
      expect((await salesMember.get(`/chat/channels/${pa}/messages`)).status).toBe(404);
      expect((await salesHead.post(`/chat/channels/${pa}/messages`, { text: 'hi' })).status).toBe(404);
      expect((await salesMember.get('/chat/channels')).body.channels.some((c) => c.id === pa)).toBe(false);
    });

    it('GTM ↔ Accounts is a separate conversation Procurement never sees, even in search', async () => {
      const sa = pairs['pair:accounts:sales'];
      await salesMember.post(`/chat/channels/${sa}/messages`, { text: 'refund zebra for customer' });
      expect((await procurement.get(`/chat/channels/${sa}/messages`)).status).toBe(404);
      const found = await procurement.get('/chat/search?q=zebra');
      expect(found.status).toBe(200);
      expect(found.body.messages || found.body.results || []).toHaveLength(0);
      expect(((await accounts.get('/chat/search?q=zebra')).body.messages || []).length).toBe(1);
    });

    it('team mentions work for the two teams in the conversation only', async () => {
      const sa = pairs['pair:accounts:sales'];
      const res = await salesMember.post(`/chat/channels/${sa}/messages`, { text: '@accounts please check', mentionTeams: ['accounts', 'procurement'] });
      expect(res.body.message.mentionTeams).toEqual(['accounts']);
    });

    it('the live event for a team-to-team message routes to both teams and admins only', async () => {
      const events = [];
      const off = onChatEvent((e) => events.push(e));
      const pa = pairs['pair:accounts:procurement'];
      await procurement.post(`/chat/channels/${pa}/messages`, { text: 'live' });
      off();
      const route = events.find((e) => e.type === 'message' && e.channelId === pa)?.route;
      expect(route).toMatchObject({ audience: 'teams', teams: ['accounts', 'procurement'] });
      const asStaff = (team) => ({ _id: '0'.repeat(24), role: 'staff', staff: { team, active: true } });
      expect(canAccess(asStaff('procurement'), route)).toBe(true);
      expect(canAccess(asStaff('accounts'), route)).toBe(true);
      expect(canAccess(asStaff('sales'), route)).toBe(false);
      expect(canAccess({ _id: '1'.repeat(24), role: 'admin' }, route)).toBe(true);
    });

    it('a team space stays private to its own team', async () => {
      const procSpace = spaceId((await admin.get('/chat/channels')).body.channels, 'team:procurement');
      expect((await salesMember.get(`/chat/channels/${procSpace}/messages`)).status).toBe(404);
      expect((await procurement.get(`/chat/channels/${procSpace}/messages`)).status).toBe(200);
    });
  });

  describe('quoting a message', () => {
    let company;
    beforeEach(async () => {
      company = spaceId((await admin.get('/chat/channels')).body.channels, 'company');
    });

    it('snapshots the quoted message and shows it with the reply', async () => {
      const q = (await accounts.post(`/chat/channels/${company}/messages`, { text: 'Payment for #A12 is approved' })).body.message;
      const res = await salesMember.post(`/chat/channels/${company}/messages`, { text: 'Thanks!', quoteId: q.id });
      expect(res.status).toBe(201);
      expect(res.body.message.quote).toEqual({ id: q.id, seq: q.seq, by: 'Anu', preview: 'Payment for #A12 is approved' });
      const listed = (await admin.get(`/chat/channels/${company}/messages`)).body.messages.at(-1);
      expect(listed.quote.preview).toBe('Payment for #A12 is approved');
    });

    it('cannot quote a message from another conversation (would leak its text)', async () => {
      const sales = spaceId((await admin.get('/chat/channels')).body.channels, 'team:sales');
      const secret = (await salesMember.post(`/chat/channels/${sales}/messages`, { text: 'sales only' })).body.message;
      const res = await salesMember.post(`/chat/channels/${company}/messages`, { text: 'look', quoteId: secret.id });
      expect(res.status).toBe(404);
      expect(await ChatMessage.countDocuments({ text: 'look' })).toBe(0);
    });

    it('rejects a malformed quote id', async () => {
      expect((await salesMember.post(`/chat/channels/${company}/messages`, { text: 'x', quoteId: 'nope' })).status).toBe(400);
    });
  });

  describe('direct messages', () => {
    it('are private to the two people — even an admin gets 404', async () => {
      const { body } = await salesMember.post('/chat/dm', { userId: String(users.accounts._id) });
      const dm = body.channel.id;
      await salesMember.post(`/chat/channels/${dm}/messages`, { text: 'private' });
      expect((await accounts.get(`/chat/channels/${dm}/messages`)).body.messages[0].text).toBe('private');
      expect((await admin.get(`/chat/channels/${dm}/messages`)).status).toBe(404);
      expect((await salesHead.get(`/chat/channels/${dm}/messages`)).status).toBe(404);
      // Listed with the partner's name for each side.
      const listed = (await accounts.get('/chat/channels')).body.channels.find((c) => c.id === dm);
      expect(listed).toMatchObject({ kind: 'dm', name: 'Sam' });
    });

    it('opening the same DM twice reuses it', async () => {
      const a = await salesMember.post('/chat/dm', { userId: String(users.accounts._id) });
      const b = await accounts.post('/chat/dm', { userId: String(users.salesMember._id) });
      expect(b.body.channel.id).toBe(a.body.channel.id);
    });

    it('cannot DM a customer or yourself', async () => {
      expect((await salesMember.post('/chat/dm', { userId: String(users.customer._id) })).status).toBe(404);
      expect((await salesMember.post('/chat/dm', { userId: String(users.salesMember._id) })).status).toBe(400);
    });
  });

  describe('custom spaces', () => {
    it('team members cannot create spaces; heads and admins can', async () => {
      expect((await salesMember.post('/chat/channels', { name: 'deals' })).status).toBe(403);
      expect((await salesHead.post('/chat/channels', { name: 'Diwali Sale' })).status).toBe(201);
      expect((await admin.post('/chat/channels', { name: 'supplier-xyz' })).status).toBe(201);
    });

    it('only invited members (and admins) can see a custom space', async () => {
      const res = await salesHead.post('/chat/channels', { name: 'diwali', memberIds: [String(users.accounts._id)] });
      const id = res.body.channel.id;
      expect((await accounts.get(`/chat/channels/${id}/messages`)).status).toBe(200);
      expect((await admin.get(`/chat/channels/${id}/messages`)).status).toBe(200);
      expect((await salesMember.get(`/chat/channels/${id}/messages`)).status).toBe(404);
    });

    it('rejects duplicate and reserved names', async () => {
      await admin.post('/chat/channels', { name: 'deals' });
      expect((await admin.post('/chat/channels', { name: 'Deals' })).status).toBe(409);
      expect((await admin.post('/chat/channels', { name: 'sales' })).status).toBe(409);
    });
  });

  describe('removal and system posts', () => {
    it('a deactivated staff member loses chat immediately', async () => {
      await User.updateOne({ _id: users.salesMember._id }, { $set: { 'staff.active': false } });
      expect((await salesMember.get('/chat/channels')).status).toBe(403);
    });

    it('system posts land in the team space with no sender, and route only to that team', async () => {
      const events = [];
      const off = onChatEvent((e) => events.push(e));
      try {
        await admin.get('/chat/channels'); // creates the default spaces
        const msg = await postSystemMessage('team:operations', 'New paid order #ORD-1');
        expect(msg).toMatchObject({ kind: 'system', sender: null, text: 'New paid order #ORD-1' });
        const event = events.find((e) => e.type === 'message');
        expect(canAccess({ ...users.salesMember.toObject() }, event.route)).toBe(false);
        expect(canAccess({ ...users.admin.toObject() }, event.route)).toBe(true);
        expect(canAccess({ ...users.customer.toObject() }, event.route)).toBe(false);
      } finally {
        off();
      }
    });

    it('a system post to an unknown space is a no-op, never a throw', async () => {
      await expect(postSystemMessage('team:nope', 'x')).resolves.toBeNull();
    });
  });
});
