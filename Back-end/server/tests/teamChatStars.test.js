/**
 * Starred messages (chatService.starMessage / listStarred).
 *
 * What must hold:
 *   - a star is private: only its owner sees it, nothing is broadcast;
 *   - starring twice is one star; un-starring what is not starred is fine;
 *   - only messages you can read; the Starred list drops anything you can no
 *     longer read, and messages since deleted (except for an admin);
 *   - every page that lists messages says whether each is starred, for that person;
 *   - the list pages by cursor and never stalls on skipped stars.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatChannel from '../models/ChatChannel.js';
import { postSystemMessage } from '../services/chatService.js';
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

describe('Starred messages', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let pavan, priya, sana, admin, users, procurement, procurementName, company;
  beforeEach(async () => {
    users = {
      pavan: await createUser({ name: 'Pavan', email: 'pavan@example.com', role: 'staff', staff: staff('procurement') }),
      priya: await createUser({ name: 'Priya', email: 'priya@example.com', role: 'staff', staff: staff('procurement') }),
      sana: await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales') }),
    };
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    pavan = await signIn('pavan@example.com');
    priya = await signIn('priya@example.com');
    sana = await signIn('sana@example.com');
    admin = await signIn('owner@example.com');
    const channels = (await pavan.get('/chat/channels')).body.channels;
    procurement = channels.find((c) => c.key === 'team:procurement').id;
    // The same name the channel list shows.
    procurementName = channels.find((c) => c.key === 'team:procurement').name;
    company = channels.find((c) => c.key === 'company').id;
  });

  let n = 0;
  const say = async (who, channel, text, body = {}) => {
    const res = await who.post(`/chat/channels/${channel}/messages`, { text, clientId: `star-${++n}-test`, ...body });
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const star = (who, id, on) => who.put(`/chat/messages/${id}/star`, on === undefined ? {} : { on });
  const starred = async (who, q = '') => (await who.get(`/chat/starred${q}`)).body;
  const inTimeline = async (who, channel, id) =>
    (await who.get(`/chat/channels/${channel}/messages`)).body.messages.find((m) => m.id === id);

  it('stars a message and lists it, with the conversation it is in', async () => {
    const m = await say(priya, procurement, 'Supplier quote: ₹42,000');
    const res = await star(pavan, m.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, messageId: m.id, starred: true });

    const list = await starred(pavan);
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0]).toMatchObject({
      id: m.id, text: 'Supplier quote: ₹42,000', starred: true, channel: procurement, channelName: procurementName, channelKind: 'space',
    });
    expect(list.nextBefore).toBeNull();
  });

  it('is private: the timeline says starred for me, not for anyone else', async () => {
    const m = await say(priya, procurement, 'hi');
    await star(pavan, m.id);
    expect((await inTimeline(pavan, procurement, m.id)).starred).toBe(true);
    expect((await inTimeline(priya, procurement, m.id)).starred).toBe(false);
    expect((await starred(priya)).messages).toEqual([]);
  });

  it('nothing goes out on the live stream', async () => {
    const m = await say(priya, procurement, 'hi');
    const events = [];
    const off = onChatEvent((e) => events.push(e));
    await star(pavan, m.id);
    await star(pavan, m.id, false);
    off();
    expect(events).toEqual([]);
  });

  it('starring twice is one star; un-starring twice is fine', async () => {
    const m = await say(priya, procurement, 'hi');
    await Promise.all([star(pavan, m.id), star(pavan, m.id)]);
    expect((await starred(pavan)).messages).toHaveLength(1);
    expect((await star(pavan, m.id, false)).body.starred).toBe(false);
    expect((await star(pavan, m.id, false)).status).toBe(200);
    expect((await starred(pavan)).messages).toEqual([]);
    expect((await inTimeline(pavan, procurement, m.id)).starred).toBe(false);
  });

  it('works on order updates, thread replies, and in search results', async () => {
    const update = await postSystemMessage('team:procurement', 'Order #AB12 paid — please source the winch', { key: 's-1' });
    const root = await say(priya, procurement, 'root');
    const reply = await say(priya, procurement, 'reply about the winch', { threadRoot: root.id });
    await star(pavan, update.id);
    await star(pavan, reply.id);

    const thread = (await pavan.get(`/chat/messages/${root.id}/thread`)).body;
    expect(thread.root.starred).toBe(false);
    expect(thread.replies[0].starred).toBe(true);

    const hits = (await pavan.get('/chat/search?q=winch')).body.messages;
    expect(hits.map((h) => [h.id, h.starred]).sort()).toEqual([[reply.id, true], [update.id, true]].sort());
    expect(hits.every((h) => h.channel === procurement && h.channelName === procurementName)).toBe(true);
  });

  it('only messages you can read; not a deleted one', async () => {
    const m = await say(priya, procurement, 'team only');
    expect((await star(sana, m.id)).status).toBe(404);
    expect((await star(sana, '64b7f0f0f0f0f0f0f0f0f0f0')).status).toBe(404);
    expect((await star(sana, m.id, 'yes')).status).toBe(400);

    await priya.del(`/chat/messages/${m.id}`);
    expect((await star(priya, m.id)).status).toBe(409);
  });

  it('the list drops what you can no longer read, and what was deleted — except for an admin', async () => {
    const kept = await say(priya, company, 'kept');
    const gone = await say(priya, company, 'deleted later');
    await star(pavan, kept.id);
    await star(pavan, gone.id);
    await star(admin, gone.id);
    await priya.del(`/chat/messages/${gone.id}`);

    expect((await starred(pavan)).messages.map((m) => m.id)).toEqual([kept.id]);
    expect((await starred(admin)).messages[0]).toMatchObject({ id: gone.id, deleted: true });

    // A custom group Pavan was in, then deleted: its stars disappear from his list.
    const group = await ChatChannel.create({ kind: 'space', name: 'Winch project', audience: 'members', members: [users.pavan._id, users.priya._id] });
    const g = await say(priya, String(group._id), 'group note');
    await star(pavan, g.id);
    expect((await starred(pavan)).messages.map((m) => m.id)).toEqual([g.id, kept.id]);
    await ChatChannel.updateOne({ _id: group._id }, { archived: true });
    expect((await starred(pavan)).messages.map((m) => m.id)).toEqual([kept.id]);
  });

  it('pages newest first by cursor, and skipped stars never stall the paging', async () => {
    const ms = [];
    for (let i = 0; i < 5; i += 1) ms.push(await say(priya, company, `m${i}`));
    for (const m of ms) await star(pavan, m.id);
    await priya.del(`/chat/messages/${ms[3].id}`); // skipped on page 1

    const p1 = await starred(pavan, '?limit=2');
    expect(p1.messages.map((m) => m.text)).toEqual(['m4']); // m3 was deleted
    expect(p1.nextBefore).toBeTruthy();
    const p2 = await starred(pavan, `?limit=2&before=${p1.nextBefore}`);
    expect(p2.messages.map((m) => m.text)).toEqual(['m2', 'm1']);
    const p3 = await starred(pavan, `?limit=2&before=${p2.nextBefore}`);
    expect(p3.messages.map((m) => m.text)).toEqual(['m0']);
    expect(p3.nextBefore).toBeNull();

    expect((await pavan.get('/chat/starred?before=nope')).status).toBe(400);
    expect((await pavan.get('/chat/starred?limit=500')).status).toBe(400);
  });
});
