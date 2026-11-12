/**
 * The "Home" list's last-message preview (ChatChannel.lastPreview, returned by
 * GET /chat/channels as `lastPreview`).
 *
 * What must hold:
 *   - it names the newest message, including thread replies and order updates;
 *   - editing the newest message updates it, editing an older one does not;
 *   - deleting the newest message leaves "deleted" and no words — the deleted
 *     text must not live on in anybody's list;
 *   - a retried send (same clientId) leaves one message and a preview of it;
 *   - a DM's preview reaches only the people in it — not an admin, who sees
 *     every space but not other people's DMs.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatChannel from '../models/ChatChannel.js';
import ChatMessage from '../models/ChatMessage.js';
import chatRepository from '../repositories/chatRepository.js';
import { postSystemMessage, HOME_PREVIEW_LENGTH } from '../services/chatService.js';
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

describe('Home list: last-message preview', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, sam, anu, ravi, samUser, anuUser, company;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    samUser = await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') });
    anuUser = await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts') });
    await createUser({ name: 'Ravi', email: 'ravi@example.com', role: 'staff', staff: staff('sales') });
    admin = await signIn('owner@example.com');
    sam = await signIn('sam@example.com');
    anu = await signIn('anu@example.com');
    ravi = await signIn('ravi@example.com');
    company = (await admin.get('/chat/channels')).body.channels.find((c) => c.key === 'company').id;
  });

  const send = async (who, channel, body) => {
    const res = await who.post(`/chat/channels/${channel}/messages`, body);
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const previewIn = async (who, channel) =>
    (await who.get('/chat/channels')).body.channels.find((c) => c.id === channel)?.lastPreview;

  it('is null before the first message, then shows who said what', async () => {
    expect(await previewIn(anu, company)).toBeNull();
    await send(sam, company, { text: 'Order 4521   shipped\n\ntoday' });
    expect(await previewIn(anu, company)).toEqual({ by: 'Sam', mine: false, text: 'Order 4521 shipped today', deleted: false });
    // "You: …" — the author's own list knows it is theirs.
    expect((await previewIn(sam, company)).mine).toBe(true);
  });

  it('never carries the message id', async () => {
    await send(sam, company, { text: 'hi' });
    expect(Object.keys(await previewIn(anu, company)).sort()).toEqual(['by', 'deleted', 'mine', 'text']);
  });

  it('is cut to a short line', async () => {
    await send(sam, company, { text: 'x'.repeat(500) });
    expect((await previewIn(anu, company)).text).toHaveLength(HOME_PREVIEW_LENGTH);
  });

  it('follows the newest message, including a thread reply and an automatic order update', async () => {
    const root = await send(sam, company, { text: 'Winch return?' });
    await send(anu, company, { text: 'Approved', threadRoot: root.id });
    expect(await previewIn(sam, company)).toMatchObject({ by: 'Anu', text: 'Approved' });

    await postSystemMessage('company', 'Order #A1B2 paid');
    expect(await previewIn(sam, company)).toMatchObject({ by: 'Autobacs updates', mine: false, text: 'Order #A1B2 paid' });
  });

  describe('edit', () => {
    it('editing the newest message updates the preview and refreshes readers’ lists', async () => {
      const events = [];
      const off = onChatEvent((e) => events.push(e));
      try {
        const m = await send(sam, company, { text: 'Delivery on Tuesdy' });
        events.length = 0;
        expect((await sam.patch(`/chat/messages/${m.id}`, { text: 'Delivery on Tuesday' })).status).toBe(200);
        expect(await previewIn(anu, company)).toMatchObject({ text: 'Delivery on Tuesday', deleted: false });
        expect(events.some((e) => e.type === 'channel' && e.channelId === company)).toBe(true);
      } finally { off(); }
    });

    it('editing an older message leaves the newer preview alone', async () => {
      const older = await send(sam, company, { text: 'first' });
      await send(anu, company, { text: 'second' });
      await sam.patch(`/chat/messages/${older.id}`, { text: 'first, corrected' });
      expect(await previewIn(sam, company)).toMatchObject({ by: 'Anu', text: 'second' });
    });
  });

  describe('delete', () => {
    it('deleting the newest message says deleted and keeps no words, for everyone (admins too)', async () => {
      const m = await send(sam, company, { text: 'secret salary figure' });
      expect((await sam.del(`/chat/messages/${m.id}`)).status).toBe(200);
      for (const who of [anu, admin, sam]) {
        expect(await previewIn(who, company)).toMatchObject({ by: 'Sam', text: '', deleted: true });
      }
      // Not just hidden by the API — gone from the channel document.
      const doc = await ChatChannel.findById(company).lean();
      expect(doc.lastPreview.text).toBe('');
      expect(JSON.stringify(doc)).not.toContain('salary');
    });

    it('deleting twice is fine and changes nothing more', async () => {
      const m = await send(sam, company, { text: 'oops' });
      await sam.del(`/chat/messages/${m.id}`);
      expect((await sam.del(`/chat/messages/${m.id}`)).status).toBe(200);
      expect(await previewIn(anu, company)).toMatchObject({ deleted: true, text: '' });
    });

    it('deleting an older message leaves the newer preview alone', async () => {
      const older = await send(sam, company, { text: 'first' });
      await send(anu, company, { text: 'second' });
      await sam.del(`/chat/messages/${older.id}`);
      expect(await previewIn(sam, company)).toMatchObject({ text: 'second', deleted: false });
    });

    it('a new message after a delete replaces the "deleted" preview', async () => {
      const m = await send(sam, company, { text: 'oops' });
      await sam.del(`/chat/messages/${m.id}`);
      await send(anu, company, { text: 'all good' });
      expect(await previewIn(sam, company)).toEqual({ by: 'Anu', mine: false, text: 'all good', deleted: false });
    });
  });

  describe('retries', () => {
    it('a retried send (same clientId) leaves one message and its preview', async () => {
      await send(sam, company, { text: 'Pay now', clientId: 'retry-0001' });
      const again = await sam.post(`/chat/channels/${company}/messages`, { text: 'Pay now', clientId: 'retry-0001' });
      expect(again.status).toBeLessThan(300);
      expect(await ChatMessage.countDocuments({ channel: company })).toBe(1);
      expect(await previewIn(anu, company)).toMatchObject({ by: 'Sam', text: 'Pay now' });
    });

    /*
      Two copies of one send racing: both take a seq (and write a preview), one
      insert loses on the unique clientId. The loser's preview names a message
      that was never written — it must be pointed back at the winner, or a
      later edit/delete of the real message would never reach the Home list.
    */
    it('a lost clientId race points the preview back at the message that exists', async () => {
      const first = await send(sam, company, { text: 'double click', clientId: 'race-0001' });
      // The second copy slips past the up-front duplicate check, as it does when
      // both arrive together: it takes a seq, writes its preview, then loses on
      // the unique index.
      const spy = jest.spyOn(chatRepository, 'findByClientId').mockResolvedValueOnce(null);
      try {
        const again = await sam.post(`/chat/channels/${company}/messages`, { text: 'double click', clientId: 'race-0001' });
        expect(again.status).toBeLessThan(300);
        expect(again.body.message.id).toBe(first.id);
      } finally { spy.mockRestore(); }

      expect(await ChatMessage.countDocuments({ channel: company })).toBe(1);
      const doc = await ChatChannel.findById(company).lean();
      expect(String(doc.lastPreview.message)).toBe(first.id);

      await sam.del(`/chat/messages/${first.id}`);
      expect(await previewIn(anu, company)).toMatchObject({ deleted: true, text: '' });
    });

    it('repointing never overwrites a newer message’s preview', async () => {
      const ghost = new mongoose.Types.ObjectId();
      await send(anu, company, { text: 'newer' });
      const moved = await chatRepository.repointPreview(company, ghost, { message: ghost, by: 'x', text: 'stale' });
      expect(moved).toBe(false);
      expect(await previewIn(sam, company)).toMatchObject({ text: 'newer' });
    });
  });

  it('a photo with no text previews as the file', async () => {
    const id = new mongoose.Types.ObjectId();
    await ChatChannel.updateOne({ _id: company }, { $set: { lastPreview: { message: id, sender: samUser._id, by: 'Sam', text: '📎 invoice.pdf' } } });
    expect(await previewIn(anu, company)).toMatchObject({ text: '📎 invoice.pdf', mine: false });
  });

  describe('privacy', () => {
    it('a DM’s preview reaches only the two people in it — not an admin, not a third person', async () => {
      const dm = (await sam.post('/chat/dm', { userId: String(anuUser._id) })).body.channel.id;
      await send(sam, dm, { text: 'private: my notice period' });
      expect(await previewIn(anu, dm)).toMatchObject({ text: 'private: my notice period' });
      expect(await previewIn(sam, dm)).toMatchObject({ mine: true });

      for (const outsider of [admin, ravi]) {
        const body = JSON.stringify((await outsider.get('/chat/channels')).body);
        expect(body).not.toContain('notice period');
      }
    });

    it('a team space’s preview does not reach another team', async () => {
      const sales = (await sam.get('/chat/channels')).body.channels.find((c) => c.key === 'team:sales').id;
      await send(sam, sales, { text: 'sales-only discount code' });
      const body = JSON.stringify((await anu.get('/chat/channels')).body);
      expect(body).not.toContain('discount code');
    });

    it('an edit or delete in a DM refreshes only the people in it', async () => {
      const dm = (await sam.post('/chat/dm', { userId: String(anuUser._id) })).body.channel.id;
      const m = await send(sam, dm, { text: 'zebra-words' });
      const events = [];
      const off = onChatEvent((e) => events.push(e));
      try {
        await sam.del(`/chat/messages/${m.id}`);
      } finally { off(); }
      const ev = events.find((e) => e.type === 'channel');
      expect(ev).toBeTruthy();
      // The SSE layer routes on this: a DM goes to its members only.
      expect(ev.route).toMatchObject({ kind: 'dm', members: expect.arrayContaining([String(samUser._id), String(anuUser._id)]) });
      expect(ev.route.members).toHaveLength(2);
      expect(JSON.stringify(ev)).not.toContain('zebra');
    });
  });
});
