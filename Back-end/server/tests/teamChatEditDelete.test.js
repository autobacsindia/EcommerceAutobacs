/**
 * Editing and deleting your own chat message (services/chatService.js,
 * "editing and deleting your own message").
 *
 * The rule: the AUTHOR may edit or delete their own message within 15 minutes
 * of sending it. Nobody may change anyone else's. Both are soft — an admin still
 * sees the original words and every earlier version; everyone else sees
 * "edited" or "This message was deleted".
 *
 * Deleting was switched off once because chat is part of the company record.
 * These tests are weighted toward the ways a soft delete quietly stops being
 * one — the words surviving in a quote, in a thread's "last reply" line, in the
 * live broadcast, or in search — and toward one person changing another's words.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatMessage from '../models/ChatMessage.js';
import { postSystemMessage, CHAT_EDIT_WINDOW_MS } from '../services/chatService.js';
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

/*
  Age a message past the edit window. Through the raw driver: with
  `timestamps: true`, Mongoose treats createdAt as immutable and would quietly
  drop it from an update, leaving the test asserting against a fresh message.
*/
const ageMessage = (id, ms = CHAT_EDIT_WINDOW_MS + 60_000) =>
  ChatMessage.collection.updateOne(
    { _id: ChatMessage.castObject({ _id: id })._id },
    { $set: { createdAt: new Date(Date.now() - ms) } },
  );

