/**
 * Pinned messages (chatService.pinMessage / listPins).
 *
 * What must hold:
 *   - anyone who can read a conversation can pin and unpin, and everyone in
 *     it sees the change (live event, the timeline, the Pinned list);
 *   - pinning twice keeps the first pin; unpinning twice is fine;
 *   - nobody outside the conversation can pin or list its pins (404);
 *   - a deleted message cannot be pinned and drops off the list;
 *   - a conversation has at most MAX_PINS_PER_CHANNEL pins.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatMessage from '../models/ChatMessage.js';
import { postSystemMessage, MAX_PINS_PER_CHANNEL } from '../services/chatService.js';
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

describe('Pinned messages', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let pavan, priya, sana, admin, procurement;
  beforeEach(async () => {
    await createUser({ name: 'Pavan', email: 'pavan@example.com', role: 'staff', staff: staff('procurement') });
    await createUser({ name: 'Priya', email: 'priya@example.com', role: 'staff', staff: staff('procurement') });
    await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales') });
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    pavan = await signIn('pavan@example.com');
    priya = await signIn('priya@example.com');
    sana = await signIn('sana@example.com');
    admin = await signIn('owner@example.com');
    procurement = (await pavan.get('/chat/channels')).body.channels.find((c) => c.key === 'team:procurement').id;
  });

  let n = 0;
  const say = async (who, text, body = {}) => {
    const res = await who.post(`/chat/channels/${procurement}/messages`, { text, clientId: `pin-${++n}-test`, ...body });
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const pin = (who, id, on) => who.put(`/chat/messages/${id}/pin`, on === undefined ? {} : { on });
  const pins = async (who) => (await who.get(`/chat/channels/${procurement}/pins`)).body.messages;

  it('anyone in the conversation can pin; everyone sees it, with who pinned it', async () => {
    const m = await say(priya, 'Supplier bank details: see attached');
    const res = await pin(pavan, m.id);
    expect(res.status).toBe(200);
    expect(res.body.pinned).toMatchObject({ by: 'Pavan' });

    const list = await pins(priya);
    expect(list.map((x) => x.id)).toEqual([m.id]);
    expect(list[0].pinned.by).toBe('Pavan');
    const inTimeline = (await admin.get(`/chat/channels/${procurement}/messages`)).body.messages.find((x) => x.id === m.id);
    expect(inTimeline.pinned).toMatchObject({ by: 'Pavan' });
  });

  it('pinning twice keeps the first pin; anyone can unpin; unpinning twice is fine', async () => {
    const m = await say(priya, 'hi');
    await pin(pavan, m.id);
    expect((await pin(priya, m.id)).body.pinned.by).toBe('Pavan');
    expect((await pin(priya, m.id, false)).body.pinned).toBeNull();
    expect((await pin(priya, m.id, false)).status).toBe(200);
    expect(await pins(pavan)).toEqual([]);
  });

  it('lists newest pin first, including order updates and thread replies', async () => {
    const a = await say(priya, 'a');
    const root = await say(priya, 'root');
    const reply = await say(priya, 'reply', { threadRoot: root.id });
    const update = await postSystemMessage('team:procurement', 'Order #AB12 paid', { key: 'pin-sys' });
    await pin(pavan, a.id);
    await pin(pavan, reply.id);
    await pin(pavan, update.id);
    expect((await pins(priya)).map((x) => x.id)).toEqual([update.id, reply.id, a.id]);
  });

  it('nobody outside the conversation can pin or see its pins', async () => {
    const m = await say(priya, 'team only');
    expect((await pin(sana, m.id)).status).toBe(404);
    expect((await sana.get(`/chat/channels/${procurement}/pins`)).status).toBe(404);
    expect((await pin(sana, 'nope')).status).toBe(400);
    expect((await pin(pavan, m.id, 'yes')).status).toBe(400);
  });

  it('a deleted message cannot be pinned, and drops off the list', async () => {
    const m = await say(priya, 'oops');
    const kept = await say(priya, 'kept');
    await pin(pavan, m.id);
    await pin(pavan, kept.id);
    await priya.del(`/chat/messages/${m.id}`);
    expect((await pins(pavan)).map((x) => x.id)).toEqual([kept.id]);
    expect((await pin(pavan, m.id)).status).toBe(409);
  });

  it(`allows up to ${MAX_PINS_PER_CHANNEL} pins per conversation`, async () => {
    const ms = [];
    for (let i = 0; i <= MAX_PINS_PER_CHANNEL; i += 1) ms.push(await say(priya, `m${i}`));
    for (const m of ms.slice(0, MAX_PINS_PER_CHANNEL)) expect((await pin(pavan, m.id)).status).toBe(200);
    const over = await pin(pavan, ms[MAX_PINS_PER_CHANNEL].id);
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/unpin one first/);
    // Re-pinning one already pinned is still fine at the cap.
    expect((await pin(pavan, ms[0].id)).status).toBe(200);
  });

  it('tells the room live — only when something changed', async () => {
    const m = await say(priya, 'hi');
    const events = [];
    const off = onChatEvent((e) => { if (e.type === 'message_pinned') events.push(e); });
    await pin(pavan, m.id);
    await pin(pavan, m.id);
    await pin(pavan, m.id, false);
    await pin(pavan, m.id, false);
    off();
    expect(events.map((e) => !!e.pinned)).toEqual([true, false]);
    expect(events[0]).toMatchObject({ channelId: procurement, messageId: m.id, route: expect.objectContaining({ audience: 'team' }) });
  });

  it('uses the chat_pins index', async () => {
    const m = await say(priya, 'hi');
    await pin(pavan, m.id);
    await ChatMessage.syncIndexes();
    const plan = await ChatMessage.find({ channel: m.channelId, pinnedAt: { $type: 'date' }, deletedAt: null })
      .sort({ pinnedAt: -1 }).explain('queryPlanner');
    expect(JSON.stringify(plan)).toContain('chat_pins');
  });
});
