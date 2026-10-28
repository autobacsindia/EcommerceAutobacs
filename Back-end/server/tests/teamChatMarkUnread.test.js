/**
 * "Mark as unread" (chatService.markUnreadFrom).
 *
 * What must hold:
 *   - the message and everything after it in ITS tab count as unread again —
 *     Chat and Order updates stay independent;
 *   - only for the person who asked; doing it twice is the same as once;
 *   - it never moves a read position forward;
 *   - a message in a conversation you cannot read is "not found".
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import ChatReadState from '../models/ChatReadState.js';
import { postSystemMessage } from '../services/chatService.js';

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
  };
}
const staff = (team) => ({ team, isHead: false, active: true });
const createUser = async ({ name, email, role = 'customer', staff: s }) => User.create({
  name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4),
});

describe('Mark as unread', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let pavan, priya, sana, procurement;
  beforeEach(async () => {
    await createUser({ name: 'Pavan', email: 'pavan@example.com', role: 'staff', staff: staff('procurement') });
    await createUser({ name: 'Priya', email: 'priya@example.com', role: 'staff', staff: staff('procurement') });
    await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales') });
    pavan = await signIn('pavan@example.com');
    priya = await signIn('priya@example.com');
    sana = await signIn('sana@example.com');
    procurement = (await pavan.get('/chat/channels')).body.channels.find((c) => c.key === 'team:procurement').id;
  });

  let n = 0;
  const say = async (text, body = {}) => {
    const res = await priya.post(`/chat/channels/${procurement}/messages`, { text, clientId: `unread-${++n}-test`, ...body });
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const mine = async (who = pavan) => (await who.get('/chat/channels')).body.channels.find((c) => c.id === procurement);
  const readAll = async () => {
    const c = await mine();
    await pavan.post(`/chat/channels/${procurement}/read`, { seq: c.lastMessageSeq });
  };

  it('makes that message and everything after it unread again', async () => {
    await say('one');
    const two = await say('two');
    await say('three');
    await readAll();
    expect((await mine()).unread).toBe(0);

    const res = await pavan.post(`/chat/messages/${two.id}/unread`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ channelId: procurement, part: 'chat', lastReadSeq: two.seq - 1 });
    expect((await mine()).unreadChat).toBe(2);
  });

  it('is only for me', async () => {
    const one = await say('one');
    await readAll();
    await priya.post(`/chat/messages/${one.id}/unread`);
    expect((await mine()).unread).toBe(0);
  });

  it('twice is the same as once, and never moves the read position forward', async () => {
    const one = await say('one');
    const two = await say('two');
    await readAll();
    await pavan.post(`/chat/messages/${one.id}/unread`);
    await pavan.post(`/chat/messages/${one.id}/unread`);
    expect((await mine()).unreadChat).toBe(2);
    // Marking a LATER message unread must not mark the earlier one read.
    await pavan.post(`/chat/messages/${two.id}/unread`);
    expect((await mine()).unreadChat).toBe(2);
  });

  it('Chat and Order updates stay separate', async () => {
    const chat = await say('a person');
    await postSystemMessage('team:procurement', 'Order #AB12 paid', { key: 'u-1' });
    await readAll();

    await pavan.post(`/chat/messages/${chat.id}/unread`);
    let c = await mine();
    expect(c).toMatchObject({ unreadChat: 1, unreadUpdates: 0 });

    await readAll();
    const update = (await pavan.get(`/chat/channels/${procurement}/messages`)).body.messages.find((m) => m.kind === 'system');
    const res = await pavan.post(`/chat/messages/${update.id}/unread`);
    expect(res.body.part).toBe('updates');
    c = await mine();
    expect(c).toMatchObject({ unreadChat: 0, unreadUpdates: 1 });
  });

  it('works on a row from before the two tabs had separate positions', async () => {
    const one = await say('one');
    await postSystemMessage('team:procurement', 'Order #CD34 paid', { key: 'u-2' });
    await readAll();
    // An old-style row: only lastReadSeq, which then meant both tabs.
    await ChatReadState.updateMany({}, { $unset: { lastReadUpdatesSeq: '' } });
    expect(await ChatReadState.countDocuments({ lastReadUpdatesSeq: { $exists: true } })).toBe(0);
    await pavan.post(`/chat/messages/${one.id}/unread`);
    expect(await mine()).toMatchObject({ unreadChat: 1, unreadUpdates: 0 });
  });

  it('works on a thread reply', async () => {
    const root = await say('root');
    const reply = await say('reply', { threadRoot: root.id });
    await readAll();
    await pavan.post(`/chat/messages/${reply.id}/unread`);
    expect((await mine()).unreadChat).toBe(1);
  });

  it('a message you cannot read is "not found"', async () => {
    const one = await say('team only');
    expect((await sana.post(`/chat/messages/${one.id}/unread`)).status).toBe(404);
    expect((await sana.post('/chat/messages/64b7f0f0f0f0f0f0f0f0f0f0/unread')).status).toBe(404);
    expect((await sana.post('/chat/messages/nope/unread')).status).toBe(400);
  });
});