describe('Editing and deleting your own chat message', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, salesHead, salesMember, accounts, company, sales;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales', true) });
    await createUser({ name: 'Sam', email: 'sam@example.com', role: 'staff', staff: staff('sales') });
    await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts', true) });
    admin = await signIn('owner@example.com');
    salesHead = await signIn('sana@example.com');
    salesMember = await signIn('sam@example.com');
    accounts = await signIn('anu@example.com');
    const channels = (await admin.get('/chat/channels')).body.channels;
    company = spaceId(channels, 'company');
    sales = spaceId(channels, 'team:sales');
  });

  const send = async (who, channel, body) => {
    const res = await who.post(`/chat/channels/${channel}/messages`, body);
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const timeline = async (who, channel) => (await who.get(`/chat/channels/${channel}/messages`)).body.messages;
  const find = async (who, channel, id) => (await timeline(who, channel)).find((m) => m.id === id);

  // ── the rule ──────────────────────────────────────────────────────────────

  describe('who may change a message', () => {
    it('the author can edit their own message, and it is marked edited', async () => {
      const m = await send(salesMember, company, { text: 'Delivery on Tuesdy' });
      const res = await salesMember.patch(`/chat/messages/${m.id}`, { text: 'Delivery on Tuesday' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatchObject({ text: 'Delivery on Tuesday', edited: true });

      const seen = await find(accounts, company, m.id);
      expect(seen).toMatchObject({ text: 'Delivery on Tuesday', edited: true });
    });

    it('the author can delete their own message', async () => {
      const m = await send(salesMember, company, { text: 'wrong channel, sorry' });
      expect((await salesMember.del(`/chat/messages/${m.id}`)).status).toBe(200);
      expect(await find(accounts, company, m.id)).toMatchObject({ deleted: true, text: '' });
    });

    /*
      One person changing another's words is the thing this must never allow —
      not a head over their member, not an admin over anyone. Admins SEE
      everything; they do not rewrite it.
    */
    it.each([
      ['an admin', () => admin],
      ['the team head', () => salesHead],
      ['someone from another team', () => accounts],
    ])('%s cannot edit or delete someone else’s message', async (_label, who) => {
      const m = await send(salesMember, company, { text: 'mine' });
      expect((await who().patch(`/chat/messages/${m.id}`, { text: 'not yours' })).status).toBe(403);
      expect((await who().del(`/chat/messages/${m.id}`)).status).toBe(403);
      expect(await find(salesMember, company, m.id)).toMatchObject({ text: 'mine', deleted: false, edited: false });
    });

    it('nobody can edit or delete an automatic system post', async () => {
      const posted = await postSystemMessage('company', 'Order #A1B2 paid');
      expect((await admin.patch(`/chat/messages/${posted.id}`, { text: 'x' })).status).toBe(403);
      expect((await admin.del(`/chat/messages/${posted.id}`)).status).toBe(403);
    });

    /*
      A message in a channel you cannot read is a 404 — the same answer as a
      message that does not exist — so the endpoint cannot be used to learn that
      a private message is there.
    */
    it('a message in a channel you cannot see is "not found", not "not yours"', async () => {
      const m = await send(salesMember, sales, { text: 'team only' });
      expect((await accounts.patch(`/chat/messages/${m.id}`, { text: 'x' })).status).toBe(404);
      expect((await accounts.del(`/chat/messages/${m.id}`)).status).toBe(404);
    });
  });

  describe('the 15-minute window', () => {
    it('is open just inside 15 minutes', async () => {
      const m = await send(salesMember, company, { text: 'almost' });
      await ageMessage(m.id, CHAT_EDIT_WINDOW_MS - 60_000);
      expect((await salesMember.patch(`/chat/messages/${m.id}`, { text: 'just in time' })).status).toBe(200);
    });

    it('is closed after 15 minutes, for editing and deleting alike', async () => {
      const m = await send(salesMember, company, { text: 'too late' });
      await ageMessage(m.id);
      const edit = await salesMember.patch(`/chat/messages/${m.id}`, { text: 'changed' });
      expect(edit.status).toBe(403);
      expect(edit.body.message).toMatch(/15 minutes/);
      expect((await salesMember.del(`/chat/messages/${m.id}`)).status).toBe(403);
      expect(await find(accounts, company, m.id)).toMatchObject({ text: 'too late', deleted: false });
    });

    it('applies to an admin’s own message too', async () => {
      const m = await send(admin, company, { text: 'announcement' });
      await ageMessage(m.id);
      expect((await admin.del(`/chat/messages/${m.id}`)).status).toBe(403);
    });

    it('tells the client when the window closes', async () => {
      const m = await send(salesMember, company, { text: 'hello' });
      const until = new Date(m.editableUntil).getTime();
      expect(until - new Date(m.createdAt).getTime()).toBe(CHAT_EDIT_WINDOW_MS);
    });
  });

  describe('edge cases', () => {
    it('deleting twice is still a success — the person wanted it gone, and it is', async () => {
      const m = await send(salesMember, company, { text: 'oops' });
      expect((await salesMember.del(`/chat/messages/${m.id}`)).status).toBe(200);
      expect((await salesMember.del(`/chat/messages/${m.id}`)).status).toBe(200);
    });

    it('a deleted message cannot be edited back', async () => {
      const m = await send(salesMember, company, { text: 'gone' });
      await salesMember.del(`/chat/messages/${m.id}`);
      expect((await salesMember.patch(`/chat/messages/${m.id}`, { text: 'back' })).status).toBe(409);
    });

    it('an edit cannot empty a text-only message — that is a delete', async () => {
      const m = await send(salesMember, company, { text: 'something' });
      expect((await salesMember.patch(`/chat/messages/${m.id}`, { text: '   ' })).status).toBe(400);
    });

    it('saving the same text changes nothing and is not marked edited', async () => {
      const m = await send(salesMember, company, { text: 'same' });
      const res = await salesMember.patch(`/chat/messages/${m.id}`, { text: 'same' });
      expect(res.status).toBe(200);
      expect(res.body.message.edited).toBe(false);
    });
  });

  // ── admins see everything ─────────────────────────────────────────────────

  describe('what an admin sees', () => {
    it('the original words of a deleted message, flagged deleted', async () => {
      const m = await send(salesMember, company, { text: 'Customer said ₹40k max' });
      await salesMember.del(`/chat/messages/${m.id}`);

      expect(await find(admin, company, m.id)).toMatchObject({ deleted: true, text: 'Customer said ₹40k max' });
      expect(await find(salesHead, company, m.id)).toMatchObject({ deleted: true, text: '' });
    });

    it('every earlier version of an edited message — and nobody else does', async () => {
      const m = await send(salesMember, company, { text: 'v1' });
      await salesMember.patch(`/chat/messages/${m.id}`, { text: 'v2' });
      await salesMember.patch(`/chat/messages/${m.id}`, { text: 'v3' });

      const seen = await find(admin, company, m.id);
      expect(seen.text).toBe('v3');
      expect(seen.editHistory.map((h) => h.text)).toEqual(['v1', 'v2']);

      expect((await find(salesHead, company, m.id)).editHistory).toBeUndefined();
    });
  });

  // ── where the old words could survive ─────────────────────────────────────

  describe('the deleted words do not survive anywhere else', () => {
    /*
      A quote is a snapshot. Without handling it, deleting a message would leave
      its words readable in every reply that quoted it — the delete would be
      cosmetic.
    */
    it('not in a reply that quoted it', async () => {
      const original = await send(salesMember, company, { text: 'secret discount code ABC' });
      const reply = await send(accounts, company, { text: 'noted', quoteId: original.id });
      expect(reply.quote.preview).toBe('secret discount code ABC');

      await salesMember.del(`/chat/messages/${original.id}`);

      const seenByStaff = await find(salesHead, company, reply.id);
      expect(seenByStaff.quote).toMatchObject({ deleted: true, preview: '' });
      // An admin still reads what was answered.
      const seenByAdmin = await find(admin, company, reply.id);
      expect(seenByAdmin.quote).toMatchObject({ deleted: true, preview: 'secret discount code ABC' });
    });

    it('a quote shows the corrected words after an edit', async () => {
      const original = await send(salesMember, company, { text: 'price is 500' });
      const reply = await send(accounts, company, { text: 'ok', quoteId: original.id });
      await salesMember.patch(`/chat/messages/${original.id}`, { text: 'price is 600' });
      expect((await find(salesHead, company, reply.id)).quote.preview).toBe('price is 600');
    });

    /*
      A thread root carries a "last reply" line so the timeline can show
      "3 replies · <latest>" without loading the thread. If the latest reply is
      deleted, that line must stop showing it.
    */
    it('not in the thread’s "last reply" line', async () => {
      const root = await send(salesMember, company, { text: 'Thread' });
      await send(accounts, company, { text: 'first reply', threadRoot: root.id });
      const latest = await send(salesHead, company, { text: 'call me on 98xxxx', threadRoot: root.id });

      expect((await find(salesMember, company, root.id)).lastReply.preview).toBe('call me on 98xxxx');
      await salesHead.del(`/chat/messages/${latest.id}`);

      const after = await find(salesMember, company, root.id);
      expect(after.lastReply.preview).toBe('first reply');
      // The thread does not lose its place or its count: the deleted reply is
      // still there, shown as deleted.
      expect(after.replyCount).toBe(2);
    });

    it('an edited latest reply updates the thread line', async () => {
      const root = await send(salesMember, company, { text: 'Thread' });
      const reply = await send(accounts, company, { text: 'teh total', threadRoot: root.id });
      await accounts.patch(`/chat/messages/${reply.id}`, { text: 'the total' });
      expect((await find(salesMember, company, root.id)).lastReply.preview).toBe('the total');
    });

    it('not in search — and an edit is found by its new words, not its old ones', async () => {
      const gone = await send(salesMember, company, { text: 'pineapple supplier' });
      const fixed = await send(salesMember, company, { text: 'mango supplier' });
      await salesMember.del(`/chat/messages/${gone.id}`);
      await salesMember.patch(`/chat/messages/${fixed.id}`, { text: 'banana supplier' });

      const search = async (q) => (await salesHead.get(`/chat/search?q=${q}`)).body.messages.map((m) => m.id);
      expect(await search('pineapple')).toEqual([]);
      expect(await search('mango')).toEqual([]);
      expect(await search('banana')).toEqual([fixed.id]);
    });

    /*
      The live stream sends ONE payload to everyone in the channel, so it must be
      the version the least-privileged reader may see. A delete sends only the
      id; an edit sends the new text and never the history.
    */
    it('not in the live broadcast', async () => {
      const m = await send(salesMember, company, { text: 'first draft' });
      const events = [];
      const off = onChatEvent((e) => events.push(e));
      await salesMember.patch(`/chat/messages/${m.id}`, { text: 'second draft' });
      await salesMember.del(`/chat/messages/${m.id}`);
      off();

      const edited = events.find((e) => e.type === 'message_edited');
      expect(edited.message.text).toBe('second draft');
      expect(edited.message.editHistory).toBeUndefined();

      const deleted = events.find((e) => e.type === 'message_deleted');
      expect(deleted.messageId).toBe(m.id);
      expect(JSON.stringify(deleted)).not.toMatch(/draft/);
    });
  });
});
