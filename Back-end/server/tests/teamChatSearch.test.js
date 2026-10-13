/**
 * Team chat — message search.
 *
 * WHAT THIS GUARDS
 * ----------------
 * Search is the one chat endpoint where a scoping mistake leaks the WHOLE
 * history rather than a single message. Every other route takes a channel id
 * and checks it; this one spans channels, so the access rules have to be
 * applied to the QUERY. A missing filter here would quietly return another
 * team's space or somebody else's DM to anyone who typed a common word.
 *
 * So the tests that matter are the negative ones: a team space is invisible to
 * another team, a DM is invisible to everyone outside it INCLUDING an admin
 * (admins see every space but only their own DMs), and a customer cannot reach
 * the endpoint at all.
 *
 * The rest pins what a reader needs: deleted messages never surface (their text
 * is withheld anyway, so a hit nobody can read is worse than no hit), results
 * carry the channel they came from, and paging is keyset rather than skip.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
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
  const token = res.body.accessToken;
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`).set('Authorization', `Bearer ${token}`),
    post: (url, body) =>
      agent.post(`${BASE}${url}`).set('Authorization', `Bearer ${token}`)
        .set('x-xsrf-token', csrf).send(body),
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
let n = 0;
const clientId = () => `search-test-${Date.now()}-${++n}`;

describe('Team chat search', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, salesHead, accounts, customer, company, salesSpace;

  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales', true) });
    await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts', true) });
    await createUser({ name: 'Cust', email: 'cust@example.com' });

    admin = await signIn('owner@example.com');
    salesHead = await signIn('sana@example.com');
    accounts = await signIn('anu@example.com');
    customer = await signIn('cust@example.com');

    const { body } = await admin.get('/chat/channels');
    company = spaceId(body.channels, 'company');
    salesSpace = spaceId(body.channels, 'team:sales');
  });

  const say = (who, channel, text) =>
    who.post(`/chat/channels/${channel}/messages`, { text, clientId: clientId() });

  // ── the part that must never break ────────────────────────────────────────
  describe('what search must never return', () => {
    it('a customer cannot search at all', async () => {
      expect((await customer.get('/chat/search?q=winch')).status).toBe(403);
    });

    it('another team never sees a team space in results', async () => {
      await say(salesHead, salesSpace, 'the winch order shipped today');
      await say(admin, company, 'winch stock arriving friday');

      const { body } = await accounts.get('/chat/search?q=winch');
      // Accounts is in #company but not in the sales space.
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].text).toMatch(/stock arriving/);
    });

    it('a DM stays private — even from an admin', async () => {
      const dm = await salesHead.post('/chat/dm', {
        userId: String((await User.findOne({ email: 'anu@example.com' }))._id),
      });
      const dmId = dm.body.channel?.id ?? dm.body.id;
      await say(salesHead, dmId, 'confidential winch pricing');

      const asAdmin = await admin.get('/chat/search?q=winch');
      expect(asAdmin.body.messages.map((m) => m.text)).not.toContain('confidential winch pricing');

      // …but the two people in it can find it.
      const asMember = await accounts.get('/chat/search?q=winch');
      expect(asMember.body.messages.map((m) => m.text)).toContain('confidential winch pricing');
    });

    it('searching INSIDE a channel you cannot see 404s, exactly like reading it', async () => {
      await say(salesHead, salesSpace, 'winch');
      expect((await accounts.get(`/chat/search?q=winch&channelId=${salesSpace}`)).status).toBe(404);
    });

    it('a deleted message never surfaces', async () => {
      const sent = await say(admin, company, 'winch delivered to the wrong address');
      const id = sent.body.message?.id ?? sent.body.id;
      await ChatMessage.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });

      const { body } = await admin.get('/chat/search?q=winch');
      expect(body.messages).toHaveLength(0);
    });
  });

  // ── what a reader needs ───────────────────────────────────────────────────
  describe('results', () => {
    it('finds a message and says which channel it was in', async () => {
      await say(admin, company, 'the Bushranger winch arrives Tuesday');

      const { body } = await admin.get('/chat/search?q=bushranger');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].channel).toBe(String(company));
      expect(body.messages[0].channelName).toBeTruthy();
    });

    it('labels a DM hit with the other person, not a blank name', async () => {
      // A DM has no name of its own, so the label has to be resolved per
      // viewer — the same message is "Anu" to Sana and "Sana" to Anu.
      const dm = await salesHead.post('/chat/dm', {
        userId: String((await User.findOne({ email: 'anu@example.com' }))._id),
      });
      const dmId = dm.body.channel?.id ?? dm.body.id;
      await say(salesHead, dmId, 'winch quote sent');

      const mine = await salesHead.get('/chat/search?q=winch');
      expect(mine.body.messages[0].channelKind).toBe('dm');
      expect(mine.body.messages[0].channelName).toBe('Anu');

      const theirs = await accounts.get('/chat/search?q=winch');
      expect(theirs.body.messages[0].channelName).toBe('Sana');
    });

    it('matches on word stem, not just exact substring', async () => {
      await say(admin, company, 'we shipped the order');
      const { body } = await admin.get('/chat/search?q=shipping');
      expect(body.messages.length).toBeGreaterThanOrEqual(1);
    });

    it('can be narrowed to one channel', async () => {
      await say(admin, company, 'winch in company');
      await say(salesHead, salesSpace, 'winch in sales');

      const { body } = await admin.get(`/chat/search?q=winch&channelId=${salesSpace}`);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].text).toBe('winch in sales');
    });

    it('returns nothing for a one-character query rather than the whole history', async () => {
      await say(admin, company, 'a winch');
      const { body } = await admin.get('/chat/search?q=a');
      expect(body.messages).toHaveLength(0);
      expect(body.nextBefore).toBeNull();
    });

    it('pages newest-first with a keyset cursor, never repeating a row', async () => {
      for (let i = 0; i < 7; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await say(admin, company, `winch note ${i}`);
      }

      const first = await admin.get('/chat/search?q=winch&limit=3');
      expect(first.body.messages).toHaveLength(3);
      expect(first.body.nextBefore).toBeTruthy();

      const second = await admin.get(
        `/chat/search?q=winch&limit=3&before=${encodeURIComponent(first.body.nextBefore)}`,
      );
      const ids = new Set(first.body.messages.map((m) => m.id));
      for (const m of second.body.messages) expect(ids.has(m.id)).toBe(false);
    });

    it('says search is not ready yet instead of crashing when the index is missing', async () => {
      // Production runs autoIndex: false. Between a deploy and the index-drift
      // run, Mongo refuses $text; the staff member should be told to wait, not
      // handed a 500.
      const spy = jest.spyOn(ChatMessage, 'find').mockImplementationOnce(() => {
        const err = new Error('text index required for $text query');
        err.code = 27;
        return { sort: () => ({ limit: () => ({ populate: () => ({ lean: () => Promise.reject(err) }) }) }) };
      });
      try {
        const res = await admin.get('/chat/search?q=winch');
        expect(res.status).toBe(503);
      } finally {
        spy.mockRestore();
      }
    });

    it('the last page reports no cursor', async () => {
      await say(admin, company, 'single winch');
      const { body } = await admin.get('/chat/search?q=winch&limit=10');
      expect(body.nextBefore).toBeNull();
    });
  });
});
